-- O estúdio do site diz que a música já vai no vídeo (`musicInFile`), mas no Safari do iPhone o vídeo podia sair calado
-- (o gravador do browser sem som) e a tcheka ficava muda: a app não tocava a música por cima. Agora a tcheka entra na fila
-- com `verify_inline`: o worker ouve o vídeo; com som fica 'inline' (como antes); calado ou sem pista de áudio, grava-se lá
-- a música (como as outras tchekas com música à parte).
ALTER TABLE content.post_music_bakes ADD COLUMN IF NOT EXISTS verify_inline boolean NOT NULL DEFAULT false;
