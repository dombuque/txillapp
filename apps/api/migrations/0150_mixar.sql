-- Mixar (docs/mixar-contrato.md): um feed a dois, como o Blend do Instagram. Duas pessoas juntam os gostos e recebem todos
-- os dias uma seleção de publicações que tem a ver com os dois. Ver src/mixar/mixar.service.ts e src/mixar/mixar-pick.ts.
--
-- Tudo pendurado em social.mixars com ON DELETE CASCADE: sair do Mixar não apaga nada (fica `ended`), mas apagar o Mixar (a
-- eliminação da conta apaga os Mixar da pessoa: a conta fica anonimizada, por isso o CASCADE da linha da conta não chega)
-- leva os itens, as reações, os vistos, os desafios e as escolhas.
--
-- O «dia» do Mixar começa às 05:00 de Maputo (a hora da seleção diária): `day` é a data de Maputo menos 5 horas.
-- O perfil de temas do próprio Mixar não se guarda: calcula-se, quando se gera a seleção, a partir das reações, dos vistos,
-- dos envios para o chat e das escolhas nos desafios (com os mais antigos a pesar menos). Assim nunca fica desatualizado.

-- 1. O Mixar: o par ordenado (user_a < user_b) e quem convidou. `status`: pending (convite à espera), active, declined
--    (recusado por quem foi convidado) e ended (alguém saiu, ou quem convidou desistiu do convite). No máximo um pendente ou
--    ativo por par (índice único parcial); um convite novo depois de declined/ended cria outra linha.
--    `message_id`: o cartão no chat (mensagem kind 'mixar'; sem chave estrangeira, como o «Paga-me uma»: o Mixar grava-se
--    antes da mensagem, com o id dela já escolhido).
CREATE TABLE social.mixars (
  id          uuid PRIMARY KEY,
  user_a      uuid NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  user_b      uuid NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  invited_by  uuid NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  status      text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'declined', 'ended')),
  message_id  uuid,
  created_at  timestamptz NOT NULL DEFAULT now(),
  accepted_at timestamptz,
  ended_at    timestamptz,
  ended_by    uuid REFERENCES identity.users(id) ON DELETE SET NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (user_a < user_b),
  CHECK (invited_by = user_a OR invited_by = user_b)
);
CREATE UNIQUE INDEX mixars_pair_open_idx ON social.mixars (user_a, user_b) WHERE status IN ('pending', 'active');
CREATE INDEX mixars_a_idx ON social.mixars (user_a, status);
CREATE INDEX mixars_b_idx ON social.mixars (user_b, status);
-- O limite de convites por dia e a exportação.
CREATE INDEX mixars_invited_idx ON social.mixars (invited_by, created_at DESC);
CREATE INDEX mixars_message_idx ON social.mixars (message_id) WHERE message_id IS NOT NULL;
CREATE INDEX mixars_ended_by_idx ON social.mixars (ended_by) WHERE ended_by IS NOT NULL;
-- A tarefa diária: os ativos.
CREATE INDEX mixars_active_idx ON social.mixars (id) WHERE status = 'active';

-- 2. Os dias já gerados (também os que ficaram sem itens: não se volta a gerar a cada abertura).
CREATE TABLE social.mixar_days (
  mixar_id     uuid NOT NULL REFERENCES social.mixars(id) ON DELETE CASCADE,
  day          date NOT NULL,
  items        smallint NOT NULL DEFAULT 0,
  generated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (mixar_id, day)
);

-- 3. Os itens do dia (até 24), pela ordem do feed, com a razão: de quem é o gosto que o trouxe (`source`: 'a' = user_a,
--    'b' = user_b, 'both') e o tema. `score`: a pontuação do algoritmo (para escolher as opções do desafio).
CREATE TABLE social.mixar_items (
  mixar_id   uuid NOT NULL REFERENCES social.mixars(id) ON DELETE CASCADE,
  day        date NOT NULL,
  post_id    uuid NOT NULL REFERENCES content.posts(id) ON DELETE CASCADE,
  position   smallint NOT NULL,
  source     text NOT NULL CHECK (source IN ('a', 'b', 'both')),
  topic      text,
  score      real NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (mixar_id, day, post_id)
);
-- «Já saiu noutro dia?» (não repetir) e as reações/vistos de um item.
CREATE INDEX mixar_items_post_idx ON social.mixar_items (mixar_id, post_id);
CREATE INDEX mixar_items_post_fk_idx ON social.mixar_items (post_id);

