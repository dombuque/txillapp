-- Temas das publicações (classificados pelo Txillapp, sem serviços externos) para o Explorar. NULL = ainda por classificar.
ALTER TABLE content.posts ADD COLUMN topics text[];
CREATE INDEX posts_topics_idx ON content.posts USING gin (topics) WHERE removed_at IS NULL;
