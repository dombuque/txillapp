-- Txillada (os lives), fase 1 (docs/txillada-contrato.md). O vídeo passa só pelo LiveKit, ao vivo: aqui não se grava nada.
-- A API guarda o estado, os comentários, os brindes e as expulsões, e dá os acessos (tokens LiveKit).
--
-- 1. A Txillada. `room` é o nome da sala no LiveKit (`tx-<id>`). No máximo uma 'live' por anfitrião (o índice único parcial,
--    que é também o índice das que estão a decorrer). `viewers` é quantos estão na sala agora (o webhook do LiveKit) e
--    `peak_viewers` o máximo. `video_on`/`video_at`: o anfitrião está a publicar vídeo (webhook track_published) e a última
--    vez que se soube que havia vídeo; sem vídeo há 60 s, a tarefa do servidor acaba-a. `notified`: avisou os seguidores (no
--    máximo um aviso por anfitrião por hora). A linha fica como registo (título, horas, números) e sai com a conta.
CREATE TABLE content.txilladas (
  id           uuid PRIMARY KEY,
  host_id      uuid NOT NULL REFERENCES identity.users (id) ON DELETE CASCADE,
  title        text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 80),
  audience     text NOT NULL DEFAULT 'everyone' CHECK (audience IN ('everyone', 'followers', 'close')),
  status       text NOT NULL DEFAULT 'live' CHECK (status IN ('live', 'ended', 'cut')),
  room         text NOT NULL UNIQUE,
  started_at   timestamptz NOT NULL DEFAULT now(),
  ended_at     timestamptz,
  viewers      int NOT NULL DEFAULT 0,
  peak_viewers int NOT NULL DEFAULT 0,
  cheers       int NOT NULL DEFAULT 0,
  comments     int NOT NULL DEFAULT 0,
  cut_reason   text,
  cut_by       uuid REFERENCES identity.users (id) ON DELETE SET NULL,
  video_on     boolean NOT NULL DEFAULT false,
  video_at     timestamptz,
  notified     boolean NOT NULL DEFAULT false
);
CREATE UNIQUE INDEX txilladas_one_live ON content.txilladas (host_id) WHERE status = 'live';
CREATE INDEX txilladas_host_idx ON content.txilladas (host_id, started_at DESC);
-- A limpeza dos 7 dias (comentários e brindes das acabadas).
CREATE INDEX txilladas_ended_idx ON content.txilladas (ended_at) WHERE status <> 'live';

-- 2. Comentários (1 a 300, pelo filtro de palavras). Apagar (anfitrião ou autor) marca `removed_at`. Os de uma Txillada
--    acabada apagam-se 7 dias depois do fim, menos os de uma Txillada com denúncia por decidir.
CREATE TABLE content.txillada_comments (
  id          uuid PRIMARY KEY,
  txillada_id uuid NOT NULL REFERENCES content.txilladas (id) ON DELETE CASCADE,
  author_id   uuid NOT NULL REFERENCES identity.users (id) ON DELETE CASCADE,
  body        text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 300),
  created_at  timestamptz NOT NULL DEFAULT now(),
  removed_at  timestamptz
);
CREATE INDEX txillada_comments_tx_idx ON content.txillada_comments (txillada_id, id);
CREATE INDEX txillada_comments_author_idx ON content.txillada_comments (author_id);

-- 3. Brindes: uma linha por pessoa e Txillada, com quantos brindou.
CREATE TABLE content.txillada_cheers (
  txillada_id uuid NOT NULL REFERENCES content.txilladas (id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES identity.users (id) ON DELETE CASCADE,
  count       int NOT NULL DEFAULT 0,
  last_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (txillada_id, user_id)
);
CREATE INDEX txillada_cheers_user_idx ON content.txillada_cheers (user_id);

-- 4. Expulsos: não voltam a entrar nesta Txillada.
CREATE TABLE content.txillada_bans (
  txillada_id uuid NOT NULL REFERENCES content.txilladas (id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES identity.users (id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (txillada_id, user_id)
);
CREATE INDEX txillada_bans_user_idx ON content.txillada_bans (user_id);

-- 5. Denunciar uma Txillada ('txillada'): junta-se aos tipos que já existem, sem tirar nenhum (como na 0125).
DO $$
DECLARE def text; kinds text[];
BEGIN
  SELECT pg_get_constraintdef(oid) INTO def FROM pg_constraint
   WHERE conname = 'reports_target_type_check' AND conrelid = 'social.reports'::regclass;
  SELECT array_agg(DISTINCT k ORDER BY k) INTO kinds FROM (
    SELECT (regexp_matches(coalesce(def, ''), '''([a-z_]+)''', 'g'))[1] AS k
    UNION SELECT unnest(string_to_array((regexp_match(coalesce(def, ''), '\{([a-z_,]+)\}'))[1], ','))
    UNION SELECT unnest(ARRAY['post', 'comment', 'story', 'user', 'message', 'media', 'venue', 'story_comment', 'instant', 'txillada'])
  ) x WHERE k IS NOT NULL AND k <> '';
  ALTER TABLE social.reports DROP CONSTRAINT IF EXISTS reports_target_type_check;
  EXECUTE format('ALTER TABLE social.reports ADD CONSTRAINT reports_target_type_check CHECK (target_type = ANY (%L::text[]))', kinds);
END $$;

-- 6. O aviso novo 'txillada_live': alguém que sigo abriu uma Txillada. Ator = o anfitrião. data: { txilladaId, title }.
DO $$
DECLARE def text; kinds text[];
BEGIN
  SELECT pg_get_constraintdef(oid) INTO def FROM pg_constraint
   WHERE conname = 'notifications_kind_check' AND conrelid = 'social.notifications'::regclass;
  SELECT array_agg(DISTINCT k ORDER BY k) INTO kinds FROM (
    SELECT (regexp_matches(coalesce(def, ''), '''([a-z_]+)''', 'g'))[1] AS k
    UNION SELECT unnest(string_to_array((regexp_match(coalesce(def, ''), '\{([a-z_,]+)\}'))[1], ','))
    UNION SELECT unnest(ARRAY['txillada_live'])
  ) x WHERE k IS NOT NULL AND k <> '';
  ALTER TABLE social.notifications DROP CONSTRAINT IF EXISTS notifications_kind_check;
  EXECUTE format('ALTER TABLE social.notifications ADD CONSTRAINT notifications_kind_check CHECK (kind = ANY (%L::text[]))', kinds);
END $$;
