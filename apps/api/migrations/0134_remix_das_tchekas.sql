-- Remix das tchekas: o «Dueto» (o meu vídeo lado a lado com a tcheka de outra pessoa) e o «Responder com tcheka»
-- (responder a um comentário com uma tcheka, com o comentário por cima do vídeo).

-- 1. «Deixar fazer duetos e respostas com as minhas tchekas» (Definições › Conteúdo). Ligado por omissão; numa conta
--    privada não vale (a regra está no código: NOT is_private AND remix_allowed), para o conteúdo não sair dos seguidores.
ALTER TABLE identity.users ADD COLUMN IF NOT EXISTS remix_allowed boolean NOT NULL DEFAULT true;

-- 2. De que é remix cada publicação: o original (a tcheka do dueto, ou a publicação onde está o comentário respondido),
--    o tipo, o comentário respondido e onde ficou o autocolante do comentário (0–1 do vídeo, a partir do canto de cima).
--    Apagar o original (de vez) ou o comentário não apaga a tcheka de quem fez o remix: só a ligação.
CREATE TABLE IF NOT EXISTS content.post_remixes (
  post_id     uuid PRIMARY KEY REFERENCES content.posts(id) ON DELETE CASCADE,
  original_id uuid NOT NULL REFERENCES content.posts(id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('duet', 'reply')),
  comment_id  uuid REFERENCES content.comments(id) ON DELETE SET NULL,
  sticker_x   real CHECK (sticker_x IS NULL OR (sticker_x >= 0 AND sticker_x <= 1)),
  sticker_y   real CHECK (sticker_y IS NULL OR (sticker_y >= 0 AND sticker_y <= 1)),
  created_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (post_id <> original_id),
  CHECK (kind = 'reply' OR comment_id IS NULL)
);
-- «Duetos e respostas» de um original (o mais recente primeiro) e «Respondeu com uma tcheka» de um comentário.
CREATE INDEX IF NOT EXISTS post_remixes_original_idx ON content.post_remixes (original_id, post_id DESC);
CREATE INDEX IF NOT EXISTS post_remixes_comment_idx ON content.post_remixes (comment_id) WHERE comment_id IS NOT NULL;

-- 3. O aviso a quem foi remisturado: data: { postId (o remix), originalId, remixKind: 'duet' | 'reply', role: 'post' | 'comment',
--    commentId? }. Categoria «Duetos e respostas» (remixes), que se pode desligar. Mesma regra de união das outras migrações.
DO $$
DECLARE def text; kinds text[];
BEGIN
  SELECT pg_get_constraintdef(oid) INTO def FROM pg_constraint
   WHERE conname = 'notifications_kind_check' AND conrelid = 'social.notifications'::regclass;
  SELECT array_agg(DISTINCT k ORDER BY k) INTO kinds FROM (
    SELECT (regexp_matches(coalesce(def, ''), '''([a-z_]+)''', 'g'))[1] AS k
    UNION SELECT unnest(string_to_array((regexp_match(coalesce(def, ''), '\{([a-z_,]+)\}'))[1], ','))
    UNION SELECT unnest(ARRAY['remix'])
  ) x WHERE k IS NOT NULL AND k <> '';
  ALTER TABLE social.notifications DROP CONSTRAINT IF EXISTS notifications_kind_check;
  EXECUTE format('ALTER TABLE social.notifications ADD CONSTRAINT notifications_kind_check CHECK (kind = ANY (%L::text[]))', kinds);
END $$;
