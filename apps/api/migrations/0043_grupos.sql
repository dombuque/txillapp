-- Grupos de chat: nome, membros (admin ou membro) e mensagens do grupo (as mesmas mensagens, com group_id em vez de conversation_id).
CREATE TABLE social.groups (
  id uuid PRIMARY KEY,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 40),
  created_by uuid REFERENCES identity.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_message_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE social.group_members (
  group_id uuid NOT NULL REFERENCES social.groups(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  joined_at timestamptz NOT NULL DEFAULT now(),
  -- Última mensagem lida (id), para contar o que falta ler.
  read_id uuid,
  PRIMARY KEY (group_id, user_id)
);
CREATE INDEX group_members_user_idx ON social.group_members (user_id);

ALTER TABLE social.messages ALTER COLUMN conversation_id DROP NOT NULL;
ALTER TABLE social.messages ADD COLUMN group_id uuid REFERENCES social.groups(id) ON DELETE CASCADE;
ALTER TABLE social.messages ADD CONSTRAINT messages_one_target CHECK ((conversation_id IS NULL) <> (group_id IS NULL));
CREATE INDEX messages_group_idx ON social.messages (group_id, id DESC) WHERE group_id IS NOT NULL;
