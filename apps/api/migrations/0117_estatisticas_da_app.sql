-- Estatísticas de utilização vindas da app (Android, iPhone e o site PWA feito com a mesma app), além do site antigo.
-- Cada evento passa a dizer de que plataforma veio e com que versão da app, para o painel separar e comparar.
ALTER TABLE analytics.events DROP CONSTRAINT IF EXISTS events_platform_check;
ALTER TABLE analytics.events ADD CONSTRAINT events_platform_check CHECK (platform IN ('browser', 'pwa', 'web', 'ios', 'android'));
ALTER TABLE analytics.events ADD COLUMN IF NOT EXISTS app_version text;
-- Painel: versões e plataformas em uso (só as aberturas da app).
CREATE INDEX IF NOT EXISTS analytics_events_open_platform_idx ON analytics.events (at DESC, platform, app_version) WHERE name = 'app_open';
