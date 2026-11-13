-- Filas partilhadas entre processos (docs/escala.md): a montagem das tchekas e a conversão dos vídeos correm no worker
-- (ROLE=worker), e as instâncias web só põem o trabalho na fila. Cada trabalho é apanhado por um só processo com
-- UPDATE … WHERE id = (SELECT … FOR UPDATE SKIP LOCKED); quem o apanhou renova `heartbeat_at` enquanto trabalha, e um
-- trabalho «a correr» sem sinal de vida há mais de 2 minutos é de um processo que caiu.

-- Montagem das tchekas (0136): quem está a montar e o último sinal de vida.
ALTER TABLE content.compose_jobs
  ADD COLUMN worker_id    text,
  ADD COLUMN heartbeat_at timestamptz;
CREATE INDEX compose_jobs_queued_idx ON content.compose_jobs (created_at) WHERE status = 'queued';

-- Conversão dos vídeos: antes era uma fila em memória (o vídeo ficava 'processing' para sempre se o processo caísse).
-- A linha existe só enquanto o vídeo está na fila ou a converter; o resultado fica em content.media_assets (status 'ready'
-- ou 'deleted' com processing_error), como sempre.
CREATE TABLE content.video_jobs (
  media_id     uuid PRIMARY KEY REFERENCES content.media_assets(id) ON DELETE CASCADE,
  owner_id     uuid NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  -- Onde fica o vídeo pronto com o armazenamento na nuvem ('public' nas publicações, 'private' nas conversas); NULL = disco.
  scope        text CHECK (scope IS NULL OR scope IN ('public', 'private')),
  -- O instante da capa escolhido no estúdio das tchekas.
  poster_ms    integer CHECK (poster_ms IS NULL OR poster_ms >= 0),
  status       text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'working')),
  attempts     smallint NOT NULL DEFAULT 0,
  worker_id    text,
  heartbeat_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX video_jobs_queued_idx ON content.video_jobs (created_at) WHERE status = 'queued';
