-- Backoffice: notas internas da equipa sobre uma conta, e o motivo escrito de cada decisão de moderação.
CREATE TABLE audit.staff_notes (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  author_id uuid REFERENCES identity.users(id) ON DELETE SET NULL,
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 1000),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX staff_notes_user_idx ON audit.staff_notes (user_id, created_at DESC);

ALTER TABLE social.reports ADD COLUMN resolution_note text CHECK (resolution_note IS NULL OR char_length(resolution_note) <= 300);
