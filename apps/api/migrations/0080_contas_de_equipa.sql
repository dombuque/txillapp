-- Contas de equipa do backoffice: separadas da rede social (login próprio, senha própria e dois passos).
-- Cada conta de equipa tem uma identidade interna (identity.users com estado 'staff') só para o registo de auditoria e as filas
-- continuarem a funcionar; nunca aparece na rede (não é 'active') e não consegue entrar nela (não tem credenciais da rede).
ALTER TABLE identity.users DROP CONSTRAINT IF EXISTS users_status_check;
ALTER TABLE identity.users ADD CONSTRAINT users_status_check CHECK (status IN ('active', 'suspended', 'deleted', 'staff'));

CREATE TABLE identity.staff_accounts (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL UNIQUE REFERENCES identity.users(id) ON DELETE CASCADE,
  email text NOT NULL CHECK (email = lower(email)),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  password_hash text,
  -- O segredo dos dois passos fica cifrado (AES-GCM).
  totp_secret text,
  totp_enabled boolean NOT NULL DEFAULT false,
  failed_logins int NOT NULL DEFAULT 0,
  locked_until timestamptz,
  -- Sobe quando a senha muda, o acesso é reposto ou se sai de todo o lado: as sessões antigas deixam de valer.
  token_version int NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz
);
CREATE UNIQUE INDEX staff_accounts_email_idx ON identity.staff_accounts (email);

-- Ligações de uso único para definir a senha e ativar os dois passos (convite ou reposição). Só se guarda o hash.
CREATE TABLE identity.staff_setup_tokens (
  token_hash text PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES identity.staff_accounts(id) ON DELETE CASCADE,
  totp_pending text,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX staff_setup_tokens_account_idx ON identity.staff_setup_tokens (account_id);
