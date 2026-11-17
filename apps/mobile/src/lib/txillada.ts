/**
 * A Txillada (o live do Txillapp, docs/txillada-contrato.md): a lógica pura, sem React nem módulos nativos. Os testes em
 * tests/txillada.test.mjs importam este ficheiro diretamente. Quem a usa: lib/api.txillada.ts, lib/txilladaRoom.ts,
 * components/txillada/* e app/txillada/[id].tsx.
 *
 * - O estado do live (`applyEvent`, `withDto`): quantos estão a ver (e o pico), os brindes, os comentários (os 50 mais
 *   recentes, sem repetidos, sem os apagados) e se acabou. Chega por dois caminhos: os eventos em tempo real do canal da
 *   app (`txillada.*`) e os pedidos à API (o arranque e a rede de segurança de poucos em poucos segundos).
 * - Os balões a flutuar (`floatAdd`, `floatStep`, `floatView`): os comentários novos entram de baixo, um de cada vez.
 * - O que cada um pode fazer (`liveUi`, `commentActions`) e os limites (2 s entre comentários, 5 brindes por segundo).
 * - A Txillada não se grava: quando acaba, já não se pode ver (`viewKind` dá 'ended').
 */

import type { GuestPending, GuestState, TxilladaGuest } from '@/lib/txilladaGuests';
import { fmtVibesNumber, formatVibes } from '@/lib/vibes';

/**
 * Quem pode ver (0167): 'everyone' (Pública), 'friends' (Para amigos: quem segues e te segue), 'close' (Para amigos com «Só
 * amigos próximos»), 'paid' (Privada: paga-se a entrada) e o antigo 'followers' (as Txilladas abertas por apps antigas).
 */
export type TxilladaAudience = 'everyone' | 'followers' | 'close' | 'friends' | 'paid';
/** Os três tipos que se escolhem ao preparar (0167). */
export type TxilladaKind = 'public' | 'friends' | 'paid';
export type TxilladaStatus = 'live' | 'ended' | 'cut';
export type TxilladaTier = 'verified' | 'official' | 'paid' | null;

export interface TxilladaPerson { id: string; username: string; displayName: string; avatarUrl: string | null; verified?: boolean; verifiedTier?: TxilladaTier }

export interface TxilladaDto {
  id: string;
  host: TxilladaPerson;
  title: string;
  audience: TxilladaAudience;
  status: TxilladaStatus;
  startedAt: string;
  endedAt: string | null;
  viewers: number;
  peakViewers: number;
  cheers: number;
  comments: number;
  isHost: boolean;
  canComment: boolean;
  /** O comentário fixado pelo anfitrião, como eu o vejo (0162; servidores antigos não mandam: fica o que se sabe). */
  pinned?: TxilladaComment | null;
  /** Quem transmite com o anfitrião (0165, até 3), por ordem de entrada, como eu os vejo; o meu lugar; e, só para o anfitrião, os pedidos e os convites à espera (lib/txilladaGuests). */
  guests?: TxilladaGuest[];
  guestsMax?: number;
  guestState?: GuestState;
  requests?: GuestPending[];
  invites?: GuestPending[];
  /** O tipo (0167; servidores antigos não mandam: sai do `audience`), «Só amigos próximos» e o preço da entrada (só nas pagas). */
  kind?: TxilladaKind;
  closeOnly?: boolean;
  price?: number | null;
  /** Posso entrar (anfitrião, entrada paga, convidado; nas outras, sempre). */
  hasTicket?: boolean;
  /** Paga e sem a entrada: só o cartão com o cadeado e o preço (nada da sala). */
  locked?: boolean;
  /** Nas pagas, quem está a ver não aparece aos outros (só ao anfitrião). */
  viewersHidden?: boolean;
  /** A Angariação: a meta (null sem ela), o motivo, quanto já se ofereceu e quem mais ofereceu (top 3). */
  goal?: number | null;
  goalPurpose?: string;
  raised?: number;
  topGivers?: TxilladaGiver[];
  /** Só o anfitrião de uma paga: quantas entradas se pagaram. */
  tickets?: number;
  /** Só o anfitrião: terminou uma Angariação antes da meta e ainda a pode reabrir (até `reopenUntil`). */
  canReopen?: boolean;
  reopenUntil?: string | null;
}

/** Um de «quem mais ofereceu» (com o selo, como em todo o lado). */
export interface TxilladaGiver { username: string; displayName: string; avatarUrl: string | null; verified?: boolean; verifiedTier?: TxilladaTier; total: number }
/** Uma oferta de Txills durante o live. */
export interface TxilladaGift { id: string; from: Omit<TxilladaPerson, 'id'>; amount: number; createdAt: string }

/**
 * `cheers`: quantos brindaram o comentário; `cheered`: se eu brindei (0161; servidores antigos não mandam). `gift`: não é um
 * comentário, é a linha destacada «@x ofereceu N vibes» (0167; o id começa por `gift:`, nunca vai para a API).
 */
export interface TxilladaComment { id: string; author: TxilladaPerson; body: string; createdAt: string; cheers?: number; cheered?: boolean; gift?: { amount: number } }

