-- Música nas notas: uma faixa de licença aberta (Creative Commons), com o crédito do autor.
ALTER TABLE social.notes ADD COLUMN music jsonb;

-- Uma nota pode ser só música (sem texto).
ALTER TABLE social.notes DROP CONSTRAINT notes_body_check;
ALTER TABLE social.notes ADD CONSTRAINT notes_body_check CHECK (char_length(body) <= 60 AND (char_length(body) >= 1 OR music IS NOT NULL));
