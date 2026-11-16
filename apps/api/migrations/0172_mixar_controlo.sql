-- Mixar: controlo dos temas e privacidade dos gostos (0172, docs/mixar-contrato.md, secção «Controlo e resumo»).
--
-- 1. Os temas de cada Mixar, por pessoa: «Menos disto» num item (mode 'less': o tema pesa menos neste Mixar) e «Não quero
--    isto no nosso Mixar» (mode 'off': o tema sai da seleção dos dois). Só vale neste Mixar; o feed normal não muda.
CREATE TABLE IF NOT EXISTS social.mixar_topic_prefs (
  mixar_id   uuid NOT NULL REFERENCES social.mixars(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  topic      text NOT NULL CHECK (char_length(topic) BETWEEN 1 AND 40),
  mode       text NOT NULL CHECK (mode IN ('less', 'off')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (mixar_id, user_id, topic)
);

-- 2. «Menos disto» também baixa o peso do autor da publicação, só neste Mixar.
CREATE TABLE IF NOT EXISTS social.mixar_author_less (
  mixar_id   uuid NOT NULL REFERENCES social.mixars(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  author_id  uuid NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (mixar_id, user_id, author_id)
);
CREATE INDEX IF NOT EXISTS mixar_author_less_author_idx ON social.mixar_author_less (author_id);

-- 3. Temas privados (por pessoa, valem para todos os meus Mixar): nunca entram no meu perfil para o Mixar, nem na
--    compatibilidade, nem nos temas em comum, nem nas razões dos itens, nem no resumo da semana.
CREATE TABLE IF NOT EXISTS social.mixar_private_topics (
  user_id    uuid NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  topic      text NOT NULL CHECK (char_length(topic) BETWEEN 1 AND 40),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, topic)
);
