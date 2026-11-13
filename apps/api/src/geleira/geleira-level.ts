import type { Pool, PoolClient } from 'pg';

/**
 * O nível da geleira (0146): mede o que a pessoa vive com a malta nos últimos 90 dias, não o que declara.
 *
 * Pontos (só os últimos WINDOW_DAYS dias):
 * - geladas pagas e confirmadas (o livro, estado `paid`, e os pedidos aceites com «Bora!»): 3 a quem pagou, 2 a quem recebeu;
 * - brindes de outras pessoas à geleira ou aos gostos (taste.geleira_cheers e geleira_item_cheers), só de seguidores mútuos:
 *   1 por pessoa, no máximo 1 por pessoa a cada 30 dias;
 * - check-ins em locais (content.checkins, já validados pelo QR; locais aprovados e não meus): 2 por local, no máximo 1 vez por
 *   local em cada semana;
 * - rodadas fechadas de um TxillGroup com mais alguém: 1 por entrar, 2 por pagar;
 * - gostos na geleira (base): 1 por grupo diferente (até 4) e 1 por cada 2 gostos avaliados (até 4), no máximo 8.
 *
 * Anti-batota: tudo o que vem de outra pessoa (geladas, brindes, rodadas) conta só com contas ativas e sem bloqueio entre as
 * duas, e a mesma pessoa vale no máximo PERSON_WEEK_MAX pontos por semana (semanas de Maputo). O álcool nunca conta nada: uma
 * gelada de refresco vale o mesmo, e uma bebida com álcool na geleira vale o mesmo que uma sem. Os Txills também não contam.
 *
 * Os níveis de cima pedem, além dos pontos, pessoas diferentes e semanas com atividade (GATES). O nível mostrado sobe logo,
 * mas desce no máximo um degrau por semana (DROP_EVERY_DAYS). O resultado fica em taste.geleira_levels: o perfil e o retrato
 * dos posts da geleira leem daí.
 */

type Db = Pool | PoolClient;

export const WINDOW_DAYS = 90;
export const POINTS = { paid: 3, received: 2, cheer: 1, checkin: 2, roundJoin: 1, roundPaid: 2 } as const;
/** A mesma pessoa vale, no máximo, isto por semana para o meu nível. */
export const PERSON_WEEK_MAX = 6;
/** Um brinde por pessoa a cada 30 dias. */
export const CHEER_EVERY_DAYS = 30;
/** Os gostos da geleira valem no máximo isto (4 pela variedade e 4 pelas notas). */
export const BASE_MAX = 8;
/** Pontos para cada nível (0 a 4). */
export const STEPS = [0, 1, 40, 100, 180] as const;
/** O que cada nível pede além dos pontos: pessoas diferentes e semanas com atividade (dos últimos 90 dias). */
export const GATES = [
  { people: 0, weeks: 0 },
  { people: 0, weeks: 0 },
  { people: 2, weeks: 3 },
  { people: 5, weeks: 6 },
  { people: 10, weeks: 10 },
] as const;
/** O nível mostrado desce no máximo um degrau por cada tantos dias. */
export const DROP_EVERY_DAYS = 7;
/** Uma conta com mais de uma hora é refeita (na leitura ou na volta de hora a hora). */
export const MAX_AGE_MS = 3_600_000;

const DAY_MS = 86_400_000;

export interface LevelBreakdown {
  geladas: { points: number; paid: number; received: number };
  brindes: { points: number; people: number };
  sitios: { points: number; places: number; visits: number };
  rodadas: { points: number; joined: number; paid: number };
  gostos: { points: number; max: number; groups: number; rated: number };
  /** Pessoas diferentes que contaram e semanas com atividade, nos últimos 90 dias. */
  people: number;
  weeks: number;
  /** O nível que os números dão agora (o mostrado pode estar acima, a descer devagar). */
  raw: number;
}

export interface LevelRow {
  points: number;
  level: number;
  breakdown: LevelBreakdown;
  computedAt: Date;
  droppedAt: Date | null;
}

