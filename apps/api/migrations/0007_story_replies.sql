-- Respostas e reacções (emoji) a stories, como no Instagram: chegam ao autor do story.
CREATE TABLE content.story_replies (
  id         uuid PRIMARY KEY,
  story_id   uuid NOT NULL REFERENCES content.stories(id) ON DELETE CASCADE,
  author_id  uuid NOT NULL REFERENCES identity.users(id),
  body       text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 500),
  kind       text NOT NULL DEFAULT 'reply' CHECK (kind IN ('reply', 'reaction')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX story_replies_story_idx ON content.story_replies (story_id, id);
