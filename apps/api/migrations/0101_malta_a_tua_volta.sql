-- "A malta à tua volta": quem quiser aparece no mapa aos amigos, como no Snap Map, mas com a privacidade primeiro.
CREATE SCHEMA IF NOT EXISTS nearby;

-- Quem me pode ver no mapa: ninguém (por omissão), só quem eu sigo e me segue de volta, ou quem eu sigo.
-- Menores de 18 anos nunca podem ligar (a API recusa).
CREATE TABLE nearby.settings (
  user_id uuid PRIMARY KEY REFERENCES identity.users(id) ON DELETE CASCADE,
  visibility text NOT NULL DEFAULT 'off' CHECK (visibility IN ('off', 'mutual', 'following')),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Onde a pessoa anda: SÓ o centro de uma quadrícula de ~1,5 km e a hora. Nunca a posição exata.
-- Passadas 3 horas deixa de contar e uma varredura periódica apaga a linha.
CREATE TABLE nearby.presence (
  user_id uuid PRIMARY KEY REFERENCES identity.users(id) ON DELETE CASCADE,
  cell_lat double precision NOT NULL CHECK (cell_lat BETWEEN -90 AND 90),
  cell_lng double precision NOT NULL CHECK (cell_lng BETWEEN -180 AND 180),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX presence_cell_idx ON nearby.presence (cell_lat, cell_lng);
CREATE INDEX presence_updated_idx ON nearby.presence (updated_at);
