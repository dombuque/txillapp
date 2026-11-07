-- Resposta a um Zás: a mensagem leva a foto do Zás (em story_media_id), para a conversa mostrar de que Zás se fala.
ALTER TABLE social.messages DROP CONSTRAINT messages_kind_check;
ALTER TABLE social.messages ADD CONSTRAINT messages_kind_check CHECK (kind IN ('text', 'story_reply', 'story_reaction', 'image', 'voice', 'sticker', 'location', 'post', 'gift', 'video', 'zas_reply'));
