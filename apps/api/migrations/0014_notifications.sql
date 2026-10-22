-- Notificações: bloqueios, seguidores, pedidos, presentes, comentários e respostas a stories.
CREATE TABLE social.notifications (
  id         uuid PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES identity.users(id),
  actor_id   uuid NOT NULL REFERENCES identity.users(id),
  kind       text NOT NULL CHECK (kind IN ('blocked', 'follow', 'follow_request', 'request_accepted', 'gift', 'comment', 'reply', 'story_reply')),
  data       jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at    timestamptz,
  CHECK (user_id <> actor_id)
);
CREATE INDEX notifications_user_idx ON social.notifications (user_id, id DESC);
CREATE INDEX notifications_unread_idx ON social.notifications (user_id) WHERE read_at IS NULL;
