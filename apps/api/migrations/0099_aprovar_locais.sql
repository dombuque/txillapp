-- Locais (bares, restaurantes, etc.) passam a ser aprovados pela equipa no backoffice antes de ficarem públicos.
-- Em análise: só o dono e os gestores veem a página (podem prepará-la); não aparece na pesquisa nem no mapa,
-- não recebe pagamentos, não faz check-in e não publica como o local. Os que já existiam ficam aprovados.
ALTER TABLE content.venues
  ADD COLUMN review_status text NOT NULL DEFAULT 'pending' CHECK (review_status IN ('pending', 'approved', 'rejected')),
  ADD COLUMN review_note text CHECK (char_length(review_note) <= 300),
  ADD COLUMN reviewed_at timestamptz,
  ADD COLUMN reviewed_by uuid REFERENCES identity.users(id) ON DELETE SET NULL;
UPDATE content.venues SET review_status = 'approved', reviewed_at = now();
CREATE INDEX venues_review_idx ON content.venues (created_at) WHERE review_status = 'pending';

-- Notificação ao dono: o local foi aprovado ou recusado.
ALTER TABLE social.notifications DROP CONSTRAINT notifications_kind_check;
ALTER TABLE social.notifications ADD CONSTRAINT notifications_kind_check
  CHECK (kind IN ('blocked', 'follow', 'follow_request', 'request_accepted', 'gift', 'comment', 'reply', 'story_reply', 'repost', 'mention', 'tag', 'verified', 'venue_invite', 'missed_call', 'venue_payment', 'venue_review'));
