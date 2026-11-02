-- Recarregar Txills: pacotes, pedidos de pagamento e o crédito na carteira (mesmo livro de partidas dobradas).
ALTER TABLE ledger.transactions DROP CONSTRAINT transactions_type_check;
ALTER TABLE ledger.transactions ADD CONSTRAINT transactions_type_check CHECK (type IN ('welcome_bonus', 'transfer', 'gift', 'topup'));

CREATE SCHEMA IF NOT EXISTS payments;

-- Pacotes à venda. Os valores são em centavos da moeda (MZN) para nunca haver vírgulas flutuantes.
CREATE TABLE payments.packages (
  id          text PRIMARY KEY CHECK (id ~ '^[a-z0-9-]{2,24}$'),
  name        text NOT NULL,
  txills      integer NOT NULL CHECK (txills > 0),
  price_minor integer NOT NULL CHECK (price_minor > 0),
  currency    text NOT NULL DEFAULT 'MZN',
  position    integer NOT NULL DEFAULT 0,
  active      boolean NOT NULL DEFAULT true
);
INSERT INTO payments.packages (id, name, txills, price_minor, position) VALUES
  ('pequeno', 'Pequeno', 500, 5000, 1),
  ('medio', 'Médio', 1200, 10000, 2),
  ('grande', 'Grande', 3000, 23000, 3),
  ('mega', 'Mega', 7500, 50000, 4);

CREATE TABLE payments.orders (
  id              uuid PRIMARY KEY,
  user_id         uuid NOT NULL REFERENCES identity.users(id),
  package_id      text NOT NULL REFERENCES payments.packages(id),
  -- Copiados do pacote na altura: mudar preços depois não altera pedidos antigos.
  txills          integer NOT NULL CHECK (txills > 0),
  amount_minor    integer NOT NULL CHECK (amount_minor > 0),
  currency        text NOT NULL,
  provider        text NOT NULL CHECK (provider IN ('sandbox', 'mpesa', 'emola', 'card')),
  status          text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'failed', 'cancelled', 'expired')),
  provider_ref    text,
  -- Só os últimos dígitos do telemóvel (para mostrar no histórico); o número completo não se guarda.
  phone_tail      text,
  idempotency_key text NOT NULL,
  ledger_tx       uuid REFERENCES ledger.transactions(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  paid_at         timestamptz,
  UNIQUE (user_id, idempotency_key)
);
CREATE INDEX orders_user_idx ON payments.orders (user_id, created_at DESC);
CREATE UNIQUE INDEX orders_provider_ref_idx ON payments.orders (provider, provider_ref) WHERE provider_ref IS NOT NULL;
