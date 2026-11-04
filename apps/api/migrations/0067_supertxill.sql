-- SuperTxill: a IA do Txillapp, que vive no chat. É uma conta própria (sem senha: ninguém entra nela) e tem contadores de uso.
ALTER TABLE identity.users ADD COLUMN is_bot boolean NOT NULL DEFAULT false;

INSERT INTO identity.users (id, email, username, display_name, status, email_verified_at, terms_accepted_at, terms_version, is_bot)
VALUES ('00000000-0000-7000-8000-0000000000b1', 'supertxill@bot.invalid', 'supertxill', 'SuperTxill', 'active', now(), now(), '2026-11-03', true)
ON CONFLICT DO NOTHING;

-- Quantas respostas cada pessoa já recebeu hoje (limite diário).
CREATE TABLE social.bot_usage (
  user_id uuid NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  day date NOT NULL DEFAULT (now() AT TIME ZONE 'UTC')::date,
  n integer NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day)
);

-- Respostas dadas por mês, em toda a app (teto mensal, para o custo nunca fugir ao controlo).
CREATE TABLE social.bot_budget (
  month text PRIMARY KEY,
  n integer NOT NULL DEFAULT 0
);
