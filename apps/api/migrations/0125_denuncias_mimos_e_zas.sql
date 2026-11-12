-- Denunciar também um comentário num mimo ('story_comment', content.story_comments) e um Zás ('instant', social.instants),
-- como pedem as regras das lojas (Apple 1.2, Google Play UGC): todo o conteúdo que outras pessoas veem tem de poder ser
-- denunciado. Junta os tipos novos aos que já lá estão, sem tirar nenhum. Depois da 0121 a regra fica escrita como
-- ANY ('{comment,media,...}'::text[]) (sem aspas em cada tipo), por isso lê-se nas duas formas e junta-se a lista conhecida.
DO $$
DECLARE def text; kinds text[];
BEGIN
  SELECT pg_get_constraintdef(oid) INTO def FROM pg_constraint
   WHERE conname = 'reports_target_type_check' AND conrelid = 'social.reports'::regclass;
  SELECT array_agg(DISTINCT k ORDER BY k) INTO kinds FROM (
    SELECT (regexp_matches(coalesce(def, ''), '''([a-z_]+)''', 'g'))[1] AS k
    UNION SELECT unnest(string_to_array((regexp_match(coalesce(def, ''), '\{([a-z_,]+)\}'))[1], ','))
    UNION SELECT unnest(ARRAY['post', 'comment', 'story', 'user', 'message', 'media', 'venue', 'story_comment', 'instant'])
  ) x WHERE k IS NOT NULL AND k <> '';
  ALTER TABLE social.reports DROP CONSTRAINT IF EXISTS reports_target_type_check;
  EXECUTE format('ALTER TABLE social.reports ADD CONSTRAINT reports_target_type_check CHECK (target_type = ANY (%L::text[]))', kinds);
END $$;
