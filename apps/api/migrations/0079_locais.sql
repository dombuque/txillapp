-- Locais (bares, restaurantes, discotecas, cafés…): página própria, dono, selo de verificado e check-in por QR.
CREATE TABLE content.venues (
  id uuid PRIMARY KEY,
  slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9-]{3,60}$'),
  name text NOT NULL CHECK (char_length(name) BETWEEN 2 AND 80),
  kind text NOT NULL CHECK (kind IN ('bar', 'restaurante', 'discoteca', 'cafe', 'hotel', 'evento', 'outro')),
  city text CHECK (char_length(city) <= 60),
  country text,
  -- A posição do local (arredondada a ~110 m): é um sítio público, não uma pessoa.
  lat double precision CHECK (lat BETWEEN -90 AND 90),
  lng double precision CHECK (lng BETWEEN -180 AND 180),
  about text CHECK (char_length(about) <= 300),
  owner_id uuid NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  verified boolean NOT NULL DEFAULT false,
  -- O que vai dentro do QR do local: quem lê (no local) pode fazer check-in.
  check_token text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX venues_name_idx ON content.venues (lower(name));
CREATE INDEX venues_owner_idx ON content.venues (owner_id);

CREATE TABLE content.checkins (
  id uuid PRIMARY KEY,
  venue_id uuid NOT NULL REFERENCES content.venues(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX checkins_venue_idx ON content.checkins (venue_id, created_at DESC);
CREATE INDEX checkins_user_idx ON content.checkins (user_id, venue_id, created_at DESC);
