-- Guardar publicações (privado: só quem guarda vê a sua lista; o autor não sabe).
CREATE TABLE content.saved_posts (
  user_id uuid NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  post_id uuid NOT NULL REFERENCES content.posts(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, post_id)
);
CREATE INDEX saved_posts_user_idx ON content.saved_posts (user_id, created_at DESC);
