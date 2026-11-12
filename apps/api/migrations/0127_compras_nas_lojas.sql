-- Compras pela loja (Apple App Store e Google Play), só para duas coisas: a verificação paga (subscrição; selo com o
-- nível 'paid') e o Bombar (consumíveis de 1, 3 e 7 dias). Os Txills NÃO se vendem nas lojas.
-- Ver docs/lojas/iap.md e apps/api/src/iap. O nível 'paid' do selo já existe (0126).

-- ---------- Pedidos de selo: aprovado como «elegível para verificação paga» ----------
-- A equipa confirma a identidade e, em vez de dar o selo, deixa a pessoa subscrever a verificação paga.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT c.conname FROM pg_constraint c
            WHERE c.conrelid = 'identity.verification_requests'::regclass AND c.contype = 'c' AND pg_get_constraintdef(c.oid) LIKE '%status%'
  LOOP
    EXECUTE format('ALTER TABLE identity.verification_requests DROP CONSTRAINT %I', r.conname);
  END LOOP;
  ALTER TABLE identity.verification_requests ADD CONSTRAINT verification_requests_status_check
    CHECK (status IN ('pending', 'approved', 'rejected', 'withdrawn', 'paid_eligible'));
END $$;

-- ---------- Bombar pago na loja ----------
-- 'iap': pago na App Store ou no Google Play (o local não gasta Txills, por isso o preço em Txills fica a 0).
-- 'draft': criada pela app antes da compra; não aparece a ninguém até a compra ser verificada.
ALTER TABLE content.boost_campaigns DROP CONSTRAINT IF EXISTS boost_campaigns_payment_check;
ALTER TABLE content.boost_campaigns ADD CONSTRAINT boost_campaigns_payment_check CHECK (payment IN ('txills', 'mzn', 'iap'));
ALTER TABLE content.boost_campaigns DROP CONSTRAINT IF EXISTS boost_campaigns_status_check;
ALTER TABLE content.boost_campaigns ADD CONSTRAINT boost_campaigns_status_check CHECK (status IN ('draft', 'pending', 'active', 'stopped', 'suspended'));
ALTER TABLE content.boost_campaigns DROP CONSTRAINT IF EXISTS boost_campaigns_price_check;
ALTER TABLE content.boost_campaigns ADD CONSTRAINT boost_campaigns_price_check CHECK (price >= 0 AND (price > 0 OR payment = 'iap'));
-- A chave de idempotência do rascunho (a app pode repetir o pedido sem criar dois rascunhos).
ALTER TABLE content.boost_campaigns ADD COLUMN draft_key text CHECK (char_length(draft_key) <= 100);
CREATE UNIQUE INDEX boost_campaigns_draft_key_idx ON content.boost_campaigns (venue_id, created_by, draft_key) WHERE draft_key IS NOT NULL;

