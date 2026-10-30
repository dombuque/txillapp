-- Confirmação de e-mail e recuperação de senha por link (guardamos só o hash do código, nunca o código).
ALTER TABLE identity.users ADD COLUMN email_verified_at timestamptz;
-- Quem já existia fica como confirmado (a regra é para contas novas).
UPDATE identity.users SET email_verified_at = created_at;

CREATE TABLE identity.email_tokens (
  id         uuid PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  kind       text NOT NULL CHECK (kind IN ('verify', 'reset')),
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX email_tokens_user_kind_idx ON identity.email_tokens (user_id, kind);
