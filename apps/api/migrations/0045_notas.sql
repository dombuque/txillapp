-- Notas: uma frase curta (até 60 caracteres) por cima da foto de perfil, que dura 24 horas. Uma nota ativa por pessoa.
-- 'mutual' = quem eu sigo e também me segue; 'close_friends' = a minha lista de amigos próximos.
CREATE TABLE social.notes (
  user_id uuid PRIMARY KEY REFERENCES identity.users(id) ON DELETE CASCADE,
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 60),
  audience text NOT NULL DEFAULT 'mutual' CHECK (audience IN ('mutual', 'close_friends')),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '24 hours'
);
CREATE INDEX notes_expires_idx ON social.notes (expires_at);
