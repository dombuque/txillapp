-- Reposts: partilhar a publicação de outra pessoa no próprio perfil, sozinha ou com um comentário (citação).
ALTER TABLE content.posts DROP CONSTRAINT posts_kind_check;
ALTER TABLE content.posts ADD COLUMN repost_of uuid REFERENCES content.posts(id);
ALTER TABLE content.posts ADD CONSTRAINT posts_kind_check CHECK (kind IN ('post', 'gift', 'repost'));
ALTER TABLE content.posts ADD CONSTRAINT repost_fields CHECK ((kind = 'repost') = (repost_of IS NOT NULL));

-- Um repost simples (sem comentário) por pessoa e publicação; citações podem ser várias.
CREATE UNIQUE INDEX posts_one_plain_repost ON content.posts (author_id, repost_of) WHERE kind = 'repost' AND body = '';
CREATE INDEX posts_repost_of_idx ON content.posts (repost_of) WHERE repost_of IS NOT NULL;

ALTER TABLE social.notifications DROP CONSTRAINT notifications_kind_check;
ALTER TABLE social.notifications ADD CONSTRAINT notifications_kind_check
  CHECK (kind IN ('blocked', 'follow', 'follow_request', 'request_accepted', 'gift', 'comment', 'reply', 'story_reply', 'repost'));
