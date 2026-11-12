-- Sons das tchekas (como no TikTok): cada tcheka liga-se a um «som», que tem página própria (/som/:id), a grelha das tchekas
-- que o usam e o botão «Usar este som». Ver docs/sons.md.
--
--  - 'original': o áudio tirado no servidor (ffmpeg) de uma tcheka publicada com o som do próprio vídeo, sem música escolhida
--    («Som original · @autor»). Até 60 s, AAC (M4A), guardado como ficheiro privado ('music') e servido só com URL assinado.
--  - 'catalog' / 'local': uma faixa do catálogo curado ou dos artistas de Moçambique. A linha cria-se no primeiro uso numa tcheka;
--    o id deriva da faixa: 'cat:<id da faixa>' ou o próprio 'local:<uuid>'.
CREATE TABLE content.sounds (
  id              text PRIMARY KEY CHECK (char_length(id) BETWEEN 3 AND 90),
  kind            text NOT NULL CHECK (kind IN ('original', 'catalog', 'local')),
  -- original: quem publicou a tcheka de onde saiu o som.
  owner_id        uuid REFERENCES identity.users(id) ON DELETE CASCADE,
  source_post_id  uuid REFERENCES content.posts(id) ON DELETE SET NULL,
  -- catalog / local: a faixa e a cópia dela no formato guardado nos posts (para o título e a capa se a faixa sair do catálogo).
  track_id        text,
  track           jsonb,
  title           text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 160),
  -- original: o áudio extraído (privado) e o vídeo de onde saiu (a capa é a imagem de capa desse vídeo).
  audio_media_id  uuid REFERENCES content.media_assets(id) ON DELETE SET NULL,
  cover_media_id  uuid REFERENCES content.media_assets(id) ON DELETE SET NULL,
  duration_ms     integer CHECK (duration_ms IS NULL OR duration_ms BETWEEN 1 AND 3600000),
  -- Denúncia «Este som tem música protegida» por analisar: o som não se pode usar em tchekas novas (continua a tocar nas que já o usam).
  hold_at         timestamptz,
  -- Tirado pela equipa (direitos procedentes) ou com a conta eliminada: deixa de existir e de tocar, também nos usos antigos.
  removed_at      timestamptz,
  removed_reason  text CHECK (removed_reason IS NULL OR char_length(removed_reason) <= 300),
  created_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (kind <> 'original' OR owner_id IS NOT NULL),
  CHECK (kind = 'original' OR track_id IS NOT NULL)
);
-- Uma tcheka dá no máximo um som original; uma faixa tem um só som.
CREATE UNIQUE INDEX sounds_source_post ON content.sounds (source_post_id) WHERE kind = 'original' AND source_post_id IS NOT NULL;
CREATE UNIQUE INDEX sounds_track ON content.sounds (track_id) WHERE track_id IS NOT NULL;
CREATE INDEX sounds_owner ON content.sounds (owner_id) WHERE owner_id IS NOT NULL;
CREATE INDEX sounds_held ON content.sounds (hold_at) WHERE hold_at IS NOT NULL;

-- A tcheka e o som que usa (só tchekas: uma publicação com um só vídeo). Os usos contam-se por publicação.
ALTER TABLE content.posts ADD COLUMN IF NOT EXISTS sound_id text REFERENCES content.sounds(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS posts_sound_idx ON content.posts (sound_id, created_at DESC) WHERE sound_id IS NOT NULL AND removed_at IS NULL;
-- Quando o servidor já viu se a tcheka tinha som próprio (com ou sem som tirado): as tchekas antigas tratam-se aos poucos.
ALTER TABLE content.posts ADD COLUMN IF NOT EXISTS sound_checked_at timestamptz;

-- Definições → Conteúdo → «Deixar usar o meu som» (ligado por omissão). Numa conta privada vale sempre como desligado.
ALTER TABLE identity.users ADD COLUMN IF NOT EXISTS sound_reuse boolean NOT NULL DEFAULT true;

-- Denúncias de um som original («Este som tem música protegida» ou outro motivo). Uma por pessoa e som.
CREATE TABLE content.sound_reports (
  id              uuid PRIMARY KEY,
  sound_id        text NOT NULL REFERENCES content.sounds(id) ON DELETE CASCADE,
  reporter_id     uuid NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  reason          text NOT NULL CHECK (reason IN ('copyright', 'other')),
  note            text CHECK (note IS NULL OR char_length(note) <= 500),
  status          text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'upheld', 'dismissed')),
  decided_by      uuid REFERENCES identity.users(id) ON DELETE SET NULL,
  decided_at      timestamptz,
  decision_reason text CHECK (decision_reason IS NULL OR char_length(decision_reason) <= 300),
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (sound_id, reporter_id)
);
CREATE INDEX sound_reports_open ON content.sound_reports (status, created_at);
CREATE INDEX sound_reports_reporter ON content.sound_reports (reporter_id);
