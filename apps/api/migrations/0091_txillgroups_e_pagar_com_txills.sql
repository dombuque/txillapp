-- TxillGroups (os grupos do chat passam a ter tipo, descrição, capa e um plano) e pagar com Txills nos locais.

-- ---------- Grupo: tipo, descrição, capa, visibilidade e o plano (um por grupo) ----------
-- O nome continua 1-40 na base de dados (há grupos antigos com 1 letra); a API exige 2-40 a partir de agora.
ALTER TABLE social.groups
  ADD COLUMN kind text NOT NULL DEFAULT 'outro' CHECK (kind IN ('viagem', 'festa', 'fim_de_semana', 'outro')),
  ADD COLUMN description text CHECK (char_length(description) <= 300),
  ADD COLUMN cover_media_id uuid REFERENCES content.media_assets(id) ON DELETE SET NULL,
  -- Só 'private' por agora; a descoberta de grupos públicos fica para uma fase seguinte.
  ADD COLUMN visibility text NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'public')),
  ADD COLUMN destination text CHECK (char_length(destination) <= 80),
  ADD COLUMN plan_venue_id uuid REFERENCES content.venues(id) ON DELETE SET NULL,
  ADD COLUMN starts_on date,
  ADD COLUMN ends_on date,
  -- Cofre: meta em Txills e o local para onde o dinheiro vai (opcionais).
  ADD COLUMN pot_goal bigint CHECK (pot_goal > 0),
  ADD COLUMN pot_venue_id uuid REFERENCES content.venues(id) ON DELETE SET NULL,
  ADD CONSTRAINT groups_plan_dates CHECK (ends_on IS NULL OR starts_on IS NULL OR ends_on >= starts_on);

-- Vou, talvez, não vou.
CREATE TABLE social.group_rsvps (
  group_id uuid NOT NULL REFERENCES social.groups(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('going', 'maybe', 'not_going')),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, user_id)
);

