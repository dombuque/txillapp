-- Comentários dos mimos com GIF ou autocolante (como os comentários das publicações): o GIF fica em jsonb (o mesmo formato,
-- com a classificação confirmada no GIPHY ou a fonte própria «txillapp») e o texto pode ficar vazio quando há GIF.
ALTER TABLE content.story_comments ADD COLUMN IF NOT EXISTS gif jsonb;

ALTER TABLE content.story_comments DROP CONSTRAINT IF EXISTS story_comments_body_check;
ALTER TABLE content.story_comments DROP CONSTRAINT IF EXISTS story_comments_body_or_gif;
ALTER TABLE content.story_comments ADD CONSTRAINT story_comments_body_or_gif
  CHECK (char_length(body) <= 500 AND (char_length(body) >= 1 OR gif IS NOT NULL));
