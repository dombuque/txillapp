-- Mensagens directas (1 para 1). Uma conversa por par de pessoas (user_a < user_b).
CREATE TABLE social.conversations (
  id              uuid PRIMARY KEY,
  user_a          uuid NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  user_b          uuid NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  last_message_at timestamptz NOT NULL DEFAULT now(),
  -- Último id (UUIDv7, ordenável no tempo) que cada pessoa já leu.
  read_a          uuid,
  read_b          uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (user_a < user_b),
  UNIQUE (user_a, user_b)
);
CREATE INDEX conversations_b_idx ON social.conversations (user_b);

CREATE TABLE social.messages (
  id              uuid PRIMARY KEY,
  conversation_id uuid NOT NULL REFERENCES social.conversations(id) ON DELETE CASCADE,
  sender_id       uuid NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  body            text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000),
  kind            text NOT NULL DEFAULT 'text' CHECK (kind IN ('text', 'story_reply', 'story_reaction')),
  -- Respostas a stories: guarda a foto para a conversa continuar a mostrá-la.
  story_media_id  uuid REFERENCES content.media_assets(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX messages_conv_idx ON social.messages (conversation_id, id DESC);

-- Quem pode iniciar uma conversa comigo (respostas a stories seguem a definição própria dos stories).
ALTER TABLE identity.users
  ADD COLUMN dms_allowed text NOT NULL DEFAULT 'everyone' CHECK (dms_allowed IN ('everyone', 'following', 'off'));
