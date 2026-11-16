-- Txillada: três tipos (Pública, Para amigos, Privada paga) e a Angariação (fase 1). docs/txillada-contrato.md.
--
-- 1. O público passa a ter mais dois valores: 'friends' (Para amigos: quem eu sigo E me segue) e 'paid' (Privada: quem
--    pode ver o perfil vê que existe, mas paga uma vez para entrar). 'followers' e 'close' continuam válidos (as linhas
--    antigas e as apps antigas que ainda mandam 'followers'); 'close' é agora «Para amigos» com «Só amigos próximos».
--    O tipo não muda depois de começar (não há rota para o mudar).
--    `price`: o preço da entrada em Txills (só nas pagas, 5 a 5000). `goal`/`goal_purpose`: a Angariação (opcional, em
--    qualquer tipo; meta de 10 a 1 000 000 Txills e um motivo curto, 0 a 80, pelo filtro de palavras). `raised`: quanto
--    já se ofereceu (a soma de txillada_gifts, guardada para a barra). `tickets`: quantas entradas se pagaram.
DO $$
DECLARE c text;
BEGIN
  FOR c IN SELECT conname FROM pg_constraint
            WHERE conrelid = 'content.txilladas'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%audience%'
  LOOP
    EXECUTE format('ALTER TABLE content.txilladas DROP CONSTRAINT %I', c);
  END LOOP;
END $$;
ALTER TABLE content.txilladas
  ADD CONSTRAINT txilladas_audience_check CHECK (audience IN ('everyone', 'followers', 'close', 'friends', 'paid')),
  ADD COLUMN price int CHECK (price BETWEEN 5 AND 5000),
  ADD COLUMN goal int CHECK (goal BETWEEN 10 AND 1000000),
  ADD COLUMN goal_purpose text NOT NULL DEFAULT '' CHECK (char_length(goal_purpose) <= 80),
  ADD COLUMN raised bigint NOT NULL DEFAULT 0 CHECK (raised >= 0),
  ADD COLUMN tickets int NOT NULL DEFAULT 0 CHECK (tickets >= 0);
-- Paga ⇔ com preço.
ALTER TABLE content.txilladas ADD CONSTRAINT txilladas_paid_price CHECK ((audience = 'paid') = (price IS NOT NULL));

-- 2. Os movimentos novos na carteira: a entrada paga, a oferta durante o live e a devolução da entrada (quando a moderação
--    corta). Outras equipas podem ter acrescentado tipos. A 0116 guardou a lista como um array ('{a,b}'::text[]), que a
--    expressão da 0116 já não sabe ler: aqui lê-se a definição atual nos dois formatos (os nomes entre aspas e os nomes dentro
--    de '{…}'), junta-se a lista conhecida e os tipos que já existem nas linhas, e acrescentam-se os nossos.
DO $$
DECLARE
  def text;
  cur text[];
BEGIN
  SELECT pg_get_constraintdef(c.oid) INTO def FROM pg_constraint c
   WHERE c.conname = 'transactions_type_check' AND c.conrelid = 'ledger.transactions'::regclass;
  SELECT array_agg(DISTINCT x) INTO cur FROM (
    SELECT unnest(ARRAY['welcome_bonus', 'transfer', 'gift', 'topup', 'invite', 'group_contribution', 'venue_payment', 'group_refund',
                        'boost', 'boost_refund', 'txillada_ticket', 'txillada_gift', 'txillada_refund']) AS x
    UNION SELECT m[1] FROM regexp_matches(COALESCE(def, ''), '''([a-z_]+)''', 'g') AS m
    UNION SELECT unnest(string_to_array(m[1], ',')) FROM regexp_matches(COALESCE(def, ''), '''\{([a-z_,]+)\}''', 'g') AS m
    UNION SELECT DISTINCT type FROM ledger.transactions
  ) s WHERE x IS NOT NULL AND x <> '';
  ALTER TABLE ledger.transactions DROP CONSTRAINT IF EXISTS transactions_type_check;
  EXECUTE format('ALTER TABLE ledger.transactions ADD CONSTRAINT transactions_type_check CHECK (type = ANY (%L::text[]))', cur);
END $$;

-- 3. As entradas pagas: uma por pessoa e Txillada (pagar duas vezes nunca cobra duas vezes; voltar a entrar é grátis).
--    `transaction_id`: o movimento na carteira (quem vê → anfitrião), gravado na mesma transação que esta linha.
--    `refunded_at`/`refund_transaction_id`: a devolução quando a moderação corta a Txillada (uma vez só).
--    É dinheiro: a limpeza dos 7 dias não lhe toca, e apagar a conta não a apaga (a conta fica anonimizada). Se a linha
--    da Txillada sair (o anfitrião apagou a conta), `txillada_id` fica a NULL e o registo fica com o anfitrião e o valor.
CREATE TABLE content.txillada_tickets (
  id                    uuid PRIMARY KEY,
  txillada_id           uuid REFERENCES content.txilladas (id) ON DELETE SET NULL,
  host_id               uuid NOT NULL REFERENCES identity.users (id) ON DELETE CASCADE,
  user_id               uuid NOT NULL REFERENCES identity.users (id) ON DELETE CASCADE,
  price                 int NOT NULL CHECK (price BETWEEN 1 AND 100000),
  transaction_id        uuid NOT NULL UNIQUE REFERENCES ledger.transactions (id),
  created_at            timestamptz NOT NULL DEFAULT now(),
  refunded_at           timestamptz,
  refund_transaction_id uuid UNIQUE REFERENCES ledger.transactions (id)
);
CREATE UNIQUE INDEX txillada_tickets_one ON content.txillada_tickets (txillada_id, user_id);
CREATE INDEX txillada_tickets_user_idx ON content.txillada_tickets (user_id, created_at);
CREATE INDEX txillada_tickets_host_idx ON content.txillada_tickets (host_id, created_at);
-- As que falta devolver (a tarefa de 20 em 20 s volta a tentar as das Txilladas cortadas).
CREATE INDEX txillada_tickets_refund_idx ON content.txillada_tickets (txillada_id) WHERE refunded_at IS NULL;

-- 4. As ofertas de Txills durante o live (com ou sem Angariação): quem vê → anfitrião, uma linha por oferta, com o
--    movimento na carteira (`transaction_id`, a chave de idempotência vem da app). Registo financeiro: fica como as entradas.
CREATE TABLE content.txillada_gifts (
  id             uuid PRIMARY KEY,
  txillada_id    uuid REFERENCES content.txilladas (id) ON DELETE SET NULL,
  host_id        uuid NOT NULL REFERENCES identity.users (id) ON DELETE CASCADE,
  giver_id       uuid NOT NULL REFERENCES identity.users (id) ON DELETE CASCADE,
  amount         int NOT NULL CHECK (amount BETWEEN 1 AND 5000),
  transaction_id uuid NOT NULL UNIQUE REFERENCES ledger.transactions (id),
  created_at     timestamptz NOT NULL DEFAULT now()
);
-- Quem mais ofereceu (o top 3 na sala) e as ofertas de cada um.
CREATE INDEX txillada_gifts_tx_idx ON content.txillada_gifts (txillada_id, giver_id);
CREATE INDEX txillada_gifts_giver_idx ON content.txillada_gifts (giver_id, created_at);
CREATE INDEX txillada_gifts_host_idx ON content.txillada_gifts (host_id, created_at);
