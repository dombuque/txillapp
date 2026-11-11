-- Convite que se vê.
--
-- Notificação nova: alguém entrou com o meu convite (ator = quem entrou; data: { inviteJoined: true }). Chega logo no registo,
-- sem esperar pelos 7 dias do prémio (o prémio continua a ter o seu aviso próprio, «já te deu Txills»).
-- ATENÇÃO a quem juntar ramos: esta lista tem de ser a união de todas as migrações que mexem em notifications_kind_check.
ALTER TABLE social.notifications DROP CONSTRAINT notifications_kind_check;
ALTER TABLE social.notifications ADD CONSTRAINT notifications_kind_check
  CHECK (kind IN ('blocked', 'follow', 'follow_request', 'request_accepted', 'gift', 'comment', 'reply', 'story_reply', 'repost', 'mention', 'tag', 'verified', 'venue_invite', 'missed_call', 'venue_payment', 'venue_review',
                  'group_join_request', 'group_join_accepted', 'group_member_joined', 'group_admin_granted', 'geleira_cheer', 'cheer', 'invite_joined'));

-- Medição: quantas pessoas entraram por convite, por dia (o painel conta social.referrals.created_at).
CREATE INDEX referrals_created_idx ON social.referrals (created_at);
