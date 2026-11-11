-- Denúncias guardam prova: quando alguém denuncia uma mensagem, fica uma cópia do que lá estava nesse momento (o tipo, o
-- texto, o nome e a morada do sítio e a hora da última edição), para a moderação ver o que foi denunciado mesmo que a
-- mensagem seja depois editada ou apagada. Sem ficheiros nem coordenadas: só isto.
-- A cópia vive com a denúncia: sai quando a denúncia sai (quem denunciou elimina a conta) e segue o prazo de retenção das
-- denúncias quando houver um (hoje não há nenhum).
ALTER TABLE social.reports
  ADD COLUMN evidence jsonb CHECK (evidence IS NULL OR (target_type = 'message' AND jsonb_typeof(evidence) = 'object'));
