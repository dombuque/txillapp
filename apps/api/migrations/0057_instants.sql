-- Instants: foto tirada na hora, com legenda curta. Dura 24 h e cada pessoa vê-a uma só vez.
-- Quem vê: os amigos próximos de quem a fez e as pessoas que se seguem mutuamente.
CREATE TABLE social.instants (
  id         uuid PRIMARY KEY,
  author_id  uuid NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  media_id   uuid NOT NULL REFERENCES content.media_assets(id) ON DELETE CASCADE,
  caption    text NOT NULL DEFAULT '' CHECK (char_length(caption) <= 80),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '24 hours'
);
CREATE INDEX instants_author_idx ON social.instants (author_id, created_at DESC);
CREATE INDEX instants_expires_idx ON social.instants (expires_at);

CREATE TABLE social.instant_views (
  instant_id uuid NOT NULL REFERENCES social.instants(id) ON DELETE CASCADE,
  viewer_id  uuid NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  viewed_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (instant_id, viewer_id)
);
