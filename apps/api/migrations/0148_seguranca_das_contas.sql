-- Segurança das contas: travões contra força bruta, registo em massa e contas falsas (ver src/security).
--
-- Nada disto guarda o endereço IP: guarda só uma impressão cifrada (HMAC) do IP e da rede (/24 no IPv4, /48 no IPv6), que
-- serve para contar e comparar, nunca para saber de onde alguém é. O mesmo para o identificador da instalação da app.
--
-- Prazos (o apagar corre de 10 em 10 minutos, em SecurityService.purge):
--   * security.counters e security.locks: desaparecem quando a janela ou o bloqueio acabam (no máximo 24 horas depois);
--   * security.events: 90 dias;
--   * security.account_risk: a pontuação e os sinais ficam enquanto a conta existir; as impressões (IP, rede, aparelho e
--     email) são apagadas ao fim de 90 dias, ou logo quando a conta é eliminada.
CREATE SCHEMA IF NOT EXISTS security;

-- Contadores de janela fixa (por exemplo «login falhado por IP nos últimos 15 minutos»). A chave já leva o tipo e a impressão.
-- Interface pequena (RateStore): a equipa da escala pode trocá-la pelo Redis sem mexer nas regras.
CREATE TABLE IF NOT EXISTS security.counters (
  key        text PRIMARY KEY CHECK (char_length(key) <= 200),
  hits       integer NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS counters_expires_idx ON security.counters (expires_at);

-- Bloqueios temporários com espera progressiva: cada bloqueio novo (strikes + 1) dura o dobro do anterior, até ao teto.
-- Os strikes esquecem-se 24 horas depois do último bloqueio (forget_at).
CREATE TABLE IF NOT EXISTS security.locks (
  key       text PRIMARY KEY CHECK (char_length(key) <= 200),
  until     timestamptz NOT NULL,
  strikes   integer NOT NULL DEFAULT 1,
  forget_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS locks_forget_idx ON security.locks (forget_at);

-- Eventos de segurança (falhas de login, bloqueios, prova de humano falhada, registos travados, contas suspeitas,
-- reutilização de sessão…), com prazo de 90 dias. Os importantes vão também para audit.audit_log (que não se apaga).
CREATE TABLE IF NOT EXISTS security.events (
  id         uuid PRIMARY KEY,
  kind       text NOT NULL CHECK (char_length(kind) <= 40),
  user_id    uuid REFERENCES identity.users(id) ON DELETE CASCADE,
  ip_hash    text,
  net_hash   text,
  device     text CHECK (device IS NULL OR char_length(device) <= 80),
  metadata   jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS events_created_idx ON security.events (created_at);
CREATE INDEX IF NOT EXISTS events_user_idx ON security.events (user_id, created_at DESC) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS events_kind_idx ON security.events (kind, created_at DESC);

-- Pontuação de risco de cada conta nova (registo e primeiras 48 horas). `signals`: { "mesmo_ip": 30, "nome_gerado": 10, … }.
--   ok        pontuação baixa;
--   flagged   pontuação alta: fila «Contas suspeitas» do backoffice, com limites mais apertados durante 24 horas;
--   cleared   a equipa confirmou que é verdadeira (sai da fila e os sinais deixam de a pôr lá outra vez);
--   limited   a equipa decidiu limitar (limites mais apertados até limited_until);
--   suspended a equipa suspendeu a conta.
CREATE TABLE IF NOT EXISTS security.account_risk (
  user_id          uuid PRIMARY KEY REFERENCES identity.users(id) ON DELETE CASCADE,
  score            integer NOT NULL DEFAULT 0 CHECK (score BETWEEN 0 AND 100),
  signals          jsonb NOT NULL DEFAULT '{}',
  ip_hash          text,
  net_hash         text,
  device_hash      text,
  email_hash       text,
  client           text CHECK (client IS NULL OR client IN ('web', 'app', 'other')),
  human            boolean NOT NULL DEFAULT false,
  state            text NOT NULL DEFAULT 'ok' CHECK (state IN ('ok', 'flagged', 'cleared', 'limited', 'suspended')),
  limited_until    timestamptz,
  flagged_at       timestamptz,
  reviewed_by      uuid,
  reviewed_at      timestamptz,
  review_note      text CHECK (review_note IS NULL OR char_length(review_note) <= 300),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS account_risk_queue_idx ON security.account_risk (state, score DESC, flagged_at DESC);
CREATE INDEX IF NOT EXISTS account_risk_ip_idx ON security.account_risk (ip_hash, created_at) WHERE ip_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS account_risk_net_idx ON security.account_risk (net_hash, created_at) WHERE net_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS account_risk_device_idx ON security.account_risk (device_hash, created_at) WHERE device_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS account_risk_email_idx ON security.account_risk (email_hash) WHERE email_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS account_risk_purge_idx ON security.account_risk (created_at) WHERE ip_hash IS NOT NULL OR net_hash IS NOT NULL OR device_hash IS NOT NULL OR email_hash IS NOT NULL;

-- Convites: o motivo de um convite ficar sem prémio pode agora vir da segurança (conta suspeita, mesmo aparelho, mesmo email).
-- A coluna `reason` já é texto livre: só um índice para a pergunta «quantos convidados deste código nesta hora».
CREATE INDEX IF NOT EXISTS referrals_inviter_created_idx ON social.referrals (inviter_id, created_at DESC);
