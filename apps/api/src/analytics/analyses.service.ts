import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Pool } from 'pg';
import { uuidv7 } from '../common/uuid7';
import { AppConfig, CONFIG } from '../config';
import { PG_POOL } from '../db/db.module';
import { tchekaPost } from '../posts/feed';
import { SEARCH_RETENTION_DAYS } from './search-stats.service';

/**
 * Análises do backoffice (permissão `insights.view`): coortes e retenção, envolvimento, conteúdo e tendências, geografia,
 * locais, Geleira, pesquisa e saúde da app.
 *
 * Regras de privacidade (valem para todas as páginas):
 * - só agregados: nenhuma resposta traz ids, @ ou nomes de pessoas;
 * - k-anonimato: um segmento de pessoas com menos de K (20) fica escondido (o número e as percentagens);
 *   um país com menos de K contas não se pode escolher;
 * - quem desligou "Ajudar a melhorar o Txillapp" (share_analytics) e as contas de equipa ficam de fora;
 * - cada consulta fica no registo de auditoria (insights.view), mesmo quando vem da cache.
 *
 * Desempenho: cada resposta fica 10 minutos em memória; os dias com atividade vêm da vista materializada
 * analytics.user_days (0122), atualizada de 30 em 30 minutos.
 */
export const K = 20;
/** Mínimo de pessoas diferentes para um item de conteúdo (hashtag, sítio, música, GIF) entrar num ranking. */
export const MIN_PEOPLE = 3;
export const ANALYSIS_DAYS = [7, 30, 90, 180] as const;
export type AnalysisDays = (typeof ANALYSIS_DAYS)[number];
export const PAGES = ['cohorts', 'engagement', 'content', 'geo', 'venues', 'geleira', 'search', 'health'] as const;
export type AnalysisPage = (typeof PAGES)[number];

const CACHE_MS = 10 * 60_000;
const REFRESH_MS = 30 * 60_000;

/* ───── peças de SQL (parâmetros: $1 = dias, $2 = país ou null) ───── */
const TZ = `'Africa/Maputo'`;
const dayOf = (col: string) => `((${col}) AT TIME ZONE ${TZ})::date`;
const TODAY = `((now() AT TIME ZONE ${TZ})::date)`;
/** Primeiro dia do período (o de hoje conta). */
const FIRST_DAY = `(${TODAY} - ($1::int - 1))`;
/** O início do período, como instante. */
const START = `((${FIRST_DAY})::timestamp AT TIME ZONE ${TZ})`;
/** O início do período anterior, do mesmo tamanho (para "a subir" e "a descer"). */
const PREV_START = `((${FIRST_DAY} - $1::int)::timestamp AT TIME ZONE ${TZ})`;
/** Pessoas que contam nas análises (e do país escolhido, se `country`). */
const ELIG = (u: string, country = true) => `${u}.status <> 'staff' AND ${u}.share_analytics${country ? ` AND ($2::text IS NULL OR ${u}.country = $2)` : ''}`;
const POST_COUNTRY = (p: string) => `($2::text IS NULL OR ${p}.country = $2)`;

const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 10 : null);
const n = (v: unknown) => Number(v ?? 0);

export interface Filters { days: AnalysisDays; country: string | null }

