-- Reações a um Zás (uma por pessoa), para o autor ver na grelha dos seus Zás.
CREATE TABLE social.instant_reactions (
  instant_id uuid NOT NULL REFERENCES social.instants(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  reaction   text NOT NULL CHECK (reaction ~ '^:[a-z]{2,12}:$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (instant_id, user_id)
);
