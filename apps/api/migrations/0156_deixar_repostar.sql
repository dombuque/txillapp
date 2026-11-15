-- Repostar (posts/posts.service.ts, `POST /posts/:id/repost`): Definições → Conteúdo → «Deixar repostar as minhas
-- publicações» (ligado por omissão). Ligado, os outros podem repostar as minhas publicações, tal como estão ou com um
-- comentário (citação), também numa conta privada (o repost só o vê quem pode ver o original). Desligado, só eu as reposto.
-- O próprio autor pode sempre repostar as suas. Muda-se em `GET/PUT /posts/me/repost-settings`.
--
-- Até aqui as publicações de uma conta privada nunca eram repostadas por outros: para não mudar isso sem a pessoa saber,
-- as contas que já são privadas ficam com a definição desligada (podem ligá-la quando quiserem). Só na primeira vez (quando
-- a coluna é criada): voltar a correr isto não mexe na escolha de ninguém.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'identity' AND table_name = 'users' AND column_name = 'allow_reposts'
  ) THEN
    ALTER TABLE identity.users ADD COLUMN allow_reposts boolean NOT NULL DEFAULT true;
    UPDATE identity.users SET allow_reposts = false WHERE is_private;
  END IF;
END
$$;
