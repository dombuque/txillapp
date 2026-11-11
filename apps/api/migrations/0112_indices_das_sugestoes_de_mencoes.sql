-- Sugestões de @menções (GET /mentions/suggest): a pontuação de proximidade lê, por quem escreve, os brindes e os
-- comentários que deu, as menções que fez e os perfis que visitou. Sem estes índices cada pedido (um por tecla, com
-- debounce) varria as tabelas inteiras. Hoje são pequenas; os índices são para quando deixarem de ser.
CREATE INDEX IF NOT EXISTS cheers_user_created_idx ON content.cheers (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS comments_author_created_idx ON content.comments (author_id, created_at DESC);
CREATE INDEX IF NOT EXISTS notifications_actor_mention_idx ON social.notifications (actor_id, created_at DESC) WHERE kind IN ('mention', 'tag');
CREATE INDEX IF NOT EXISTS profile_views_viewer_idx ON social.profile_views (viewer_id, day DESC);
