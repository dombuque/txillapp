-- Programa de artistas moçambicanos: os artistas e as editoras carregam as próprias músicas e autorizam o uso no Txillapp
-- (mimos e tchekas), com a «Licença de uso de música no Txillapp». Em troca ganham destaque e uma ligação ao perfil.
-- No seletor de música estas faixas têm `source: 'local'`.

-- 1. Ficheiros de música: áudio MP3 (audio/mpeg), M4A (audio/mp4) e AAC (audio/aac), guardados à parte ('music', privados,
--    servidos só com URL assinado). Junta-se aos tipos e às finalidades que já existem, sem tirar nenhum.
DO $$
DECLARE c record;
BEGIN
  FOR c IN SELECT conname FROM pg_constraint
            WHERE conrelid = 'content.media_assets'::regclass AND contype = 'c'
              AND (pg_get_constraintdef(oid) LIKE '%purpose%' OR conname = 'media_assets_mime_check')
  LOOP
    EXECUTE format('ALTER TABLE content.media_assets DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;
ALTER TABLE content.media_assets ADD CONSTRAINT media_assets_mime_check
  CHECK (mime IN ('image/jpeg', 'image/png', 'image/webp', 'audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/aac', 'video/mp4', 'video/quicktime', 'video/webm'));
ALTER TABLE content.media_assets ADD CONSTRAINT media_assets_purpose_check CHECK (purpose IN ('public', 'chat', 'music'));

-- 2. O pedido de artista (um por conta). Fica 'approved' quando a equipa aprova; a conta passa a ter a etiqueta «Artista»
--    no perfil (não é o selo de verificado). 'revoked': a equipa tirou o estatuto (as faixas deixam de estar disponíveis).
CREATE TABLE content.artist_profiles (
  user_id          uuid PRIMARY KEY REFERENCES identity.users(id) ON DELETE CASCADE,
  stage_name       text NOT NULL CHECK (char_length(stage_name) BETWEEN 2 AND 60),
  styles           text[] NOT NULL DEFAULT '{}',
  -- [{ kind: 'instagram' | 'facebook' | 'tiktok' | 'youtube' | 'spotify' | 'apple_music' | 'audiomack' | 'boomplay' | 'site', url }]
  links            jsonb NOT NULL DEFAULT '[]',
  -- Quem tem os direitos: uma editora ('label', com o nome) ou o próprio artista ('self', com a declaração).
  rights_kind      text NOT NULL CHECK (rights_kind IN ('label', 'self')),
  label_name       text CHECK (label_name IS NULL OR char_length(label_name) <= 80),
  rights_statement text NOT NULL CHECK (char_length(rights_statement) BETWEEN 20 AND 1000),
  -- Prova opcional (contrato, carta da editora, registo na SOMAS…): uma foto privada, só a equipa a vê.
  proof_media_id   uuid REFERENCES content.media_assets(id) ON DELETE SET NULL,
  status           text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'revoked', 'withdrawn')),
  review_reason    text CHECK (review_reason IS NULL OR char_length(review_reason) <= 300),
  reviewed_by      uuid REFERENCES identity.users(id) ON DELETE SET NULL,
  reviewed_at      timestamptz,
  approved_at      timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX artist_profiles_queue ON content.artist_profiles (status, updated_at);

-- 3. As faixas. 'pending' até a equipa as moderar; 'withdrawn' quando o artista as retira (deixam de estar disponíveis para
--    novos usos, mas os mimos e tchekas antigos continuam a tocar); 'removed' quando a equipa as tira (direitos, regras ou conta
--    eliminada). `hold_at`: escondida por uma denúncia de direitos de autor enquanto a equipa analisa.
CREATE TABLE content.artist_tracks (
  id               uuid PRIMARY KEY,
  artist_id        uuid NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  title            text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 100),
  styles           text[] NOT NULL DEFAULT '{}',
  explicit         boolean NOT NULL DEFAULT false,
  -- O ficheiro original (privado, nunca sai do servidor) e o trecho que se ouve no Txillapp (cortado no servidor).
  audio_media_id   uuid REFERENCES content.media_assets(id) ON DELETE SET NULL,
  preview_media_id uuid REFERENCES content.media_assets(id) ON DELETE SET NULL,
  cover_media_id   uuid REFERENCES content.media_assets(id) ON DELETE SET NULL,
  duration_ms      integer NOT NULL CHECK (duration_ms > 0),
  preview_start_ms integer NOT NULL CHECK (preview_start_ms >= 0),
  preview_ms       integer NOT NULL CHECK (preview_ms BETWEEN 10000 AND 60000),
  status           text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'withdrawn', 'removed')),
  hold_at          timestamptz,
  review_reason    text CHECK (review_reason IS NULL OR char_length(review_reason) <= 300),
  reviewed_by      uuid REFERENCES identity.users(id) ON DELETE SET NULL,
  reviewed_at      timestamptz,
  approved_at      timestamptz,
  withdrawn_at     timestamptz,
  removed_at       timestamptz,
  -- A versão da licença aceite ao carregar (o registo completo está em artist_track_licenses).
  license_version  text NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX artist_tracks_artist ON content.artist_tracks (artist_id, created_at DESC);
