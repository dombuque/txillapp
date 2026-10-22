-- Grafo social: seguir pessoas, bio e sugestões.
CREATE SCHEMA IF NOT EXISTS social;

ALTER TABLE identity.users ADD COLUMN bio text CHECK (char_length(bio) <= 150);

CREATE TABLE social.follows (
  follower_id uuid NOT NULL REFERENCES identity.users(id),
  followee_id uuid NOT NULL REFERENCES identity.users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (follower_id, followee_id),
  CHECK (follower_id <> followee_id)
);
CREATE INDEX follows_followee_idx ON social.follows (followee_id, follower_id);

-- "Não me sugiras esta pessoa" (o ✕ nas sugestões)
CREATE TABLE social.suggestion_dismissals (
  user_id      uuid NOT NULL REFERENCES identity.users(id),
  dismissed_id uuid NOT NULL REFERENCES identity.users(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, dismissed_id)
);