export type TxilladaEvent =
  | { type: 'txillada.comment'; txilladaId: string; comment: TxilladaComment }
  | { type: 'txillada.cheer'; txilladaId: string; cheers: number; from: { username: string } }
  | { type: 'txillada.viewers'; txilladaId: string; viewers: number }
  | { type: 'txillada.ended'; txilladaId: string; status: TxilladaStatus }
  | { type: 'txillada.comment_removed'; txilladaId: string; commentId: string }
  /** A contagem nova de brindes de um comentário (não diz quem brindou). */
  | { type: 'txillada.comment_cheer'; txilladaId: string; commentId: string; cheers: number }
  /** O anfitrião fixou um comentário (completo, com o autor e o selo) ou tirou o fixado (null). */
  | { type: 'txillada.pinned'; txilladaId: string; comment: TxilladaComment | null }
  /** Uma oferta de Txills (0167): a linha destacada, quanto já se juntou, a meta e quem mais ofereceu. */
  | { type: 'txillada.gift'; txilladaId: string; gift: TxilladaGift; raised: number; goal: number | null; topGivers: TxilladaGiver[] };

/** O título vai até 80 letras; um comentário até 300 (o servidor também limpa as palavras proibidas). */
export const TITLE_MAX = 80;
export const COMMENT_MAX = 300;
/** Um comentário de 2 em 2 s por pessoa (o servidor responde 429). */
export const COMMENT_GAP_MS = 2000;
/** Brindes: sem limite por pessoa, mas no máximo 5 por segundo. */
export const CHEERS_PER_S = 5;
/**
 * Quantos comentários se guardam (desde que entrei, mais os antigos que se carregam ao ler para trás): a lista dos
 * comentários (components/txillada/LiveCommentList) rola por eles todos.
 */
export const KEEP_COMMENTS = 1000;
/** A rede de segurança: de quanto em quanto tempo se pergunta à API (se um evento do canal se perder). */
export const POLL_MS = 8000;

export const AUDIENCES: { id: TxilladaAudience; label: string; hint: string }[] = [
  { id: 'everyone', label: 'Todos', hint: 'Quem pode ver o teu perfil' },
  { id: 'followers', label: 'Seguidores', hint: 'Só quem te segue' },
  { id: 'close', label: 'Amigos próximos', hint: 'A tua lista dos mimos' },
];

/** Os três tipos ao preparar (0167): Pública, Para amigos (com «Só amigos próximos») e Privada (paga). */
export const KINDS: { id: TxilladaKind; label: string; hint: string; icon: 'globe' | 'users' | 'lock' }[] = [
  { id: 'public', label: 'Pública', hint: 'Quem pode ver o teu perfil', icon: 'globe' },
  { id: 'friends', label: 'Para amigos', hint: 'Quem segues e te segue de volta', icon: 'users' },
  { id: 'paid', label: 'Privada', hint: 'Quem quiser entrar paga uma vez a entrada em vibes', icon: 'lock' },
];
/** A entrada de uma Txillada privada, a meta e o motivo da Angariação, e as ofertas (os mesmos limites do servidor). */
export const PRICE_MIN = 5;
export const PRICE_MAX = 5000;
export const GOAL_MIN = 10;
export const GOAL_MAX = 1_000_000;
export const PURPOSE_MAX = 80;
export const GIFT_MAX = 5000;
export const GIFT_PRESETS = [5, 10, 50, 100] as const;

/** O público que vai para a API a partir do que se escolheu ao preparar. */
export function prepAudience(kind: TxilladaKind, closeOnly: boolean): TxilladaAudience {
  if (kind === 'paid') return 'paid';
  if (kind === 'friends') return closeOnly ? 'close' : 'friends';
  return 'everyone';
}
/** O texto por baixo dos tipos (o de «Para amigos» muda com «Só amigos próximos»). */
export function kindHint(kind: TxilladaKind, closeOnly: boolean): string {
  if (kind === 'friends' && closeOnly) return 'Só a tua lista de amigos próximos (a mesma dos mimos)';
  return KINDS.find((k) => k.id === kind)?.hint ?? '';
}
/** O tipo de uma Txillada (servidores antigos não mandam `kind`: sai do público). */
export function dtoKind(dto: Pick<TxilladaDto, 'kind' | 'audience'> | null | undefined): TxilladaKind {
  if (dto?.kind === 'public' || dto?.kind === 'friends' || dto?.kind === 'paid') return dto.kind;
  const a = dto?.audience;
  return a === 'paid' ? 'paid' : a === 'friends' || a === 'close' ? 'friends' : 'public';
}