-- 4. As reações exclusivas (só os dois as veem; não são brindes na publicação). Uma por pessoa e por item.
CREATE TABLE social.mixar_reactions (
  mixar_id   uuid NOT NULL REFERENCES social.mixars(id) ON DELETE CASCADE,
  post_id    uuid NOT NULL REFERENCES content.posts(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  reaction   text NOT NULL CHECK (reaction IN ('kkk', 'fogo', 'amor', 'uau', 'brinde', 'nah')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (mixar_id, post_id, user_id)
);
CREATE INDEX mixar_reactions_post_idx ON social.mixar_reactions (post_id);
CREATE INDEX mixar_reactions_user_idx ON social.mixar_reactions (user_id);

-- 5. Vistos e sinais de cada um em cada item: quanto viu (`watched_ms`, o máximo), se viu até ao fim (`done`) e quando o
--    mandou para o chat (`shared_at`). Pesam no perfil de temas do Mixar.
CREATE TABLE social.mixar_views (
  mixar_id   uuid NOT NULL REFERENCES social.mixars(id) ON DELETE CASCADE,
  post_id    uuid NOT NULL REFERENCES content.posts(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  watched_ms integer NOT NULL DEFAULT 0 CHECK (watched_ms >= 0),
  done       boolean NOT NULL DEFAULT false,
  shared_at  timestamptz,
  seen_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (mixar_id, post_id, user_id)
);
CREATE INDEX mixar_views_post_idx ON social.mixar_views (post_id);
CREATE INDEX mixar_views_user_idx ON social.mixar_views (user_id);

-- 6. O desafio do dia («Mixa Challenge»): um por dia por Mixar, com 3 ou 4 itens da seleção do dia (`options`, ids de
--    publicações; as que deixarem de se poder ver saem na leitura) e uma pergunta da lista fixa (`kind`).
CREATE TABLE social.mixar_challenges (
  id         uuid PRIMARY KEY,
  mixar_id   uuid NOT NULL REFERENCES social.mixars(id) ON DELETE CASCADE,
  day        date NOT NULL,
  kind       text NOT NULL CHECK (kind IN ('mais_engracado', 'mais_txilado', 'partilhavas', 'repetias')),
  options    uuid[] NOT NULL CHECK (cardinality(options) BETWEEN 3 AND 4),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (mixar_id, day)
);

-- As escolhas (às escondidas até os dois escolherem).
CREATE TABLE social.mixar_picks (
  challenge_id uuid NOT NULL REFERENCES social.mixar_challenges(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  post_id      uuid NOT NULL REFERENCES content.posts(id) ON DELETE CASCADE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (challenge_id, user_id)
);
CREATE INDEX mixar_picks_user_idx ON social.mixar_picks (user_id);
CREATE INDEX mixar_picks_post_idx ON social.mixar_picks (post_id);

-- 7. Mensagem nova 'mixar': o cartão do convite (o Mixar aponta para a mensagem). O texto (body) é o de recurso para as
--    versões antigas («Convidou-te para um Mixar»); a API devolve-o do ponto de vista de quem lê.
DO $$
DECLARE def text; kinds text[];
BEGIN
  SELECT pg_get_constraintdef(oid) INTO def FROM pg_constraint
   WHERE conname = 'messages_kind_check' AND conrelid = 'social.messages'::regclass;
  SELECT array_agg(DISTINCT k ORDER BY k) INTO kinds FROM (
    SELECT (regexp_matches(coalesce(def, ''), '''([a-z_]+)''', 'g'))[1] AS k
    UNION SELECT unnest(string_to_array((regexp_match(coalesce(def, ''), '\{([a-z_,]+)\}'))[1], ','))
    UNION SELECT unnest(ARRAY['mixar'])
  ) x WHERE k IS NOT NULL AND k <> '';
  ALTER TABLE social.messages DROP CONSTRAINT IF EXISTS messages_kind_check;
  EXECUTE format('ALTER TABLE social.messages ADD CONSTRAINT messages_kind_check CHECK (kind IN (%s))', (SELECT string_agg(quote_literal(k), ', ') FROM unnest(kinds) k));
END $$;
