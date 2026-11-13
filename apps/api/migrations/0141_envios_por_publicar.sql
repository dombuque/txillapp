-- Envios por publicar (UnusedMediaService, media-refs.ts): de hora a hora apagam-se os ficheiros que ninguém usa há mais de
-- 48 horas. Para ver depressa se um ficheiro está em uso, índices nas colunas grandes que ainda não os tinham.
CREATE INDEX IF NOT EXISTS messages_media_idx ON social.messages (media_id) WHERE media_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS messages_story_media_idx ON social.messages (story_media_id) WHERE story_media_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS users_avatar_media_idx ON identity.users (avatar_media_id) WHERE avatar_media_id IS NOT NULL;
-- O índice único de 0032 só cobre os mimos que não são partilhas de uma publicação.
CREATE INDEX IF NOT EXISTS stories_media_idx ON content.stories (media_id);
CREATE INDEX IF NOT EXISTS instants_media_idx ON social.instants (media_id);
-- A música de uma publicação ou de um mimo pode ser um áudio meu (clipe: music->>'mediaId').
CREATE INDEX IF NOT EXISTS posts_music_media_idx ON content.posts ((music->>'mediaId')) WHERE music->>'mediaId' IS NOT NULL;
CREATE INDEX IF NOT EXISTS stories_music_media_idx ON content.stories ((music->>'mediaId')) WHERE music->>'mediaId' IS NOT NULL;
-- Os ficheiros de uma pessoa ainda não apagados, para a exportação («Envios por publicar»).
CREATE INDEX IF NOT EXISTS media_assets_live_owner_idx ON content.media_assets (owner_id, created_at) WHERE status <> 'deleted';
