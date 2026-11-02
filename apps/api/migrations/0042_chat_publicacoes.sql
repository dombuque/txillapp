-- Chat: partilhar uma publicação ou reel numa conversa (o texto da mensagem é o id da publicação).
ALTER TABLE social.messages DROP CONSTRAINT messages_kind_check;
ALTER TABLE social.messages ADD CONSTRAINT messages_kind_check CHECK (kind IN ('text', 'story_reply', 'story_reaction', 'image', 'voice', 'sticker', 'location', 'post'));
