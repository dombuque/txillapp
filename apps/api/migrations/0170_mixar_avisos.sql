-- Mixar: avisos e descoberta (docs/mixar-contrato.md, «Avisos e descoberta»). Ver src/mixar/mixar-avisos.service.ts.
--
-- 1. Quando abri cada Mixar pela última vez (uma linha por Mixar e por pessoa, sempre a última abertura). A app chama
--    POST /mixar/:id/open ao abrir o feed (e ao abrir a conversa com um convite recebido); o resumo manda `openedAt` e a
--    bolinha azul fica igual em todos os aparelhos. Também serve para não avisar da seleção de hoje quem já a abriu.
--    Vai com o Mixar (CASCADE): sair e apagar o Mixar, ou eliminar a conta, leva-a.
CREATE TABLE IF NOT EXISTS social.mixar_opens (
  mixar_id  uuid NOT NULL REFERENCES social.mixars(id) ON DELETE CASCADE,
  user_id   uuid NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  opened_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (mixar_id, user_id)
);
CREATE INDEX IF NOT EXISTS mixar_opens_user_idx ON social.mixar_opens (user_id);

-- 2. Os avisos do Mixar já mandados (para nunca repetir): `kind` 'daily' (a seleção do dia; ref = o dia), 'pick' (o outro já
--    escolheu no desafio; ref = o desafio) e 'result' (os dois escolheram; ref = o desafio). No máximo um de cada.
CREATE TABLE IF NOT EXISTS social.mixar_notices (
  mixar_id   uuid NOT NULL REFERENCES social.mixars(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  kind       text NOT NULL CHECK (kind IN ('daily', 'pick', 'result')),
  ref        text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (mixar_id, user_id, kind, ref)
);
CREATE INDEX IF NOT EXISTS mixar_notices_user_idx ON social.mixar_notices (user_id);

-- 3. «Faz um Mixar com…»: as sugestões que dispensei («Agora não»), escondidas até `until` (30 dias). Apagam-se com a conta
--    de qualquer um dos dois (auth.service) e as que já passaram apagam-se quando volto a pedir as sugestões.
CREATE TABLE IF NOT EXISTS social.mixar_suggestion_dismissals (
  user_id   uuid NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  person_id uuid NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  until     timestamptz NOT NULL,
  PRIMARY KEY (user_id, person_id)
);
CREATE INDEX IF NOT EXISTS mixar_suggestion_dismissals_person_idx ON social.mixar_suggestion_dismissals (person_id);

-- 4. Os avisos novos na lista (categoria «Mixar», que se desliga nas definições):
--    'mixar_daily'  a vossa seleção de hoje está pronta (ator = o outro). data: { mixarId, name, day }.
--    'mixar_pick'   o outro já escolheu no Mixa Challenge, falta eu (ator = quem escolheu). data: { mixarId, name, challengeId }.
--    'mixar_result' os dois escolheram (para quem escolheu primeiro; ator = quem escolheu depois). data: { mixarId, name, challengeId, match }.
-- Como na 0168: lê a lista atual nos dois formatos, junta a conhecida e acrescenta as nossas.
DO $$
DECLARE def text; kinds text[];
BEGIN
  SELECT pg_get_constraintdef(oid) INTO def FROM pg_constraint
   WHERE conname = 'notifications_kind_check' AND conrelid = 'social.notifications'::regclass;
  SELECT array_agg(DISTINCT k ORDER BY k) INTO kinds FROM (
    SELECT (regexp_matches(coalesce(def, ''), '''([a-z_]+)''', 'g'))[1] AS k
    UNION SELECT unnest(string_to_array((regexp_match(coalesce(def, ''), '\{([a-z_,]+)\}'))[1], ','))
    UNION SELECT DISTINCT kind FROM social.notifications
    UNION SELECT unnest(ARRAY['mixar_daily', 'mixar_pick', 'mixar_result'])
  ) x WHERE k IS NOT NULL AND k <> '';
  ALTER TABLE social.notifications DROP CONSTRAINT IF EXISTS notifications_kind_check;
  EXECUTE format('ALTER TABLE social.notifications ADD CONSTRAINT notifications_kind_check CHECK (kind = ANY (%L::text[]))', kinds);
END $$;
