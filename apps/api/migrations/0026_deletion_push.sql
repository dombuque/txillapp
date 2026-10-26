-- Eliminar conta: os ficheiros da pessoa passam a 'deleted' e uma rotina apaga-os do armazenamento.
ALTER TABLE content.media_assets DROP CONSTRAINT media_assets_status_check;
ALTER TABLE content.media_assets ADD CONSTRAINT media_assets_status_check CHECK (status IN ('pending', 'ready', 'deleted'));
ALTER TABLE content.media_assets ADD COLUMN purged_at timestamptz;
CREATE INDEX media_to_purge_idx ON content.media_assets (id) WHERE status = 'deleted' AND purged_at IS NULL;

-- Notificações no telemóvel (Web Push): um registo por aparelho.
CREATE TABLE social.push_subscriptions (
  id         uuid PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  endpoint   text NOT NULL UNIQUE,
  p256dh     text NOT NULL,
  auth       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX push_user_idx ON social.push_subscriptions (user_id);
