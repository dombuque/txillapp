-- TxillGroups: quem administra pode fazer outra pessoa administradora (e tirar). A pessoa promovida é avisada
-- com group_admin_granted (ator = quem promoveu; data: { groupId, groupName }). Retirar não avisa.
ALTER TABLE social.notifications DROP CONSTRAINT notifications_kind_check;
ALTER TABLE social.notifications ADD CONSTRAINT notifications_kind_check
  CHECK (kind IN ('blocked', 'follow', 'follow_request', 'request_accepted', 'gift', 'comment', 'reply', 'story_reply', 'repost', 'mention', 'tag', 'verified', 'venue_invite', 'missed_call', 'venue_payment', 'venue_review',
                  'group_join_request', 'group_join_accepted', 'group_member_joined', 'group_admin_granted'));

-- "Entrou no grupo" não se repete para o mesmo (admin, pessoa, grupo) dentro de 24 h: procura-se a última assim.
CREATE INDEX notifications_group_joined_idx ON social.notifications (user_id, actor_id, (data->>'groupId'), created_at DESC)
  WHERE kind = 'group_member_joined';
