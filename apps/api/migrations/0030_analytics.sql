-- Estatísticas de utilização (próprias, sem terceiros). Cada pessoa pode desligá-las nas Definições.
CREATE SCHEMA IF NOT EXISTS analytics;

CREATE TABLE analytics.events (
  id         bigserial PRIMARY KEY,
  user_id    uuid REFERENCES identity.users(id) ON DELETE CASCADE,
  session_id text NOT NULL,
  name       text NOT NULL,
  props      jsonb NOT NULL DEFAULT '{}',
  platform   text NOT NULL DEFAULT 'browser' CHECK (platform IN ('browser', 'pwa')),
  at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX analytics_events_name_at_idx ON analytics.events (name, at DESC);
CREATE INDEX analytics_events_user_at_idx ON analytics.events (user_id, at DESC);
CREATE INDEX analytics_events_at_idx ON analytics.events (at DESC);

ALTER TABLE identity.users ADD COLUMN share_analytics boolean NOT NULL DEFAULT true;
