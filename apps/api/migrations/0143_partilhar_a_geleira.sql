-- Partilhar a geleira como publicação (src/geleira/geleira-post.ts).
-- A publicação guarda um retrato da geleira no momento da partilha (a ordem, os nomes e o desenho de cada item), por isso
-- não muda se a geleira mudar depois. Formato: { v: 1, level, total, totalSoft, items: [{ id, slug, name, kind, category,
-- alcoholic, favorite, rating }] }. `totalSoft` = quantos gostos sem álcool (o que vê quem tem menos de 18 anos).
-- As bebidas alcoólicas ficam no retrato, mas só saem a quem tem 18 anos ou mais (como na geleira).
ALTER TABLE content.posts ADD COLUMN IF NOT EXISTS geleira jsonb;
-- As partilhas da geleira de cada pessoa (exportação de dados).
CREATE INDEX IF NOT EXISTS posts_geleira_author_idx ON content.posts (author_id, id DESC) WHERE geleira IS NOT NULL;

-- Brindar ao post da geleira (o brinde normal dos posts) conta também como brinde à geleira do perfil: a mesma linha de
-- taste.geleira_cheers (uma por pessoa, por isso nunca conta duas vezes), com a publicação de onde veio. Se a publicação for
-- apagada, o brinde fica e a ligação desaparece (source_post_id = NULL; a app também a tira ao apagar, que é só esconder).
ALTER TABLE taste.geleira_cheers ADD COLUMN IF NOT EXISTS source_post_id uuid REFERENCES content.posts(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS geleira_cheers_post_idx ON taste.geleira_cheers (source_post_id) WHERE source_post_id IS NOT NULL;

-- Brindes a cada item da geleira, no perfil ou no cartão do post: uma linha por pessoa e item (a chave impede duplicados,
-- venha o brinde de onde vier). `source_post_id`: a publicação onde se brindou (nulo = no perfil, ou publicação apagada).
CREATE TABLE IF NOT EXISTS taste.geleira_item_cheers (
  owner_id       uuid NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  item_id        uuid NOT NULL REFERENCES taste.items(id) ON DELETE CASCADE,
  user_id        uuid NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  source_post_id uuid REFERENCES content.posts(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, item_id, user_id),
  CHECK (owner_id <> user_id)
);
-- Os brindes que dei (exportação de dados e eliminação da conta) e os que vieram de cada publicação (ao apagar).
CREATE INDEX IF NOT EXISTS geleira_item_cheers_user_idx ON taste.geleira_item_cheers (user_id);
CREATE INDEX IF NOT EXISTS geleira_item_cheers_post_idx ON taste.geleira_item_cheers (source_post_id) WHERE source_post_id IS NOT NULL;
