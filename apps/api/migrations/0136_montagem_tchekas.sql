-- Montagem das tchekas no servidor (POST /tchekas/compose; ver docs/montagem.md): a app nativa manda os clipes já enviados
-- (fotos e vídeos), a música ou o som, o texto, os stickers e o filtro, e o servidor monta o vídeo final com o ffmpeg.
-- Cada pedido é um «job» numa fila em memória; a linha guarda o estado para ele sobreviver a um reinício do servidor (os
-- que estavam a meio passam a 'failed', com «Tenta outra vez»).
CREATE TABLE content.compose_jobs (
  id          uuid PRIMARY KEY,
  owner_id    uuid NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  status      text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'working', 'done', 'failed')),
  progress    real NOT NULL DEFAULT 0 CHECK (progress >= 0 AND progress <= 1),
  -- O pedido já validado e resolvido (durações, de onde vem o áudio): é só isto que o trabalho lê.
  spec        jsonb NOT NULL,
  -- O vídeo final (content.media_assets, 'public', pronto e `signed`), para publicar com POST /posts.
  media_id    uuid REFERENCES content.media_assets(id) ON DELETE SET NULL,
  error       text CHECK (error IS NULL OR char_length(error) <= 300),
  duration_ms integer CHECK (duration_ms IS NULL OR duration_ms BETWEEN 1 AND 61000),
  created_at  timestamptz NOT NULL DEFAULT now(),
  started_at  timestamptz,
  finished_at timestamptz
);
-- Uma montagem de cada vez por pessoa (a fila é partilhada): a segunda recusa-se logo.
CREATE UNIQUE INDEX compose_jobs_one_active ON content.compose_jobs (owner_id) WHERE status IN ('queued', 'working');
CREATE INDEX compose_jobs_owner_idx ON content.compose_jobs (owner_id, created_at DESC);
CREATE INDEX compose_jobs_open_idx ON content.compose_jobs (created_at) WHERE status IN ('queued', 'working');