-- Sondagens: aparecem na conversa como uma mensagem do tipo 'poll' (o corpo é o id da sondagem).
CREATE TABLE social.group_polls (
  id uuid PRIMARY KEY,
  group_id uuid NOT NULL REFERENCES social.groups(id) ON DELETE CASCADE,
  question text NOT NULL CHECK (char_length(question) BETWEEN 1 AND 140),
  multiple boolean NOT NULL DEFAULT false,
  closes_at timestamptz,
  closed_at timestamptz,
  created_by uuid REFERENCES identity.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX group_polls_group_idx ON social.group_polls (group_id, id DESC);

CREATE TABLE social.group_poll_options (
  id uuid PRIMARY KEY,
  poll_id uuid NOT NULL REFERENCES social.group_polls(id) ON DELETE CASCADE,
  position smallint NOT NULL,
  text text NOT NULL CHECK (char_length(text) BETWEEN 1 AND 60),
  UNIQUE (poll_id, position)
);

CREATE TABLE social.group_poll_votes (
  poll_id uuid NOT NULL REFERENCES social.group_polls(id) ON DELETE CASCADE,
  option_id uuid NOT NULL REFERENCES social.group_poll_options(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (option_id, user_id)
);
CREATE INDEX group_poll_votes_poll_idx ON social.group_poll_votes (poll_id, user_id);

-- Lista do que levar / fazer.
CREATE TABLE social.group_checklist (
  id uuid PRIMARY KEY,
  group_id uuid NOT NULL REFERENCES social.groups(id) ON DELETE CASCADE,
  text text NOT NULL CHECK (char_length(text) BETWEEN 1 AND 120),
  assignee_id uuid REFERENCES identity.users(id) ON DELETE SET NULL,
  done boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES identity.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX group_checklist_group_idx ON social.group_checklist (group_id, id);

-- Despesas em meticais (só contas, não mexe em dinheiro). Valores em cêntimos.
CREATE TABLE social.group_expenses (
  id uuid PRIMARY KEY,
  group_id uuid NOT NULL REFERENCES social.groups(id) ON DELETE CASCADE,
  description text NOT NULL CHECK (char_length(description) BETWEEN 1 AND 120),
  amount_cents bigint NOT NULL CHECK (amount_cents > 0),
  paid_by uuid NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  created_by uuid REFERENCES identity.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX group_expenses_group_idx ON social.group_expenses (group_id, id DESC);

-- A parte de cada pessoa (somam o valor da despesa; o resto dos cêntimos vai para os primeiros).
CREATE TABLE social.group_expense_shares (
  expense_id uuid NOT NULL REFERENCES social.group_expenses(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  share_cents bigint NOT NULL CHECK (share_cents >= 0),
  PRIMARY KEY (expense_id, user_id)
);

-- Sondagem dentro da conversa do grupo.
ALTER TABLE social.messages DROP CONSTRAINT messages_kind_check;
ALTER TABLE social.messages ADD CONSTRAINT messages_kind_check CHECK (kind IN ('text', 'story_reply', 'story_reaction', 'image', 'voice', 'sticker', 'location', 'post', 'gift', 'video', 'zas_reply', 'call', 'poll'));

-- ---------- Locais que aceitam Txills ----------
ALTER TABLE content.venues ADD COLUMN accepts_txills boolean NOT NULL DEFAULT false;

-- ---------- Ledger: cofre do grupo e carteira do local ----------
-- As contas guardam o grupo ou o local a que pertencem. Se o grupo ou o local desaparecer, a conta e os lançamentos ficam
-- (o ledger é imutável); o grupo devolve o cofre antes de desaparecer (ver groups.service.ts).
ALTER TABLE ledger.accounts
  ADD COLUMN group_id uuid UNIQUE REFERENCES social.groups(id) ON DELETE SET NULL,
  ADD COLUMN venue_id uuid UNIQUE REFERENCES content.venues(id) ON DELETE SET NULL;
ALTER TABLE ledger.accounts DROP CONSTRAINT accounts_kind_check;
ALTER TABLE ledger.accounts ADD CONSTRAINT accounts_kind_check CHECK (kind IN ('user_wallet', 'system_issuance', 'group_pot', 'venue_wallet'));
-- Uma conta pertence a uma coisa só.
ALTER TABLE ledger.accounts ADD CONSTRAINT accounts_one_owner CHECK (
  (kind = 'user_wallet' AND group_id IS NULL AND venue_id IS NULL) OR
  (kind = 'group_pot' AND user_id IS NULL AND venue_id IS NULL) OR
  (kind = 'venue_wallet' AND user_id IS NULL AND group_id IS NULL) OR
  (kind = 'system_issuance' AND user_id IS NULL AND group_id IS NULL AND venue_id IS NULL)
);

ALTER TABLE ledger.transactions DROP CONSTRAINT transactions_type_check;
ALTER TABLE ledger.transactions ADD CONSTRAINT transactions_type_check CHECK (type IN ('welcome_bonus', 'transfer', 'gift', 'topup', 'invite', 'group_contribution', 'venue_payment', 'group_refund'));
-- Para listar depressa os pagamentos de um local e os movimentos de um cofre.
CREATE INDEX transactions_venue_idx ON ledger.transactions ((metadata->>'venueId'), id DESC) WHERE type = 'venue_payment';
CREATE INDEX transactions_group_idx ON ledger.transactions ((metadata->>'groupId'), id DESC) WHERE type IN ('group_contribution', 'venue_payment', 'group_refund');

-- ---------- Notificação: pagaram ao meu local ----------
ALTER TABLE social.notifications DROP CONSTRAINT notifications_kind_check;
ALTER TABLE social.notifications ADD CONSTRAINT notifications_kind_check
  CHECK (kind IN ('blocked', 'follow', 'follow_request', 'request_accepted', 'gift', 'comment', 'reply', 'story_reply', 'repost', 'mention', 'tag', 'verified', 'venue_invite', 'missed_call', 'venue_payment'));
