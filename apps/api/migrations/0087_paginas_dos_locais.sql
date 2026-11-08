-- Páginas dos locais a sério: perfil completo, gestores (como as páginas do Facebook), seguidores e publicações feitas como o local.
ALTER TABLE content.venues
  ADD COLUMN avatar_media_id uuid REFERENCES content.media_assets(id) ON DELETE SET NULL,
  ADD COLUMN cover_media_id uuid REFERENCES content.media_assets(id) ON DELETE SET NULL,
  ADD COLUMN address text CHECK (char_length(address) <= 160),
  ADD COLUMN hours text CHECK (char_length(hours) <= 300),
  ADD COLUMN phone text CHECK (char_length(phone) <= 30),
  ADD COLUMN whatsapp text CHECK (char_length(whatsapp) <= 30),
  ADD COLUMN website text CHECK (char_length(website) <= 200);
-- O "sobre" passa a caber uma descrição a sério.
ALTER TABLE content.venues DROP CONSTRAINT venues_about_check;
ALTER TABLE content.venues ADD CONSTRAINT venues_about_check CHECK (char_length(about) <= 1000);

-- Gestores: o dono convida; a pessoa aceita. Administrador edita tudo e gere gestores; editor publica como o local.
CREATE TABLE content.venue_managers (
  venue_id uuid NOT NULL REFERENCES content.venues(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('admin', 'editor')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active')),
  invited_by uuid REFERENCES identity.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (venue_id, user_id)
);
CREATE INDEX venue_managers_user_idx ON content.venue_managers (user_id, status);

-- Seguir um local: as publicações da página entram no feed de quem segue.
CREATE TABLE content.venue_follows (
  venue_id uuid NOT NULL REFERENCES content.venues(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (venue_id, user_id)
);
CREATE INDEX venue_follows_user_idx ON content.venue_follows (user_id);

-- Publicação feita como o local (por um gestor): aparece com o nome e o logótipo da página.
ALTER TABLE content.posts ADD COLUMN venue_id uuid REFERENCES content.venues(id) ON DELETE SET NULL;
CREATE INDEX posts_venue_idx ON content.posts (venue_id, created_at DESC) WHERE venue_id IS NOT NULL;

-- Notificação do convite para gerir um local.
ALTER TABLE social.notifications DROP CONSTRAINT notifications_kind_check;
ALTER TABLE social.notifications ADD CONSTRAINT notifications_kind_check
  CHECK (kind IN ('blocked', 'follow', 'follow_request', 'request_accepted', 'gift', 'comment', 'reply', 'story_reply', 'repost', 'mention', 'tag', 'verified', 'venue_invite'));
