-- Fontes ao publicar (docs/fontes-contrato.md): as 10 letras do estúdio das tchekas (@txillapp/shared TEXT_FONT_IDS) também
-- nas publicações só com texto e na legenda do Zás. Os textos por cima dos mimos não precisam de coluna: vão na lista
-- content.stories.stickers, ao lado dos stickers (`kind: 'text'`).
--
-- Guarda-se o id da fonte como texto, sem CHECK: o servidor valida-o à entrada e quem lê trata um id desconhecido (ou NULL)
-- como 'classica'. Assim uma fonte nova não precisa de migração.

-- A letra de uma publicação sem fotos nem vídeos (com ficheiros fica NULL).
ALTER TABLE content.posts ADD COLUMN text_font text NULL;

-- A letra da legenda de um Zás (sem legenda fica NULL).
ALTER TABLE social.instants ADD COLUMN caption_font text NULL;