/** Um número inteiro escrito pela pessoa («50», « 1 000 »); vazio ou com outras coisas: null. */
export function parseAmount(s: string): number | null {
  const t = String(s ?? '').replace(/[\s.\u00a0]/g, '');
  if (!/^\d{1,9}$/.test(t)) return null;
  return Number(t);
}
export function priceError(n: number | null): string | null {
  if (n == null) return `Escreve o preço da entrada (de ${PRICE_MIN} a ${fmtTxills(PRICE_MAX)} vibes).`;
  if (n < PRICE_MIN || n > PRICE_MAX) return `A entrada vai de ${PRICE_MIN} a ${fmtTxills(PRICE_MAX)} vibes.`;
  return null;
}
export function goalError(n: number | null): string | null {
  if (n == null) return `Escreve a meta da angariação (de ${GOAL_MIN} a ${fmtTxills(GOAL_MAX)} vibes).`;
  if (n < GOAL_MIN || n > GOAL_MAX) return `A meta vai de ${GOAL_MIN} a ${fmtTxills(GOAL_MAX)} vibes.`;
  return null;
}
/** Uma oferta: de 1 a 5000 e, se se sabe o saldo, não mais do que ele. */
export function giftError(n: number | null, balance?: number | null): string | null {
  if (n == null || n < 1) return 'Escolhe quantas vibes queres oferecer.';
  if (n > GIFT_MAX) return `Podes oferecer até ${fmtTxills(GIFT_MAX)} vibes de cada vez.`;
  if (typeof balance === 'number' && n > balance) return `Não tens vibes suficientes (tens ${fmtTxills(balance)}).`;
  return null;
}
/** «50», «1000», «12 500» (como em pt: o espaço só a partir de 5 algarismos). O nome antigo de `fmtVibesNumber` (lib/vibes). */
export const fmtTxills = fmtVibesNumber;
/** «50 vibes» (e «1 vibe»). O nome antigo de `formatVibes` (lib/vibes). */
export const txillsLabel = (n: number): string => formatVibes(n);
/** A barra da Angariação: quanto falta, em 0..1 (pode passar da meta: a barra fica cheia), e «X de Y vibes». */
export function goalProgress(raised: number, goal: number | null | undefined): { pct: number; label: string; done: boolean } | null {
  if (goal == null || !(goal > 0)) return null;
  const r = Math.max(0, Math.round(raised || 0));
  return { pct: Math.min(1, r / goal), label: `${fmtTxills(r)} de ${txillsLabel(goal)}`, done: r >= goal };
}
/** A chave de idempotência de uma oferta (a mesma ao repetir o pedido; nova a cada oferta). */
export function giftKey(now = Date.now(), rnd = Math.random): string {
  return `g${now.toString(36)}${Math.floor(rnd() * 36 ** 8).toString(36).padStart(8, '0')}`;
}
/** A linha destacada «@x ofereceu N vibes» no meio dos comentários. */
export function giftLine(g: TxilladaGift): TxilladaComment {
  return {
    id: `gift:${g.id}`,
    author: { id: '', username: g.from.username, displayName: g.from.displayName, avatarUrl: g.from.avatarUrl, verified: g.from.verified, verifiedTier: g.from.verifiedTier },
    body: `ofereceu ${txillsLabel(g.amount)}`,
    createdAt: g.createdAt,
    gift: { amount: g.amount },
  };
}
export const isGiftLine = (c: Pick<TxilladaComment, 'id' | 'gift'>): boolean => !!c.gift || c.id.startsWith('gift:');
/** Os erros de dinheiro (sem saldo): a app mostra a mensagem e aponta para a carteira. */
export function isInsufficient(e: { status?: number; code?: string; extra?: Record<string, unknown> } | null | undefined): boolean {
  return !!e && e.status === 422 && (e.code === 'insufficient_funds' || e.extra?.code === 'insufficient_funds');
}
/** O preço da roda «AO VIVO» (0167): só numa paga em que ainda não tenho a entrada. */
export function livePrice(u: { live?: { price?: unknown } | null } | null | undefined): number | null {
  const p = u?.live?.price;
  return typeof p === 'number' && p > 0 ? p : null;
}

/** A configuração do servidor diz que a Txillada está ligada? (Sem resposta, ou uma resposta estranha, não está.) */
export function txilladaEnabled(config: unknown): boolean {
  return !!config && typeof config === 'object' && (config as { enabled?: unknown }).enabled === true;
}

/** Os modos de Criar com a TXILLADA no fim (só quando está ligada). */
export function withTxilladaKind<K extends { id: string; label: string }>(kinds: readonly K[], enabled: boolean): (K | { id: 'txillada'; label: string })[] {
  const base = kinds.filter((k) => k.id !== 'txillada');
  return enabled ? [...base, { id: 'txillada', label: 'Txillada' }] : base;
}

/** O título limpo: espaços seguidos passam a um, sem espaços nas pontas, até 80 letras. */
export function cleanTitle(s: string): string {
  return s.replace(/\s+/g, ' ').trim().slice(0, TITLE_MAX);
}
export function titleError(s: string): string | null {
  // O título é opcional (vazio pode); só não passa das TITLE_MAX letras.
  const t = s.replace(/\s+/g, ' ').trim();
  if (t.length > TITLE_MAX) return `O título vai até ${TITLE_MAX} letras.`;
  return null;
}

const STATUSES: readonly string[] = ['live', 'ended', 'cut'];
const str = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Um evento do canal da app é da Txillada? */
export function isTxilladaEvent(e: unknown): boolean {
  return !!e && typeof e === 'object' && typeof (e as { type?: unknown }).type === 'string' && (e as { type: string }).type.startsWith('txillada.');
}

function validComment(c: unknown): c is TxilladaComment {
  if (!c || typeof c !== 'object') return false;
  const x = c as TxilladaComment;
  return str(x.id) && typeof x.body === 'string' && !!x.author && str(x.author.username);
}

/**
 * Lê um evento do canal (JSON já aberto). Só passa o que vem bem formado e, com `id`, só o desta Txillada. Um tipo novo
 * que esta versão não conhece fica de fora (null), não parte o ecrã.
 */
