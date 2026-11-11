-- Bombar: o dono e os administradores de um local pagam (com os Txills da carteira do local) para destacar um evento
-- ou uma publicação feita como o local, num raio à volta do local, durante um pacote de dias. Os destaques aparecem
-- no feed e no mapa do "À tua volta", sempre com a etiqueta "Patrocinado", e nunca a menores de 18 anos.

-- ---------- Ledger: tipos de movimento novos ----------
-- 'boost' (o local paga a campanha) e 'boost_refund' (devolução quando a campanha é parada ou suspensa).
-- Outras equipas podem ter acrescentado tipos nas migrações anteriores: lê-se a lista atual e junta-se a nossa.
DO $$
DECLARE
  cur text[];
BEGIN
  SELECT array_agg(DISTINCT m[1]) INTO cur
    FROM pg_constraint c, regexp_matches(pg_get_constraintdef(c.oid), '''([a-z_]+)''', 'g') AS m
   WHERE c.conname = 'transactions_type_check' AND c.conrelid = 'ledger.transactions'::regclass;
  cur := COALESCE(cur, ARRAY[]::text[]);
  IF NOT 'boost' = ANY (cur) THEN cur := array_append(cur, 'boost'); END IF;
  IF NOT 'boost_refund' = ANY (cur) THEN cur := array_append(cur, 'boost_refund'); END IF;
  ALTER TABLE ledger.transactions DROP CONSTRAINT IF EXISTS transactions_type_check;
  EXECUTE format('ALTER TABLE ledger.transactions ADD CONSTRAINT transactions_type_check CHECK (type = ANY (%L::text[]))', cur);
END $$;
CREATE INDEX transactions_boost_idx ON ledger.transactions ((metadata->>'venueId'), id DESC) WHERE type IN ('boost', 'boost_refund');

-- ---------- Campanhas ----------
CREATE TABLE content.boost_campaigns (
  id uuid PRIMARY KEY,
  venue_id uuid NOT NULL REFERENCES content.venues(id) ON DELETE CASCADE,
  -- O que se bomba: um evento do local ou uma publicação feita como o local.
  target_kind text NOT NULL CHECK (target_kind IN ('event', 'post')),
  event_id uuid REFERENCES content.venue_events(id) ON DELETE CASCADE,
  post_id uuid REFERENCES content.posts(id) ON DELETE CASCADE,
  -- O pacote escolhido ('1d', '3d', '7d'; ver boost-config.ts) e o raio à volta do local.
  package text NOT NULL CHECK (char_length(package) BETWEEN 1 AND 20),
  days smallint NOT NULL CHECK (days BETWEEN 1 AND 60),
  radius_km smallint NOT NULL CHECK (radius_km BETWEEN 1 AND 10),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  -- Como se pagou. Nesta fase só 'txills' (a carteira do local); 'mzn' fica preparado para um fornecedor de meticais.
  payment text NOT NULL DEFAULT 'txills' CHECK (payment IN ('txills', 'mzn')),
  price bigint NOT NULL CHECK (price > 0),
  refunded bigint NOT NULL DEFAULT 0,
  -- 'pending' (à espera da equipa; não usado enquanto a aprovação é automática), 'active', 'stopped' (parada pelo local),
  -- 'suspended' (suspensa pela equipa). "Agendada" e "terminada" saem das datas.
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('pending', 'active', 'stopped', 'suspended')),
  -- Quem aprovou: 'auto' (local já aprovado pela equipa) ou 'staff'.
  review text NOT NULL DEFAULT 'auto' CHECK (review IN ('auto', 'staff')),
  charge_tx_id uuid UNIQUE REFERENCES ledger.transactions(id),
  refund_tx_id uuid REFERENCES ledger.transactions(id),
  created_by uuid REFERENCES identity.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  stopped_at timestamptz,
  stopped_by uuid REFERENCES identity.users(id) ON DELETE SET NULL,
  status_note text CHECK (char_length(status_note) <= 300),
  CONSTRAINT boost_target CHECK (
    (target_kind = 'event' AND event_id IS NOT NULL AND post_id IS NULL) OR
    (target_kind = 'post' AND post_id IS NOT NULL AND event_id IS NULL)
  ),
  CONSTRAINT boost_dates CHECK (ends_at > starts_at),
  CONSTRAINT boost_refund_le_price CHECK (refunded >= 0 AND refunded <= price)
);
-- As campanhas a decorrer (o feed e o mapa só olham para estas).
CREATE INDEX boost_campaigns_live_idx ON content.boost_campaigns (ends_at, starts_at) WHERE status = 'active';
CREATE INDEX boost_campaigns_venue_idx ON content.boost_campaigns (venue_id, created_at DESC);

-- ---------- Impressões e toques ----------
-- Uma linha por vez que o destaque foi mostrado ('view') ou tocado ('tap'), no feed ou no mapa.
-- Ao local só se mostram totais; quem viu nunca sai daqui. Se a conta for apagada, a linha fica sem pessoa (os totais mantêm-se).
CREATE TABLE content.boost_impressions (
  id uuid PRIMARY KEY,
  campaign_id uuid NOT NULL REFERENCES content.boost_campaigns(id) ON DELETE CASCADE,
  user_id uuid REFERENCES identity.users(id) ON DELETE SET NULL,
  kind text NOT NULL CHECK (kind IN ('view', 'tap')),
  surface text NOT NULL CHECK (surface IN ('feed', 'map')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX boost_impressions_campaign_idx ON content.boost_impressions (campaign_id, kind);
-- O limite de vezes por dia (por pessoa e campanha) e a atribuição dos check-ins.
CREATE INDEX boost_impressions_user_idx ON content.boost_impressions (user_id, campaign_id, created_at DESC);

-- ---------- "Não mostrar destaques deste local" ----------
CREATE TABLE content.boost_hidden (
  user_id uuid NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  venue_id uuid NOT NULL REFERENCES content.venues(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, venue_id)
);
