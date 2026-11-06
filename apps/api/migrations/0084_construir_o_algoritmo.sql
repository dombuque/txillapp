-- Construir o algoritmo: além dos temas, cada pessoa afina como o Explorar e os Reels são ordenados.
CREATE TABLE social.feed_settings (
  user_id    uuid PRIMARY KEY REFERENCES identity.users(id) ON DELETE CASCADE,
  following  text NOT NULL DEFAULT 'balanced' CHECK (following IN ('less', 'balanced', 'more')),
  freshness  text NOT NULL DEFAULT 'balanced' CHECK (freshness IN ('recent', 'balanced', 'popular')),
  media      text NOT NULL DEFAULT 'all' CHECK (media IN ('all', 'photos', 'videos')),
  variety    text NOT NULL DEFAULT 'normal' CHECK (variety IN ('low', 'normal', 'high')),
  hide_seen  boolean NOT NULL DEFAULT false,
  calm       boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- Contas de que se quer ver mais (1) ou menos (-1) no Explorar e nos Reels.
CREATE TABLE social.explore_people (
  user_id   uuid NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  person_id uuid NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  pref      smallint NOT NULL CHECK (pref IN (-1, 1)),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, person_id),
  CHECK (user_id <> person_id)
);
