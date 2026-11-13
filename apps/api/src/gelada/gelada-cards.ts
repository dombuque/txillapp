import type { Pool, PoolClient } from 'pg';
import { badge, type Badge } from '../common/badge';
import { blockedBetween } from '../social/visibility';

/**
 * «Paga-me uma» (0145): os cartões vistos por quem pede. Funções soltas (como geleira/geleira-post.ts) para o chat, os
 * TxillGroups e as publicações as poderem usar sem dependências entre serviços.
 *
 * O álcool só sai para quem tem 18 anos ou mais: um pedido entre um adulto e um menor já foi gravado como refresco, mas um
 * terceiro menor que veja a publicação de dois adultos também não vê a bebida (`masked`: «uma bebida»).
 */

type Db = Pool | PoolClient;

export interface Drink {
  slug: string;
  name: string;
  category: string;
  alcoholic: boolean;
  /** Escondida para quem vê (tem menos de 18 anos): o nome e o desenho passam a «uma bebida». */
  masked?: boolean;
}

export interface Person extends Badge {
  username: string;
  displayName: string;
  hasAvatar: boolean;
}

export type RequestStatus = 'pending' | 'accepted' | 'declined' | 'owed' | 'untagged';

/** SQL: a pessoa `u` (alias de identity.users) tem 18 anos ou mais. Sem data de nascimento conta como menor. */
export const adultSql = (u: string) => `(${u}.birth_date IS NOT NULL AND ${u}.birth_date <= (now() AT TIME ZONE 'Africa/Maputo')::date - interval '18 years')`;

/** Uma bebida escondida (para menores): o desenho de um copo de água e «uma bebida». */
export const MASKED: Drink = { slug: 'beb-agua', name: 'Uma bebida', category: 'refrigerante', alcoholic: false, masked: true };
export const maskFor = (d: Drink, viewerAdult: boolean): Drink => (d.alcoholic && !viewerAdult ? MASKED : d);

/** O emoji que acompanha a bebida no texto (refrescos e sumos 🥤; nunca um copo de álcool num texto para menores). */
export function drinkEmoji(d: Drink): string {
  if (!d.alcoholic || d.masked) return '🥤';
  if (d.category === 'vinho') return /espumante|champanhe|prosecco/.test(d.slug) ? '🥂' : '🍷';
  if (d.category === 'destilado') return '🥃';
  if (d.category === 'cocktail') return '🍹';
  return '🍺';
}

/** O que se pede: «uma 2M» (com álcool), «um refresco» (sem álcool) ou «uma bebida» (escondida). */
export function drinkPhrase(d: Drink): string {
  if (d.masked) return 'uma bebida';
  return d.alcoholic ? `uma ${d.name}` : 'um refresco';
}

/** O texto do pedido na voz de quem pede: «Paga-me uma 2M 🍺» / «Paga-me um refresco 🥤». */
export const requestText = (d: Drink) => `Paga-me ${drinkPhrase(d)} ${drinkEmoji(d)}`;

const person = (r: Record<string, any>, p: string): Person | null => {
  if (!r[`${p}_username`]) return null;
  if (r[`${p}_status`] !== 'active') return { username: '', displayName: 'Conta eliminada', hasAvatar: false, ...badge(false, null) };
  return { username: r[`${p}_username`] as string, displayName: r[`${p}_name`] as string, hasAvatar: !!r[`${p}_avatar`], ...badge(r[`${p}_verified`], r[`${p}_tier`]) };
};
const personCols = (alias: string, p: string) =>
  `${alias}.username AS ${p}_username, ${alias}.display_name AS ${p}_name, (${alias}.avatar_media_id IS NOT NULL) AS ${p}_avatar, ${alias}.verified AS ${p}_verified, ${alias}.verified_tier AS ${p}_tier, ${alias}.status AS ${p}_status`;

