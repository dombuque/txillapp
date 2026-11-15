-- O título da Txillada passa a ser opcional (o dono, 2026-11-15): pode ficar vazio. Sem título, a app mostra só quem
-- transmite e o aviso aos seguidores diz «@x abriu uma Txillada».
DO $$
DECLARE c text;
BEGIN
  FOR c IN SELECT conname FROM pg_constraint
            WHERE conrelid = 'content.txilladas'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) ILIKE '%char_length(title)%'
  LOOP
    EXECUTE format('ALTER TABLE content.txilladas DROP CONSTRAINT %I', c);
  END LOOP;
END $$;
ALTER TABLE content.txilladas ADD CONSTRAINT txilladas_title_check CHECK (char_length(title) <= 80);
