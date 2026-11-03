-- Responder a uma mensagem (citação) e reagir a mensagens (uma reação por pessoa e mensagem).
ALTER TABLE social.messages ADD COLUMN reply_to uuid REFERENCES social.messages(id) ON DELETE SET NULL;

CREATE TABLE social.message_reactions (
  message_id uuid NOT NULL REFERENCES social.messages(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  reaction   text NOT NULL CHECK (reaction ~ '^:[a-z]{2,12}:$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, user_id)
);
