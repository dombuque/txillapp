-- Ficheiros que já vêm assinados da câmara do Txillapp (TxillCam no site, editor de fotos no telemóvel, estúdio de
-- tchekas): a app já gravou o logótipo e o @ na foto ou no vídeo. Ao "Guardar" um mimo, o servidor não volta a pôr a
-- assinatura por cima (a letra e a sombra do @ não são iguais às da app e o @ ficava desfocado, como se estivesse a dobrar).
-- Os ficheiros que já existem ficam a false e continuam a ser assinados no servidor, como até aqui.
-- Valor por omissão constante: o Postgres não reescreve a tabela.
ALTER TABLE content.media_assets ADD COLUMN signed boolean NOT NULL DEFAULT false;
