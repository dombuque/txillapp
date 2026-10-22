-- Respostas a comentários (um nível, como no Instagram: respostas a respostas ficam no mesmo fio)
ALTER TABLE content.comments
  ADD COLUMN parent_id uuid REFERENCES content.comments(id) ON DELETE CASCADE;
CREATE INDEX comments_parent_idx ON content.comments (parent_id, id) WHERE parent_id IS NOT NULL;

-- "Brindar" um comentário (equivalente ao coração do Instagram)
CREATE TABLE content.comment_cheers (
  comment_id uuid NOT NULL REFERENCES content.comments(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES identity.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (comment_id, user_id)
);
