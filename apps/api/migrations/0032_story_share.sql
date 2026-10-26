-- Partilhar uma publicação (foto ou reel) no próprio status. O story usa o mesmo ficheiro e guarda de onde veio.
ALTER TABLE content.stories ADD COLUMN shared_post_id uuid REFERENCES content.posts(id) ON DELETE SET NULL;
ALTER TABLE content.stories DROP CONSTRAINT stories_media_id_key;
-- Os stories normais continuam com um ficheiro próprio e único; os partilhados reutilizam o da publicação.
CREATE UNIQUE INDEX stories_media_unique ON content.stories (media_id) WHERE shared_post_id IS NULL;
CREATE INDEX stories_shared_idx ON content.stories (shared_post_id) WHERE shared_post_id IS NOT NULL;
