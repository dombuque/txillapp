-- Idade mínima e aceitação dos termos. Guarda-se a data de nascimento (só para validar a idade; nunca é mostrada).
ALTER TABLE identity.users
  ADD COLUMN birth_date        date,
  ADD COLUMN terms_accepted_at timestamptz,
  ADD COLUMN terms_version     text;
