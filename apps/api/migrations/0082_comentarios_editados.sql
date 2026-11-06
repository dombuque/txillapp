-- Comentários editáveis pelo autor (mostra-se "editado").
ALTER TABLE content.comments ADD COLUMN edited_at timestamptz;
