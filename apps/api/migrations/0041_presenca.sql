-- "Online" no chat: última vez visto e a definição de mostrar (ou não) quando se está online.
-- Quem esconde a sua presença também não vê a dos outros.
ALTER TABLE identity.users
  ADD COLUMN last_seen_at timestamptz,
  ADD COLUMN show_presence boolean NOT NULL DEFAULT true;
