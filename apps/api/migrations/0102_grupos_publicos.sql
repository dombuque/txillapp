-- TxillGroups que se veem de fora. Três modos:
--   privado oculto (por omissão): não aparece em lado nenhum; só entra quem um admin adiciona;
--   privado no mapa (show_on_map): aparece em "À tua volta"; quem não é membro pede para entrar e um admin aceita;
--   público (visibility = 'public'): aparece sempre no mapa; quem não é membro entra logo.
-- Mensagens, sondagens, lista, despesas, álbum, cofre e a lista de membros continuam só para membros.
ALTER TABLE social.groups
  ADD COLUMN show_on_map boolean NOT NULL DEFAULT false,
  -- Foto de perfil do grupo (a capa já existe em cover_media_id).
  ADD COLUMN avatar_media_id uuid REFERENCES content.media_assets(id) ON DELETE SET NULL;

-- Pedidos para entrar num grupo privado no mapa. Um por pessoa e grupo; aceitar, recusar ou cancelar apaga a linha.
CREATE TABLE social.group_join_requests (
  group_id uuid NOT NULL REFERENCES social.groups(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, user_id)
);
-- Os admins veem os pedidos do grupo, os mais antigos primeiro.
CREATE INDEX group_join_requests_group_idx ON social.group_join_requests (group_id, created_at);
-- Os meus pedidos (exportação de dados e eliminação da conta).
CREATE INDEX group_join_requests_user_idx ON social.group_join_requests (user_id);

-- Notificações: pediram para entrar (aos admins), aceitaram o meu pedido, alguém entrou num grupo público (aos admins).
ALTER TABLE social.notifications DROP CONSTRAINT notifications_kind_check;
ALTER TABLE social.notifications ADD CONSTRAINT notifications_kind_check
  CHECK (kind IN ('blocked', 'follow', 'follow_request', 'request_accepted', 'gift', 'comment', 'reply', 'story_reply', 'repost', 'mention', 'tag', 'verified', 'venue_invite', 'missed_call', 'venue_payment', 'venue_review',
                  'group_join_request', 'group_join_accepted', 'group_member_joined'));
