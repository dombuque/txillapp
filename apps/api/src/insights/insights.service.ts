import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../db/db.module';
import { tchekaPost } from '../posts/feed';

export const PERIODS = [7, 30, 90] as const;
export type Period = (typeof PERIODS)[number];

/** Só se mostram quebras do público quando há gente que chegue para ninguém ser identificável. */
const MIN_AUDIENCE = 20;
const MIN_BUCKET = 5;

const AGES = [
  { label: '15-17', min: 15, max: 17 },
  { label: '18-24', min: 18, max: 24 },
  { label: '25-34', min: 25, max: 34 },
  { label: '35-44', min: 35, max: 44 },
  { label: '45+', min: 45, max: 200 },
];

/**
 * Estatísticas do PRÓPRIO perfil (como os Insights de outras redes): alcance, interações, seguidores, melhores horas,
 * publicações em destaque e o público (idades, género, sítios e interesses) em números agregados, sem nunca mostrar quem é quem.
 */
@Injectable()
export class InsightsService {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  /** Uma visita ao perfil por pessoa e por dia (não conta o próprio dono). */
  async recordProfileView(profileId: string, viewerId: string) {
    if (profileId === viewerId) return;
    await this.pool.query('INSERT INTO social.profile_views (profile_id, viewer_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [profileId, viewerId]).catch(() => undefined);
  }

  async get(me: string, days: Period, tzMinutes: number) {
    const tz = Math.max(-720, Math.min(840, Math.round(tzMinutes)));
    const since = `now() - ($2::int * interval '1 day')`;
    const before = `now() - (2 * $2::int * interval '1 day')`;
    const one = async <T>(sql: string): Promise<T> => (await this.pool.query(sql, [me, days])).rows[0] as T;

    // Alcance: contas diferentes que viram publicações ou stories (excluindo o próprio).
    const reachSql = (from: string, to: string) => `
      SELECT count(DISTINCT v)::int AS n FROM (
        SELECT i.user_id AS v FROM content.feed_impressions i JOIN content.posts p ON p.id = i.post_id
         WHERE p.author_id = $1 AND p.removed_at IS NULL AND i.user_id <> $1 AND i.seen_at >= ${from} AND i.seen_at < ${to}
        UNION ALL
        SELECT sv.viewer_id FROM content.story_views sv JOIN content.stories s ON s.id = sv.story_id
         WHERE s.author_id = $1 AND sv.viewer_id <> $1 AND sv.viewed_at >= ${from} AND sv.viewed_at < ${to}
      ) x`;
    const reach = (await one<{ n: number }>(reachSql(since, 'now()'))).n;
    const reachPrev = (await one<{ n: number }>(reachSql(before, since))).n;

    const interactionsSql = (from: string, to: string) => `
      SELECT
        (SELECT count(*) FROM content.cheers c JOIN content.posts p ON p.id = c.post_id WHERE p.author_id = $1 AND c.user_id <> $1 AND c.created_at >= ${from} AND c.created_at < ${to})::int AS cheers,
        (SELECT count(*) FROM content.comments c JOIN content.posts p ON p.id = c.post_id WHERE p.author_id = $1 AND c.author_id <> $1 AND c.created_at >= ${from} AND c.created_at < ${to})::int AS comments,
        (SELECT count(*) FROM content.posts r JOIN content.posts p ON p.id = r.repost_of WHERE p.author_id = $1 AND r.kind = 'repost' AND r.author_id <> $1 AND r.removed_at IS NULL AND r.created_at >= ${from} AND r.created_at < ${to})::int AS reposts,
        (SELECT count(*) FROM content.gifts g WHERE g.recipient_id = $1 AND g.created_at >= ${from} AND g.created_at < ${to})::int AS gifts,
        (SELECT count(*) FROM content.story_cheers c JOIN content.stories s ON s.id = c.story_id WHERE s.author_id = $1 AND c.user_id <> $1 AND c.created_at >= ${from} AND c.created_at < ${to})::int AS story_cheers,
        (SELECT count(*) FROM content.story_replies r JOIN content.stories s ON s.id = r.story_id WHERE s.author_id = $1 AND r.author_id <> $1 AND r.created_at >= ${from} AND r.created_at < ${to})::int AS story_replies`;
    const cur = await one<Record<string, number>>(interactionsSql(since, 'now()'));
    const prev = await one<Record<string, number>>(interactionsSql(before, since));
    const sum = (o: Record<string, number>) => Object.values(o).reduce((a, n) => a + Number(n), 0);

    const followers = await one<{ total: number; gained: number; gained_prev: number }>(
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE created_at >= ${since})::int AS gained,
              count(*) FILTER (WHERE created_at >= ${before} AND created_at < ${since})::int AS gained_prev
         FROM social.follows WHERE followee_id = $1`,
    );
    const views = await one<{ visitors: number; visitors_prev: number }>(
      `SELECT count(DISTINCT viewer_id) FILTER (WHERE day >= (${since})::date)::int AS visitors,
              count(DISTINCT viewer_id) FILTER (WHERE day >= (${before})::date AND day < (${since})::date)::int AS visitors_prev
         FROM social.profile_views WHERE profile_id = $1`,
    );
    const storyViews = await one<{ n: number }>(
      `SELECT count(*)::int AS n FROM content.story_views sv JOIN content.stories s ON s.id = sv.story_id WHERE s.author_id = $1 AND sv.viewer_id <> $1 AND sv.viewed_at >= ${since}`,
    );

    // Por dia (no fuso de quem vê): alcance, interações e novos seguidores.
    const series = (
      await this.pool.query(
        `WITH d AS (SELECT generate_series(((now() + make_interval(mins => $3))::date - ($2::int - 1)), (now() + make_interval(mins => $3))::date, interval '1 day')::date AS day),
              reach AS (SELECT ((i.seen_at + make_interval(mins => $3))::date) AS day, count(DISTINCT i.user_id) AS n FROM content.feed_impressions i JOIN content.posts p ON p.id = i.post_id
                         WHERE p.author_id = $1 AND i.user_id <> $1 AND i.seen_at >= now() - (($2::int + 1) * interval '1 day') GROUP BY 1),
              inter AS (SELECT day, count(*) AS n FROM (
                          SELECT ((c.created_at + make_interval(mins => $3))::date) AS day FROM content.cheers c JOIN content.posts p ON p.id = c.post_id WHERE p.author_id = $1 AND c.user_id <> $1 AND c.created_at >= now() - (($2::int + 1) * interval '1 day')
                          UNION ALL SELECT ((c.created_at + make_interval(mins => $3))::date) FROM content.comments c JOIN content.posts p ON p.id = c.post_id WHERE p.author_id = $1 AND c.author_id <> $1 AND c.created_at >= now() - (($2::int + 1) * interval '1 day')
                          UNION ALL SELECT ((g.created_at + make_interval(mins => $3))::date) FROM content.gifts g WHERE g.recipient_id = $1 AND g.created_at >= now() - (($2::int + 1) * interval '1 day')
                        ) z GROUP BY day),
              fol AS (SELECT ((created_at + make_interval(mins => $3))::date) AS day, count(*) AS n FROM social.follows WHERE followee_id = $1 AND created_at >= now() - (($2::int + 1) * interval '1 day') GROUP BY 1)
         SELECT to_char(d.day, 'YYYY-MM-DD') AS day, COALESCE(reach.n, 0)::int AS reach, COALESCE(inter.n, 0)::int AS interactions, COALESCE(fol.n, 0)::int AS followers
           FROM d LEFT JOIN reach USING (day) LEFT JOIN inter USING (day) LEFT JOIN fol USING (day) ORDER BY d.day`,
        [me, days, tz],
      )
    ).rows as { day: string; reach: number; interactions: number; followers: number }[];

    // Melhores horas e dias: quando as outras pessoas reagem mais ao teu conteúdo (no fuso de quem vê).
    const when = (
      await this.pool.query(
        `SELECT extract(hour FROM (t + make_interval(mins => $3)))::int AS h, extract(dow FROM (t + make_interval(mins => $3)))::int AS dow, count(*)::int AS n FROM (
           SELECT c.created_at AS t FROM content.cheers c JOIN content.posts p ON p.id = c.post_id WHERE p.author_id = $1 AND c.user_id <> $1 AND c.created_at >= ${since}
           UNION ALL SELECT c.created_at FROM content.comments c JOIN content.posts p ON p.id = c.post_id WHERE p.author_id = $1 AND c.author_id <> $1 AND c.created_at >= ${since}
           UNION ALL SELECT sv.viewed_at FROM content.story_views sv JOIN content.stories s ON s.id = sv.story_id WHERE s.author_id = $1 AND sv.viewer_id <> $1 AND sv.viewed_at >= ${since}
         ) e GROUP BY 1, 2`,
        [me, days, tz],
      )
    ).rows as { h: number; dow: number; n: number }[];
    const hours = Array.from({ length: 24 }, (_, h) => ({ hour: h, value: when.filter((r) => r.h === h).reduce((a, r) => a + r.n, 0) }));
    const weekdays = Array.from({ length: 7 }, (_, d) => ({ dow: d, value: when.filter((r) => r.dow === d).reduce((a, r) => a + r.n, 0) }));

    // Publicações em destaque do período.
    const top = (
      await this.pool.query(
        `SELECT p.id, p.short_code, p.body, p.created_at,
                (SELECT pm.media_id FROM content.post_media pm WHERE pm.post_id = p.id ORDER BY pm.position LIMIT 1) AS media_id,
                (SELECT (ma.mime LIKE 'video/%') FROM content.post_media pm JOIN content.media_assets ma ON ma.id = pm.media_id WHERE pm.post_id = p.id ORDER BY pm.position LIMIT 1) AS video,
                ${tchekaPost()} AS tcheka,
                (SELECT count(*) FROM content.cheers c WHERE c.post_id = p.id AND c.user_id <> $1 AND c.created_at >= ${since})::int AS cheers,
                (SELECT count(*) FROM content.comments c WHERE c.post_id = p.id AND c.author_id <> $1 AND c.created_at >= ${since})::int AS comments,
                (SELECT count(*) FROM content.posts r WHERE r.repost_of = p.id AND r.kind = 'repost' AND r.author_id <> $1 AND r.removed_at IS NULL AND r.created_at >= ${since})::int AS reposts,
                (SELECT count(*) FROM content.gifts g WHERE g.post_id = p.id AND g.created_at >= ${since})::int AS gifts,
                (SELECT count(*) FROM content.feed_impressions i WHERE i.post_id = p.id AND i.user_id <> $1 AND i.seen_at >= ${since})::int AS reach
           FROM content.posts p WHERE p.author_id = $1 AND p.removed_at IS NULL AND p.kind = 'post'
          ORDER BY (SELECT count(*) FROM content.cheers c WHERE c.post_id = p.id AND c.user_id <> $1 AND c.created_at >= ${since})
                 + 2 * (SELECT count(*) FROM content.comments c WHERE c.post_id = p.id AND c.author_id <> $1 AND c.created_at >= ${since})
                 + 3 * (SELECT count(*) FROM content.posts r WHERE r.repost_of = p.id AND r.kind = 'repost' AND r.removed_at IS NULL AND r.created_at >= ${since}) DESC, p.id DESC
          LIMIT 5`,
        [me, days],
      )
    ).rows;

    const audience = await this.audience(me, followers.total);

    const delta = (a: number, b: number) => (b > 0 ? Math.round(((a - b) / b) * 100) : a > 0 ? 100 : 0);
    return {
      days,
      overview: {
        reach, reachDelta: delta(reach, reachPrev),
        interactions: sum(cur), interactionsDelta: delta(sum(cur), sum(prev)),
        followers: followers.total, newFollowers: followers.gained, newFollowersDelta: delta(followers.gained, followers.gained_prev),
        profileVisitors: views.visitors, profileVisitorsDelta: delta(views.visitors, views.visitors_prev),
        storyViews: storyViews.n,
      },
      interactions: { cheers: cur.cheers, comments: cur.comments, reposts: cur.reposts, gifts: cur.gifts, storyCheers: cur.story_cheers, storyReplies: cur.story_replies },
      series,
      hours,
      weekdays,
      top: top.map((r) => ({
        id: r.id as string, code: (r.short_code as string | null) ?? (r.id as string), body: ((r.body as string) ?? '').slice(0, 90),
        mediaUrl: r.media_id ? `/api/v1/media/${r.media_id as string}${r.video ? '?poster=1' : '?w=240'}` : null, video: !!r.video, tcheka: !!r.tcheka, createdAt: r.created_at as string,
        cheers: r.cheers as number, comments: r.comments as number, reposts: r.reposts as number, gifts: r.gifts as number, reach: r.reach as number,
      })),
      audience,
    };
  }

  /** O público (os teus seguidores) em números agregados. Abaixo de ${MIN_AUDIENCE} seguidores não se mostra; grupos com menos de ${MIN_BUCKET} pessoas ficam de fora. */
  private async audience(me: string, total: number) {
    if (total < MIN_AUDIENCE) return { enough: false as const, minimum: MIN_AUDIENCE, followers: total };
    const rows = (
      await this.pool.query(
        `SELECT u.gender, u.country, u.city, u.birth_date, u.geleira_matching, u.id
           FROM social.follows f JOIN identity.users u ON u.id = f.follower_id WHERE f.followee_id = $1 AND u.status = 'active'`,
        [me],
      )
    ).rows as { gender: string | null; country: string | null; city: string | null; birth_date: string | null; geleira_matching: boolean; id: string }[];
    const bucket = (xs: (string | null)[], limit = 6) => {
      const m = new Map<string, number>();
      for (const x of xs) if (x) m.set(x, (m.get(x) ?? 0) + 1);
      return [...m.entries()].filter(([, n]) => n >= MIN_BUCKET).sort((a, b) => b[1] - a[1]).slice(0, limit).map(([label, n]) => ({ label, value: n, pct: Math.round((n / rows.length) * 100) }));
    };
    const age = (d: string | null) => (d ? Math.floor((Date.now() - new Date(d).getTime()) / 31_557_600_000) : null);
    const ages = rows.map((r) => age(r.birth_date)).map((a) => (a == null ? null : AGES.find((b) => a >= b.min && a <= b.max)?.label ?? null));
    // Interesses: itens da geleira de quem a deixa usar e mostra a todos; só se pelo menos MIN_BUCKET seguidores o têm; sem bebidas alcoólicas.
    const ids = rows.filter((r) => r.geleira_matching).map((r) => r.id);
    const interests = ids.length
      ? (
          await this.pool.query(
            `SELECT i.name, i.kind, count(*)::int AS n FROM taste.user_items ui JOIN taste.items i ON i.id = ui.item_id
              WHERE ui.user_id = ANY($1::uuid[]) AND ui.visibility = 'everyone' AND i.status = 'curated' AND NOT i.alcoholic
              GROUP BY i.id, i.name, i.kind HAVING count(*) >= $2 ORDER BY count(*) DESC, i.name LIMIT 12`,
            [ids, MIN_BUCKET],
          )
        ).rows.map((r) => ({ label: r.name as string, kind: r.kind as string, value: r.n as number, pct: Math.round(((r.n as number) / rows.length) * 100) }))
      : [];
    return {
      enough: true as const,
      followers: rows.length,
      gender: bucket(rows.map((r) => (r.gender && r.gender !== 'unspecified' ? r.gender : null))),
      ages: bucket(ages, 5).sort((a, b) => AGES.findIndex((x) => x.label === a.label) - AGES.findIndex((x) => x.label === b.label)),
      countries: bucket(rows.map((r) => r.country)),
      cities: bucket(rows.map((r) => r.city)),
      interests,
    };
  }
}
