-- Stories: conteúdo temporário (24 h) com registo de visualizações.
CREATE TABLE content.stories (
  id         uuid PRIMARY KEY,
  author_id  uuid NOT NULL REFERENCES identity.users(id),
  media_id   uuid NOT NULL UNIQUE REFERENCES content.media_assets(id),
  caption    text CHECK (char_length(caption) <= 200),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '24 hours'
);
CREATE INDEX stories_author_idx ON content.stories (author_id, id);
CREATE INDEX stories_expiry_idx ON content.stories (expires_at);

CREATE TABLE content.story_views (
  story_id  uuid NOT NULL REFERENCES content.stories(id) ON DELETE CASCADE,
  viewer_id uuid NOT NULL REFERENCES identity.users(id),
  viewed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (story_id, viewer_id)
);