export function parseTxilladaEvent(e: unknown, id?: string): TxilladaEvent | null {
  if (!isTxilladaEvent(e)) return null;
  const x = e as Record<string, unknown> & { type: string };
  if (!str(x.txilladaId) || (id && x.txilladaId !== id)) return null;
  const txilladaId = x.txilladaId;
  switch (x.type) {
    case 'txillada.comment':
      return validComment(x.comment) ? { type: x.type, txilladaId, comment: x.comment } : null;
    case 'txillada.cheer': {
      const from = x.from as { username?: unknown } | undefined;
      return num(x.cheers) ? { type: x.type, txilladaId, cheers: x.cheers, from: { username: str(from?.username) ? from.username : '' } } : null;
    }
    case 'txillada.viewers':
      return num(x.viewers) ? { type: x.type, txilladaId, viewers: Math.max(0, x.viewers) } : null;
    case 'txillada.ended':
      return { type: x.type, txilladaId, status: typeof x.status === 'string' && STATUSES.includes(x.status) && x.status !== 'live' ? (x.status as TxilladaStatus) : 'ended' };
    case 'txillada.comment_removed':
      return str(x.commentId) ? { type: x.type, txilladaId, commentId: x.commentId } : null;
    case 'txillada.comment_cheer':
      return str(x.commentId) && num(x.cheers) ? { type: x.type, txilladaId, commentId: x.commentId, cheers: Math.max(0, Math.floor(x.cheers)) } : null;
    case 'txillada.pinned':
      if (x.comment === null) return { type: x.type, txilladaId, comment: null };
      return validComment(x.comment) ? { type: x.type, txilladaId, comment: x.comment } : null;
    case 'txillada.gift': {
      const g = x.gift as TxilladaGift | undefined;
      if (!g || !str(g.id) || !num(g.amount) || !g.from || !str(g.from.username)) return null;
      return {
        type: x.type, txilladaId, gift: { ...g, createdAt: str(g.createdAt) ? g.createdAt : new Date().toISOString() },
        raised: num(x.raised) ? Math.max(0, x.raised) : 0, goal: num(x.goal) ? x.goal : null, topGivers: giverList(x.topGivers),
      };
    }
    default:
      return null;
  }
}

function giverList(v: unknown): TxilladaGiver[] {
  return Array.isArray(v) ? v.filter((g): g is TxilladaGiver => !!g && typeof g === 'object' && str((g as TxilladaGiver).username) && num((g as TxilladaGiver).total)).slice(0, 3) : [];
}

/** Junta comentários novos aos que já há: sem repetidos, sem os apagados, do mais antigo para o mais recente, os últimos `max`. */
export function mergeComments(list: readonly TxilladaComment[], incoming: readonly TxilladaComment[], removed: readonly string[] = [], max = KEEP_COMMENTS): TxilladaComment[] {
  const out = list.slice();
  const have = new Set(out.map((c) => c.id));
  const gone = new Set(removed);
  for (const c of incoming) {
    if (have.has(c.id) || gone.has(c.id)) continue;
    have.add(c.id);
    out.push(c);
  }
  // Por hora (o canal pode trazer um antes de um pedido que ainda vinha a caminho); com a mesma hora fica a ordem de chegada.
  const order = new Map(out.map((c, i) => [c.id, i]));
  out.sort((a, b) => (Date.parse(a.createdAt) || 0) - (Date.parse(b.createdAt) || 0) || order.get(a.id)! - order.get(b.id)!);
  return out.filter((c) => !gone.has(c.id)).slice(-max);
}

export interface LiveState {
  status: TxilladaStatus | null;
  viewers: number;
  peak: number;
  cheers: number;
  /** Quantos comentários houve ao todo (o número do servidor; sobe com cada comentário novo). */
  commentCount: number;
  comments: TxilladaComment[];
  /** Os comentários apagados (para um pedido atrasado não os trazer de volta). */
  removed: string[];
  /** Sobe a cada brinde de outra pessoa (os copos aparecem); os meus aparecem logo ao tocar. */
  cheerBurst: number;
  lastCheerFrom: string | null;
  /** O comentário fixado pelo anfitrião (fica sempre à vista, em baixo); null sem nenhum. */
  pinned: TxilladaComment | null;
  /** A Angariação (0167): quanto já se juntou, a meta (null sem ela) e quem mais ofereceu. */
  raised: number;
  goal: number | null;
  topGivers: TxilladaGiver[];
  /** Sobe a cada oferta (a animação). */
  giftBurst: number;
}

export function initialLive(dto?: TxilladaDto | null): LiveState {
  const s: LiveState = { status: null, viewers: 0, peak: 0, cheers: 0, commentCount: 0, comments: [], removed: [], cheerBurst: 0, lastCheerFrom: null, pinned: null, raised: 0, goal: null, topGivers: [], giftBurst: 0 };
  return dto ? withDto(s, dto) : s;
}

/** O fixado novo (sem os apagados ou escondidos); devolve o mesmo objeto se não mudou (o mesmo id, brindes e estado). */
function withPinned(s: LiveState, c: TxilladaComment | null | undefined): LiveState {
  if (c === undefined) return s;
  const next = c && !s.removed.includes(c.id) ? c : null;
  const cur = s.pinned;
  if (cur === next || (cur && next && cur.id === next.id && cur.body === next.body && (cur.cheers ?? 0) === (next.cheers ?? 0) && cur.cheered === next.cheered)) return s;
  return { ...s, pinned: next };
}

/**
 * O que a API diz (GET /txilladas/:id): os números do servidor, sem andar para trás nos brindes e no pico (um evento pode
 * ter chegado antes da resposta). Um fim nunca volta a 'live'.
 */