export interface RequestDto {
  id: string;
  status: RequestStatus;
  channel: 'chat' | 'post';
  requester: Person | null;
  recipient: Person | null;
  drink: Drink;
  /** Sem álcool (refresco ou sumo). */
  soft: boolean;
  /** «Paga-me uma 2M 🍺», na voz de quem pede. */
  text: string;
  /** Fui eu que pedi / pediram-me a mim. */
  mine: boolean;
  forMe: boolean;
  /** Posso responder («Bora!», «Hoje não», «Fica a dever»): é para mim e ainda está à espera. */
  canAnswer: boolean;
  /** Posso tirar a minha identificação (pedido numa publicação). */
  canUntag: boolean;
  /** A dívida criada por «Fica a dever» (para o livro). */
  debtId: string | null;
  postId: string | null;
  at: string;
  answeredAt: string | null;
}

/**
 * Os pedidos vistos por `viewerId`, por mensagens do chat (`messageIds`), por publicações (`postIds`) ou por id. Só os que a
 * pessoa pode ver: é uma das duas partes, ou (numa publicação) vê a publicação; sem bloqueio entre quem vê e a pessoa
 * identificada (essa linha some, como nas identificações em fotos).
 */
export async function requestCards(db: Db, viewerId: string, by: { messageIds?: string[]; postIds?: string[]; ids?: string[] }): Promise<RequestDto[]> {
  const where = by.messageIds ? 'r.message_id = ANY($2::uuid[])' : by.postIds ? 'r.post_id = ANY($2::uuid[])' : 'r.id = ANY($2::uuid[])';
  const list = by.messageIds ?? by.postIds ?? by.ids ?? [];
  if (!list.length) return [];
  const { rows } = await db.query(
    `SELECT r.*, ${personCols('rq', 'rq')}, ${personCols('rc', 'rc')}, ${adultSql('vw')} AS viewer_adult,
            (SELECT d.id FROM taste.gelada_debts d WHERE d.request_id = r.id) AS debt_id
       FROM taste.gelada_requests r
       JOIN identity.users rq ON rq.id = r.requester_id
       JOIN identity.users rc ON rc.id = r.recipient_id
       JOIN identity.users vw ON vw.id = $1
      WHERE ${where}
        AND (r.requester_id = $1 OR r.recipient_id = $1 OR (r.channel = 'post' AND r.status <> 'untagged' AND NOT ${blockedBetween('r.recipient_id', '$1')}))
      ORDER BY r.created_at, r.id`,
    [viewerId, list],
  );
  return rows.map((r) => requestDto(r, viewerId));
}

function requestDto(r: Record<string, any>, viewerId: string): RequestDto {
  const raw: Drink = { slug: r.drink_slug, name: r.drink_name, category: r.drink_category, alcoholic: !!r.alcoholic };
  const drink = maskFor(raw, !!r.viewer_adult);
  const forMe = r.recipient_id === viewerId;
  return {
    id: r.id as string,
    status: r.status as RequestStatus,
    channel: r.channel as 'chat' | 'post',
    requester: person(r, 'rq'),
    recipient: person(r, 'rc'),
    drink,
    soft: !raw.alcoholic,
    text: requestText(drink),
    mine: r.requester_id === viewerId,
    forMe,
    canAnswer: forMe && r.status === 'pending',
    canUntag: forMe && r.channel === 'post' && r.status !== 'untagged',
    debtId: (r.debt_id as string | null) ?? null,
    postId: (r.post_id as string | null) ?? null,
    at: new Date(r.created_at as string).toISOString(),
    answeredAt: r.answered_at ? new Date(r.answered_at as string).toISOString() : null,
  };
}

/** O cartão do pedido publicado (`post.gelada`): a bebida, quem foi identificado e o estado de cada um. */
export interface PostGeladaDto {
  drink: Drink;
  /** «@ana, @rui, paga-me uma 2M 🍺» constrói-se na app com `requests`; aqui fica o texto base («Paga-me uma 2M 🍺»). */
  text: string;
  requests: RequestDto[];
  /** Pessoas identificadas cuja conta já não existe ou que tiraram a identificação (o cartão diz «Conta eliminada» / nada). */
  gone: number;
}

