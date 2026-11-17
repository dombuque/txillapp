-- Notas com mais opções (src/chat/notes.service.ts): a cor da bolha, um local e um GIF, além do texto e da música.
--
-- color: uma cor da lista fechada ('coral', 'ambar', 'verde', 'ceu', 'noite'); NULL = a bolha branca de sempre.
-- place: { name } (o nome do sítio, até 80 caracteres). Nunca a posição: nem coordenadas nem outra coisa.
-- gif:   o mesmo formato das mensagens GIF ({ id, w, h, url, still?, title?, rating? }, só do GIPHY; src/gifs/gif.ts).
--        `rating` é a classificação do GIPHY ('g', 'pg', 'pg-13', 'r'): quem vê e é menor de 18 (ou não tem data de
--        nascimento) recebe a nota sem o GIF se a classificação for acima de 'g' ou se faltar.
-- id:    cada nota publicada tem um id próprio (a chave continua a ser o user_id: uma nota por pessoa), para se poder
--        denunciar ('note' em social.reports) e para os avisos de brinde.
-- O público ('mutual' = quem me segue, ou 'close_friends') já tem o CHECK desde a 0045; aqui só se confirma que existe.
-- As notas deixam de se ver às 24 h (expires_at) e a limpeza de hora a hora apaga-as 24 h depois (NotesService.purge).

ALTER TABLE social.notes ADD COLUMN IF NOT EXISTS color text;
ALTER TABLE social.notes ADD COLUMN IF NOT EXISTS place jsonb;
ALTER TABLE social.notes ADD COLUMN IF NOT EXISTS gif jsonb;
ALTER TABLE social.notes ADD COLUMN IF NOT EXISTS id uuid NOT NULL DEFAULT gen_random_uuid();
CREATE UNIQUE INDEX IF NOT EXISTS notes_id_key ON social.notes (id);

ALTER TABLE social.notes DROP CONSTRAINT IF EXISTS notes_color_check;
ALTER TABLE social.notes ADD CONSTRAINT notes_color_check CHECK (color IS NULL OR color IN ('coral', 'ambar', 'verde', 'ceu', 'noite'));

-- Só o nome: um local com coordenadas (ou com qualquer outra chave) não entra.
ALTER TABLE social.notes DROP CONSTRAINT IF EXISTS notes_place_check;
ALTER TABLE social.notes ADD CONSTRAINT notes_place_check CHECK (
  place IS NULL OR (jsonb_typeof(place) = 'object' AND jsonb_typeof(place -> 'name') = 'string' AND char_length(place ->> 'name') BETWEEN 1 AND 80
                    AND (place - 'name') = '{}'::jsonb)
);

ALTER TABLE social.notes DROP CONSTRAINT IF EXISTS notes_gif_check;
ALTER TABLE social.notes ADD CONSTRAINT notes_gif_check CHECK (gif IS NULL OR jsonb_typeof(gif) = 'object');

-- Uma nota pode ser só música, só GIF ou só local (sem texto); vazia nunca.
ALTER TABLE social.notes DROP CONSTRAINT IF EXISTS notes_body_check;
ALTER TABLE social.notes ADD CONSTRAINT notes_body_check CHECK (
  char_length(body) <= 60 AND (char_length(body) >= 1 OR music IS NOT NULL OR gif IS NOT NULL OR place IS NOT NULL)
);

-- O público: o CHECK da 0045 (inline, notes_audience_check). Se por alguma razão faltar, volta a pôr-se.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conrelid = 'social.notes'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%audience%'
  ) THEN
    ALTER TABLE social.notes ADD CONSTRAINT notes_audience_check CHECK (audience IN ('mutual', 'close_friends'));
  END IF;
END $$;

-- Quem já avisou o dono com um brinde a esta nota: o aviso «brindou a tua nota» vai só da primeira vez por pessoa
-- (brindar, tirar e voltar a pôr não volta a avisar). Sai com a nota.
CREATE TABLE IF NOT EXISTS social.note_cheer_pings (
  note_id uuid NOT NULL REFERENCES social.notes(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (note_id, user_id)
);

-- Denunciar uma nota ('note', target_id = social.notes.id): junta-se aos tipos que já existem, sem tirar nenhum (como na 0176).
DO $$
DECLARE def text; kinds text[];
BEGIN
  SELECT pg_get_constraintdef(oid) INTO def FROM pg_constraint
   WHERE conname = 'reports_target_type_check' AND conrelid = 'social.reports'::regclass;
  SELECT array_agg(DISTINCT k ORDER BY k) INTO kinds FROM (
    SELECT (regexp_matches(coalesce(def, ''), '''([a-z_]+)''', 'g'))[1] AS k
    UNION SELECT unnest(string_to_array((regexp_match(coalesce(def, ''), '\{([a-z_,]+)\}'))[1], ','))
    UNION SELECT DISTINCT target_type FROM social.reports
    UNION SELECT unnest(ARRAY['txillada', 'txillada_comment', 'mixar_comment', 'txillada_schedule', 'note'])
  ) x WHERE k IS NOT NULL AND k <> '';
  ALTER TABLE social.reports DROP CONSTRAINT IF EXISTS reports_target_type_check;
  EXECUTE format('ALTER TABLE social.reports ADD CONSTRAINT reports_target_type_check CHECK (target_type = ANY (%L::text[]))', kinds);
END $$;

-- A prova de uma denúncia (0111) passa a existir também nas notas: a cópia da nota no momento da denúncia (o texto, o nome
-- do local, o GIF e a classificação, o título da música, o público e as horas), porque a nota apaga-se sozinha. Segue as
-- regras da prova das mensagens: sai 180 dias depois da decisão (REPORT_EVIDENCE_DAYS). A regra antiga não tem nome próprio
-- (reports_check): procura-se pela definição.
DO $$
DECLARE c text;
BEGIN
  FOR c IN SELECT conname FROM pg_constraint
            WHERE conrelid = 'social.reports'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%evidence%'
  LOOP
    EXECUTE format('ALTER TABLE social.reports DROP CONSTRAINT %I', c);
  END LOOP;
  ALTER TABLE social.reports ADD CONSTRAINT reports_evidence_check
    CHECK (evidence IS NULL OR (target_type IN ('message', 'note') AND jsonb_typeof(evidence) = 'object'));
END $$;
