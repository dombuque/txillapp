-- Ensinar o algoritmo: preferências por tema (mais / menos) e "interessado / não interessado" por publicação.
CREATE TABLE social.explore_prefs (
  user_id uuid NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  topic text NOT NULL CHECK (topic ~ '^[a-z0-9-]{2,30}$'),
  pref smallint NOT NULL CHECK (pref IN (-1, 1)),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, topic)
);
CREATE TABLE content.post_feedback (
  user_id uuid NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  post_id uuid NOT NULL REFERENCES content.posts(id) ON DELETE CASCADE,
  value smallint NOT NULL CHECK (value IN (-1, 1)),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, post_id)
);
