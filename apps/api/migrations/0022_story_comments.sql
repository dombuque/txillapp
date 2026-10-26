-- Comentários públicos nos stories: visíveis a quem pode ver o story (as respostas privadas continuam à parte).
CREATE TABLE content.story_comments (
  id         uuid PRIMARY KEY,
  story_id   uuid NOT NULL REFERENCES content.stories(id) ON DELETE CASCADE,
  author_id  uuid NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  body       text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 500),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX story_comments_story_idx ON content.story_comments (story_id, id);