export function withDto(s: LiveState, dto: TxilladaDto): LiveState {
  const status = s.status && s.status !== 'live' ? s.status : dto.status;
  return withPinned({
    ...s,
    status,
    viewers: Math.max(0, dto.viewers),
    peak: Math.max(s.peak, dto.peakViewers, dto.viewers),
    cheers: Math.max(s.cheers, dto.cheers),
    commentCount: Math.max(s.commentCount, dto.comments),
    // A Angariação: o que já se juntou nunca desce (um evento pode ter chegado antes da resposta).
    raised: Math.max(s.raised, typeof dto.raised === 'number' ? dto.raised : 0),
    goal: dto.goal === undefined ? s.goal : dto.goal,
    topGivers: Array.isArray(dto.topGivers) && (dto.raised ?? 0) >= s.raised ? dto.topGivers : s.topGivers,
  }, dto.pinned);
}

/** Os comentários pedidos à API (o arranque ou `?after=`). */
export function withComments(s: LiveState, items: readonly TxilladaComment[]): LiveState {
  const comments = mergeComments(s.comments, items, s.removed);
  return comments.length === s.comments.length && comments.every((c, i) => c === s.comments[i]) ? s : { ...s, comments };
}

/** Um evento do canal. `me`: o meu @ (os meus brindes já fizeram os copos quando toquei). */
export function applyEvent(s: LiveState, ev: TxilladaEvent, me?: string | null): LiveState {
  switch (ev.type) {
    case 'txillada.comment': {
      if (s.removed.includes(ev.comment.id) || s.comments.some((c) => c.id === ev.comment.id)) return s;
      return { ...s, comments: mergeComments(s.comments, [ev.comment], s.removed), commentCount: s.commentCount + 1 };
    }
    case 'txillada.cheer': {
      const mine = !!me && ev.from.username === me;
      return { ...s, cheers: Math.max(s.cheers, ev.cheers), cheerBurst: mine ? s.cheerBurst : s.cheerBurst + 1, lastCheerFrom: mine ? s.lastCheerFrom : ev.from.username || s.lastCheerFrom };
    }
    case 'txillada.viewers':
      return { ...s, viewers: ev.viewers, peak: Math.max(s.peak, ev.viewers) };
    case 'txillada.ended':
      return { ...s, status: ev.status };
    case 'txillada.comment_removed':
      return {
        ...s,
        comments: s.comments.filter((c) => c.id !== ev.commentId),
        removed: s.removed.includes(ev.commentId) ? s.removed : [...s.removed, ev.commentId].slice(-200),
        pinned: s.pinned?.id === ev.commentId ? null : s.pinned,
      };
    case 'txillada.comment_cheer':
      return withCommentCheer(s, ev.commentId, ev.cheers);
    case 'txillada.pinned':
      return withPinned(s, ev.comment);
    case 'txillada.gift': {
      const line = giftLine(ev.gift);
      if (s.comments.some((c) => c.id === line.id)) return s;
      return {
        ...s,
        comments: mergeComments(s.comments, [line], s.removed),
        raised: Math.max(s.raised, ev.raised),
        goal: ev.goal,
        topGivers: ev.raised >= s.raised ? ev.topGivers : s.topGivers,
        giftBurst: s.giftBurst + 1,
      };
    }
  }
}

/** A resposta à minha oferta (antes de o evento chegar): a linha, a barra e o top, como o evento. */
export function withMyGift(s: LiveState, r: { gift: TxilladaGift; raised: number; goal: number | null; topGivers: TxilladaGiver[] }, txilladaId = ''): LiveState {
  return applyEvent(s, { type: 'txillada.gift', txilladaId, gift: r.gift, raised: r.raised, goal: r.goal, topGivers: r.topGivers });
}

/**
 * A contagem de brindes de um comentário (o evento da sala ou a resposta ao meu brinde). `cheered`: o meu estado, só quando
 * fui eu (o evento não diz quem brindou). Um comentário que já não está no ecrã fica como está.
 */
export function withCommentCheer(s: LiveState, commentId: string, cheers: number, cheered?: boolean): LiveState {
  const n = Math.max(0, Math.floor(cheers));
  // O fixado também conta (pode já não estar entre os balões).
  const p = s.pinned;
  const pinned = p && p.id === commentId && ((p.cheers ?? 0) !== n || p.cheered !== (cheered ?? p.cheered)) ? { ...p, cheers: n, cheered: cheered ?? p.cheered } : p;
  const i = s.comments.findIndex((c) => c.id === commentId);
  const c = i < 0 ? null : s.comments[i];
  const mine = cheered ?? c?.cheered;
  if (!c || ((c.cheers ?? 0) === n && c.cheered === mine)) return pinned === p ? s : { ...s, pinned };
  const comments = s.comments.slice();
  comments[i] = { ...c, cheers: n, cheered: mine };
  return { ...s, comments, pinned };
}

/** «3» na pastilha do balão, ao lado do ícone do brinde (nada com 0). */
export function commentCheersLabel(n: number | null | undefined): string {
  const v = typeof n === 'number' && Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
  if (!v) return '';
  return v < 1000 ? String(v) : `${String(Math.round(v / 100) / 10).replace('.', ',')} mil`;
}

/** O id do comentário mais recente (para o `?after=`; as linhas das ofertas não contam: não são comentários). */
export const lastCommentId = (s: LiveState): string | null => {
  for (let i = s.comments.length - 1; i >= 0; i--) if (!isGiftLine(s.comments[i])) return s.comments[i].id;
  return null;
};

