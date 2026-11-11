-- Backoffice › Contas: índices para a lista de contas (filtros e ordenação), a ficha (queixas feitas e recebidas,
-- histórico da equipa) e as sessões. Só índices: nenhum dado novo é guardado (e nunca o IP).
CREATE INDEX IF NOT EXISTS reports_target_user_idx ON social.reports (target_user_id, created_at DESC) WHERE target_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS reports_reporter_idx ON social.reports (reporter_id, created_at DESC) WHERE reporter_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS audit_log_target_idx ON audit.audit_log (target, created_at DESC) WHERE target IS NOT NULL;
CREATE INDEX IF NOT EXISTS users_created_idx ON identity.users (created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS users_birth_date_idx ON identity.users (birth_date) WHERE birth_date IS NOT NULL;
