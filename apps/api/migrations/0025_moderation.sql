-- Apagar publicações (por quem as fez ou pela moderação) sem partir referências: ficam escondidas.
ALTER TABLE content.posts ADD COLUMN removed_at timestamptz, ADD COLUMN removed_by text CHECK (removed_by IN ('author', 'moderation'));

-- Contas de moderação.
ALTER TABLE identity.users ADD COLUMN is_admin boolean NOT NULL DEFAULT false;

-- Denúncias.
CREATE TABLE social.reports (
  id             uuid PRIMARY KEY,
  reporter_id    uuid NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  target_type    text NOT NULL CHECK (target_type IN ('post', 'comment', 'story', 'user', 'message')),
  target_id      uuid NOT NULL,
  -- Dono do conteúdo denunciado (para ver reincidência).
  target_user_id uuid REFERENCES identity.users(id) ON DELETE SET NULL,
  reason         text NOT NULL CHECK (reason IN ('spam', 'harassment', 'hate', 'nudity', 'violence', 'scam', 'impersonation', 'minor', 'other')),
  note           text CHECK (note IS NULL OR char_length(note) <= 500),
  status         text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'dismissed', 'actioned')),
  resolution     text,
  resolved_by    uuid REFERENCES identity.users(id) ON DELETE SET NULL,
  resolved_at    timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (reporter_id, target_type, target_id)
);
CREATE INDEX reports_open_idx ON social.reports (status, created_at DESC);
CREATE INDEX reports_target_idx ON social.reports (target_type, target_id);
