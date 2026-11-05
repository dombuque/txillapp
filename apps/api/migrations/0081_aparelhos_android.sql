-- Notificações push nativas (app Android): o código do aparelho no Firebase (FCM), ligado à conta com sessão.
CREATE TABLE social.push_devices (
  token text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  platform text NOT NULL CHECK (platform IN ('android', 'ios')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX push_devices_user_idx ON social.push_devices (user_id);
