-- Perfis privados (só seguidores aceites vêem o conteúdo) e pedidos para seguir.
ALTER TABLE identity.users ADD COLUMN is_private boolean NOT NULL DEFAULT false;

CREATE TABLE social.follow_requests (
  requester_id uuid NOT NULL REFERENCES identity.users(id),
  target_id    uuid NOT NULL REFERENCES identity.users(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (requester_id, target_id),
  CHECK (requester_id <> target_id)
);
CREATE INDEX follow_requests_target_idx ON social.follow_requests (target_id, created_at DESC);
