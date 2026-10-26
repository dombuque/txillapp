-- Amigos próximos: lista de quem pode ver os stories marcados só para eles.
CREATE TABLE social.close_friends (
  owner_id   uuid NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  friend_id  uuid NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, friend_id),
  CHECK (owner_id <> friend_id)
);
CREATE INDEX close_friends_friend_idx ON social.close_friends (friend_id);

ALTER TABLE content.stories ADD COLUMN audience text NOT NULL DEFAULT 'all' CHECK (audience IN ('all', 'close_friends'));