/** O pedido publicado de várias publicações de uma vez (a página do feed). Chave: o id da publicação. */
export async function postGeladas(db: Db, viewerId: string, posts: { id: string; gelada: unknown }[]): Promise<Map<string, PostGeladaDto>> {
  const out = new Map<string, PostGeladaDto>();
  const withCard = posts.filter((p) => p.gelada && typeof p.gelada === 'object');
  if (!withCard.length) return out;
  const reqs = await requestCards(db, viewerId, { postIds: withCard.map((p) => p.id) });
  const adult = (await db.query(`SELECT ${adultSql('u')} AS a FROM identity.users u WHERE u.id = $1`, [viewerId])).rows[0]?.a === true;
  const all = (await db.query(`SELECT post_id, count(*)::int AS n FROM taste.gelada_requests WHERE post_id = ANY($1::uuid[]) GROUP BY post_id`, [withCard.map((p) => p.id)])).rows;
  const existing = new Map(all.map((r) => [r.post_id as string, r.n as number]));
  for (const p of withCard) {
    const g = p.gelada as { drink?: Drink; count?: number };
    if (!g.drink) continue;
    const drink = maskFor({ slug: g.drink.slug, name: g.drink.name, category: g.drink.category, alcoholic: !!g.drink.alcoholic }, adult);
    const mine = reqs.filter((r) => r.postId === p.id && r.status !== 'untagged');
    out.set(p.id, { drink, text: requestText(drink), requests: mine, gone: Math.max(0, (g.count ?? 0) - (existing.get(p.id) ?? 0)) });
  }
  return out;
}

export interface RoundEntry { person: Person; drink: Drink; mine: boolean }
export interface RoundDto {
  id: string;
  groupId: string;
  status: 'open' | 'closed';
  openedBy: Person | null;
  payer: Person | null;
  entries: RoundEntry[];
  /** Eu: já entrei (e com que bebida) e se sou eu que pago. */
  me: { joined: boolean; payer: boolean; drink: Drink | null };
  /** Quem pagou a última rodada fechada deste grupo, e a sugestão para esta: «Hoje paga o @x». */
  lastPayer: Person | null;
  suggestedPayer: Person | null;
  /** Posso fechar: quem abriu, quem paga ou quem administra o grupo. */
  canClose: boolean;
  /** Posso criar as dívidas ao fechar (só quem pagou). */
  canBill: boolean;
  at: string;
  closedAt: string | null;
}

/**
 * Rodadas vistas por um membro do grupo (por mensagens kind 'rodada', ou por id). Quem tem menos de 18 anos não vê as bebidas
 * com álcool dos outros (`masked`).
 */
