-- Vídeos curtos (até 60 s): enviados, convertidos para MP4 (H.264/AAC), com imagem de capa e verificação de conteúdo.
ALTER TABLE content.media_assets DROP CONSTRAINT media_assets_mime_check;
ALTER TABLE content.media_assets ADD CONSTRAINT media_assets_mime_check
  CHECK (mime IN ('image/jpeg', 'image/png', 'image/webp', 'audio/webm', 'audio/ogg', 'audio/mp4', 'video/mp4', 'video/quicktime', 'video/webm'));
ALTER TABLE content.media_assets DROP CONSTRAINT media_assets_status_check;
ALTER TABLE content.media_assets ADD CONSTRAINT media_assets_status_check CHECK (status IN ('pending', 'uploaded', 'processing', 'ready', 'deleted'));
ALTER TABLE content.media_assets
  ADD COLUMN duration_ms integer,
  ADD COLUMN width integer,
  ADD COLUMN height integer,
  ADD COLUMN processing_error text;
CREATE INDEX media_video_idx ON content.media_assets (id) WHERE mime LIKE 'video/%';
