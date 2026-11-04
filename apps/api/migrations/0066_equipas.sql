-- Equipas do backoffice: cada pessoa da equipa pertence a uma ou mais equipas, e cada equipa tem as suas permissões (definidas no código).
-- Quem já tinha a marca de moderação (is_admin) continua a ser da Administração.
CREATE TABLE identity.staff_members (
  user_id uuid PRIMARY KEY REFERENCES identity.users(id) ON DELETE CASCADE,
  teams text[] NOT NULL DEFAULT '{}',
  active boolean NOT NULL DEFAULT true,
  added_by uuid REFERENCES identity.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
