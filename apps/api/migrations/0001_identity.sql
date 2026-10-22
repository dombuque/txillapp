CREATE EXTENSION IF NOT EXISTS citext;
CREATE SCHEMA IF NOT EXISTS identity;
CREATE SCHEMA IF NOT EXISTS audit;

CREATE TABLE identity.users (
  id           uuid PRIMARY KEY,
  email        citext NOT NULL UNIQUE,
  username     citext NOT NULL UNIQUE,
  display_name text NOT NULL,
  status       text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'deleted')),
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE identity.credentials (
  user_id       uuid PRIMARY KEY REFERENCES identity.users(id),
  password_hash text NOT NULL,
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- Refresh tokens opacos (guardados só como hash), com rotação por "família".
CREATE TABLE identity.sessions (
  id          uuid PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES identity.users(id),
  family_id   uuid NOT NULL,
  token_hash  text NOT NULL UNIQUE,
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,
  revoked_at  timestamptz,
  user_agent  text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user_idx ON identity.sessions (user_id);
CREATE INDEX sessions_family_idx ON identity.sessions (family_id);

-- Auditoria append-only.
CREATE TABLE audit.audit_log (
  id         uuid PRIMARY KEY,
  actor_id   uuid,
  action     text NOT NULL,
  target     text,
  metadata   jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE FUNCTION audit.forbid_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'audit_log é append-only'; END $$;

CREATE TRIGGER audit_log_immutable
  BEFORE UPDATE OR DELETE ON audit.audit_log
  FOR EACH ROW EXECUTE FUNCTION audit.forbid_mutation();
