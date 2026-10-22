-- Várias fotografias por publicação (carrossel), em ordem.
CREATE TABLE content.post_media (
  post_id  uuid NOT NULL REFERENCES content.posts(id) ON DELETE CASCADE,
  media_id uuid NOT NULL REFERENCES content.media_assets(id),
  position smallint NOT NULL CHECK (position BETWEEN 0 AND 9),
  PRIMARY KEY (post_id, position),
  UNIQUE (media_id)
);

INSERT INTO content.post_media (post_id, media_id, position)
SELECT id, media_id, 0 FROM content.posts WHERE media_id IS NOT NULL;

ALTER TABLE content.posts DROP COLUMN media_id;
