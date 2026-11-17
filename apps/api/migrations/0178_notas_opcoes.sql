-- Notas com mais opções (src/chat/notes.service.ts): a cor da bolha, um local e um GIF, além do texto e da música.
--
-- color: uma cor da lista fechada ('coral', 'ambar', 'verde', 'ceu', 'noite'); NULL = a bolha branca de sempre.
-- place: { name, lat?, lng? } (o nome até 80 caracteres; a posição, se houver, já vem arredondada a 2 casas, ~1 km, como
--        nas publicações, e nunca a de um menor de 18 anos).
-- gif:   o mesmo formato das mensagens GIF ({ id, w, h, url, still?, title? }, só do GIPHY; src/gifs/gif.ts).
-- O público ('mutual' ou 'close_friends') já tem o CHECK desde a 0045; aqui só se confirma que existe.

ALTER TABLE social.notes ADD COLUMN IF NOT EXISTS color text;
ALTER TABLE social.notes ADD COLUMN IF NOT EXISTS place jsonb;
ALTER TABLE social.notes ADD COLUMN IF NOT EXISTS gif jsonb;

ALTER TABLE social.notes DROP CONSTRAINT IF EXISTS notes_color_check;
ALTER TABLE social.notes ADD CONSTRAINT notes_color_check CHECK (color IS NULL OR color IN ('coral', 'ambar', 'verde', 'ceu', 'noite'));

ALTER TABLE social.notes DROP CONSTRAINT IF EXISTS notes_place_check;
ALTER TABLE social.notes ADD CONSTRAINT notes_place_check CHECK (
  place IS NULL OR (jsonb_typeof(place) = 'object' AND jsonb_typeof(place -> 'name') = 'string' AND char_length(place ->> 'name') BETWEEN 1 AND 80)
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
