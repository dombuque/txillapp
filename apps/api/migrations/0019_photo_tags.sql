-- Identificar pessoas numa foto (posição manual, escolhida por quem publica; sem reconhecimento facial).
CREATE TABLE content.photo_tags (
  id         uuid PRIMARY KEY,
  post_id    uuid NOT NULL REFERENCES content.posts(id) ON DELETE CASCADE,
  media_id   uuid NOT NULL REFERENCES content.media_assets(id) ON DELETE CASCADE,
  tagged_id  uuid NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  x          real NOT NULL CHECK (x BETWEEN 0 AND 1),
  y          real NOT NULL CHECK (y BETWEEN 0 AND 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (media_id, tagged_id)
);
CREATE INDEX photo_tags_post_idx ON content.photo_tags (post_id);
CREATE INDEX photo_tags_user_idx ON content.photo_tags (tagged_id);

ALTER TABLE social.notifications DROP CONSTRAINT notifications_kind_check;
ALTER TABLE social.notifications ADD CONSTRAINT notifications_kind_check
  CHECK (kind IN ('blocked', 'follow', 'follow_request', 'request_accepted', 'gift', 'comment', 'reply', 'story_reply', 'repost', 'mention', 'tag'));
