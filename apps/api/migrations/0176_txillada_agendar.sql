-- Txillada agendada (docs/txillada-agendar.md; src/txillada/txillada-schedules.service.ts).
--
-- O anfitrião marca dia e hora para uma Txillada; quem a pode ver pede «Lembrar-me» e recebe o aviso quando começa. Na hora,
-- o anfitrião começa com as escolhas que já fez (título, tipo, preço, meta): a Txillada que nasce fica em `txillada_id`.
-- Estados: 'scheduled' (à espera), 'started' (começou), 'cancelled' (o anfitrião cancelou), 'expired' (2 h depois da hora sem
-- começar) e 'removed' (retirada pela moderação, na fila de queixas: removed_by e removed_reason). Os 'cancelled', 'expired' e
-- 'removed' apagam-se ao fim de 30 dias (com os lembretes); os 'started' ficam enquanto a Txillada existir.
-- Ao começar, os lembretes apagam-se (já não servem) e o número fica em reminders_count.

CREATE TABLE IF NOT EXISTS content.txillada_schedules (
  id               uuid PRIMARY KEY,
  host_id          uuid NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  title            text NOT NULL DEFAULT '' CHECK (char_length(title) <= 80),
  audience         text NOT NULL CHECK (audience IN ('everyone', 'friends', 'close', 'paid')),
  price            int CHECK (price BETWEEN 5 AND 5000),
  goal             int CHECK (goal BETWEEN 10 AND 1000000),
  goal_purpose     text NOT NULL DEFAULT '' CHECK (char_length(goal_purpose) <= 80),
  starts_at        timestamptz NOT NULL,
  status           text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'started', 'cancelled', 'expired', 'removed')),
  txillada_id      uuid REFERENCES content.txilladas(id) ON DELETE SET NULL,
  -- Os avisos ao anfitrião: 15 minutos antes e «é agora». Cada um só uma vez (voltam a NULL quando a hora muda).
  host_reminded_at timestamptz,
  host_now_at      timestamptz,
  -- Quantos pediram lembrete (contas ativas), guardado ao começar, quando os lembretes se apagam (null antes disso).
  reminders_count  int,
  -- Retirada pela moderação (status 'removed'): quem decidiu (identity.users da equipa) e o motivo.
  removed_by       uuid REFERENCES identity.users(id) ON DELETE SET NULL,
  removed_reason   text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  -- A entrada só e sempre numa 'paid' (como txilladas_paid_price).
  CONSTRAINT txillada_schedules_paid_price CHECK ((audience = 'paid') = (price IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS txillada_schedules_host_idx ON content.txillada_schedules (host_id, starts_at) WHERE status = 'scheduled';
CREATE INDEX IF NOT EXISTS txillada_schedules_due_idx ON content.txillada_schedules (starts_at) WHERE status = 'scheduled';
CREATE INDEX IF NOT EXISTS txillada_schedules_txillada_idx ON content.txillada_schedules (txillada_id) WHERE txillada_id IS NOT NULL;

-- «Lembrar-me»: quem pediu para ser avisado quando começa.
CREATE TABLE IF NOT EXISTS content.txillada_schedule_reminders (
  schedule_id uuid NOT NULL REFERENCES content.txillada_schedules(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (schedule_id, user_id)
);
CREATE INDEX IF NOT EXISTS txillada_schedule_reminders_user_idx ON content.txillada_schedule_reminders (user_id);

-- Os avisos novos na lista (categoria «Txilladas»): 'txillada_scheduled_soon' (ao anfitrião: começa daqui a 15 min),
-- 'txillada_scheduled_now' (ao anfitrião: é agora) e 'txillada_scheduled_cancelled' (a quem pediu lembrete: cancelada, ou a
-- hora mudou com `data.moved`). data: { scheduleId, startsAt, title } (e moved/newStartsAt, reminders).
DO $$
DECLARE def text; kinds text[];
BEGIN
  SELECT pg_get_constraintdef(oid) INTO def FROM pg_constraint
   WHERE conname = 'notifications_kind_check' AND conrelid = 'social.notifications'::regclass;
  SELECT array_agg(DISTINCT k ORDER BY k) INTO kinds FROM (
    SELECT (regexp_matches(coalesce(def, ''), '''([a-z_]+)''', 'g'))[1] AS k
    UNION SELECT unnest(string_to_array((regexp_match(coalesce(def, ''), '\{([a-z_,]+)\}'))[1], ','))
    UNION SELECT DISTINCT kind FROM social.notifications
    UNION SELECT unnest(ARRAY['txillada_scheduled_soon', 'txillada_scheduled_now', 'txillada_scheduled_cancelled'])
  ) x WHERE k IS NOT NULL AND k <> '';
  ALTER TABLE social.notifications DROP CONSTRAINT IF EXISTS notifications_kind_check;
  EXECUTE format('ALTER TABLE social.notifications ADD CONSTRAINT notifications_kind_check CHECK (kind = ANY (%L::text[]))', kinds);
END $$;

-- Os dois avisos ao anfitrião vêm dele próprio (ator = quem recebe, como o 'zas_recap'): juntam-se aos tipos que o
-- notifications_check deixa com user_id = actor_id (lê a lista atual e junta os novos).
DO $$
DECLARE def text; kinds text[];
BEGIN
  SELECT pg_get_constraintdef(oid) INTO def FROM pg_constraint
   WHERE conname = 'notifications_check' AND conrelid = 'social.notifications'::regclass;
  SELECT array_agg(DISTINCT k ORDER BY k) INTO kinds FROM (
    SELECT (regexp_matches(coalesce(def, ''), '''([a-z_]+)''', 'g'))[1] AS k
    UNION SELECT unnest(ARRAY['verified', 'sound_review', 'zas_recap', 'txillada_scheduled_soon', 'txillada_scheduled_now'])
  ) x WHERE k IS NOT NULL AND k <> '';
  ALTER TABLE social.notifications DROP CONSTRAINT IF EXISTS notifications_check;
  EXECUTE format('ALTER TABLE social.notifications ADD CONSTRAINT notifications_check CHECK (user_id <> actor_id OR kind = ANY (%L::text[]))', kinds);
END $$;

-- Denunciar uma Txillada agendada ('txillada_schedule'): junta-se aos tipos que já existem, sem tirar nenhum (como na 0158 e na 0162).
DO $$
DECLARE def text; kinds text[];
BEGIN
  SELECT pg_get_constraintdef(oid) INTO def FROM pg_constraint
   WHERE conname = 'reports_target_type_check' AND conrelid = 'social.reports'::regclass;
  SELECT array_agg(DISTINCT k ORDER BY k) INTO kinds FROM (
    SELECT (regexp_matches(coalesce(def, ''), '''([a-z_]+)''', 'g'))[1] AS k
    UNION SELECT unnest(string_to_array((regexp_match(coalesce(def, ''), '\{([a-z_,]+)\}'))[1], ','))
    UNION SELECT DISTINCT target_type FROM social.reports
    UNION SELECT unnest(ARRAY['txillada', 'txillada_comment', 'mixar_comment', 'txillada_schedule'])
  ) x WHERE k IS NOT NULL AND k <> '';
  ALTER TABLE social.reports DROP CONSTRAINT IF EXISTS reports_target_type_check;
  EXECUTE format('ALTER TABLE social.reports ADD CONSTRAINT reports_target_type_check CHECK (target_type = ANY (%L::text[]))', kinds);
END $$;
