-- Estatísticas do perfil (como os "Insights" de outras redes): cada pessoa vê as do seu próprio perfil.
-- Visitas ao perfil: uma por visitante e por dia (só contagens; nunca se mostra quem foi).
CREATE TABLE social.profile_views (
  profile_id uuid NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  viewer_id uuid NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  day date NOT NULL DEFAULT (now() AT TIME ZONE 'UTC')::date,
  PRIMARY KEY (profile_id, viewer_id, day)
);
CREATE INDEX profile_views_day_idx ON social.profile_views (profile_id, day);
