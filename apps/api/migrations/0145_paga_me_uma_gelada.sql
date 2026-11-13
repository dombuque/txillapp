-- «Paga-me uma» (a gelada de sexta), fase 1: sem dinheiro. Nada aqui mexe em Txills nem em pagamentos: são pedidos, um livro
-- de quem deve a quem e rodadas no TxillGroup. Ver src/gelada/gelada.service.ts.
--
-- A bebida de cada pedido, dívida ou entrada numa rodada fica guardada como estava (slug, nome, grupo e se tem álcool), para o
-- desenho e o texto não mudarem se o catálogo mudar. Menores de 18 anos (e quem não tem data de nascimento) nunca têm álcool:
-- um pedido em que um dos dois é menor passa a refresco (alcoholic = false) logo ao criar.

-- 1. Os pedidos. `channel`: no chat (uma mensagem kind 'gelada' em cada conversa; `message_id`) ou numa publicação (`post_id`,
--    a mesma publicação para todos a quem se pediu nela; a pessoa fica identificada nela). `status`:
--    pending (à espera), accepted («Bora!»), declined («Hoje não»), owed («Fica a dever»: cria uma dívida) e untagged (a pessoa
--    tirou a identificação do post: o pedido fica fechado para ela).
CREATE TABLE taste.gelada_requests (
  id             uuid PRIMARY KEY,
  requester_id   uuid NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  recipient_id   uuid NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  item_id        uuid REFERENCES taste.items(id) ON DELETE SET NULL,
  drink_slug     text NOT NULL,
  drink_name     text NOT NULL,
  drink_category text NOT NULL,
  alcoholic      boolean NOT NULL DEFAULT false,
  channel        text NOT NULL CHECK (channel IN ('chat', 'post')),
  -- A mensagem do cartão no chat (sem chave estrangeira: o pedido é gravado antes da mensagem, com o id dela já escolhido).
  message_id     uuid,
  post_id        uuid REFERENCES content.posts(id) ON DELETE CASCADE,
  status         text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined', 'owed', 'untagged')),
  answered_at    timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CHECK (requester_id <> recipient_id),
  CHECK (channel = 'chat' OR post_id IS NOT NULL)
);
-- Os limites do dia (10 por pessoa, 3 ao mesmo amigo) e a exportação/eliminação.
CREATE INDEX gelada_requests_requester_idx ON taste.gelada_requests (requester_id, created_at DESC);
CREATE INDEX gelada_requests_recipient_idx ON taste.gelada_requests (recipient_id, created_at DESC);
CREATE INDEX gelada_requests_message_idx ON taste.gelada_requests (message_id) WHERE message_id IS NOT NULL;
CREATE INDEX gelada_requests_post_idx ON taste.gelada_requests (post_id) WHERE post_id IS NOT NULL;

-- 2. As rodadas no TxillGroup: aparecem na conversa como uma mensagem kind 'rodada' (`message_id`). `payer_id`: quem disse
--    «Esta pago eu». Fechada, fica no histórico («quem pagou a última rodada»), para a próxima ser de outro.
CREATE TABLE taste.gelada_rounds (
  id          uuid PRIMARY KEY,
  group_id    uuid NOT NULL REFERENCES social.groups(id) ON DELETE CASCADE,
  opened_by   uuid NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  message_id  uuid,
  payer_id    uuid REFERENCES identity.users(id) ON DELETE SET NULL,
  status      text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  closed_at   timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
-- Uma rodada aberta de cada vez por grupo.
CREATE UNIQUE INDEX gelada_rounds_open_idx ON taste.gelada_rounds (group_id) WHERE status = 'open';
CREATE INDEX gelada_rounds_group_idx ON taste.gelada_rounds (group_id, closed_at DESC);
CREATE INDEX gelada_rounds_message_idx ON taste.gelada_rounds (message_id) WHERE message_id IS NOT NULL;
CREATE INDEX gelada_rounds_opened_idx ON taste.gelada_rounds (opened_by);
CREATE INDEX gelada_rounds_payer_idx ON taste.gelada_rounds (payer_id) WHERE payer_id IS NOT NULL;

-- Quem entra na rodada («Eu entro», com a bebida).
CREATE TABLE taste.gelada_round_entries (
  round_id       uuid NOT NULL REFERENCES taste.gelada_rounds(id) ON DELETE CASCADE,
  user_id        uuid NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  drink_slug     text NOT NULL,
  drink_name     text NOT NULL,
  drink_category text NOT NULL,
  alcoholic      boolean NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (round_id, user_id)
);
CREATE INDEX gelada_round_entries_user_idx ON taste.gelada_round_entries (user_id);

-- 3. O livro das geladas: quem deve (`debtor_id`) a quem (`creditor_id`), que bebida, quando e de onde veio (um pedido com
--    «Fica a dever», uma rodada fechada por quem pagou, ou à mão: «Fico a dever-te uma», que só o devedor cria).
--    status: open (por pagar), paid (paga e CONFIRMADA por quem recebeu) e forgiven (perdoada por quem recebia).
--    «Já paguei» só marca `paid_claimed_at` (com uma foto ou um local, se quiser); só fica paga quando a outra pessoa confirma.
--    Por omissão só as duas pessoas veem as dívidas entre elas (identity.users.gelada_book_public, mais abaixo).
CREATE TABLE taste.gelada_debts (
  id              uuid PRIMARY KEY,
  debtor_id       uuid NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  creditor_id     uuid NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  drink_slug      text NOT NULL,
  drink_name      text NOT NULL,
  drink_category  text NOT NULL,
  alcoholic       boolean NOT NULL DEFAULT false,
  source          text NOT NULL CHECK (source IN ('request', 'round', 'manual')),
  request_id      uuid REFERENCES taste.gelada_requests(id) ON DELETE SET NULL,
  round_id        uuid REFERENCES taste.gelada_rounds(id) ON DELETE SET NULL,
  status          text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'paid', 'forgiven')),
  paid_claimed_at timestamptz,
  paid_media_id   uuid REFERENCES content.media_assets(id) ON DELETE SET NULL,
  paid_venue_id   uuid REFERENCES content.venues(id) ON DELETE SET NULL,
  closed_at       timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (debtor_id <> creditor_id)
);
CREATE INDEX gelada_debts_debtor_idx ON taste.gelada_debts (debtor_id, status);
CREATE INDEX gelada_debts_creditor_idx ON taste.gelada_debts (creditor_id, status);
-- Os pontos do nível (geladas pagas e confirmadas, por semana).
CREATE INDEX gelada_debts_paid_idx ON taste.gelada_debts (closed_at) WHERE status = 'paid';
-- Um pedido dá no máximo uma dívida.
CREATE UNIQUE INDEX gelada_debts_request_idx ON taste.gelada_debts (request_id) WHERE request_id IS NOT NULL;

