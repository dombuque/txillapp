-- Feed por relevância: o que cada pessoa já viu (ou escondeu) para não repetir sempre o mesmo.
CREATE TABLE content.feed_impressions (
  user_id uuid NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  post_id uuid NOT NULL REFERENCES content.posts(id) ON DELETE CASCADE,
  seen_at timestamptz NOT NULL DEFAULT now(),
  hidden  boolean NOT NULL DEFAULT false,
  PRIMARY KEY (user_id, post_id)
);
CREATE INDEX feed_impressions_user_seen_idx ON content.feed_impressions (user_id, seen_at DESC);
-- Candidatos recentes, para a pesquisa do feed.
CREATE INDEX posts_created_idx ON content.posts (created_at DESC) WHERE removed_at IS NULL;
