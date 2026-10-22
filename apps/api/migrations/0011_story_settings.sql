-- Definições de stories: quem pode responder e a quem esconder o story.
ALTER TABLE identity.users
  ADD COLUMN story_replies text NOT NULL DEFAULT 'everyone' CHECK (story_replies IN ('everyone', 'following', 'off'));

CREATE TABLE social.story_hidden (
  owner_id   uuid NOT NULL REFERENCES identity.users(id),
  hidden_id  uuid NOT NULL REFERENCES identity.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, hidden_id),
  CHECK (owner_id <> hidden_id)
);