/** O que mostrar no ecrã da Txillada. A Txillada não se grava: acabada, já não se vê. */
export type ViewKind = 'loading' | 'live' | 'locked' | 'ended' | 'error';
/** 'locked' (0167): uma Txillada privada a decorrer sem a entrada paga (o cartão com o cadeado; não se liga à sala). */
export function viewKind(dto: TxilladaDto | null | undefined, live: LiveState, failed: boolean): ViewKind {
  if (live.status === 'ended' || live.status === 'cut') return 'ended';
  if (dto && dto.status !== 'live') return 'ended';
  if (failed) return 'error';
  if (dto?.locked) return 'locked';
  return dto ? 'live' : 'loading';
}

export interface LiveUi {
  host: boolean;
  /** O campo para comentar (o servidor diz se posso, com as regras de «quem comenta» do anfitrião). */
  canComment: boolean;
  canCheer: boolean;
  canReport: boolean;
  canShare: boolean;
  /** Virar a câmara, calar o microfone, terminar. */
  canBroadcast: boolean;
  /** Oferecer Txills (0167): quem vê (não o anfitrião), com a entrada. */
  canGift: boolean;
  /** A lista «A ver agora» e os avatares: nas privadas, só o anfitrião. */
  canSeeViewers: boolean;
}
export function liveUi(dto: TxilladaDto | null | undefined): LiveUi {
  const on = !!dto && dto.status === 'live' && !dto.locked;
  const host = !!dto?.isHost;
  return {
    host, canComment: on && dto.canComment, canCheer: on && !host, canReport: !!dto && dto.status === 'live' && !host, canShare: on, canBroadcast: on && host,
    canGift: on && !host, canSeeViewers: host || !dto?.viewersHidden,
  };
}

export type CommentAction = 'remove' | 'ban';
/** O toque longo num comentário: o anfitrião apaga qualquer um e expulsa quem não é ele; o autor só apaga o seu. */
export function commentActions(dto: TxilladaDto | null | undefined, c: TxilladaComment, me?: string | null): CommentAction[] {
  if (!dto || dto.status !== 'live' || isGiftLine(c)) return [];
  if (dto.isHost) return c.author.username === dto.host.username ? ['remove'] : ['remove', 'ban'];
  return me && c.author.username === me ? ['remove'] : [];
}

/** O que o menu de um comentário oferece (tocar num balão ou no fixado), pela ordem em que aparece. */
export type CommentMenuItem = 'reply' | 'cheer' | 'pin' | 'unpin' | 'remove' | 'ban' | 'report';
/**
 * O menu de um comentário (o toque simples, ou o longo, num balão; ou o toque no fixado):
 * - de outra pessoa: «Responder» (se posso comentar), «Brindar» e «Denunciar»;
 * - o anfitrião, além disso: «Fixar» (ou «Tirar o fixado»), «Apagar» e «Expulsar»;
 * - o meu: «Apagar» (e, se sou o anfitrião, fixar).
 * Acabada (ou sem sessão), nada.
 */
export function commentMenu(dto: TxilladaDto | null | undefined, c: TxilladaComment, me: string | null | undefined, pinnedId?: string | null): CommentMenuItem[] {
  // As linhas das ofertas não são comentários: sem menu.
  if (!dto || dto.status !== 'live' || !me || isGiftLine(c)) return [];
  const mine = c.author.username === me;
  const pin: CommentMenuItem = pinnedId === c.id ? 'unpin' : 'pin';
  if (mine) return dto.isHost ? [pin, 'remove'] : ['remove'];
  const out: CommentMenuItem[] = [];
  if (dto.canComment) out.push('reply');
  out.push('cheer');
  if (dto.isHost) out.push(pin, 'remove', 'ban');
  out.push('report');
  return out;
}

/** «Responder a @fulano»: o campo passa a começar por `@fulano ` (troca uma menção que já lá estava no início). */
export function replyText(current: string, username: string): string {
  const rest = current.replace(/^\s*@[\w.]+\s*/, '').replace(/^\s+/, '');
  return `@${username} ${rest}`.slice(0, COMMENT_MAX);
}

/** Pode mandar já outro comentário? `wait`: quantos ms faltam (2 s entre comentários). */
export function commentGate(lastAt: number | null, now: number): { ok: boolean; wait: number } {
  if (lastAt == null) return { ok: true, wait: 0 };
  const wait = Math.max(0, lastAt + COMMENT_GAP_MS - now);
  return { ok: wait === 0, wait };
}

/** Os brindes do último segundo: mais um cabe? (No máximo 5 por segundo; tocar mais depressa não manda nada.) */
export function cheerGate(times: readonly number[], now: number): { ok: boolean; times: number[] } {
  const recent = times.filter((t) => now - t < 1000);
  if (recent.length >= CHEERS_PER_S) return { ok: false, times: recent };
  return { ok: true, times: [...recent, now] };
}

/** O tempo do live: «4:07», «12:30», «1:02:09». */
export function liveClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}
export function elapsed(startedAt: string | null | undefined, now: number, endedAt?: string | null): number {
  const a = startedAt ? Date.parse(startedAt) : NaN;
  if (!Number.isFinite(a)) return 0;
  const b = endedAt ? Date.parse(endedAt) : NaN;
  return Math.max(0, (Number.isFinite(b) ? b : now) - a);
}

/** «1 a ver», «23 a ver», «1,2 mil a ver». */
export function viewersLabel(n: number): string {
  const v = Math.max(0, Math.round(n));
  if (v < 1000) return `${v} a ver`;
  const k = Math.round(v / 100) / 10;
  return `${String(k).replace('.', ',')} mil a ver`;
}

