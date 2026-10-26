import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../db/db.module';

/** Só estes eventos entram (lista fechada): evita lixo e dados que não se queriam. */
export const EVENT_NAMES = [
  'app_open', 'screen_view', 'post_create', 'post_open', 'search', 'follow', 'cheer', 'comment', 'repost', 'share',
  'install_prompt', 'install_accepted', 'push_enabled', 'story_view', 'story_create', 'message_send', 'video_view',
  'feed_refresh', 'perf', 'client_error',
] as const;
export type EventName = (typeof EVENT_NAMES)[number];

export interface IncomingEvent {
  name: EventName;
  props?: Record<string, unknown>;
  /** Milissegundos atrás (o relógio do telemóvel pode estar errado, por isso não se confia na hora absoluta). */
  ago?: number;
}

const MAX_PROPS_BYTES = 1000;

@Injectable()
export class AnalyticsService {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  /** Guarda os eventos, se a pessoa não os desligou. Valores de texto são cortados; nada de objetos grandes. */
  async record(userId: string, sessionId: string, platform: 'browser' | 'pwa', events: IncomingEvent[]) {
    const { rows } = await this.pool.query('SELECT share_analytics FROM identity.users WHERE id = $1', [userId]);
    if (!rows[0]?.share_analytics) return { stored: 0 };
    const clean = events.map((e) => {
      const props: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(e.props ?? {}).slice(0, 12)) {
        if (typeof v === 'string') props[k.slice(0, 40)] = v.slice(0, 200);
        else if (typeof v === 'number' && Number.isFinite(v)) props[k.slice(0, 40)] = Math.round(v * 1000) / 1000;
        else if (typeof v === 'boolean') props[k.slice(0, 40)] = v;
      }
      const json = JSON.stringify(props);
      return { name: e.name, props: json.length > MAX_PROPS_BYTES ? {} : props, ago: Math.min(Math.max(e.ago ?? 0, 0), 3_600_000) };
    });
    await this.pool.query(
      `INSERT INTO analytics.events (user_id, session_id, name, props, platform, at)
       SELECT $1, $2, x.name, x.props, $3, now() - (x.ago || ' milliseconds')::interval
         FROM jsonb_to_recordset($4::jsonb) AS x(name text, props jsonb, ago int)`,
      [userId, sessionId, platform, JSON.stringify(clean)],
    );
    return { stored: clean.length };
  }

  /** Números para o painel de moderação/produto. `days` dias para trás, por dia (fuso do servidor). */
  async stats(days: number) {
    const q = async (sql: string, params: unknown[] = [days]) => (await this.pool.query(sql, params)).rows;
    const series = (rows: { d: string; n: number }[]) => {
      // Preenche dias sem dados com 0 para os gráficos não terem buracos.
      const map = new Map(rows.map((r) => [String(r.d), Number(r.n)]));
      return Array.from({ length: days }, (_, i) => {
        const d = new Date(Date.now() - (days - 1 - i) * 86_400_000).toISOString().slice(0, 10);
        return { day: d, value: map.get(d) ?? 0 };
      });
    };
    const perDay = (table: string, col = 'created_at', where = 'true') =>
      q(`SELECT to_char(${col} AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS d, count(*)::int AS n FROM ${table} WHERE ${col} > now() - make_interval(days => $1) AND ${where} GROUP BY 1`);

    const [totals] = await q(
      `SELECT (SELECT count(*) FROM identity.users WHERE status = 'active')::int AS users,
              (SELECT count(*) FROM content.posts WHERE removed_at IS NULL)::int AS posts,
              (SELECT count(*) FROM content.comments)::int AS comments,
              (SELECT count(*) FROM social.messages WHERE deleted_at IS NULL)::int AS messages,
              (SELECT count(*) FROM social.follows)::int AS follows`,
      [],
    );
    const [active] = await q(
      `SELECT count(DISTINCT user_id) FILTER (WHERE at > now() - interval '1 day')::int AS dau,
              count(DISTINCT user_id) FILTER (WHERE at > now() - interval '7 days')::int AS wau,
              count(DISTINCT user_id) FILTER (WHERE at > now() - interval '30 days')::int AS mau
         FROM analytics.events WHERE name = 'app_open' AND at > now() - interval '30 days'`,
      [],
    );
    // Retenção: das pessoas que se registaram há N dias (coortes dos últimos 30 dias), quantas voltaram nesse dia N.
    const [ret] = await q(
      `WITH c AS (SELECT id, (created_at AT TIME ZONE 'UTC')::date AS d0 FROM identity.users WHERE created_at > now() - interval '30 days'),
            r AS (SELECT c.id, (e.at AT TIME ZONE 'UTC')::date - c.d0 AS dn FROM c JOIN analytics.events e ON e.user_id = c.id AND e.name = 'app_open' GROUP BY 1, 2)
       SELECT (SELECT count(*) FROM c WHERE d0 <= (now() AT TIME ZONE 'UTC')::date - 1)::int AS d1_base,
              (SELECT count(DISTINCT id) FROM r WHERE dn = 1)::int AS d1_back,
              (SELECT count(*) FROM c WHERE d0 <= (now() AT TIME ZONE 'UTC')::date - 7)::int AS d7_base,
              (SELECT count(DISTINCT id) FROM r WHERE dn = 7)::int AS d7_back`,
      [],
    );
    const [funnel] = await q(
      `SELECT count(*)::int AS signed,
              count(*) FILTER (WHERE EXISTS (SELECT 1 FROM content.posts p WHERE p.author_id = u.id))::int AS posted,
              count(*) FILTER (WHERE EXISTS (SELECT 1 FROM social.follows f WHERE f.follower_id = u.id))::int AS followed,
              count(*) FILTER (WHERE EXISTS (SELECT 1 FROM content.cheers c WHERE c.user_id = u.id))::int AS cheered
         FROM identity.users u WHERE u.created_at > now() - make_interval(days => $1)`,
    );
    const [feed] = await q(
      `SELECT (SELECT count(*) FROM content.feed_impressions WHERE seen_at > now() - make_interval(days => $1))::int AS seen,
              (SELECT count(*) FROM content.cheers WHERE created_at > now() - make_interval(days => $1))::int AS cheers,
              (SELECT count(*) FROM content.comments WHERE created_at > now() - make_interval(days => $1))::int AS comments,
              (SELECT count(*) FROM content.feed_impressions WHERE hidden AND seen_at > now() - make_interval(days => $1))::int AS hidden`,
    );
    const perf = await q(
      `SELECT props->>'metric' AS metric, percentile_cont(0.75) WITHIN GROUP (ORDER BY (props->>'value')::float) AS p75, count(*)::int AS n
         FROM analytics.events WHERE name = 'perf' AND at > now() - make_interval(days => $1) AND props ? 'metric' AND props ? 'value'
        GROUP BY 1 ORDER BY 1`,
    );
    const screens = await q(
      `SELECT props->>'path' AS path, count(*)::int AS n FROM analytics.events
        WHERE name = 'screen_view' AND at > now() - make_interval(days => $1) AND props ? 'path' GROUP BY 1 ORDER BY n DESC LIMIT 8`,
    );
    const errors = await q(
      `SELECT left(props->>'message', 120) AS message, count(*)::int AS n FROM analytics.events
        WHERE name = 'client_error' AND at > now() - make_interval(days => $1) GROUP BY 1 ORDER BY n DESC LIMIT 5`,
    );
    const platform = await q(
      `SELECT platform, count(DISTINCT user_id)::int AS users FROM analytics.events WHERE name = 'app_open' AND at > now() - make_interval(days => $1) GROUP BY 1`,
    );
    const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 10 : null);

    return {
      days,
      totals,
      active,
      retention: { d1: pct(ret.d1_back, ret.d1_base), d7: pct(ret.d7_back, ret.d7_base), d1Base: ret.d1_base, d7Base: ret.d7_base },
      funnel,
      feed: { ...feed, engagementRate: pct(feed.cheers + feed.comments, feed.seen), hideRate: pct(feed.hidden, feed.seen) },
      series: {
        signups: series(await perDay('identity.users')),
        posts: series(await perDay('content.posts', 'created_at', 'removed_at IS NULL')),
        comments: series(await perDay('content.comments')),
        cheers: series(await perDay('content.cheers')),
        messages: series(await perDay('social.messages', 'created_at', 'deleted_at IS NULL')),
        opens: series(await q(`SELECT to_char(at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS d, count(DISTINCT user_id)::int AS n FROM analytics.events WHERE name = 'app_open' AND at > now() - make_interval(days => $1) GROUP BY 1`)),
      },
      perf: perf.map((r) => ({ metric: r.metric as string, p75: Math.round(Number(r.p75) * 100) / 100, n: r.n as number })),
      screens,
      errors,
      platform,
    };
  }
}
