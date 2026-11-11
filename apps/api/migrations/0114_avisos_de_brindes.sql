-- "A malta brindou-te": quem tem a publicação (ou a tcheka, ou o comentário) é avisado quando a brindam.
-- Os avisos juntam-se: uma linha por publicação (ou comentário) a cada 24 h, que sobe ao topo com o último a brindar.

-- Quem já foi contado para o aviso de cada coisa brindada (como em taste.geleira_cheer_notices): fica aqui mesmo depois de tirar
-- o brinde, por isso tirar e voltar a pôr não avisa outra vez. Inserir com ON CONFLICT DO NOTHING: se entrou uma linha, é a
-- primeira vez. `kind` diz se `target_id` é uma publicação ou um comentário; `owner_id` é quem é avisado.
CREATE TABLE social.cheer_notices (
  kind       text NOT NULL CHECK (kind IN ('post', 'comment')),
  target_id  uuid NOT NULL,
  user_id    uuid NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  owner_id   uuid NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (kind, target_id, user_id)
);
-- Quem brindou cada coisa numa janela de tempo (o nome e a contagem na lista, o "+4 brindes" no telemóvel).
CREATE INDEX cheer_notices_target_idx ON social.cheer_notices (kind, target_id, created_at DESC);
-- Eliminação da conta.
CREATE INDEX cheer_notices_user_idx ON social.cheer_notices (user_id);
CREATE INDEX cheer_notices_owner_idx ON social.cheer_notices (owner_id);

-- O travão dos avisos no telemóvel: um por publicação a cada 30 min e no máximo 6 por pessoa por dia.
CREATE TABLE social.cheer_pushes (
  user_id   uuid NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  target_id uuid NOT NULL,
  sent_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX cheer_pushes_user_idx ON social.cheer_pushes (user_id, sent_at DESC);
CREATE INDEX cheer_pushes_target_idx ON social.cheer_pushes (user_id, target_id, sent_at DESC);

-- Encontrar a linha de brindes desta publicação (ou comentário) para a atualizar.
CREATE INDEX notifications_cheer_idx ON social.notifications (user_id, (data->>'targetId')) WHERE kind = 'cheer';

-- Notificação nova: brindaram a minha publicação ou o meu comentário (ator = o último a brindar;
-- data: { target: 'post' | 'comment', targetId, postId, commentId?, tcheka?, since }).
ALTER TABLE social.notifications DROP CONSTRAINT notifications_kind_check;
ALTER TABLE social.notifications ADD CONSTRAINT notifications_kind_check
  CHECK (kind IN ('blocked', 'follow', 'follow_request', 'request_accepted', 'gift', 'comment', 'reply', 'story_reply', 'repost', 'mention', 'tag', 'verified', 'venue_invite', 'missed_call', 'venue_payment', 'venue_review',
                  'group_join_request', 'group_join_accepted', 'group_member_joined', 'group_admin_granted', 'geleira_cheer', 'cheer'));
