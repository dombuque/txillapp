-- Presentear num post (anúncio público) é um cartão do presente com a publicação presenteada lá dentro: o presente aponta para essa publicação.
ALTER TABLE content.posts DROP CONSTRAINT repost_fields;
ALTER TABLE content.posts ADD CONSTRAINT repost_fields CHECK (
  (kind = 'repost' AND repost_of IS NOT NULL) OR (kind = 'gift') OR (kind = 'post' AND repost_of IS NULL)
);
