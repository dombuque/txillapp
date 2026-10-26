-- Chat: fotos e mensagens de voz (ficheiros privados), apagar mensagens.
ALTER TABLE content.media_assets DROP CONSTRAINT media_assets_mime_check;
ALTER TABLE content.media_assets ADD CONSTRAINT media_assets_mime_check
  CHECK (mime IN ('image/jpeg', 'image/png', 'image/webp', 'audio/webm', 'audio/ogg', 'audio/mp4'));
-- 'chat' = só os participantes da conversa, por URL assinado e temporário; 'public' = fotos de posts, stories e perfis.
ALTER TABLE content.media_assets ADD COLUMN purpose text NOT NULL DEFAULT 'public' CHECK (purpose IN ('public', 'chat'));

ALTER TABLE social.messages DROP CONSTRAINT messages_kind_check;
ALTER TABLE social.messages ADD CONSTRAINT messages_kind_check CHECK (kind IN ('text', 'story_reply', 'story_reaction', 'image', 'voice'));
ALTER TABLE social.messages DROP CONSTRAINT messages_body_check;
ALTER TABLE social.messages ADD CONSTRAINT messages_body_check CHECK (char_length(body) <= 2000);
ALTER TABLE social.messages
  ADD COLUMN media_id    uuid REFERENCES content.media_assets(id) ON DELETE SET NULL,
  ADD COLUMN duration_ms integer CHECK (duration_ms IS NULL OR duration_ms BETWEEN 0 AND 300000),
  ADD COLUMN deleted_at  timestamptz;
