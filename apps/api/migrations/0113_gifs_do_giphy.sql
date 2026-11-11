-- GIFs do GIPHY nas conversas (a dois e nos TxillGroups) e nos comentários.
--
-- Uma mensagem kind 'gif' e um comentário com GIF guardam só a referência ao GIF, num jsonb { id, w, h, url, still?, title? }:
-- o servidor já validou que o url (e o still) é https de media*.giphy.com, que o id tem o feitio do GIPHY e que as medidas
-- são razoáveis (src/gifs/gif.ts). A imagem em si não se guarda: o aparelho carrega-a da CDN do GIPHY.
-- "Apagar para todos" (wipeMessage) põe o gif a NULL e o tipo a 'text', como o resto do conteúdo.
ALTER TABLE social.messages DROP CONSTRAINT messages_kind_check;
ALTER TABLE social.messages ADD CONSTRAINT messages_kind_check CHECK (kind IN ('text', 'story_reply', 'story_reaction', 'image', 'voice', 'sticker', 'location', 'post', 'gift', 'video', 'zas_reply', 'call', 'poll', 'gif'));
ALTER TABLE social.messages ADD COLUMN gif jsonb CHECK (gif IS NULL OR jsonb_typeof(gif) = 'object');
ALTER TABLE social.messages ADD CONSTRAINT messages_gif_kind_check CHECK (kind <> 'gif' OR gif IS NOT NULL);

-- Comentários: um GIF opcional, com ou sem texto (sem texto, o body fica '').
ALTER TABLE content.comments ADD COLUMN gif jsonb CHECK (gif IS NULL OR jsonb_typeof(gif) = 'object');
ALTER TABLE content.comments DROP CONSTRAINT comments_body_check;
ALTER TABLE content.comments ADD CONSTRAINT comments_body_check CHECK (char_length(body) <= 1000 AND (char_length(body) >= 1 OR gif IS NOT NULL));