/** O resumo do anfitrião no fim (a Txillada não fica gravada). */
export function liveSummary(dto: TxilladaDto | null | undefined, s: LiveState, now: number): { duration: string; peak: number; cheers: number; comments: number; raised: number; tickets: number | null } {
  return {
    duration: liveClock(elapsed(dto?.startedAt, now, dto?.endedAt)),
    peak: Math.max(s.peak, dto?.peakViewers ?? 0),
    cheers: Math.max(s.cheers, dto?.cheers ?? 0),
    comments: Math.max(s.commentCount, dto?.comments ?? 0),
    raised: Math.max(s.raised, dto?.raised ?? 0),
    tickets: dtoKind(dto) === 'paid' ? (dto?.tickets ?? 0) : null,
  };
}

/** A ligação para partilhar. */
export function shareLink(id: string, base = 'https://txillapp.com'): string {
  return `${(base || 'https://txillapp.com').replace(/\/$/, '')}/txillada/${encodeURIComponent(id)}`;
}
export function shareMessage(dto: Pick<TxilladaDto, 'title' | 'host'>): string {
  return `@${dto.host.username} está ao vivo no Txillapp: ${dto.title}`;
}

/** Os erros da API em palavras para a pessoa (a mensagem do servidor, quando a há, vale mais). */
export function errorText(status: number | undefined, message?: string | null): string {
  const m = message && message !== 'Erro inesperado' ? message : '';
  switch (status) {
    case 402: return m || 'Esta Txillada é privada: paga a entrada para entrar.';
    case 403: return m || 'Não podes ver esta Txillada.';
    case 404: return 'Esta Txillada não existe ou não a podes ver.';
    case 409: return m || 'Já tens uma Txillada a decorrer.';
    case 410: return m || 'A Txillada já acabou.';
    case 422: return m || 'Não deu. Verifica o que escreveste e tenta outra vez.';
    case 429: return m || 'Calma! Espera um bocadinho antes de comentar outra vez.';
    case 503: return m || 'A Txillada ainda não está disponível.';
    default: return m || 'Não consegui ligar à Txillada. Verifica a internet e tenta outra vez.';
  }
}

/** A roda «AO VIVO» da fila dos mimos e do perfil: o id da Txillada a decorrer, ou null. */
export function liveId(u: { live?: { id?: unknown } | null } | null | undefined): string | null {
  const id = u?.live?.id;
  return typeof id === 'string' && id ? id : null;
}

type TrayLike = { isMe: boolean; count: number; live?: { id?: unknown } | null };

/**
 * A fila dos mimos sem o meu: cada entrada com a Txillada que tocar abre (`live`, só com ela ligada). Quem está ao vivo vem
 * primeiro (a ordem do resto não muda); uma entrada só ao vivo (sem mimos, `count: 0`) sai se não houver Txillada para abrir.
 */
export function trayOthers<T extends TrayLike>(users: readonly T[], txilladaOn: boolean): { u: T; live: string | null }[] {
  const rows = users.filter((u) => !u.isMe).map((u) => ({ u, live: txilladaOn ? liveId(u) : null })).filter((r) => r.live || r.u.count > 0);
  return rows.filter((r) => r.live).concat(rows.filter((r) => !r.live));
}

/** Acabou a Txillada `id`: a entrada só ao vivo sai da fila; a que tem mimos fica, sem a roda. */
export function trayWithoutLive<T extends TrayLike>(users: readonly T[] | undefined, id: string): T[] | undefined {
  if (!users) return users;
  return users.filter((u) => !(liveId(u) === id && u.count === 0)).map((u) => (liveId(u) === id ? { ...u, live: null } : u));
}

/** Quem tem mimos para ver (o visor passa de pessoa a pessoa só por estas; as entradas só ao vivo ficam de fora). */
export function withStories<T extends { count: number }>(users: readonly T[]): T[] {
  return users.filter((u) => u.count > 0);
}

/** A notificação `txillada_live`: «abriu uma Txillada: <título>» (o @ vem antes, como nas outras). */
export function noticeText(data: { title?: unknown; reopened?: unknown } | null | undefined): string {
  const t = typeof data?.title === 'string' ? data.title.trim() : '';
  // Reaberta (a Angariação, 0174): «reabriu a Txillada: <título>».
  if (data?.reopened === true) return t ? `reabriu a Txillada: ${t}` : 'reabriu a Txillada';
  return t ? `abriu uma Txillada: ${t}` : 'abriu uma Txillada';
}
export function noticeTarget(data: { txilladaId?: unknown; id?: unknown } | null | undefined): string | null {
  const id = typeof data?.txilladaId === 'string' && data.txilladaId ? data.txilladaId : typeof data?.id === 'string' && data.id ? data.id : null;
  return id ? `/txillada/${encodeURIComponent(id)}` : null;
}
/**
 * A lista das notificações junta `txillada: { status }` (o estado de agora; null se já não existe). Ainda a decorrer:
 * nada a acrescentar; acabada (ou cortada, ou apagada): «Já acabou». Sem o campo (servidor antigo): não se sabe, nada.
 */
export function noticeSub(tx: { status?: unknown } | null | undefined): string | undefined {
  if (!tx || typeof tx !== 'object') return undefined;
  return tx.status === 'live' ? undefined : 'Já acabou';
}
/** A notificação `txillada_invite` (0168): «convidou-te para transmitir na Txillada: <título>» (o @ e o selo vêm antes). */
/**
 * Com `data.mention` (txillada-voltar): mencionaram-me num comentário e eu não estava a ver: «mencionou-te na Txillada de
 * @zeca: vem ver» (ou «mencionou-te na Txillada: vem ver», quando quem mencionou é o próprio anfitrião, `actor`).
 */
