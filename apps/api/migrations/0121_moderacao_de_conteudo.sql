-- Moderação de conteúdo no backoffice (página «Conteúdo», fila de queixas melhorada e auditoria com filtros).
--
-- 1. Remover e repor conteúdo, com motivo. As publicações já tinham removed_at (0025). Os comentários apagam-se (as
--    respostas e os brindes vão com eles), por isso guardamos aqui uma cópia para os poder repor; os mimos deixam de se
--    ver (o prazo passa para agora) e guardamos o prazo original. A cópia de um comentário removido é apagada 180 dias
--    depois da remoção (REMOVAL_COPY_DAYS em content-removal.ts) e quando o autor elimina a conta.
CREATE TABLE content.moderation_removals (
  id             uuid PRIMARY KEY,
  target_type    text NOT NULL CHECK (target_type IN ('post', 'comment', 'story')),
  target_id      uuid NOT NULL,
  author_id      uuid REFERENCES identity.users(id) ON DELETE SET NULL,
  -- Comentário: a publicação onde estava (para o repor e para a ligação no backoffice).
  post_id        uuid,
  -- O texto no momento da remoção (para pesquisar e mostrar o que foi removido) e a cópia para repor.
  body           text,
  snapshot       jsonb,
  reason         text NOT NULL CHECK (char_length(reason) BETWEEN 3 AND 300),
  removed_by     uuid REFERENCES identity.users(id) ON DELETE SET NULL,
  removed_at     timestamptz NOT NULL DEFAULT now(),
  restored_at    timestamptz,
  restored_by    uuid REFERENCES identity.users(id) ON DELETE SET NULL,
  restore_reason text CHECK (restore_reason IS NULL OR char_length(restore_reason) BETWEEN 3 AND 300)
);
-- Só uma remoção ativa por conteúdo.
CREATE UNIQUE INDEX moderation_removals_active ON content.moderation_removals (target_type, target_id) WHERE restored_at IS NULL;
CREATE INDEX moderation_removals_recent ON content.moderation_removals (removed_at DESC);
CREATE INDEX moderation_removals_author ON content.moderation_removals (author_id);

-- 2. Avisos ao autor: conteúdo removido, conteúdo reposto e aviso da moderação (data: { type, reason, postId? }).
--    A lista de tipos é a união da que já existe com estes três (não depende da ordem em que os ramos se juntam).
DO $$
DECLARE def text; kinds text[];
BEGIN
  SELECT pg_get_constraintdef(oid) INTO def FROM pg_constraint
   WHERE conname = 'notifications_kind_check' AND conrelid = 'social.notifications'::regclass;
  SELECT array_agg(DISTINCT k ORDER BY k) INTO kinds FROM (
    SELECT (regexp_matches(coalesce(def, ''), '''([a-z_]+)''', 'g'))[1] AS k
    UNION SELECT unnest(ARRAY['content_removed', 'content_restored', 'moderation_warning'])
  ) x;
  ALTER TABLE social.notifications DROP CONSTRAINT IF EXISTS notifications_kind_check;
  EXECUTE format('ALTER TABLE social.notifications ADD CONSTRAINT notifications_kind_check CHECK (kind = ANY (%L::text[]))', kinds);
END $$;

-- 3. Denunciar um local (página de um local aprovado). Mesma regra de união.
DO $$
DECLARE def text; kinds text[];
BEGIN
  SELECT pg_get_constraintdef(oid) INTO def FROM pg_constraint
   WHERE conname = 'reports_target_type_check' AND conrelid = 'social.reports'::regclass;
  SELECT array_agg(DISTINCT k ORDER BY k) INTO kinds FROM (
    SELECT (regexp_matches(coalesce(def, ''), '''([a-z_]+)''', 'g'))[1] AS k
    UNION SELECT 'venue'
  ) x;
  ALTER TABLE social.reports DROP CONSTRAINT IF EXISTS reports_target_type_check;
  EXECUTE format('ALTER TABLE social.reports ADD CONSTRAINT reports_target_type_check CHECK (target_type = ANY (%L::text[]))', kinds);
END $$;

-- 4. Filas e pesquisas do backoffice.
-- O 0119 (Contas) já cria reports_target_user_idx (target_user_id, created_at) e audit_log_target_idx (target, created_at):
-- com o mesmo nome, estes ficavam por criar sem aviso. O da auditoria por alvo serve como está; o das queixas por estado
-- leva outro nome.
CREATE INDEX IF NOT EXISTS reports_target_user_status_idx ON social.reports (target_user_id, status);
CREATE INDEX IF NOT EXISTS audit_log_actor_idx ON audit.audit_log (actor_id, id DESC);
CREATE INDEX IF NOT EXISTS audit_log_action_idx ON audit.audit_log (action, id DESC);
CREATE INDEX IF NOT EXISTS media_assets_nsfw_idx ON content.media_assets (nsfw_score) WHERE nsfw_score IS NOT NULL;
CREATE INDEX IF NOT EXISTS comments_recent_idx ON content.comments (created_at DESC);
CREATE INDEX IF NOT EXISTS stories_recent_idx ON content.stories (created_at DESC);
CREATE INDEX IF NOT EXISTS taste_items_status_idx ON taste.items (status, created_at);
