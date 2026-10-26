-- Pesquisa melhor: texto completo (português, sem acentos), nomes aproximados (trigramas) e hashtags.
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- `unaccent` não é "imutable" de fábrica; este envólucro permite usá-lo em índices.
CREATE OR REPLACE FUNCTION content.f_unaccent(text) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT AS $$ SELECT public.unaccent('public.unaccent'::regdictionary, $1) $$;

CREATE INDEX posts_fts_idx ON content.posts USING gin (to_tsvector('portuguese', content.f_unaccent(body))) WHERE removed_at IS NULL;
CREATE INDEX users_username_trgm ON identity.users USING gin (lower(username) gin_trgm_ops);
CREATE INDEX users_display_trgm ON identity.users USING gin (lower(display_name) gin_trgm_ops);

CREATE TABLE content.post_tags (
  post_id    uuid NOT NULL REFERENCES content.posts(id) ON DELETE CASCADE,
  tag        text NOT NULL CHECK (tag ~ '^[a-z0-9_]{2,30}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, tag)
);
CREATE INDEX post_tags_tag_idx ON content.post_tags (tag, created_at DESC);
CREATE INDEX post_tags_recent_idx ON content.post_tags (created_at DESC);

-- Publicações que já existiam.
INSERT INTO content.post_tags (post_id, tag, created_at)
SELECT DISTINCT p.id, lower(content.f_unaccent(m[1])), p.created_at
  FROM content.posts p, regexp_matches(p.body, '(?<![[:alnum:]_&#])#([[:alnum:]_]{2,30})', 'g') AS m
 WHERE p.removed_at IS NULL AND lower(content.f_unaccent(m[1])) ~ '^[a-z0-9_]{2,30}$'
ON CONFLICT DO NOTHING;
