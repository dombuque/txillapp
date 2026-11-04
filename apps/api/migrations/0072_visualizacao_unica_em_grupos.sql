-- Visualização única nos grupos: cada pessoa abre uma vez; o conteúdo só se apaga quando todos os outros já abriram.
CREATE TABLE social.message_views (
  message_id uuid NOT NULL REFERENCES social.messages(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  viewed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, user_id)
);