export async function roundCards(db: Db, viewerId: string, by: { messageIds?: string[]; ids?: string[] }): Promise<RoundDto[]> {
  const list = by.messageIds ?? by.ids ?? [];
  if (!list.length) return [];
  const { rows } = await db.query(
    `SELECT r.*, ${personCols('ob', 'ob')}, ${personCols('py', 'py')}, ${adultSql('vw')} AS viewer_adult,
            (SELECT gm.role FROM social.group_members gm WHERE gm.group_id = r.group_id AND gm.user_id = $1) AS my_role
       FROM taste.gelada_rounds r
       LEFT JOIN identity.users ob ON ob.id = r.opened_by
       LEFT JOIN identity.users py ON py.id = r.payer_id
       JOIN identity.users vw ON vw.id = $1
      WHERE ${by.messageIds ? 'r.message_id = ANY($2::uuid[])' : 'r.id = ANY($2::uuid[])'}
        AND EXISTS (SELECT 1 FROM social.group_members gm WHERE gm.group_id = r.group_id AND gm.user_id = $1)`,
    [viewerId, list],
  );
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id as string);
  const entries = (
    await db.query(
      `SELECT e.round_id, e.user_id, e.drink_slug, e.drink_name, e.drink_category, e.alcoholic, ${personCols('u', 'u')}
         FROM taste.gelada_round_entries e JOIN identity.users u ON u.id = e.user_id
        WHERE e.round_id = ANY($1::uuid[]) AND u.status = 'active' ORDER BY e.created_at`,
      [ids],
    )
  ).rows;
  const groups = [...new Set(rows.map((r) => r.group_id as string))];
  const hint = new Map<string, { last: Person | null; next: Person | null }>();
  for (const g of groups) hint.set(g, await payerHint(db, g, rows.find((r) => r.group_id === g)?.id as string));
  return rows.map((r) => {
    const adult = !!r.viewer_adult;
    const mine = entries.filter((e) => e.round_id === r.id);
    const me = mine.find((e) => e.user_id === viewerId);
    const drinkOf = (e: Record<string, any>) => maskFor({ slug: e.drink_slug, name: e.drink_name, category: e.drink_category, alcoholic: !!e.alcoholic }, adult);
    const h = hint.get(r.group_id as string)!;
    const isPayer = r.payer_id === viewerId;
    return {
      id: r.id as string,
      groupId: r.group_id as string,
      status: r.status as 'open' | 'closed',
      openedBy: person(r, 'ob'),
      payer: person(r, 'py'),
      entries: mine.map((e) => ({ person: person(e, 'u')!, drink: drinkOf(e), mine: e.user_id === viewerId })),
      me: { joined: !!me, payer: isPayer, drink: me ? drinkOf(me) : null },
      lastPayer: h.last,
      // Numa rodada já com quem pague, a sugestão já não faz falta.
      suggestedPayer: r.status === 'open' && !r.payer_id ? h.next : null,
      canClose: r.status === 'open' && (r.opened_by === viewerId || isPayer || r.my_role === 'admin'),
      canBill: r.status === 'open' && isPayer,
      at: new Date(r.created_at as string).toISOString(),
      closedAt: r.closed_at ? new Date(r.closed_at as string).toISOString() : null,
    };
  });
}

/**
 * Quem pagou a última rodada fechada do grupo e quem devia pagar a próxima: o membro que há mais tempo não paga (quem nunca
 * pagou primeiro), nunca quem pagou a última; entre iguais, quem já entrou nesta rodada e depois quem está há mais tempo no grupo.
 */
export async function payerHint(db: Db, groupId: string, roundId?: string): Promise<{ last: Person | null; next: Person | null }> {
  const last = (
    await db.query(
      `SELECT r.payer_id, ${personCols('u', 'u')} FROM taste.gelada_rounds r JOIN identity.users u ON u.id = r.payer_id
        WHERE r.group_id = $1 AND r.status = 'closed' AND r.payer_id IS NOT NULL ORDER BY r.closed_at DESC LIMIT 1`,
      [groupId],
    )
  ).rows[0];
  const next = (
    await db.query(
      `SELECT gm.user_id, ${personCols('u', 'u')},
              (SELECT max(r.closed_at) FROM taste.gelada_rounds r WHERE r.group_id = gm.group_id AND r.status = 'closed' AND r.payer_id = gm.user_id) AS paid_at,
              EXISTS (SELECT 1 FROM taste.gelada_round_entries e WHERE e.round_id = $3::uuid AND e.user_id = gm.user_id) AS joined
         FROM social.group_members gm JOIN identity.users u ON u.id = gm.user_id
        WHERE gm.group_id = $1 AND u.status = 'active' AND gm.user_id IS DISTINCT FROM $2::uuid
        ORDER BY paid_at ASC NULLS FIRST, joined DESC, gm.joined_at ASC LIMIT 1`,
      [groupId, (last?.payer_id as string | undefined) ?? null, roundId ?? null],
    )
  ).rows[0];
  return { last: last ? person(last, 'u') : null, next: next ? person(next, 'u') : null };
}


// Os pontos das geladas no nível da geleira estão em geleira/geleira-level.ts (0146): 3 a quem pagou, 2 a quem recebeu.
