-- Brindar a geleira de alguém: um brinde por pessoa, que se põe e se tira. Quem visita o perfil vê quantos brindes tem;
-- o dono vê quem brindou. Só brinda quem pode ver a geleira (mesma regra da geleira) e ninguém brinda a sua.
CREATE TABLE taste.geleira_cheers (
  owner_id   uuid NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, user_id),
  CHECK (owner_id <> user_id)
);
-- O dono lista quem brindou, os mais recentes primeiro.
CREATE INDEX geleira_cheers_owner_idx ON taste.geleira_cheers (owner_id, created_at DESC);
-- Os brindes que dei (exportação de dados e eliminação da conta).
CREATE INDEX geleira_cheers_user_idx ON taste.geleira_cheers (user_id);

-- O dono é avisado só da PRIMEIRA vez que cada pessoa brinda. O par fica aqui mesmo depois de tirar o brinde
-- (ao contrário de geleira_cheers), por isso tirar e voltar a pôr não avisa outra vez. Inserir com ON CONFLICT DO NOTHING:
-- se entrou uma linha, é a primeira vez.
CREATE TABLE taste.geleira_cheer_notices (
  owner_id   uuid NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, user_id)
);
CREATE INDEX geleira_cheer_notices_user_idx ON taste.geleira_cheer_notices (user_id);

-- Notificação nova: brindaram a minha geleira (ator = quem brindou; sem data).
ALTER TABLE social.notifications DROP CONSTRAINT notifications_kind_check;
ALTER TABLE social.notifications ADD CONSTRAINT notifications_kind_check
  CHECK (kind IN ('blocked', 'follow', 'follow_request', 'request_accepted', 'gift', 'comment', 'reply', 'story_reply', 'repost', 'mention', 'tag', 'verified', 'venue_invite', 'missed_call', 'venue_payment', 'venue_review',
                  'group_join_request', 'group_join_accepted', 'group_member_joined', 'group_admin_granted', 'geleira_cheer'));