-- 4. «Sexta da gelada»: o aviso de sexta por volta das 17h de Maputo, no máximo um por sexta (a chave impede o segundo).
--    Só o registo de que foi enviado e de que tipo (cobrar uma dívida ou pedir à malta), nunca o texto. Apagado ao fim de 90 dias.
CREATE TABLE taste.gelada_fridays (
  user_id  uuid NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  friday   date NOT NULL,
  kind     text NOT NULL CHECK (kind IN ('pending', 'debt', 'friends')),
  sent_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, friday)
);

-- 5. Definição da geleira: mostrar o livro das geladas a quem vê a geleira (desligada por omissão).
ALTER TABLE identity.users ADD COLUMN IF NOT EXISTS gelada_book_public boolean NOT NULL DEFAULT false;

-- 6. O pedido publicado: a publicação leva a bebida pedida (o retrato do momento) e quantas pessoas foram identificadas
--    ({ v: 1, drink: { slug, name, category, alcoholic }, count }). Cada pessoa tem a sua linha em taste.gelada_requests.
ALTER TABLE content.posts ADD COLUMN IF NOT EXISTS gelada jsonb;

-- 7. Mensagens novas: 'gelada' (o cartão do pedido; o pedido aponta para a mensagem) e 'rodada' (o cartão da rodada).
--    O texto (body) é legível ("Paga-me uma 2M 🍺"), que é o que as versões antigas da app e a lista de conversas mostram.
DO $$
DECLARE def text; kinds text[];
BEGIN
  SELECT pg_get_constraintdef(oid) INTO def FROM pg_constraint
   WHERE conname = 'messages_kind_check' AND conrelid = 'social.messages'::regclass;
  SELECT array_agg(DISTINCT k ORDER BY k) INTO kinds FROM (
    SELECT (regexp_matches(coalesce(def, ''), '''([a-z_]+)''', 'g'))[1] AS k
    UNION SELECT unnest(string_to_array((regexp_match(coalesce(def, ''), '\{([a-z_,]+)\}'))[1], ','))
    UNION SELECT unnest(ARRAY['gelada', 'rodada'])
  ) x WHERE k IS NOT NULL AND k <> '';
  ALTER TABLE social.messages DROP CONSTRAINT IF EXISTS messages_kind_check;
  -- Na forma clássica (kind IN ('text', ...)), como as anteriores: pg_get_constraintdef mostra cada tipo como 'text'::text.
  EXECUTE format('ALTER TABLE social.messages ADD CONSTRAINT messages_kind_check CHECK (kind IN (%s))', (SELECT string_agg(quote_literal(k), ', ') FROM unnest(kinds) k));
END $$;

-- 8. Avisos novos:
--    - 'gelada_tag': pediram-me uma gelada numa publicação (fico identificado). Ator = quem pediu.
--      data: { requestId, postId, soft (refresco, sem álcool no texto) }. A lista mostra os botões.
--    - 'gelada_answer': a pessoa a quem pedi numa publicação respondeu. Ator = quem respondeu. data: { requestId, postId, answer, soft }.
--    - 'gelada_paid': a outra pessoa disse «Já paguei» (para eu confirmar) ou confirmou que lhe paguei. Ator = essa pessoa.
--      data: { debtId, step: 'claimed' | 'confirmed', soft }.
DO $$
DECLARE def text; kinds text[];
BEGIN
  SELECT pg_get_constraintdef(oid) INTO def FROM pg_constraint
   WHERE conname = 'notifications_kind_check' AND conrelid = 'social.notifications'::regclass;
  SELECT array_agg(DISTINCT k ORDER BY k) INTO kinds FROM (
    SELECT (regexp_matches(coalesce(def, ''), '''([a-z_]+)''', 'g'))[1] AS k
    UNION SELECT unnest(string_to_array((regexp_match(coalesce(def, ''), '\{([a-z_,]+)\}'))[1], ','))
    UNION SELECT unnest(ARRAY['gelada_tag', 'gelada_answer', 'gelada_paid'])
  ) x WHERE k IS NOT NULL AND k <> '';
  ALTER TABLE social.notifications DROP CONSTRAINT IF EXISTS notifications_kind_check;
  EXECUTE format('ALTER TABLE social.notifications ADD CONSTRAINT notifications_kind_check CHECK (kind = ANY (%L::text[]))', kinds);
END $$;
