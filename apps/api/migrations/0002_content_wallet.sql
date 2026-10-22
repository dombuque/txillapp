CREATE SCHEMA IF NOT EXISTS content;
CREATE SCHEMA IF NOT EXISTS ledger;

-- ---------- Media ----------
CREATE TABLE content.media_assets (
  id          uuid PRIMARY KEY,
  owner_id    uuid NOT NULL REFERENCES identity.users(id),
  mime        text NOT NULL CHECK (mime IN ('image/jpeg', 'image/png', 'image/webp')),
  size_bytes  bigint NOT NULL,
  storage_key text NOT NULL,
  status      text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'ready')),
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ---------- Posts ----------
CREATE TABLE content.posts (
  id             uuid PRIMARY KEY, -- UUIDv7: ordenar por id = ordenar por tempo
  author_id      uuid NOT NULL REFERENCES identity.users(id),
  body           text NOT NULL CHECK (char_length(body) <= 2000),
  location_label text CHECK (char_length(location_label) <= 80),
  media_id       uuid REFERENCES content.media_assets(id),
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX posts_author_idx ON content.posts (author_id, id DESC);

-- "Brindou": a reacção principal do feed.
CREATE TABLE content.cheers (
  post_id    uuid NOT NULL REFERENCES content.posts(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES identity.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, user_id)
);

CREATE TABLE content.comments (
  id         uuid PRIMARY KEY,
  post_id    uuid NOT NULL REFERENCES content.posts(id) ON DELETE CASCADE,
  author_id  uuid NOT NULL REFERENCES identity.users(id),
  body       text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 1000),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX comments_post_idx ON content.comments (post_id, id);

-- ---------- Ledger (partidas dobradas, Txills FICTÍCIOS) ----------
CREATE TABLE ledger.accounts (
  id        uuid PRIMARY KEY,
  user_id   uuid UNIQUE REFERENCES identity.users(id),
  kind      text NOT NULL CHECK (kind IN ('user_wallet', 'system_issuance')),
  currency  text NOT NULL DEFAULT 'TXL',
  -- Projecção do saldo (= soma dos lançamentos), actualizada na mesma transacção.
  balance   bigint NOT NULL DEFAULT 0,
  CONSTRAINT no_overdraft CHECK (kind = 'system_issuance' OR balance >= 0)
);

CREATE TABLE ledger.transactions (
  id              uuid PRIMARY KEY,
  type            text NOT NULL CHECK (type IN ('welcome_bonus', 'transfer', 'gift')),
  actor_id        uuid NOT NULL REFERENCES identity.users(id),
  idempotency_key text NOT NULL,
  metadata        jsonb NOT NULL DEFAULT '{}',
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (actor_id, idempotency_key)
);

CREATE TABLE ledger.entries (
  id             uuid PRIMARY KEY,
  transaction_id uuid NOT NULL REFERENCES ledger.transactions(id),
  account_id     uuid NOT NULL REFERENCES ledger.accounts(id),
  amount         bigint NOT NULL CHECK (amount <> 0), -- + crédito, - débito
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX entries_account_idx ON ledger.entries (account_id, id DESC);
CREATE INDEX entries_tx_idx ON ledger.entries (transaction_id);

-- Lançamentos imutáveis: correcções só por movimentos compensatórios.
CREATE FUNCTION ledger.forbid_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'ledger é imutável'; END $$;
CREATE TRIGGER entries_immutable BEFORE UPDATE OR DELETE ON ledger.entries
  FOR EACH ROW EXECUTE FUNCTION ledger.forbid_mutation();
CREATE TRIGGER transactions_immutable BEFORE UPDATE OR DELETE ON ledger.transactions
  FOR EACH ROW EXECUTE FUNCTION ledger.forbid_mutation();

-- Cada transacção tem de somar zero (verificado no commit).
CREATE FUNCTION ledger.check_balanced() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (SELECT COALESCE(SUM(amount), 0) FROM ledger.entries WHERE transaction_id = NEW.transaction_id) <> 0 THEN
    RAISE EXCEPTION 'transacção % não está equilibrada', NEW.transaction_id;
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER entries_balanced AFTER INSERT ON ledger.entries
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ledger.check_balanced();

-- Conta de emissão do sistema (origem dos Txills de demonstração).
INSERT INTO ledger.accounts (id, kind) VALUES ('00000000-0000-7000-8000-000000000001', 'system_issuance');

-- Presentes ligados a publicações (contador "Presentear").
CREATE TABLE content.gifts (
  id             uuid PRIMARY KEY,
  post_id        uuid NOT NULL REFERENCES content.posts(id),
  sender_id     uuid NOT NULL REFERENCES identity.users(id),
  recipient_id   uuid NOT NULL REFERENCES identity.users(id),
  amount         bigint NOT NULL CHECK (amount > 0),
  transaction_id uuid NOT NULL REFERENCES ledger.transactions(id),
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX gifts_post_idx ON content.gifts (post_id);
