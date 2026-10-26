-- Menções (@utilizador): quem pode mencionar-me (todos / quem eu sigo / ninguém) e o novo tipo de notificação.
ALTER TABLE identity.users
  ADD COLUMN mentions_allowed text NOT NULL DEFAULT 'everyone' CHECK (mentions_allowed IN ('everyone', 'following', 'off'));

ALTER TABLE social.notifications DROP CONSTRAINT notifications_kind_check;
ALTER TABLE social.notifications ADD CONSTRAINT notifications_kind_check
  CHECK (kind IN ('blocked', 'follow', 'follow_request', 'request_accepted', 'gift', 'comment', 'reply', 'story_reply', 'repost', 'mention'));
