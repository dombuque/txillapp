-- Mixar: social e guardados (docs/mixar-contrato.md, «Social e guardados»; src/mixar/mixar-social.service.ts).
--
-- 1. A conversa de cada item: comentários que só os dois do Mixar veem (no máximo 500 caracteres). Apagar (o autor ou a
--    moderação) marca `deleted_at` e o comentário deixa de se ver; a limpeza (mixar.social.purge) apaga de vez os que
--    estão apagados há mais de 30 dias e não têm denúncias por decidir. Tudo sai com o Mixar (CASCADE).
CREATE TABLE social.mixar_comments (
  id         uuid PRIMARY KEY,
  mixar_id   uuid NOT NULL REFERENCES social.mixars(id) ON DELETE CASCADE,
  post_id    uuid NOT NULL REFERENCES content.posts(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  body       text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 500),
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE INDEX mixar_comments_item_idx ON social.mixar_comments (mixar_id, post_id, id DESC) WHERE deleted_at IS NULL;
CREATE INDEX mixar_comments_post_idx ON social.mixar_comments (post_id);
CREATE INDEX mixar_comments_user_idx ON social.mixar_comments (user_id);
CREATE INDEX mixar_comments_deleted_idx ON social.mixar_comments (deleted_at) WHERE deleted_at IS NOT NULL;

-- 2. Os Guardados do Mixar: a coleção dos dois. `saved_by`: quem guardou à mão; NULL = entrou sozinho, porque os dois
--    reagiram com amor, fogo, kkk, uau ou brinde (não com nah). Tirar marca `removed_at` (em vez de apagar a linha) para o
--    item não voltar a entrar sozinho quando alguém muda a reação; guardar à mão outra vez volta a pô-lo.
CREATE TABLE social.mixar_saves (
  mixar_id   uuid NOT NULL REFERENCES social.mixars(id) ON DELETE CASCADE,
  post_id    uuid NOT NULL REFERENCES content.posts(id) ON DELETE CASCADE,
  saved_by   uuid REFERENCES identity.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  removed_at timestamptz,
  PRIMARY KEY (mixar_id, post_id)
);
CREATE INDEX mixar_saves_list_idx ON social.mixar_saves (mixar_id, created_at DESC, post_id) WHERE removed_at IS NULL;
CREATE INDEX mixar_saves_post_idx ON social.mixar_saves (post_id);
CREATE INDEX mixar_saves_user_idx ON social.mixar_saves (saved_by) WHERE saved_by IS NOT NULL;

-- Entra sozinho: depois de cada reação, se os dois reagiram a este item sem ser com «nah».
CREATE FUNCTION social.mixar_auto_save() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.reaction <> 'nah' AND (
    SELECT count(*) FROM social.mixar_reactions r WHERE r.mixar_id = NEW.mixar_id AND r.post_id = NEW.post_id AND r.reaction <> 'nah'
  ) >= 2 THEN
    INSERT INTO social.mixar_saves (mixar_id, post_id, saved_by) VALUES (NEW.mixar_id, NEW.post_id, NULL) ON CONFLICT DO NOTHING;
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER mixar_reactions_auto_save AFTER INSERT OR UPDATE OF reaction ON social.mixar_reactions
  FOR EACH ROW EXECUTE FUNCTION social.mixar_auto_save();

-- 3. «Mais 5»: quantas vezes já se pediu mais itens neste dia (no máximo 3 por dia por Mixar).
ALTER TABLE social.mixar_days ADD COLUMN more_rounds smallint NOT NULL DEFAULT 0;

-- 4. Denunciar um comentário do Mixar ('mixar_comment'): junta-se aos tipos que já existem, sem tirar nenhum (como na 0162).
DO $$
DECLARE def text; kinds text[];
BEGIN
  SELECT pg_get_constraintdef(oid) INTO def FROM pg_constraint
   WHERE conname = 'reports_target_type_check' AND conrelid = 'social.reports'::regclass;
  SELECT array_agg(DISTINCT k ORDER BY k) INTO kinds FROM (
    SELECT (regexp_matches(coalesce(def, ''), '''([a-z_]+)''', 'g'))[1] AS k
    UNION SELECT unnest(string_to_array((regexp_match(coalesce(def, ''), '\{([a-z_,]+)\}'))[1], ','))
    UNION SELECT unnest(ARRAY['post', 'comment', 'story', 'user', 'message', 'media', 'venue', 'story_comment', 'instant', 'txillada', 'txillada_comment', 'mixar_comment'])
  ) x WHERE k IS NOT NULL AND k <> '';
  ALTER TABLE social.reports DROP CONSTRAINT IF EXISTS reports_target_type_check;
  EXECUTE format('ALTER TABLE social.reports ADD CONSTRAINT reports_target_type_check CHECK (target_type = ANY (%L::text[]))', kinds);
END $$;
