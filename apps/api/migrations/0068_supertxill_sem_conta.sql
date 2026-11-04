-- O SuperTxill deixa de ser uma conta/conversa: é uma IA na barra de pesquisa. Tira a conta e as conversas da 0067 e cria o histórico próprio.
DELETE FROM social.conversations WHERE user_a = '00000000-0000-7000-8000-0000000000b1' OR user_b = '00000000-0000-7000-8000-0000000000b1';
DELETE FROM identity.users WHERE id = '00000000-0000-7000-8000-0000000000b1';
ALTER TABLE identity.users DROP COLUMN is_bot;

-- O que cada pessoa pergunta ao SuperTxill e as respostas (só dela; pode apagar quando quiser).
CREATE TABLE social.ai_messages (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user', 'assistant')),
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 4000),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ai_messages_user_idx ON social.ai_messages (user_id, id DESC);