/** Os pontos dos gostos: variedade (grupos diferentes, até 4) e notas (1 por cada 2 gostos avaliados, até 4). */
export const basePoints = (groups: number, rated: number) => Math.min(BASE_MAX, Math.min(4, groups) + Math.min(4, Math.floor(rated / 2)));

/** O nível que os números dão: o maior cujos pontos, pessoas e semanas estão todos cumpridos. */
export function rawLevel(s: { points: number; people: number; weeks: number }): number {
  for (let l = 4; l >= 1; l--) if (s.points >= STEPS[l] && s.people >= GATES[l].people && s.weeks >= GATES[l].weeks) return l;
  return 0;
}

/**
 * O nível mostrado: sobe logo; desce no máximo um degrau por DROP_EVERY_DAYS (a contar da última descida), para não ser brusco.
 */
export function settle(prev: { level: number; droppedAt: Date | null } | null, raw: number, now: Date): { level: number; droppedAt: Date | null } {
  if (!prev || raw >= prev.level) return { level: raw, droppedAt: prev?.droppedAt ?? null };
  if (prev.droppedAt && now.getTime() - prev.droppedAt.getTime() < DROP_EVERY_DAYS * DAY_MS) return { level: prev.level, droppedAt: prev.droppedAt };
  return { level: prev.level - 1, droppedAt: now };
}

/** Quanto falta para o nível seguinte (pontos, pessoas e semanas); null no topo. */
export function needs(row: { points: number; level: number; breakdown: Pick<LevelBreakdown, 'people' | 'weeks'> }) {
  if (row.level >= 4) return null;
  const next = row.level + 1;
  return {
    points: Math.max(0, STEPS[next] - row.points),
    people: Math.max(0, GATES[next].people - row.breakdown.people),
    weeks: Math.max(0, GATES[next].weeks - row.breakdown.weeks),
  };
}

