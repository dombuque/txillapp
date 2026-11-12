-- Música licenciada (comercial): o uso agregado por faixa e por país para os relatórios aos fornecedores, as remoções
-- e o que já foi entregue. Nada aqui guarda quem ouviu: só contagens por dia.

-- O uso por dia (UTC), catálogo, faixa, país e tipo. 'ZZ' = país desconhecido.
CREATE TABLE content.music_usage_daily (
  day date NOT NULL,
  source text NOT NULL CHECK (source ~ '^[a-z0-9_-]{1,30}$'),
  track_id text NOT NULL CHECK (char_length(track_id) BETWEEN 1 AND 80),
  country char(2) NOT NULL CHECK (country ~ '^[A-Z]{2}$'),
  event text NOT NULL CHECK (event IN ('preview', 'play', 'create')),
  count integer NOT NULL DEFAULT 0 CHECK (count >= 0),
  PRIMARY KEY (source, day, track_id, country, event)
);

-- Os dias já entregues a cada fornecedor (um relatório por dia fechado; voltar a correr não duplica).
CREATE TABLE content.music_usage_reports (
  source text NOT NULL,
  day date NOT NULL,
  rows integer NOT NULL CHECK (rows >= 0),
  accepted integer NOT NULL CHECK (accepted >= 0),
  sent_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source, day)
);

-- Faixas retiradas (aviso do fornecedor ou decisão da equipa): deixam de aparecer e saem das publicações.
CREATE TABLE content.music_takedowns (
  source text NOT NULL,
  track_id text NOT NULL CHECK (char_length(track_id) BETWEEN 1 AND 80),
  reason text NOT NULL CHECK (char_length(reason) BETWEEN 1 AND 300),
  origin text NOT NULL CHECK (origin IN ('provider', 'staff')),
  actor_id uuid REFERENCES identity.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source, track_id)
);

-- Até onde já lemos os avisos de remoção de cada fornecedor.
CREATE TABLE content.music_provider_state (
  source text PRIMARY KEY,
  takedowns_checked_at timestamptz NOT NULL
);