-- ---------- Compras ----------
-- Uma linha por compra: um consumível (um Bombar) ou uma subscrição inteira (as renovações atualizam a mesma linha;
-- cada renovação fica em payments.iap_events). `raw` guarda só o que a loja disse da transação (sem tokens nem chaves).
CREATE TABLE payments.iap_purchases (
  id                      uuid PRIMARY KEY,
  user_id                 uuid NOT NULL REFERENCES identity.users(id),
  store                   text NOT NULL CHECK (store IN ('apple', 'google')),
  product_id              text NOT NULL CHECK (char_length(product_id) BETWEEN 1 AND 150),
  kind                    text NOT NULL CHECK (kind IN ('subscription', 'consumable')),
  -- Apple: a transação mais recente e a original (a da subscrição). Google: vazio (usa o purchase_token e o order_id).
  transaction_id          text,
  original_transaction_id text,
  -- Google: o token da compra (fixo numa subscrição, mesmo depois de renovar) e o número da encomenda mais recente.
  purchase_token          text,
  order_id                text,
  environment             text NOT NULL CHECK (environment IN ('Production', 'Sandbox')),
  status                  text NOT NULL CHECK (status IN ('active', 'expired', 'refunded', 'revoked', 'consumed')),
  expires_at              timestamptz,
  auto_renew              boolean,
  campaign_id             uuid REFERENCES content.boost_campaigns(id) ON DELETE SET NULL,
  raw                     jsonb NOT NULL DEFAULT '{}',
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT iap_store_ids CHECK (
    (store = 'apple' AND transaction_id IS NOT NULL AND original_transaction_id IS NOT NULL) OR
    (store = 'google' AND purchase_token IS NOT NULL)
  )
);
-- Idempotência: cada transação da loja é creditada uma só vez.
CREATE UNIQUE INDEX iap_purchases_tx_idx ON payments.iap_purchases (store, transaction_id) WHERE transaction_id IS NOT NULL;
CREATE UNIQUE INDEX iap_purchases_sub_idx ON payments.iap_purchases (store, original_transaction_id) WHERE kind = 'subscription' AND original_transaction_id IS NOT NULL;
CREATE UNIQUE INDEX iap_purchases_token_idx ON payments.iap_purchases (store, purchase_token) WHERE purchase_token IS NOT NULL;
CREATE UNIQUE INDEX iap_purchases_order_idx ON payments.iap_purchases (store, order_id) WHERE order_id IS NOT NULL;
-- Uma campanha é paga por uma única compra.
CREATE UNIQUE INDEX iap_purchases_campaign_idx ON payments.iap_purchases (campaign_id) WHERE campaign_id IS NOT NULL;
CREATE INDEX iap_purchases_user_idx ON payments.iap_purchases (user_id, created_at DESC);
CREATE INDEX iap_purchases_due_idx ON payments.iap_purchases (expires_at) WHERE kind = 'subscription' AND status = 'active';
CREATE INDEX iap_purchases_list_idx ON payments.iap_purchases (created_at DESC);

-- O que aconteceu a cada compra: compra, renovação, expirou, reembolso… Também é aqui que se garante que cada aviso da
-- loja (notificationUUID da Apple, messageId do Pub/Sub) e cada transação de renovação só contam uma vez.
-- `amount_minor`: o valor pago, em centavos (o que a Apple diz na transação; na Google, o preço da configuração).
CREATE TABLE payments.iap_events (
  id              uuid PRIMARY KEY,
  purchase_id     uuid REFERENCES payments.iap_purchases(id) ON DELETE CASCADE,
  store           text NOT NULL CHECK (store IN ('apple', 'google')),
  type            text NOT NULL CHECK (char_length(type) BETWEEN 1 AND 60),
  -- A transação a que o acontecimento se refere (Apple transactionId, Google orderId), para as compras e renovações.
  transaction_ref text,
  -- O aviso da loja que o trouxe (Apple notificationUUID, Pub/Sub messageId).
  notification_id text,
  product_id      text,
  environment     text,
  amount_minor    bigint,
  currency        text,
  data            jsonb NOT NULL DEFAULT '{}',
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX iap_events_tx_idx ON payments.iap_events (store, type, transaction_ref) WHERE transaction_ref IS NOT NULL;
CREATE UNIQUE INDEX iap_events_notification_idx ON payments.iap_events (store, notification_id) WHERE notification_id IS NOT NULL;
CREATE INDEX iap_events_purchase_idx ON payments.iap_events (purchase_id, created_at);
CREATE INDEX iap_events_month_idx ON payments.iap_events (created_at, type);

-- ---------- Verificação paga ----------
-- Quem pode subscrever (aprovado pela equipa) e o selo que tinha antes de a subscrição o pôr em 'paid', para o repor
-- quando a subscrição expira, é reembolsada ou revogada. Se antes não era verificado, deixa de ser.
CREATE TABLE payments.paid_verification (
  user_id           uuid PRIMARY KEY REFERENCES identity.users(id) ON DELETE CASCADE,
  eligible_at       timestamptz,
  eligible_by       uuid REFERENCES identity.users(id) ON DELETE SET NULL,
  request_id        uuid REFERENCES identity.verification_requests(id) ON DELETE SET NULL,
  -- true enquanto o selo 'paid' está aplicado por uma subscrição ativa.
  applied           boolean NOT NULL DEFAULT false,
  purchase_id       uuid REFERENCES payments.iap_purchases(id) ON DELETE SET NULL,
  previous_verified boolean,
  previous_tier     text,
  applied_at        timestamptz,
  updated_at        timestamptz NOT NULL DEFAULT now()
);