export function inviteNoticeText(data: { title?: unknown; mention?: unknown; host?: { username?: unknown } | null } | null | undefined, actor?: string | null): string {
  if (data?.mention === true) {
    const h = typeof data.host?.username === 'string' ? data.host.username : '';
    return h && h.toLowerCase() !== (actor ?? '').toLowerCase() ? `mencionou-te na Txillada de @${h}: vem ver` : 'mencionou-te na Txillada: vem ver';
  }
  const t = typeof data?.title === 'string' ? data.title.trim() : '';
  return t ? `convidou-te para transmitir na Txillada: ${t}` : 'convidou-te para transmitir na Txillada';
}
/** Por baixo: a decorrer, «Entra e aceita o convite» (a menção: «Toca para ver»); acabada, «Já acabou»; sem o estado (servidor antigo), nada. */
export function inviteNoticeSub(tx: { status?: unknown } | null | undefined, data?: { mention?: unknown } | null): string | undefined {
  if (!tx || typeof tx !== 'object') return undefined;
  if (tx.status !== 'live') return 'Já acabou';
  return data?.mention === true ? 'Toca para ver' : 'Entra e aceita o convite';
}

// ─── Os balões a flutuar ───────────────────────────────────────────────────────────────────────────────────────────────

/** No máximo 4 balões à vista; um novo a cada 0,65 s quando chegam muitos; cada um fica 9 s. */
export const FLOAT_MAX = 4;
export const FLOAT_STEP_MS = 650;
export const FLOAT_TTL_MS = 9000;
/** No live os balões ficam à vista muito mais tempo (até os novos os empurrarem): a conversa vê-se sempre por cima do vídeo. */
export const LIVE_FLOAT_TTL_MS = 45_000;
/** Numa enxurrada, os que esperam mais do que isto saltam-se (fica-se sempre perto do que está a acontecer). */
export const FLOAT_QUEUE_MAX = 6;

export interface FloatState { queue: string[]; shown: { id: string; at: number }[]; seen: string[] }
export const floatInit = (): FloatState => ({ queue: [], shown: [], seen: [] });

/** Chegaram comentários (ids, do mais antigo para o mais recente): os que nunca entraram vão para a fila. */
export function floatAdd(s: FloatState, ids: readonly string[]): FloatState {
  const seen = new Set(s.seen);
  const fresh = ids.filter((id) => !seen.has(id));
  if (!fresh.length) return s;
  const queue = [...s.queue, ...fresh].slice(-FLOAT_QUEUE_MAX);
  return { ...s, queue, seen: [...s.seen, ...fresh].slice(-300) };
}

/** Marca como já vistos sem os mostrar (os comentários antigos de quem acabou de entrar, menos os últimos). */
export function floatSkip(s: FloatState, ids: readonly string[]): FloatState {
  const seen = new Set(s.seen);
  const add = ids.filter((id) => !seen.has(id));
  return add.length ? { ...s, seen: [...s.seen, ...add].slice(-300) } : s;
}

/** Uma batida: entra o próximo da fila; os que já saíram (a mais ou passados do tempo) deixam de se desenhar. */
export function floatStep(s: FloatState, now: number, max = FLOAT_MAX, ttl = FLOAT_TTL_MS): FloatState {
  let shown = s.shown.filter((e) => now - e.at < ttl + 600);
  let queue = s.queue;
  if (queue.length) {
    shown = [...shown, { id: queue[0], at: now }];
    queue = queue.slice(1);
  }
  // Fica mais um do que cabe: o que está a sair (desvanece a subir).
  shown = shown.slice(-(max + 1));
  if (queue === s.queue && shown.length === s.shown.length && shown.every((e, i) => e === s.shown[i])) return s;
  return { ...s, queue, shown };
}

/** Ainda há o que animar (a fila ou balões à vista)? Sem nada, o relógio pára. */
export const floatBusy = (s: FloatState): boolean => s.queue.length > 0 || s.shown.length > 0;

/** Apagaram um comentário: sai da fila e dos balões logo. */
export function floatRemove(s: FloatState, id: string): FloatState {
  if (!s.queue.includes(id) && !s.shown.some((e) => e.id === id)) return s;
  return { ...s, queue: s.queue.filter((x) => x !== id), shown: s.shown.filter((e) => e.id !== id) };
}

export type LiveFloatEntry = { id: string; age: number; leaving: boolean };
/** Os balões a desenhar, do mais velho para o mais novo (`age` 0 = o mais novo, em baixo). */
export function floatView(s: FloatState, now: number, max = FLOAT_MAX, ttl = FLOAT_TTL_MS): LiveFloatEntry[] {
  const n = s.shown.length;
  return s.shown.map((e, i) => {
    const age = n - 1 - i;
    return { id: e.id, age, leaving: age >= max || now - e.at >= ttl };
  });
}

/** A distância de cada balão ao fundo da coluna, pela altura medida (ou `fallback`). O que sai sobe mais um bocadinho. */
export function floatLift(entries: readonly LiveFloatEntry[], heights: Readonly<Record<string, number>>, fallback: number, gap: number): Record<string, number> {
  const out: Record<string, number> = {};
  let y = 0;
  for (const e of entries.slice().sort((a, b) => a.age - b.age)) {
    out[e.id] = e.leaving ? y + 14 : y;
    if (!e.leaving) y += (heights[e.id] ?? fallback) + gap;
  }
  return out;
}
