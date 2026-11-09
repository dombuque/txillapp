-- Contas por ativar (e-mail por confirmar): lembrete ao fim de 1, 3 e 7 dias (e-mail com link novo e aviso no telemóvel). Depois pára.
ALTER TABLE identity.users
  ADD COLUMN verify_reminders smallint NOT NULL DEFAULT 0,
  ADD COLUMN verify_reminded_at timestamptz;
CREATE INDEX users_unverified_idx ON identity.users (created_at) WHERE email_verified_at IS NULL AND status = 'active';
