-- Resumo semanal dos Zás (0163).
-- Um Zás continua a desaparecer para os outros às 24 h (expires_at). Para quem o fez, com «Guardar os meus Zás para o
-- resumo semanal» ligada (identity.users.zas_keep, ligada por omissão), a foto fica 7 dias (keep_until), só para ele: no
-- arquivo («Os meus Zás») e no resumo da semana. Ao fim de 7 dias apaga-se mesmo (a linha e o ficheiro); com a definição
-- desligada apaga-se às 24 h (InstantsRecapService.sweep).

ALTER TABLE identity.users ADD COLUMN IF NOT EXISTS zas_keep boolean NOT NULL DEFAULT true;

-- Até quando o autor ainda vê o Zás (null: só até expires_at, como antes). Nunca antes de expires_at.
ALTER TABLE social.instants ADD COLUMN IF NOT EXISTS keep_until timestamptz NULL;

-- Os Zás dos últimos 7 dias (os que não foram tirados pela moderação, que lhes pôs expires_at = a hora da remoção) ficam
-- guardados para o primeiro resumo, como os novos.
UPDATE social.instants SET keep_until = created_at + interval '7 days'
 WHERE created_at > now() - interval '7 days' AND expires_at >= created_at + interval '23 hours' AND keep_until IS NULL;

-- A limpeza procura pelo fim de cada Zás (o que vier depois: as 24 h ou os 7 dias).
CREATE INDEX IF NOT EXISTS instants_gone_idx ON social.instants ((coalesce(keep_until, expires_at)));

-- O resumo da semana: a imagem (privada, só o dono a vê até a publicar nos mimos), a semana (de Maputo) e quantos Zás.
-- Apaga-se ao fim de 7 dias (a linha e o ficheiro). Publicado: story_id aponta para o mimo (que tem a sua própria cópia).
CREATE TABLE IF NOT EXISTS social.zas_recaps (
  id            uuid PRIMARY KEY,
  user_id       uuid NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  week_start    date NOT NULL,
  week_end      date NOT NULL,
  media_id      uuid NOT NULL REFERENCES content.media_assets(id) ON DELETE CASCADE,
  instant_count int NOT NULL,
  photo_count   int NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL DEFAULT now() + interval '7 days',
  story_id      uuid NULL REFERENCES content.stories(id) ON DELETE SET NULL,
  published_audience text NULL CHECK (published_audience IN ('all', 'close_friends')),
  published_at  timestamptz NULL,
  UNIQUE (user_id, week_end)
);
CREATE INDEX IF NOT EXISTS zas_recaps_expires_idx ON social.zas_recaps (expires_at);

-- O aviso novo 'zas_recap': o meu resumo da semana está pronto. Ator = a própria pessoa (a lista mostra-o como Txillapp).
-- data: { recapId, label, count }.
DO $$
DECLARE def text; kinds text[];
BEGIN
  SELECT pg_get_constraintdef(oid) INTO def FROM pg_constraint
   WHERE conname = 'notifications_kind_check' AND conrelid = 'social.notifications'::regclass;
  SELECT array_agg(DISTINCT k ORDER BY k) INTO kinds FROM (
    SELECT (regexp_matches(coalesce(def, ''), '''([a-z_]+)''', 'g'))[1] AS k
    UNION SELECT unnest(string_to_array((regexp_match(coalesce(def, ''), '\{([a-z_,]+)\}'))[1], ','))
    UNION SELECT unnest(ARRAY['zas_recap'])
  ) x WHERE k IS NOT NULL AND k <> '';
  ALTER TABLE social.notifications DROP CONSTRAINT IF EXISTS notifications_kind_check;
  EXECUTE format('ALTER TABLE social.notifications ADD CONSTRAINT notifications_kind_check CHECK (kind = ANY (%L::text[]))', kinds);
END $$;
-- O ator do 'zas_recap' é a própria pessoa (como no 'verified' e no 'sound_review').
ALTER TABLE social.notifications DROP CONSTRAINT IF EXISTS notifications_check;
ALTER TABLE social.notifications ADD CONSTRAINT notifications_check CHECK (user_id <> actor_id OR kind IN ('verified', 'sound_review', 'zas_recap'));
