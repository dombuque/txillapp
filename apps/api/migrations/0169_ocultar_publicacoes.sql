-- «Ocultar publicação» (0169): o autor esconde uma publicação sua (foto, carrossel, texto, tcheka, repost ou presente) e
-- volta a mostrá-la quando quiser, como o «Arquivar» do Instagram. Enquanto `hidden_at` não é nulo só o autor a vê (no
-- separador «Ocultas» do perfil e pelo link); para os outros é como uma publicação apagada. Os brindes, os comentários e os
-- presentes ficam guardados; ao voltar a mostrar, a publicação volta ao mesmo sítio (a data é a de sempre).
ALTER TABLE content.posts ADD COLUMN IF NOT EXISTS hidden_at timestamptz;

-- O separador «Ocultas» (as minhas, das ocultadas mais recentemente para as mais antigas).
CREATE INDEX IF NOT EXISTS posts_hidden_author_idx ON content.posts (author_id, hidden_at DESC, id DESC) WHERE hidden_at IS NOT NULL AND removed_at IS NULL;
