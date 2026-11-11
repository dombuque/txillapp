-- Análises do backoffice (permissão insights.view): coortes, envolvimento, conteúdo, geografia, locais, Geleira, pesquisa e saúde.
-- Só se mostram agregados, com um limiar de k ≥ 20 pessoas nos segmentos pequenos (ver src/analytics/analyses.service.ts).

-- ---------- Dias com atividade (para coortes, retenção, DAU/MAU e "pessoas ativas") ----------
-- Uma linha por pessoa e por dia (no fuso de Maputo) em que fez alguma coisa: abriu a app (eventos), viu o feed ou um mimo,
-- publicou, comentou, brindou, mandou mensagem, seguiu alguém ou fez check-in. Serve só para contar; nunca sai como lista.
-- Vista materializada atualizada de 30 em 30 minutos pela própria API (AnalysesService), com REFRESH ... CONCURRENTLY.
-- Guarda só os últimos 400 dias.
CREATE MATERIALIZED VIEW analytics.user_days AS
SELECT DISTINCT user_id, day FROM (
  SELECT user_id, (at AT TIME ZONE 'Africa/Maputo')::date AS day FROM analytics.events WHERE user_id IS NOT NULL AND at > now() - interval '400 days'
  UNION ALL SELECT author_id, (created_at AT TIME ZONE 'Africa/Maputo')::date FROM content.posts WHERE created_at > now() - interval '400 days'
  UNION ALL SELECT author_id, (created_at AT TIME ZONE 'Africa/Maputo')::date FROM content.comments WHERE created_at > now() - interval '400 days'
  UNION ALL SELECT user_id, (created_at AT TIME ZONE 'Africa/Maputo')::date FROM content.cheers WHERE created_at > now() - interval '400 days'
  UNION ALL SELECT sender_id, (created_at AT TIME ZONE 'Africa/Maputo')::date FROM social.messages WHERE created_at > now() - interval '400 days'
  UNION ALL SELECT author_id, (created_at AT TIME ZONE 'Africa/Maputo')::date FROM content.stories WHERE created_at > now() - interval '400 days'
  UNION ALL SELECT author_id, (created_at AT TIME ZONE 'Africa/Maputo')::date FROM social.instants WHERE created_at > now() - interval '400 days'
  UNION ALL SELECT viewer_id, (viewed_at AT TIME ZONE 'Africa/Maputo')::date FROM content.story_views WHERE viewed_at > now() - interval '400 days'
  UNION ALL SELECT follower_id, (created_at AT TIME ZONE 'Africa/Maputo')::date FROM social.follows WHERE created_at > now() - interval '400 days'
  UNION ALL SELECT user_id, (seen_at AT TIME ZONE 'Africa/Maputo')::date FROM content.feed_impressions WHERE seen_at > now() - interval '400 days'
  UNION ALL SELECT user_id, (created_at AT TIME ZONE 'Africa/Maputo')::date FROM content.checkins WHERE created_at > now() - interval '400 days'
) x;
CREATE UNIQUE INDEX user_days_pk ON analytics.user_days (user_id, day);
CREATE INDEX user_days_day_idx ON analytics.user_days (day);

-- ---------- Pesquisas (agregadas) ----------
-- Contador de termos normalizados (minúsculas, sem acentos, espaços juntos) por dia e por país. NÃO liga à pessoa:
-- não há coluna de conta nem de sessão. Não entram pesquisas de menores de 18 anos nem de quem desligou
-- "Ajudar a melhorar o Txillapp". `searches`: vezes (no máximo uma por pessoa, termo e dia); `empty`: dessas, sem resultados.
-- Apagado ao fim de 90 dias (varredura diária na API).
CREATE TABLE analytics.search_terms (
  day      date NOT NULL,
  country  char(2) NOT NULL DEFAULT '--',
  term     text NOT NULL CHECK (char_length(term) BETWEEN 2 AND 50),
  searches integer NOT NULL DEFAULT 0 CHECK (searches >= 0),
  empty    integer NOT NULL DEFAULT 0 CHECK (empty >= 0),
  PRIMARY KEY (day, country, term)
);
CREATE INDEX search_terms_day_idx ON analytics.search_terms (day);

-- Saúde da app: erros e tempos por versão (os índices de 0030 já servem name+at; este ajuda os agrupamentos).
CREATE INDEX IF NOT EXISTS analytics_events_health_idx ON analytics.events (name, at DESC, platform, app_version) WHERE name IN ('client_error', 'perf');
