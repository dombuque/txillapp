-- Brindar os comentários dos mimos e os comentários da Txillada (como nos comentários das publicações, content.comment_cheers).

-- 1. Brindes aos comentários dos mimos: uma linha por pessoa e comentário (brindar outra vez tira). Saem com o comentário
--    (e o comentário com o mimo) e com a conta (a conta fica anonimizada: apaga-se à mão em auth.service).
CREATE TABLE content.story_comment_cheers (
  comment_id uuid NOT NULL REFERENCES content.story_comments (id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES identity.users (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (comment_id, user_id)
);
CREATE INDEX story_comment_cheers_user_idx ON content.story_comment_cheers (user_id);

-- 2. Brindes aos comentários da Txillada: uma linha por pessoa e comentário (brindar outra vez tira). Saem com o comentário
--    (a limpeza dos 7 dias) e com a conta. Não há aviso ao autor (é ao vivo): só a contagem e os copos na sala.
CREATE TABLE content.txillada_comment_cheers (
  comment_id uuid NOT NULL REFERENCES content.txillada_comments (id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES identity.users (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (comment_id, user_id)
);
CREATE INDEX txillada_comment_cheers_user_idx ON content.txillada_comment_cheers (user_id);

-- 3. Os avisos de brindes juntados (0114) passam a conhecer o comentário de um mimo ('story_comment').
ALTER TABLE social.cheer_notices DROP CONSTRAINT IF EXISTS cheer_notices_kind_check;
ALTER TABLE social.cheer_notices ADD CONSTRAINT cheer_notices_kind_check CHECK (kind IN ('post', 'comment', 'story_comment'));
