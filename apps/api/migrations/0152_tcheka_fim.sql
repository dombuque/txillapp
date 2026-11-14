-- Fim de tcheka (posts/music-bake.ts e posts/post-download.service.ts): a música gravada no vídeo e a assinatura de fim nas cópias guardadas.
--
-- 1) content.post_music_bakes: uma tcheka publicada com música à parte (gravada ou escolhida na galeria, sem a montagem do
--    estúdio) ganha, em segundo plano, um vídeo novo com a música misturada (as regras de som da montagem). O vídeo da
--    publicação (content.post_media) fica como estava: a app recebe o vídeo com a música (`media_id`) enquanto a música se
--    puder ouvir (o som não foi tirado, a faixa do artista não está escondida); senão volta ao original. 'inline': o vídeo
--    da publicação já traz a música (montagem do servidor ou estúdio do site), nada a fazer.
CREATE TABLE content.post_music_bakes (
  post_id         uuid PRIMARY KEY REFERENCES content.posts(id) ON DELETE CASCADE,
  -- O vídeo da publicação de onde se parte (o de content.post_media).
  source_media_id uuid NOT NULL REFERENCES content.media_assets(id) ON DELETE CASCADE,
  -- O vídeo com a música (público, pronto); NULL até ficar feito.
  media_id        uuid REFERENCES content.media_assets(id) ON DELETE SET NULL,
  status          text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'working', 'done', 'failed', 'skipped', 'inline')),
  -- A mistura, com os volumes por omissão da montagem (docs/montagem.md, 4-A2): o som do vídeo a 100 % (0 com «Usar este
  -- som») e a música a 70 % por cima de um vídeo; o trecho começa no início da faixa.
  original_volume real NOT NULL DEFAULT 1 CHECK (original_volume BETWEEN 0 AND 1),
  music_volume    real NOT NULL DEFAULT 0.7 CHECK (music_volume BETWEEN 0 AND 1),
  music_start_ms  integer NOT NULL DEFAULT 0 CHECK (music_start_ms >= 0),
  attempts        smallint NOT NULL DEFAULT 0,
  error           text CHECK (error IS NULL OR char_length(error) <= 300),
  worker_id       text,
  heartbeat_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  started_at      timestamptz,
  finished_at     timestamptz
);
CREATE INDEX post_music_bakes_open_idx ON content.post_music_bakes (created_at) WHERE status IN ('queued', 'working', 'failed');

-- As tchekas já publicadas a partir de uma montagem do servidor: a música já vai no vídeo (a app não a toca por cima).
INSERT INTO content.post_music_bakes (post_id, source_media_id, status, finished_at)
SELECT DISTINCT ON (p.id) p.id, pm.media_id, 'inline', now()
  FROM content.posts p
  JOIN content.post_media pm ON pm.post_id = p.id
  JOIN content.compose_jobs j ON j.media_id = pm.media_id AND j.status = 'done'
 WHERE p.music IS NOT NULL
ON CONFLICT (post_id) DO NOTHING;

-- 2) content.post_downloads: a cópia guardada de uma tcheka (com a assinatura e o cartão do fim), feita uma vez por versão
--    (o vídeo de onde parte, o @ e o selo) e servida das vezes seguintes. O ficheiro é privado e expira sozinho
--    (media_assets.expires_at); uma versão nova substitui a anterior.
CREATE TABLE content.post_downloads (
  post_id    uuid NOT NULL REFERENCES content.posts(id) ON DELETE CASCADE,
  version    text NOT NULL CHECK (char_length(version) <= 64),
  media_id   uuid NOT NULL REFERENCES content.media_assets(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, version)
);

-- Procurar pelo ficheiro (a quota de vídeos por hora não conta estas cópias; apagar um ficheiro não varre a tabela toda).
CREATE INDEX post_music_bakes_media_idx ON content.post_music_bakes (media_id) WHERE media_id IS NOT NULL;
CREATE INDEX post_downloads_media_idx ON content.post_downloads (media_id);