CREATE INDEX artist_tracks_available ON content.artist_tracks (approved_at DESC) WHERE status = 'approved' AND hold_at IS NULL;
CREATE INDEX artist_tracks_queue ON content.artist_tracks (created_at) WHERE status = 'pending';
CREATE INDEX artist_tracks_preview ON content.artist_tracks (preview_media_id);

-- 4. Quem aceitou a licença, que versão do texto (e o resumo SHA-256 do texto exato) e quando. Fica mesmo que a faixa saia:
--    é a prova da autorização para os usos já feitos.
CREATE TABLE content.artist_track_licenses (
  id          uuid PRIMARY KEY,
  track_id    uuid NOT NULL REFERENCES content.artist_tracks(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  version     text NOT NULL,
  text_sha256 text NOT NULL,
  accepted_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX artist_track_licenses_track ON content.artist_track_licenses (track_id);

-- 5. Cada uso numa publicação (tcheka) ou num mimo: o artista só vê os totais (quantas vezes e por quantas pessoas).
CREATE TABLE content.artist_track_uses (
  track_id   uuid NOT NULL REFERENCES content.artist_tracks(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  surface    text NOT NULL CHECK (surface IN ('post', 'story')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX artist_track_uses_track ON content.artist_track_uses (track_id);
CREATE INDEX artist_track_uses_user ON content.artist_track_uses (user_id);

-- 6. Denúncias de violação de direitos de autor sobre uma faixa. A faixa fica escondida (hold_at) enquanto houver uma aberta.
CREATE TABLE content.artist_track_claims (
  id            uuid PRIMARY KEY,
  track_id      uuid NOT NULL REFERENCES content.artist_tracks(id) ON DELETE CASCADE,
  reporter_id   uuid REFERENCES identity.users(id) ON DELETE SET NULL,
  claimant_name text NOT NULL CHECK (char_length(claimant_name) BETWEEN 2 AND 80),
  contact_email text NOT NULL CHECK (char_length(contact_email) BETWEEN 3 AND 160),
  relation      text NOT NULL CHECK (relation IN ('owner', 'label', 'representative', 'other')),
  details       text NOT NULL CHECK (char_length(details) BETWEEN 10 AND 1000),
  status        text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'upheld', 'dismissed')),
  decision_note text CHECK (decision_note IS NULL OR char_length(decision_note) <= 300),
  decided_by    uuid REFERENCES identity.users(id) ON DELETE SET NULL,
  decided_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX artist_track_claims_open ON content.artist_track_claims (created_at) WHERE status = 'open';
CREATE UNIQUE INDEX artist_track_claims_once ON content.artist_track_claims (track_id, reporter_id) WHERE status = 'open' AND reporter_id IS NOT NULL;

-- 7. Avisos da equipa sobre o programa de artistas (pedido aprovado/recusado, faixa aprovada/recusada/retirada/escondida).
--    data: { what: 'artist' | 'track', decision, title?, reason? }. Mesma regra de união das outras migrações.
DO $$
DECLARE def text; kinds text[];
BEGIN
  SELECT pg_get_constraintdef(oid) INTO def FROM pg_constraint
   WHERE conname = 'notifications_kind_check' AND conrelid = 'social.notifications'::regclass;
  SELECT array_agg(DISTINCT k ORDER BY k) INTO kinds FROM (
    SELECT (regexp_matches(coalesce(def, ''), '''([a-z_]+)''', 'g'))[1] AS k
    UNION SELECT unnest(string_to_array((regexp_match(coalesce(def, ''), '\{([a-z_,]+)\}'))[1], ','))
    UNION SELECT unnest(ARRAY['music_review'])
  ) x WHERE k IS NOT NULL AND k <> '';
  ALTER TABLE social.notifications DROP CONSTRAINT IF EXISTS notifications_kind_check;
  EXECUTE format('ALTER TABLE social.notifications ADD CONSTRAINT notifications_kind_check CHECK (kind = ANY (%L::text[]))', kinds);
END $$;
