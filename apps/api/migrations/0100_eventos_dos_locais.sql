-- Eventos dos locais: o dono e os gestores anunciam o que vai acontecer (noite de kizomba, jogo no ecrã grande...).
-- Aparecem na página do local e no mapa "À tua volta".
CREATE TABLE content.venue_events (
  id uuid PRIMARY KEY,
  venue_id uuid NOT NULL REFERENCES content.venues(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (char_length(title) BETWEEN 2 AND 80),
  description text CHECK (char_length(description) <= 500),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz,
  cover_media_id uuid REFERENCES content.media_assets(id) ON DELETE SET NULL,
  created_by uuid REFERENCES identity.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  cancelled_at timestamptz,
  CONSTRAINT venue_events_dates CHECK (ends_at IS NULL OR ends_at > starts_at)
);
CREATE INDEX venue_events_venue_idx ON content.venue_events (venue_id, starts_at) WHERE cancelled_at IS NULL;
CREATE INDEX venue_events_starts_idx ON content.venue_events (starts_at) WHERE cancelled_at IS NULL;

-- "Tenho interesse": só conta e serve para a pessoa se lembrar; não notifica ninguém.
CREATE TABLE content.venue_event_interest (
  event_id uuid NOT NULL REFERENCES content.venue_events(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, user_id)
);
CREATE INDEX venue_event_interest_user_idx ON content.venue_event_interest (user_id);