@Injectable()
export class AnalysesService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('Analyses');
  private cache = new Map<string, { at: number; value: unknown }>();
  private refresher?: NodeJS.Timeout;
  private refreshing: Promise<void> | null = null;

  constructor(@Inject(PG_POOL) private readonly pool: Pool, @Inject(CONFIG) private readonly config: AppConfig) {}

  onModuleInit() {
    if (this.config.NODE_ENV === 'test') return;
    const run = () => void this.refresh().catch((e) => this.log.warn(`falha a atualizar analytics.user_days: ${(e as Error).message}`));
    this.refresher = setInterval(run, REFRESH_MS);
    this.refresher.unref();
    setTimeout(run, 90_000).unref();
  }

  onModuleDestroy() {
    if (this.refresher) clearInterval(this.refresher);
  }

  /** Atualiza a vista dos dias com atividade (sem bloquear quem lê). */
  async refresh() {
    if (!this.refreshing) {
      this.refreshing = this.pool
        .query('REFRESH MATERIALIZED VIEW CONCURRENTLY analytics.user_days')
        .then(() => undefined)
        .finally(() => (this.refreshing = null));
    }
    return this.refreshing;
  }

  clearCache() {
    this.cache.clear();
  }

  /** Países que se podem escolher: só com K contas ou mais. */
  async countries(actor: string) {
    await this.audit(actor, 'countries', { days: null, country: null });
    return this.cached('countries', async () => {
      const { rows } = await this.pool.query(
        `SELECT u.country, count(*)::int AS n FROM identity.users u WHERE ${ELIG('u', false)} AND u.status = 'active' AND u.country IS NOT NULL
          GROUP BY 1 HAVING count(*) >= $1 ORDER BY n DESC`,
        [K],
      );
      return { k: K, countries: rows.map((r) => ({ code: (r.country as string).trim(), people: r.n as number })) };
    });
  }

  /** Uma página das Análises: regista na auditoria, verifica o país (k) e responde da cache se puder. */
  async page(actor: string, page: AnalysisPage, f: Filters) {
    await this.audit(actor, page, f);
    const base = { page, days: f.days, country: f.country, k: K };
    if (f.country) {
      const people = (await this.pool.query(`SELECT count(*)::int AS n FROM identity.users u WHERE ${ELIG('u', false)} AND u.status = 'active' AND u.country = $1`, [f.country])).rows[0].n as number;
      if (people < K) return { ...base, hidden: true as const, reason: `Menos de ${K} pessoas neste país: não se mostra para ninguém ser identificável.` };
    }
    const run = (this[page] as (f: Filters) => Promise<object>).bind(this);
    const data = await this.cached(`${page}:${f.days}:${f.country ?? '*'}`, () => run(f));
    return { ...base, hidden: false as const, ...(data as object) };
  }

  private async cached<T>(key: string, fn: () => Promise<T>): Promise<T & { generatedAt: string }> {
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.value as T & { generatedAt: string };
    const value = { ...(await fn()), generatedAt: new Date().toISOString() };
    if (this.cache.size > 300) this.cache.clear();
    this.cache.set(key, { at: Date.now(), value });
    return value;
  }

  private async audit(actor: string, page: string, f: { days: number | null; country: string | null }) {
    await this.pool.query('INSERT INTO audit.audit_log (id, actor_id, action, target, metadata) VALUES ($1, $2, $3, $4, $5)', [uuidv7(), actor, 'insights.view', `insights:${page}`, { days: f.days, country: f.country }]);
  }

  private async q<T = Record<string, unknown>>(sql: string, f: Filters, extra: unknown[] = []): Promise<T[]> {
    return (await this.pool.query(sql, [f.days, f.country, ...extra])).rows as T[];
  }

  /** Esconde um segmento pequeno: devolve null em vez do número. */
  private static safe(count: number) {
    return count >= K ? count : null;
  }

  /* ═════════════ 1. Coortes e retenção ═════════════ */
  async cohorts(f: Filters) {
    const weeks = Array.from({ length: 8 }, (_, i) => i + 1);
    const cols = weeks
      .map((w) => `count(DISTINCT c.id) FILTER (WHERE c.d0 + ${7 * w + 6} < ${TODAY})::int AS b${w},
                   count(DISTINCT c.id) FILTER (WHERE c.d0 + ${7 * w + 6} < ${TODAY} AND r.n = ${w})::int AS r${w}`)
      .join(',\n');
    const cohortRows = await this.q(
      `WITH c0 AS (SELECT u.id, ${dayOf('u.created_at')} AS d0 FROM identity.users u WHERE ${ELIG('u')} AND u.created_at >= ${START}),
            c AS (SELECT id, d0, date_trunc('week', d0)::date AS wk FROM c0),
            r AS (SELECT c.id, ((ud.day - c.d0) / 7)::int AS n FROM c JOIN analytics.user_days ud ON ud.user_id = c.id AND ud.day >= c.d0 + 7 AND ud.day < c.d0 + 63 GROUP BY 1, 2)
       SELECT to_char(c.wk, 'YYYY-MM-DD') AS week, count(DISTINCT c.id)::int AS size, ${cols}
         FROM c LEFT JOIN r ON r.id = c.id GROUP BY c.wk ORDER BY c.wk`,
      f,
    );
    const cohorts = cohortRows.map((r) => {
      const size = n(r.size);
      return {
        week: r.week as string,
        size: AnalysesService.safe(size),
        retention: weeks.map((w) => {
          const b = n(r[`b${w}`]);
          // Semana ainda por acabar: null. Coorte pequena: escondida (o "small" diz porquê).
          if (b === 0) return null;
          return b >= K ? pct(n(r[`r${w}`]), b) : 'small';
        }),
      };
    });

    // Curvas: % que voltou exatamente no dia N depois do registo (só quem já teve o dia N completo).
    const curveRows = await this.q(
      `WITH c AS (SELECT u.id, ${dayOf('u.created_at')} AS d0 FROM identity.users u WHERE ${ELIG('u')} AND u.created_at >= ${START})
       SELECT g.n, count(*)::int AS base, count(ud.user_id)::int AS back
         FROM c CROSS JOIN generate_series(1, 30) AS g(n)
         LEFT JOIN analytics.user_days ud ON ud.user_id = c.id AND ud.day = c.d0 + g.n
        WHERE c.d0 + g.n < ${TODAY}
        GROUP BY g.n ORDER BY g.n`,
      f,
    );
    const curve = Array.from({ length: 30 }, (_, i) => {
      const r = curveRows.find((x) => n(x.n) === i + 1);
      const base = n(r?.base);
      return { day: i + 1, base: AnalysesService.safe(base), pct: base >= K ? pct(n(r?.back), base) : null };
    });
    const point = (d: number) => curve[d - 1];

    // Stickiness: DAU / MAU (30 dias a contar para trás) em cada dia do período.
    const stick = await this.q(
      `WITH d AS (SELECT generate_series(${FIRST_DAY}, ${TODAY}, interval '1 day')::date AS day),
            a AS (SELECT ud.user_id, ud.day FROM analytics.user_days ud JOIN identity.users u ON u.id = ud.user_id
                   WHERE ${ELIG('u')} AND ud.day > ${FIRST_DAY} - 30)
       SELECT to_char(d.day, 'YYYY-MM-DD') AS day,
              (SELECT count(*) FROM a WHERE a.day = d.day)::int AS dau,
              (SELECT count(DISTINCT a.user_id) FROM a WHERE a.day > d.day - 7 AND a.day <= d.day)::int AS wau,
              (SELECT count(DISTINCT a.user_id) FROM a WHERE a.day > d.day - 30 AND a.day <= d.day)::int AS mau
         FROM d ORDER BY d.day`,
      f,
    );
    const stickiness = stick.map((r) => ({ day: r.day as string, dau: n(r.dau), wau: n(r.wau), mau: n(r.mau), ratio: pct(n(r.dau), n(r.mau)) }));
    const withMau = stickiness.filter((s) => s.mau > 0);
    const avgStick = withMau.length ? Math.round((withMau.reduce((a, s) => a + n(s.ratio), 0) / withMau.length) * 10) / 10 : null;

    // Quem volta: por plataforma e por "fez X no 1.º dia" (o dia do registo).
    const seg = await this.q(
      `WITH c AS (SELECT u.id, ${dayOf('u.created_at')} AS d0 FROM identity.users u WHERE ${ELIG('u')} AND u.created_at >= ${START}),
            f AS (
              SELECT c.id, c.d0,
                     (SELECT e.platform FROM analytics.events e WHERE e.user_id = c.id ORDER BY e.at LIMIT 1) AS platform,
                     EXISTS (SELECT 1 FROM content.posts p WHERE p.author_id = c.id AND p.kind = 'post' AND ${dayOf('p.created_at')} = c.d0) AS posted,
                     (SELECT count(*) FROM social.follows fo WHERE fo.follower_id = c.id AND ${dayOf('fo.created_at')} = c.d0) >= 3 AS followed3,
                     EXISTS (SELECT 1 FROM social.group_members gm WHERE gm.user_id = c.id AND ${dayOf('gm.joined_at')} = c.d0) AS grouped,
                     (SELECT count(*) FROM taste.user_items ti WHERE ti.user_id = c.id AND ${dayOf('ti.created_at')} = c.d0) >= 5 AS geleira,
                     EXISTS (SELECT 1 FROM analytics.user_days ud WHERE ud.user_id = c.id AND ud.day = c.d0 + 1) AS d1,
                     EXISTS (SELECT 1 FROM analytics.user_days ud WHERE ud.user_id = c.id AND ud.day BETWEEN c.d0 + 1 AND c.d0 + 7) AS w1
                FROM c)
       SELECT s.seg, s.val,
              count(*) FILTER (WHERE f.d0 + 1 < ${TODAY})::int AS d1_base,
              count(*) FILTER (WHERE f.d0 + 1 < ${TODAY} AND f.d1)::int AS d1_back,
              count(*) FILTER (WHERE f.d0 + 7 < ${TODAY})::int AS w1_base,
              count(*) FILTER (WHERE f.d0 + 7 < ${TODAY} AND f.w1)::int AS w1_back
         FROM f CROSS JOIN LATERAL (VALUES ('all', 'all'), ('platform', coalesce(f.platform, 'unknown')), ('posted', f.posted::text),
                                          ('followed3', f.followed3::text), ('grouped', f.grouped::text), ('geleira', f.geleira::text)) AS s(seg, val)
        GROUP BY 1, 2`,
      f,
    );
    const segRows = new Map(seg.map((r) => [`${r.seg as string}|${r.val as string}`, r]));
    const cell = (seg: string, val: string) => {
      const x = (segRows.get(`${seg}|${val}`) ?? {}) as Record<string, unknown>;
      const d1b = n(x.d1_base);
      const w1b = n(x.w1_base);
      return {
        d1Base: AnalysesService.safe(d1b), d1: d1b >= K ? pct(n(x.d1_back), d1b) : null,
        w1Base: AnalysesService.safe(w1b), w1: w1b >= K ? pct(n(x.w1_back), w1b) : null,
      };
    };
    const platforms = seg.filter((r) => r.seg === 'platform').map((r) => ({ platform: r.val as string, ...cell('platform', r.val as string) }));
    const ahaDefs = [
      { id: 'posted', label: 'Publicou no 1.º dia' },
      { id: 'followed3', label: 'Seguiu 3 ou mais no 1.º dia' },
      { id: 'grouped', label: 'Entrou num TxillGroup no 1.º dia' },
      { id: 'geleira', label: 'Pôs 5 ou mais gostos na Geleira no 1.º dia' },
    ];
    const aha = ahaDefs.map((a) => {
      const yes = cell(a.id, 'true');
      const no = cell(a.id, 'false');
      return { ...a, yes, no, liftW1: yes.w1 != null && no.w1 != null ? Math.round((yes.w1 - no.w1) * 10) / 10 : null, liftD1: yes.d1 != null && no.d1 != null ? Math.round((yes.d1 - no.d1) * 10) / 10 : null };
    });

    return {
      cohorts,
      curve,
      headline: { d1: point(1).pct, d7: point(7).pct, d30: point(30).pct, d1Base: point(1).base, d7Base: point(7).base, d30Base: point(30).base, stickiness: avgStick },
      stickiness,
      all: cell('all', 'all'),
      platforms,
      aha,
    };
  }

  /* ═════════════ 2. Envolvimento ═════════════ */
  async engagement(f: Filters) {
    const joinU = (col: string) => `JOIN identity.users u ON u.id = ${col} AND ${ELIG('u')}`;
    const rows = await this.q(
      `SELECT m, to_char(d, 'YYYY-MM-DD') AS day, count(*)::int AS n FROM (
         SELECT CASE WHEN ${tchekaPost('p')} THEN 'tchekas' ELSE 'posts' END AS m, ${dayOf('p.created_at')} AS d
           FROM content.posts p ${joinU('p.author_id')} WHERE p.kind = 'post' AND p.removed_at IS NULL AND p.created_at >= ${START}
         UNION ALL SELECT 'mimos', ${dayOf('s.created_at')} FROM content.stories s ${joinU('s.author_id')} WHERE s.created_at >= ${START}
         UNION ALL SELECT 'zas', ${dayOf('i.created_at')} FROM social.instants i ${joinU('i.author_id')} WHERE i.created_at >= ${START}
         UNION ALL SELECT 'comments', ${dayOf('c.created_at')} FROM content.comments c ${joinU('c.author_id')} WHERE c.created_at >= ${START}
         UNION ALL SELECT 'cheers', ${dayOf('c.created_at')} FROM content.cheers c ${joinU('c.user_id')} WHERE c.created_at >= ${START}
         UNION ALL SELECT 'messages', ${dayOf('m.created_at')} FROM social.messages m ${joinU('m.sender_id')} WHERE m.created_at >= ${START}
       ) x GROUP BY 1, 2`,
      f,
    );
    const active = await this.q(
      `SELECT to_char(ud.day, 'YYYY-MM-DD') AS day, count(*)::int AS n FROM analytics.user_days ud ${joinU('ud.user_id')} WHERE ud.day >= ${FIRST_DAY} GROUP BY 1`,
      f,
    );
    const days = (await this.q(`SELECT to_char(g::date, 'YYYY-MM-DD') AS day FROM generate_series(${FIRST_DAY}, ${TODAY}, interval '1 day') g WHERE coalesce($2::text, '') IS NOT NULL ORDER BY 1`, f)).map((r) => r.day as string);
    const METRICS = ['posts', 'tchekas', 'mimos', 'zas', 'comments', 'cheers', 'messages'] as const;
    const at = (m: string, d: string) => n(rows.find((r) => r.m === m && r.day === d)?.n);
    const activeAt = (d: string) => n(active.find((r) => r.day === d)?.n);
    const series = days.map((d) => {
      const a = activeAt(d);
      const o: Record<string, number | string | null> = { day: d, active: a };
      for (const m of METRICS) {
        o[m] = at(m, d);
        o[`${m}PerActive`] = a > 0 ? Math.round((at(m, d) / a) * 100) / 100 : null;
      }
      return o;
    });
    const activeDays = series.reduce((s, r) => s + n(r.active), 0);
    const totals = Object.fromEntries(METRICS.map((m) => {
      const total = series.reduce((s, r) => s + n(r[m]), 0);
      return [m, { total, perDay: Math.round((total / days.length) * 10) / 10, perActive: activeDays > 0 ? Math.round((total / activeDays) * 100) / 100 : null }];
    }));

    // Quem cria, quem só interage e quem só vê (a regra 1 / 9 / 90).
    const [mix] = await this.q(
      `WITH a AS (SELECT DISTINCT ud.user_id AS id FROM analytics.user_days ud ${joinU('ud.user_id')} WHERE ud.day >= ${FIRST_DAY}),
            cr AS (SELECT author_id AS id, count(*) AS n FROM (
                     SELECT author_id FROM content.posts WHERE kind = 'post' AND removed_at IS NULL AND created_at >= ${START}
                     UNION ALL SELECT author_id FROM content.stories WHERE created_at >= ${START}
                     UNION ALL SELECT author_id FROM social.instants WHERE created_at >= ${START}) x GROUP BY 1),
            it AS (SELECT author_id AS id FROM content.comments WHERE created_at >= ${START}
                   UNION SELECT user_id FROM content.cheers WHERE created_at >= ${START}
                   UNION SELECT sender_id FROM social.messages WHERE created_at >= ${START}
                   UNION SELECT author_id FROM content.posts WHERE kind = 'repost' AND created_at >= ${START}
                   UNION SELECT user_id FROM content.story_cheers WHERE created_at >= ${START}),
            per AS (SELECT a.id, coalesce(cr.n, 0)::int AS n, (it.id IS NOT NULL) AS interacted FROM a LEFT JOIN cr ON cr.id = a.id LEFT JOIN (SELECT DISTINCT id FROM it) it ON it.id = a.id),
            rk AS (SELECT n, interacted, row_number() OVER (ORDER BY n DESC) AS rn, count(*) OVER () AS tot FROM per)
       SELECT count(*)::int AS people,
              count(*) FILTER (WHERE n > 0)::int AS creators,
              count(*) FILTER (WHERE n = 0 AND interacted)::int AS interactors,
              count(*) FILTER (WHERE n = 0 AND NOT interacted)::int AS viewers,
              coalesce(sum(n), 0)::int AS content,
              coalesce(sum(n) FILTER (WHERE rn <= ceil(tot * 0.01)), 0)::int AS top1,
              coalesce(sum(n) FILTER (WHERE rn <= ceil(tot * 0.10)), 0)::int AS top10
         FROM rk`,
      f,
    );
    const people = n(mix?.people);
    const distribution = people >= K
      ? {
          people,
          creators: pct(n(mix.creators), people), interactors: pct(n(mix.interactors), people), viewers: pct(n(mix.viewers), people),
          top1Share: pct(n(mix.top1), n(mix.content)), top10Share: pct(n(mix.top10), n(mix.content)),
        }
      : { people: null, small: true as const };

    // Mapa de calor: "pessoas-hora" ativas (cada pessoa conta uma vez por hora), por dia da semana e hora, em Maputo.
    const heat = people >= K
      ? await this.q(
          `SELECT extract(dow FROM t AT TIME ZONE ${TZ})::int AS dow, extract(hour FROM t AT TIME ZONE ${TZ})::int AS h,
                  count(DISTINCT (x.uid::text || date_trunc('hour', t)::text))::int AS n
             FROM (
               SELECT user_id AS uid, at AS t FROM analytics.events WHERE at >= ${START} AND name NOT IN ('perf', 'client_error') AND user_id IS NOT NULL
               UNION ALL SELECT author_id, created_at FROM content.posts WHERE created_at >= ${START}
               UNION ALL SELECT author_id, created_at FROM content.comments WHERE created_at >= ${START}
               UNION ALL SELECT user_id, created_at FROM content.cheers WHERE created_at >= ${START}
               UNION ALL SELECT sender_id, created_at FROM social.messages WHERE created_at >= ${START}
               UNION ALL SELECT author_id, created_at FROM content.stories WHERE created_at >= ${START}
               UNION ALL SELECT author_id, created_at FROM social.instants WHERE created_at >= ${START}
               UNION ALL SELECT user_id, seen_at FROM content.feed_impressions WHERE seen_at >= ${START}
             ) x ${joinU('x.uid')}
            GROUP BY 1, 2`,
          f,
        )
      : [];
    const heatmap = Array.from({ length: 7 }, (_, dow) => Array.from({ length: 24 }, (_, h) => n(heat.find((r) => n(r.dow) === dow && n(r.h) === h)?.n)));

    return { series, totals, activePeopleDays: activeDays, distribution, heatmap };
  }

  /* ═════════════ 3. Conteúdo e tendências ═════════════ */
  async content(f: Filters) {
    const author = `JOIN identity.users u ON u.id = p.author_id AND ${ELIG('u', false)} AND NOT u.is_private`;
    const trend = (rows: Record<string, unknown>[], label: string) => {
      const list = rows.map((r) => ({ label: r[label] as string, now: n(r.cur), before: n(r.prev), people: n(r.people) }));
      const change = (x: { now: number; before: number }) => (x.before > 0 ? Math.round(((x.now - x.before) / x.before) * 100) : null);
      const withChange = list.map((x) => ({ ...x, change: change(x) }));
      return {
        top: [...withChange].filter((x) => x.now > 0).sort((a, b) => b.now - a.now || a.label.localeCompare(b.label)).slice(0, 12),
        rising: [...withChange].filter((x) => x.now > x.before).sort((a, b) => b.now - b.before - (a.now - a.before) || b.now - a.now).slice(0, 8),
        falling: [...withChange].filter((x) => x.now < x.before).sort((a, b) => b.before - b.now - (a.before - a.now)).slice(0, 8),
      };
    };
    const tags = await this.q(
      `SELECT pt.tag, count(*) FILTER (WHERE p.created_at >= ${START})::int AS cur, count(*) FILTER (WHERE p.created_at < ${START})::int AS prev,
              count(DISTINCT p.author_id)::int AS people
         FROM content.post_tags pt JOIN content.posts p ON p.id = pt.post_id ${author}
        WHERE p.removed_at IS NULL AND p.created_at >= ${PREV_START} AND ${POST_COUNTRY('p')}
        GROUP BY 1 HAVING count(DISTINCT p.author_id) >= $3`,
      f,
      [MIN_PEOPLE],
    );
    const topics = await this.q(
      `SELECT t AS topic, count(*) FILTER (WHERE p.created_at >= ${START})::int AS cur, count(*) FILTER (WHERE p.created_at < ${START})::int AS prev,
              count(DISTINCT p.author_id)::int AS people
         FROM content.posts p ${author} CROSS JOIN LATERAL unnest(p.topics) AS t
        WHERE p.removed_at IS NULL AND p.topics IS NOT NULL AND p.created_at >= ${PREV_START} AND ${POST_COUNTRY('p')}
        GROUP BY 1 HAVING count(DISTINCT p.author_id) >= $3`,
      f,
      [MIN_PEOPLE],
    );
    const places = await this.q(
      `SELECT mode() WITHIN GROUP (ORDER BY trim(p.location_label)) AS place, count(*)::int AS posts, count(DISTINCT p.author_id)::int AS people
         FROM content.posts p ${author}
        WHERE p.removed_at IS NULL AND p.location_label IS NOT NULL AND trim(p.location_label) <> '' AND p.created_at >= ${START} AND ${POST_COUNTRY('p')}
        GROUP BY lower(trim(p.location_label)) HAVING count(DISTINCT p.author_id) >= $3 ORDER BY posts DESC, place LIMIT 12`,
      f,
      [MIN_PEOPLE],
    );
    const music = await this.q(
      `SELECT m->>'id' AS id, max(m->>'title') AS title, max(m->>'artist') AS artist, count(*)::int AS uses, count(DISTINCT uid)::int AS people,
              count(*) FILTER (WHERE src = 'post')::int AS in_posts, count(*) FILTER (WHERE src = 'story')::int AS in_mimos
         FROM (
           SELECT p.music AS m, p.author_id AS uid, 'post' AS src FROM content.posts p ${author}
            WHERE p.music IS NOT NULL AND p.removed_at IS NULL AND p.created_at >= ${START} AND ${POST_COUNTRY('p')}
           UNION ALL
           SELECT s.music, s.author_id, 'story' FROM content.stories s JOIN identity.users u ON u.id = s.author_id AND ${ELIG('u')}
            WHERE s.music IS NOT NULL AND s.created_at >= ${START}
         ) x
        WHERE m ? 'id' AND coalesce(m->>'kind', '') <> 'clip' AND NOT (m->>'id') LIKE 'clip:%'
        GROUP BY 1 HAVING count(DISTINCT uid) >= $3 ORDER BY uses DESC, title LIMIT 12`,
      f,
      [MIN_PEOPLE],
    );
    const gifs = await this.q(
      `SELECT g->>'id' AS id, max(g->>'title') AS title, max(g->>'url') AS url, count(*)::int AS uses, count(DISTINCT uid)::int AS people,
              count(*) FILTER (WHERE src = 'chat')::int AS in_chat, count(*) FILTER (WHERE src = 'comment')::int AS in_comments
         FROM (
           SELECT m.gif AS g, m.sender_id AS uid, 'chat' AS src FROM social.messages m JOIN identity.users u ON u.id = m.sender_id AND ${ELIG('u')}
            WHERE m.gif IS NOT NULL AND m.created_at >= ${START}
           UNION ALL
           SELECT c.gif, c.author_id, 'comment' FROM content.comments c JOIN identity.users u ON u.id = c.author_id AND ${ELIG('u')}
            WHERE c.gif IS NOT NULL AND c.created_at >= ${START}
         ) x
        WHERE g ? 'id'
        GROUP BY 1 HAVING count(DISTINCT uid) >= $3 ORDER BY uses DESC LIMIT 12`,
      f,
      [MIN_PEOPLE],
    );
    // Publicações públicas com mais alcance no período (pessoas diferentes que as viram no feed), com ligação.
    const reach = await this.q(
      `SELECT p.short_code AS code, left(p.body, 90) AS body, p.created_at, ${tchekaPost('p')} AS tcheka,
              count(DISTINCT i.user_id)::int AS reach,
              (SELECT count(*) FROM content.cheers c WHERE c.post_id = p.id)::int AS cheers,
              (SELECT count(*) FROM content.comments c WHERE c.post_id = p.id)::int AS comments
         FROM content.feed_impressions i JOIN content.posts p ON p.id = i.post_id ${author}
        WHERE i.seen_at >= ${START} AND i.user_id <> p.author_id AND p.removed_at IS NULL AND p.kind = 'post' AND ${POST_COUNTRY('p')}
        GROUP BY p.id ORDER BY reach DESC, p.id DESC LIMIT 10`,
      f,
    );

    return {
      minPeople: MIN_PEOPLE,
      hashtags: trend(tags, 'tag'),
      topics: trend(topics, 'topic'),
      places: places.map((r) => ({ label: r.place as string, posts: n(r.posts), people: n(r.people) })),
      music: music.map((r) => ({ title: r.title as string, artist: (r.artist as string) || '', uses: n(r.uses), people: n(r.people), inPosts: n(r.in_posts), inMimos: n(r.in_mimos) })),
      gifs: gifs.map((r) => ({ title: (r.title as string) || 'GIF sem título', url: (r.url as string) || null, uses: n(r.uses), people: n(r.people), inChat: n(r.in_chat), inComments: n(r.in_comments) })),
      topPosts: reach.map((r) => ({ code: r.code as string, body: (r.body as string) ?? '', createdAt: r.created_at as string, tcheka: !!r.tcheka, reach: n(r.reach), cheers: n(r.cheers), comments: n(r.comments) })),
    };
  }

  /* ═════════════ 4. Geografia ═════════════ */
  async geo(f: Filters) {
    // Pela cidade escolhida no perfil: pessoas ativas no período.
    const cities = await this.q(
      `SELECT u.country, nullif(initcap(lower(trim(u.city))), '') AS city, count(*)::int AS n
         FROM (SELECT DISTINCT user_id FROM analytics.user_days WHERE day >= ${FIRST_DAY}) a
         JOIN identity.users u ON u.id = a.user_id AND ${ELIG('u')}
        GROUP BY 1, 2`,
      f,
    );
    const shown = cities.filter((r) => r.city && n(r.n) >= K).sort((a, b) => n(b.n) - n(a.n));
    const smallCities = cities.filter((r) => r.city && n(r.n) < K);
    const smallTotal = smallCities.reduce((s, r) => s + n(r.n), 0);
    const noCity = cities.filter((r) => !r.city).reduce((s, r) => s + n(r.n), 0);
    const total = cities.reduce((s, r) => s + n(r.n), 0);

    // Zonas de ~11 km (0,1 grau), a partir do sítio das publicações (já arredondado ao sítio, nunca a posição da pessoa).
    const zones = await this.q(
      `SELECT round(p.location_lat::numeric, 1)::float AS lat, round(p.location_lng::numeric, 1)::float AS lng,
              count(DISTINCT p.author_id)::int AS people, count(*)::int AS posts,
              mode() WITHIN GROUP (ORDER BY trim(p.location_label)) AS label
         FROM content.posts p JOIN identity.users u ON u.id = p.author_id AND ${ELIG('u', false)}
        WHERE p.removed_at IS NULL AND p.location_lat IS NOT NULL AND p.location_lng IS NOT NULL AND p.created_at >= ${START} AND ${POST_COUNTRY('p')}
        GROUP BY 1, 2 HAVING count(DISTINCT p.author_id) >= $3 ORDER BY people DESC LIMIT 40`,
      f,
      [K],
    );
    // "Malta no mapa" agora (quem ligou; a presença já é uma quadrícula de ~1,5 km e dura 3 horas), juntada em zonas de ~11 km.
    const live = await this.q(
      `SELECT round(pr.cell_lat::numeric, 1)::float AS lat, round(pr.cell_lng::numeric, 1)::float AS lng, count(*)::int AS people
         FROM nearby.presence pr JOIN identity.users u ON u.id = pr.user_id AND ${ELIG('u')}
        WHERE pr.updated_at > now() - interval '3 hours' AND $1::int > 0
        GROUP BY 1, 2 HAVING count(*) >= $3 ORDER BY people DESC LIMIT 40`,
      f,
      [K],
    );
    return {
      activePeople: AnalysesService.safe(total),
      cities: shown.map((r) => ({ country: (r.country as string | null)?.trim() ?? null, city: r.city as string, people: n(r.n), pct: pct(n(r.n), total) })),
      otherCities: { cities: smallCities.length, people: AnalysesService.safe(smallTotal) },
      noCity: AnalysesService.safe(noCity),
      zones: zones.map((r) => ({ lat: n(r.lat), lng: n(r.lng), people: n(r.people), posts: n(r.posts), label: (r.label as string | null) ?? null })),
      live: live.map((r) => ({ lat: n(r.lat), lng: n(r.lng), people: n(r.people) })),
    };
  }

  /* ═════════════ 5. Locais ═════════════ */
  async venues(f: Filters) {
    const rows = await this.q(
      `SELECT v.slug, v.name, v.kind, v.city, v.verified,
              (SELECT count(*) FROM content.venue_follows x WHERE x.venue_id = v.id)::int AS followers,
              (SELECT count(*) FROM content.venue_follows x WHERE x.venue_id = v.id AND x.created_at >= ${START})::int AS followers_new,
              (SELECT count(*) FROM content.venue_follows x WHERE x.venue_id = v.id AND x.created_at >= ${PREV_START} AND x.created_at < ${START})::int AS followers_prev,
              (SELECT count(*) FROM content.checkins x WHERE x.venue_id = v.id AND x.created_at >= ${START})::int AS checkins,
              (SELECT count(*) FROM content.checkins x WHERE x.venue_id = v.id AND x.created_at >= ${PREV_START} AND x.created_at < ${START})::int AS checkins_prev,
              (SELECT count(*) FROM content.posts p WHERE p.removed_at IS NULL AND p.created_at >= ${START}
                  AND p.location_label IS NOT NULL AND lower(trim(p.location_label)) = lower(v.name))::int AS mentions,
              (SELECT count(*) FROM content.posts p WHERE p.removed_at IS NULL AND p.created_at >= ${START} AND p.venue_id = v.id)::int AS own_posts,
              (SELECT count(*) FROM content.venue_events e WHERE e.venue_id = v.id AND e.cancelled_at IS NULL AND e.starts_at >= ${START})::int AS events,
              (SELECT count(*) FROM content.venue_event_interest i JOIN content.venue_events e ON e.id = i.event_id
                WHERE e.venue_id = v.id AND i.created_at >= ${START})::int AS interest
         FROM content.venues v
        WHERE v.review_status = 'approved' AND ($2::text IS NULL OR v.country = $2)
        ORDER BY followers DESC, v.name LIMIT 100`,
      f,
    );
    const growth = (a: number, b: number) => (b > 0 ? Math.round(((a - b) / b) * 100) : a > 0 ? null : 0);
    const ranking = rows.map((r) => ({
      slug: r.slug as string, name: r.name as string, kind: r.kind as string, city: (r.city as string | null) ?? null, verified: !!r.verified,
      followers: n(r.followers), followersNew: n(r.followers_new), followersGrowth: growth(n(r.followers_new), n(r.followers_prev)),
      checkins: n(r.checkins), checkinsGrowth: growth(n(r.checkins), n(r.checkins_prev)),
      mentions: n(r.mentions), ownPosts: n(r.own_posts), events: n(r.events), interest: n(r.interest),
    }));

    // Bombar: quem viu, quem tocou e quem, nos 7 dias a seguir a tocar, seguiu o local, fez check-in ou marcou interesse.
    const boosts = await this.q(
      `SELECT c.id, v.name AS venue, c.target_kind, c.package, c.starts_at, c.ends_at, c.status, c.price::bigint AS price,
              count(*) FILTER (WHERE i.kind = 'view')::int AS views,
              count(DISTINCT i.user_id) FILTER (WHERE i.kind = 'view')::int AS viewers,
              count(*) FILTER (WHERE i.kind = 'tap')::int AS taps,
              count(DISTINCT i.user_id) FILTER (WHERE i.kind = 'tap')::int AS tappers,
              count(DISTINCT i.user_id) FILTER (WHERE i.kind = 'tap' AND (
                 EXISTS (SELECT 1 FROM content.venue_follows x WHERE x.venue_id = c.venue_id AND x.user_id = i.user_id AND x.created_at BETWEEN i.created_at AND i.created_at + interval '7 days')
                 OR EXISTS (SELECT 1 FROM content.checkins x WHERE x.venue_id = c.venue_id AND x.user_id = i.user_id AND x.created_at BETWEEN i.created_at AND i.created_at + interval '7 days')
                 OR EXISTS (SELECT 1 FROM content.venue_event_interest x JOIN content.venue_events e ON e.id = x.event_id
                             WHERE e.venue_id = c.venue_id AND x.user_id = i.user_id AND x.created_at BETWEEN i.created_at AND i.created_at + interval '7 days')
              ))::int AS converted
         FROM content.boost_campaigns c JOIN content.venues v ON v.id = c.venue_id
         LEFT JOIN content.boost_impressions i ON i.campaign_id = c.id
        WHERE c.ends_at >= ${START} AND ($2::text IS NULL OR v.country = $2)
        GROUP BY c.id, v.name ORDER BY c.starts_at DESC LIMIT 50`,
      f,
    );
    const campaigns = boosts.map((r) => {
      const viewers = n(r.viewers);
      const ok = viewers >= K;
      return {
        venue: r.venue as string, target: r.target_kind as string, package: r.package as string, startsAt: r.starts_at as string, endsAt: r.ends_at as string, status: r.status as string, price: n(r.price),
        views: n(r.views), viewers: AnalysesService.safe(viewers), taps: n(r.taps),
        tapRate: ok ? pct(n(r.tappers), viewers) : null, conversion: ok ? pct(n(r.converted), viewers) : null, conversionOfTaps: ok && n(r.tappers) > 0 ? pct(n(r.converted), n(r.tappers)) : null,
      };
    });
    const sum = (k: string) => boosts.reduce((s, r) => s + n(r[k]), 0);
    const allViewers = sum('viewers');
    return {
      ranking,
      boosts: {
        campaigns,
        total: { campaigns: boosts.length, views: sum('views'), taps: sum('taps'), tapRate: allViewers >= K ? pct(sum('tappers'), allViewers) : null, conversion: allViewers >= K ? pct(sum('converted'), allViewers) : null },
      },
    };
  }

  /* ═════════════ 6. Geleira ═════════════ */
  async geleira(f: Filters) {
    // Só adultos (para parcerias com marcas), quem não esconde a Geleira de todos ("só eu") e itens do catálogo.
    const H = `SELECT ui.user_id, ui.item_id, ui.created_at, u.country FROM taste.user_items ui
                 JOIN identity.users u ON u.id = ui.user_id AND ${ELIG('u')} AND u.status = 'active' AND u.geleira_visibility <> 'me'
                      AND u.birth_date IS NOT NULL AND u.birth_date <= current_date - interval '18 years'
                 JOIN taste.items i ON i.id = ui.item_id AND i.status = 'curated' AND $1::int > 0`;
    const totals = await this.q(`WITH h AS (${H}) SELECT coalesce(country, '--') AS country, count(DISTINCT user_id)::int AS people FROM h GROUP BY 1`, f);
    const holders = new Map(totals.map((r) => [(r.country as string).trim(), n(r.people)]));
    const allHolders = [...holders.values()].reduce((a, b) => a + b, 0);
    const items = await this.q(
      `WITH h AS (${H})
       SELECT coalesce(h.country, '--') AS country, i.name, i.kind, i.category, i.alcoholic,
              count(DISTINCT h.user_id)::int AS people, count(*) FILTER (WHERE h.created_at >= ${START})::int AS added
         FROM h JOIN taste.items i ON i.id = h.item_id
        GROUP BY 1, i.id HAVING count(DISTINCT h.user_id) >= $3
        ORDER BY people DESC, i.name`,
      f,
      [K],
    );
    const byCountry = [...holders.entries()]
      .filter(([, p]) => p >= K)
      .sort((a, b) => b[1] - a[1])
      .map(([country, people]) => ({
        country,
        people,
        items: items.filter((r) => (r.country as string).trim() === country).slice(0, 15).map((r) => ({
          name: r.name as string, kind: r.kind as string, category: r.category as string, alcoholic: !!r.alcoholic,
          people: n(r.people), pct: pct(n(r.people), people), added: n(r.added),
        })),
      }));
    // Combinações frequentes (pares de gostos na mesma Geleira), com o "lift": quantas vezes mais do que o acaso.
    const pairs = allHolders >= K
      ? await this.q(
          `WITH h AS (${H}),
                top AS (SELECT item_id, count(DISTINCT user_id) AS n FROM h GROUP BY 1 HAVING count(DISTINCT user_id) >= $3),
                hp AS (SELECT DISTINCT h.user_id, h.item_id FROM h JOIN top USING (item_id))
           SELECT ia.name AS a, ia.kind AS a_kind, ib.name AS b, ib.kind AS b_kind, count(*)::int AS people, ta.n::int AS na, tb.n::int AS nb
             FROM hp x JOIN hp y ON y.user_id = x.user_id AND y.item_id > x.item_id
             JOIN top ta ON ta.item_id = x.item_id JOIN top tb ON tb.item_id = y.item_id
             JOIN taste.items ia ON ia.id = x.item_id JOIN taste.items ib ON ib.id = y.item_id
            GROUP BY ia.id, ib.id, ta.n, tb.n HAVING count(*) >= $3
            ORDER BY people DESC LIMIT 20`,
          f,
          [K],
        )
      : [];
    const kinds = allHolders >= K
      ? await this.q(`WITH h AS (${H}) SELECT i.kind, count(DISTINCT h.user_id)::int AS people FROM h JOIN taste.items i ON i.id = h.item_id GROUP BY 1 ORDER BY 2 DESC`, f)
      : [];
    return {
      holders: AnalysesService.safe(allHolders),
      kinds: kinds.filter((r) => n(r.people) >= K).map((r) => ({ kind: r.kind as string, people: n(r.people), pct: pct(n(r.people), allHolders) })),
      byCountry,
      pairs: pairs.map((r) => ({
        a: r.a as string, aKind: r.a_kind as string, b: r.b as string, bKind: r.b_kind as string, people: n(r.people),
        pct: pct(n(r.people), allHolders), lift: n(r.na) && n(r.nb) ? Math.round(((n(r.people) * allHolders) / (n(r.na) * n(r.nb))) * 100) / 100 : null,
      })),
    };
  }

  /* ═════════════ 7. Pesquisa ═════════════ */
  async search(f: Filters) {
    const days = Math.min(f.days, SEARCH_RETENTION_DAYS);
    const g: Filters = { ...f, days: days as AnalysisDays };
    const where = `day >= ${FIRST_DAY} AND ($2::text IS NULL OR country = $2)`;
    const [tot] = await this.q(`SELECT coalesce(sum(searches), 0)::int AS searches, coalesce(sum(empty), 0)::int AS empty, count(DISTINCT term)::int AS terms FROM analytics.search_terms WHERE ${where}`, g);
    const top = await this.q(
      `SELECT term, sum(searches)::int AS searches, sum(empty)::int AS empty FROM analytics.search_terms WHERE ${where}
        GROUP BY term HAVING sum(searches) >= $3 ORDER BY searches DESC, term LIMIT 30`,
      g,
      [K],
    );
    const gaps = await this.q(
      `SELECT term, sum(searches)::int AS searches, sum(empty)::int AS empty FROM analytics.search_terms WHERE ${where}
        GROUP BY term HAVING sum(searches) >= $3 AND sum(empty) * 2 >= sum(searches) ORDER BY empty DESC, term LIMIT 30`,
      g,
      [K],
    );
    const series = await this.q(
      `SELECT to_char(d::date, 'YYYY-MM-DD') AS day, coalesce(sum(s.searches), 0)::int AS searches, coalesce(sum(s.empty), 0)::int AS empty
         FROM generate_series(${FIRST_DAY}, ${TODAY}, interval '1 day') d
         LEFT JOIN analytics.search_terms s ON s.day = d::date AND ($2::text IS NULL OR s.country = $2)
        GROUP BY 1 ORDER BY 1`,
      g,
    );
    const row = (r: Record<string, unknown>) => ({ term: r.term as string, searches: n(r.searches), empty: n(r.empty), emptyPct: pct(n(r.empty), n(r.searches)) });
    return {
      retentionDays: SEARCH_RETENTION_DAYS,
      effectiveDays: days,
      totals: { searches: n(tot?.searches), empty: n(tot?.empty), emptyPct: pct(n(tot?.empty), n(tot?.searches)), terms: n(tot?.terms) },
      top: top.map(row),
      gaps: gaps.map(row),
      series: series.map((r) => ({ day: r.day as string, searches: n(r.searches), empty: n(r.empty) })),
    };
  }

  /* ═════════════ 8. Saúde da app ═════════════ */
  async health(f: Filters) {
    const joinU = `JOIN identity.users u ON u.id = e.user_id AND ${ELIG('u')}`;
    const versions = await this.q(
      `SELECT e.platform, coalesce(e.app_version, '—') AS version, count(DISTINCT e.user_id)::int AS people, count(DISTINCT e.session_id)::int AS sessions
         FROM analytics.events e ${joinU} WHERE e.name = 'app_open' AND e.at >= ${START} GROUP BY 1, 2 ORDER BY people DESC LIMIT 30`,
      f,
    );
    const errors = await this.q(
      `WITH s AS (SELECT e.platform, coalesce(e.app_version, '—') AS version, count(DISTINCT e.session_id) AS sessions
                    FROM analytics.events e ${joinU} WHERE e.at >= ${START} GROUP BY 1, 2),
            er AS (SELECT e.platform, coalesce(e.app_version, '—') AS version, count(*) AS errors, count(DISTINCT e.session_id) AS bad
                     FROM analytics.events e ${joinU} WHERE e.name = 'client_error' AND e.at >= ${START} GROUP BY 1, 2)
       SELECT s.platform, s.version, s.sessions::int, coalesce(er.errors, 0)::int AS errors, coalesce(er.bad, 0)::int AS bad
         FROM s LEFT JOIN er USING (platform, version) ORDER BY errors DESC, s.sessions DESC LIMIT 30`,
      f,
    );
    const messages = await this.q(
      `SELECT e.platform, left(coalesce(e.props->>'message', '(sem mensagem)'), 120) AS message, count(*)::int AS n, count(DISTINCT e.session_id)::int AS sessions
         FROM analytics.events e ${joinU} WHERE e.name = 'client_error' AND e.at >= ${START} GROUP BY 1, 2 ORDER BY n DESC LIMIT 10`,
      f,
    );
    const firstScreen = await this.q(
      `SELECT e.platform, coalesce(e.app_version, '—') AS version, count(*)::int AS n,
              percentile_cont(0.5) WITHIN GROUP (ORDER BY (e.props->>'value')::float) AS p50,
              percentile_cont(0.75) WITHIN GROUP (ORDER BY (e.props->>'value')::float) AS p75,
              percentile_cont(0.9) WITHIN GROUP (ORDER BY (e.props->>'value')::float) AS p90
         FROM analytics.events e ${joinU}
        WHERE e.name = 'perf' AND e.at >= ${START} AND e.props->>'metric' LIKE 'first_screen_%' AND jsonb_typeof(e.props->'value') = 'number'
        GROUP BY 1, 2 ORDER BY n DESC LIMIT 20`,
      f,
    );
    // Notificações ligadas: das pessoas que abriram a app nessa plataforma no período, quantas têm um aparelho ou browser registado.
    const push = await this.q(
      `WITH a AS (SELECT DISTINCT e.platform, e.user_id FROM analytics.events e ${joinU} WHERE e.name = 'app_open' AND e.at >= ${START})
       SELECT a.platform, count(*)::int AS people,
              count(*) FILTER (WHERE CASE WHEN a.platform IN ('android', 'ios')
                                          THEN EXISTS (SELECT 1 FROM social.push_devices d WHERE d.user_id = a.user_id AND d.platform = a.platform)
                                          ELSE EXISTS (SELECT 1 FROM social.push_subscriptions s WHERE s.user_id = a.user_id) END)::int AS enabled
         FROM a GROUP BY 1 ORDER BY people DESC`,
      f,
    );
    const ms = (v: unknown) => (v == null ? null : Math.round(Number(v)));
    return {
      versions: versions.map((r) => ({ platform: r.platform as string, version: r.version as string, people: n(r.people), sessions: n(r.sessions) })),
      errors: errors.map((r) => ({ platform: r.platform as string, version: r.version as string, sessions: n(r.sessions), errors: n(r.errors), sessionsWithErrorPct: pct(n(r.bad), n(r.sessions)) })),
      messages: messages.map((r) => ({ platform: r.platform as string, message: r.message as string, count: n(r.n), sessions: n(r.sessions) })),
      firstScreen: firstScreen.map((r) => ({ platform: r.platform as string, version: r.version as string, samples: n(r.n), p50: ms(r.p50), p75: ms(r.p75), p90: ms(r.p90) })),
      push: push.map((r) => {
        const people = n(r.people);
        return { platform: r.platform as string, people: AnalysesService.safe(people), enabledPct: people >= K ? pct(n(r.enabled), people) : null };
      }),
    };
  }
}
