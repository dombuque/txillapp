-- Txillada: «Convidar por @» (docs/txillada-contrato.md, «Convidar por @ (0168)»).
--
-- O aviso novo 'txillada_invite': o anfitrião convidou-me para transmitir na Txillada dele (também quando ainda não estou a
-- ver). Ator = o anfitrião. data: { txilladaId, title }. Abre a Txillada (numa privada, quem é convidado entra sem pagar).
-- Como na 0158: lê a lista atual nos dois formatos, junta a conhecida e acrescenta a nossa.
DO $$
DECLARE def text; kinds text[];
BEGIN
  SELECT pg_get_constraintdef(oid) INTO def FROM pg_constraint
   WHERE conname = 'notifications_kind_check' AND conrelid = 'social.notifications'::regclass;
  SELECT array_agg(DISTINCT k ORDER BY k) INTO kinds FROM (
    SELECT (regexp_matches(coalesce(def, ''), '''([a-z_]+)''', 'g'))[1] AS k
    UNION SELECT unnest(string_to_array((regexp_match(coalesce(def, ''), '\{([a-z_,]+)\}'))[1], ','))
    UNION SELECT DISTINCT kind FROM social.notifications
    UNION SELECT unnest(ARRAY['txillada_live', 'txillada_invite'])
  ) x WHERE k IS NOT NULL AND k <> '';
  ALTER TABLE social.notifications DROP CONSTRAINT IF EXISTS notifications_kind_check;
  EXECUTE format('ALTER TABLE social.notifications ADD CONSTRAINT notifications_kind_check CHECK (kind = ANY (%L::text[]))', kinds);
END $$;
