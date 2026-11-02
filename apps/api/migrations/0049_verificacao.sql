-- Pedidos de verificação (selo). Fluxo híbrido: a conta tem de cumprir os requisitos automáticos para pedir; depois a moderação revê.
CREATE TABLE identity.verification_requests (
  id          uuid PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('person', 'business')),
  full_name   text NOT NULL CHECK (char_length(full_name) BETWEEN 2 AND 80),
  -- Ligações oficiais ou uma explicação curta de quem é e porque precisa do selo.
  proof       text NOT NULL CHECK (char_length(proof) BETWEEN 10 AND 600),
  status      text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'withdrawn')),
  reason      text CHECK (reason IS NULL OR char_length(reason) <= 300),
  reviewed_by uuid REFERENCES identity.users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
-- Só um pedido por pendente por conta; depois de recusado, só se pede outra vez passados 30 dias (regra na aplicação).
CREATE UNIQUE INDEX verification_one_pending_idx ON identity.verification_requests (user_id) WHERE status = 'pending';
CREATE INDEX verification_queue_idx ON identity.verification_requests (status, created_at);

-- Documentos do pedido: ficheiros privados (como os do chat). Apagam-se logo que há decisão.
ALTER TABLE identity.verification_requests
  ADD COLUMN doc_media_id    uuid REFERENCES content.media_assets(id),
  ADD COLUMN selfie_media_id uuid REFERENCES content.media_assets(id);

-- Dois níveis de selo: 'verified' (pessoa ou negócio verificado) e 'official' (conta oficial do Txillapp).
ALTER TABLE identity.users ADD COLUMN verified_tier text CHECK (verified_tier IN ('verified', 'official'));
UPDATE identity.users SET verified_tier = 'verified' WHERE verified;

-- Anúncio: quem segue é avisado quando uma conta é verificada.
ALTER TABLE social.notifications DROP CONSTRAINT notifications_kind_check;
ALTER TABLE social.notifications ADD CONSTRAINT notifications_kind_check
  CHECK (kind IN ('blocked', 'follow', 'follow_request', 'request_accepted', 'gift', 'comment', 'reply', 'story_reply', 'repost', 'mention', 'tag', 'verified'));
-- O aviso de "foste verificado" é da própria conta para si (a única notificação em que quem faz e quem recebe são a mesma pessoa).
ALTER TABLE social.notifications DROP CONSTRAINT notifications_check;
ALTER TABLE social.notifications ADD CONSTRAINT notifications_check CHECK (user_id <> actor_id OR kind = 'verified');