/** A barra (0 a 1): o requisito mais atrasado para o nível seguinte (pontos dentro do nível, pessoas, semanas). */
export function progressOf(row: { points: number; level: number; breakdown: Pick<LevelBreakdown, 'people' | 'weeks'> }): number {
  if (row.level >= 4) return 1;
  const next = row.level + 1;
  const lo = STEPS[row.level];
  const frac = (have: number, need: number) => (need <= 0 ? 1 : Math.max(0, Math.min(1, have / need)));
  const p = Math.min(frac(row.points - lo, STEPS[next] - lo), frac(row.breakdown.people, GATES[next].people), frac(row.breakdown.weeks, GATES[next].weeks));
  return Math.round(p * 100) / 100;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * A dica do dono: o que falta, em coisas concretas («Paga 2 geladas ou recebe brindes de 3 amigos para chegares a Paulada
 * garantida.»). `nextTitle`: o nome do nível seguinte (o do topo depende da idade).
 */
export function tipFor(row: { points: number; level: number; breakdown: LevelBreakdown }, nextTitle: string | null): string {
  const falling = row.breakdown.raw < row.level;
  if (falling) return 'Há uns tempos que não sais com a malta: o nível desce um degrau por semana. Paga uma gelada ou faz check-in num sítio para o segurar.';
  const n = needs(row);
  if (!n || !nextTitle) return 'Estás no topo! Só contam os últimos 90 dias: continua a sair com a malta para não desceres.';
  if (row.level === 0) return 'Paga uma gelada, recebe um brinde de um amigo ou dá nota aos teus gostos para começares a txilar.';
  const parts: string[] = [];
  if (n.points > 0) {
    const g = Math.ceil(n.points / POINTS.paid);
    // Pouco: uma ou duas coisas. Muito: o ritmo de quem sai (2 geladas pagas e 2 check-ins por semana, ~10 pontos).
    if (n.points <= PERSON_WEEK_MAX) parts.push(`paga ${plural(g, 'gelada', 'geladas')} ou recebe brindes de ${plural(n.points, 'amigo', 'amigos')}`);
    else if (n.points <= 2 * PERSON_WEEK_MAX) parts.push(`paga ${plural(g, 'gelada', 'geladas')} ou faz ${plural(Math.ceil(n.points / POINTS.checkin), 'check-in', 'check-ins')} em sítios diferentes`);
    else parts.push(`paga 2 geladas e faz 2 check-ins por semana durante umas ${Math.ceil(n.points / (2 * POINTS.paid + 2 * POINTS.checkin))} semanas`);
  }
  if (n.people > 0) parts.push(`txila com mais ${plural(n.people, 'pessoa diferente', 'pessoas diferentes')}`);
  if (n.weeks > 0) parts.push(`sai com a malta em mais ${plural(n.weeks, 'semana', 'semanas')}`);
  if (!parts.length) parts.push('continua assim');
  const text = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} e ${parts[parts.length - 1]}`;
  return `${text[0].toUpperCase()}${text.slice(1)} para chegares a ${nextTitle}.`;
}

/** A janela (`$2` é o «agora»: nos testes, um relógio falso). */
const win = (col: string) => `${col} > $2::timestamptz - interval '${WINDOW_DAYS} days' AND ${col} <= $2::timestamptz`;
const week = (col: string) => `date_trunc('week', ${col} AT TIME ZONE 'Africa/Maputo')`;

/** A primeira outra pessoa de uma rodada (ativa), para o teto por pessoa. */
const otherInRound = (round: string) =>
  `(SELECT e2.user_id FROM taste.gelada_round_entries e2 JOIN identity.users u2 ON u2.id = e2.user_id
     WHERE e2.round_id = ${round} AND e2.user_id <> $1 AND u2.status = 'active' ORDER BY e2.created_at, e2.user_id LIMIT 1)`;

/**
 * A conta, numa query agregada (cada fonte pelos índices da pessoa e da janela). `asOf`: o «agora» da conta.
 * Devolve o detalhe e os pontos, sem o nível mostrado (que depende do anterior: ver `settle`).
 */
export async function levelStats(db: Db, userId: string, asOf: Date = new Date()): Promise<{ points: number; breakdown: LevelBreakdown }> {
  const { rows } = await db.query(
    `WITH ev AS (
       SELECT 'paid'::text AS src, d.creditor_id AS other, d.closed_at AS at, ${POINTS.paid} AS pts
         FROM taste.gelada_debts d WHERE d.debtor_id = $1 AND d.status = 'paid' AND ${win('d.closed_at')}
       UNION ALL
       SELECT 'received', d.debtor_id, d.closed_at, ${POINTS.received}
         FROM taste.gelada_debts d WHERE d.creditor_id = $1 AND d.status = 'paid' AND ${win('d.closed_at')}
       UNION ALL -- «Bora!»: quem recebeu o pedido paga a gelada a quem pediu
       SELECT 'paid', r.requester_id, r.answered_at, ${POINTS.paid}
         FROM taste.gelada_requests r WHERE r.recipient_id = $1 AND r.status = 'accepted' AND ${win('r.answered_at')}
       UNION ALL
       SELECT 'received', r.recipient_id, r.answered_at, ${POINTS.received}
         FROM taste.gelada_requests r WHERE r.requester_id = $1 AND r.status = 'accepted' AND ${win('r.answered_at')}
       UNION ALL -- brindes de seguidores mútuos: um por pessoa a cada 30 dias
       SELECT 'cheer', c.user_id, min(c.created_at), ${POINTS.cheer}
         FROM (SELECT user_id, created_at FROM taste.geleira_cheers WHERE owner_id = $1 AND ${win('created_at')}
               UNION ALL
               SELECT user_id, created_at FROM taste.geleira_item_cheers WHERE owner_id = $1 AND ${win('created_at')}) c
        WHERE EXISTS (SELECT 1 FROM social.follows f WHERE f.follower_id = c.user_id AND f.followee_id = $1)
          AND EXISTS (SELECT 1 FROM social.follows f WHERE f.follower_id = $1 AND f.followee_id = c.user_id)
        GROUP BY c.user_id, floor(extract(epoch FROM ($2::timestamptz - c.created_at)) / ${CHEER_EVERY_DAYS * 86_400})
       UNION ALL -- entrei numa rodada fechada com mais alguém (conta de quem pagou, de quem abriu ou de outro que entrou)
       SELECT 'round', COALESCE(NULLIF(r.payer_id, $1), NULLIF(r.opened_by, $1), ${otherInRound('r.id')}), r.closed_at, ${POINTS.roundJoin}
         FROM taste.gelada_round_entries e JOIN taste.gelada_rounds r ON r.id = e.round_id
        WHERE e.user_id = $1 AND r.status = 'closed' AND ${win('r.closed_at')} AND ${otherInRound('r.id')} IS NOT NULL
       UNION ALL -- paguei a rodada (com mais alguém lá dentro)
       SELECT 'roundPaid', ${otherInRound('r.id')}, r.closed_at, ${POINTS.roundPaid}
         FROM taste.gelada_rounds r WHERE r.payer_id = $1 AND r.status = 'closed' AND ${win('r.closed_at')}
     ),
     ok AS (
       SELECT ev.* FROM ev JOIN identity.users o ON o.id = ev.other
        WHERE o.status = 'active' AND o.id <> $1
          AND NOT EXISTS (SELECT 1 FROM social.blocks bk WHERE (bk.blocker_id = o.id AND bk.blocked_id = $1) OR (bk.blocker_id = $1 AND bk.blocked_id = o.id))
     ),
     capped AS (
       SELECT src, other, ${week('at')} AS w,
              least(pts, greatest(0, ${PERSON_WEEK_MAX} - (sum(pts) OVER (PARTITION BY other, ${week('at')} ORDER BY at, src ROWS UNBOUNDED PRECEDING) - pts)))::int AS eff
         FROM ok
     ),
     ck AS (
       SELECT c.venue_id, ${week('c.created_at')} AS w
         FROM content.checkins c JOIN content.venues v ON v.id = c.venue_id
        WHERE c.user_id = $1 AND ${win('c.created_at')} AND v.review_status = 'approved' AND v.owner_id <> $1
        GROUP BY 1, 2
     ),
     base AS (
       SELECT count(DISTINCT i.category)::int AS groups, count(*) FILTER (WHERE ui.rating IS NOT NULL)::int AS rated
         FROM taste.user_items ui JOIN taste.items i ON i.id = ui.item_id
        WHERE ui.user_id = $1 AND i.status = 'curated' AND i.kind IN ('bebida', 'comida')
     )
     SELECT b.groups, b.rated,
            COALESCE((SELECT sum(eff) FROM capped WHERE src IN ('paid', 'received')), 0)::int AS geladas,
            (SELECT count(*) FROM capped WHERE src = 'paid' AND eff > 0)::int AS paid,
            (SELECT count(*) FROM capped WHERE src = 'received' AND eff > 0)::int AS received,
            COALESCE((SELECT sum(eff) FROM capped WHERE src = 'cheer'), 0)::int AS brindes,
            (SELECT count(DISTINCT other) FROM capped WHERE src = 'cheer' AND eff > 0)::int AS cheerers,
            COALESCE((SELECT sum(eff) FROM capped WHERE src IN ('round', 'roundPaid')), 0)::int AS rodadas,
            (SELECT count(*) FROM capped WHERE src = 'round' AND eff > 0)::int AS joined,
            (SELECT count(*) FROM capped WHERE src = 'roundPaid' AND eff > 0)::int AS rounds_paid,
            (SELECT count(*) FROM ck)::int AS visits,
            (SELECT count(DISTINCT venue_id) FROM ck)::int AS places,
            (SELECT count(DISTINCT other) FROM capped WHERE eff > 0)::int AS people,
            (SELECT count(*) FROM (SELECT w FROM capped WHERE eff > 0 UNION SELECT w FROM ck) x)::int AS weeks
       FROM base b`,
    [userId, asOf.toISOString()],
  );
  const r = rows[0] as Record<string, number>;
  const gostos = basePoints(r.groups, r.rated);
  const sitios = r.visits * POINTS.checkin;
  const points = r.geladas + r.brindes + sitios + r.rodadas + gostos;
  const breakdown: LevelBreakdown = {
    geladas: { points: r.geladas, paid: r.paid, received: r.received },
    brindes: { points: r.brindes, people: r.cheerers },
    sitios: { points: sitios, places: r.places, visits: r.visits },
    rodadas: { points: r.rodadas, joined: r.joined, paid: r.rounds_paid },
    gostos: { points: gostos, max: BASE_MAX, groups: r.groups, rated: r.rated },
    people: r.people,
    weeks: r.weeks,
    raw: 0,
  };
  breakdown.raw = rawLevel({ points, people: breakdown.people, weeks: breakdown.weeks });
  return { points, breakdown };
}

const rowOut = (r: Record<string, any>): LevelRow => ({
  points: r.points as number,
  level: r.level as number,
  breakdown: r.breakdown as LevelBreakdown,
  computedAt: new Date(r.computed_at as string),
  droppedAt: r.dropped_at ? new Date(r.dropped_at as string) : null,
});

/** Refaz a conta e guarda-a (com a descida gradual a partir do nível guardado). `now`: o «agora» (relógio falso nos testes). */
export async function refreshLevel(db: Db, userId: string, now: Date = new Date()): Promise<LevelRow> {
  // Primeiro tira a marca: se algo mudar durante a conta, o gatilho volta a pô-la e a próxima leitura refaz.
  const prev = (await db.query('UPDATE taste.geleira_levels SET stale = false WHERE user_id = $1 RETURNING level, dropped_at', [userId])).rows[0];
  const { points, breakdown } = await levelStats(db, userId, now);
  const s = settle(prev ? { level: prev.level as number, droppedAt: prev.dropped_at ? new Date(prev.dropped_at as string) : null } : null, breakdown.raw, now);
  const { rows } = await db.query(
    `INSERT INTO taste.geleira_levels (user_id, points, level, breakdown, computed_at, dropped_at) VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (user_id) DO UPDATE SET points = EXCLUDED.points, level = EXCLUDED.level, breakdown = EXCLUDED.breakdown,
            computed_at = EXCLUDED.computed_at, dropped_at = EXCLUDED.dropped_at
     RETURNING points, level, breakdown, computed_at, dropped_at`,
    [userId, points, s.level, JSON.stringify(breakdown), now.toISOString(), s.droppedAt?.toISOString() ?? null],
  );
  return rowOut(rows[0]);
}

/**
 * O nível de alguém, da cache: refaz se não há, se algo mudou (`stale`) ou se tem mais de uma hora. É a fonte única do perfil
 * (GeleiraService.level) e do retrato dos posts da geleira (buildSnapshot).
 */
export async function geleiraLevel(db: Db, userId: string, now: Date = new Date()): Promise<LevelRow> {
  const r = (await db.query('SELECT points, level, breakdown, computed_at, dropped_at, stale FROM taste.geleira_levels WHERE user_id = $1', [userId])).rows[0];
  if (r && !r.stale && now.getTime() - new Date(r.computed_at as string).getTime() < MAX_AGE_MS && (r.breakdown as LevelBreakdown)?.gostos) return rowOut(r);
  return refreshLevel(db, userId, now);
}

/**
 * A volta de hora a hora: refaz quem mudou alguma coisa e quem tem pontos ou nível (pode descer por já não sair), os mais
 * antigos primeiro. Devolve quantos refez.
 */
export async function refreshDue(db: Db, opts: { now?: Date; limit?: number } = {}): Promise<number> {
  const now = opts.now ?? new Date();
  const { rows } = await db.query(
    `SELECT l.user_id FROM taste.geleira_levels l JOIN identity.users u ON u.id = l.user_id
      WHERE (l.stale OR l.points > 0 OR l.level > 0) AND u.status = 'active'
        AND (l.stale OR l.computed_at < $1::timestamptz - interval '1 hour')
      ORDER BY l.computed_at LIMIT $2`,
    [now.toISOString(), opts.limit ?? 500],
  );
  for (const r of rows) await refreshLevel(db, r.user_id as string, now);
  return rows.length;
}
