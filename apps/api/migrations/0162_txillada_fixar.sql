-- Txillada: fixar um comentário e denunciar um comentário.

-- 1. O comentário fixado pelo anfitrião (no máximo um): fica à vista em baixo, por cima da barra. Apagar o comentário (o
--    anfitrião, o autor ou a moderação) tira-o daqui no serviço; apagar a linha (a limpeza dos 7 dias, apagar a conta) tira-o
--    pela chave estrangeira.
ALTER TABLE content.txilladas
  ADD COLUMN pinned_comment_id uuid REFERENCES content.txillada_comments (id) ON DELETE SET NULL;
CREATE INDEX txilladas_pinned_idx ON content.txilladas (pinned_comment_id) WHERE pinned_comment_id IS NOT NULL;

-- 2. Denunciar um comentário de uma Txillada ('txillada_comment'): junta-se aos tipos que já existem, sem tirar nenhum (como na 0158).
--    O comentário denunciado fica guardado até à decisão (a limpeza dos 7 dias salta-o).
DO $$
DECLARE def text; kinds text[];
BEGIN
  SELECT pg_get_constraintdef(oid) INTO def FROM pg_constraint
   WHERE conname = 'reports_target_type_check' AND conrelid = 'social.reports'::regclass;
  SELECT array_agg(DISTINCT k ORDER BY k) INTO kinds FROM (
    SELECT (regexp_matches(coalesce(def, ''), '''([a-z_]+)''', 'g'))[1] AS k
    UNION SELECT unnest(string_to_array((regexp_match(coalesce(def, ''), '\{([a-z_,]+)\}'))[1], ','))
    UNION SELECT unnest(ARRAY['post', 'comment', 'story', 'user', 'message', 'media', 'venue', 'story_comment', 'instant', 'txillada', 'txillada_comment'])
  ) x WHERE k IS NOT NULL AND k <> '';
  ALTER TABLE social.reports DROP CONSTRAINT IF EXISTS reports_target_type_check;
  EXECUTE format('ALTER TABLE social.reports ADD CONSTRAINT reports_target_type_check CHECK (target_type = ANY (%L::text[]))', kinds);
END $$;
