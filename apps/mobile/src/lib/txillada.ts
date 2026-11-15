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

export type TxilladaAudience = 'everyone' | 'followers' | 'close';
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
}

export interface TxilladaComment { id: string; author: TxilladaPerson; body: string; createdAt: string }

export type TxilladaEvent =
  | { type: 'txillada.comment'; txilladaId: string; comment: TxilladaComment }
  | { type: 'txillada.cheer'; txilladaId: string; cheers: number; from: { username: string } }
  | { type: 'txillada.viewers'; txilladaId: string; viewers: number }
  | { type: 'txillada.ended'; txilladaId: string; status: TxilladaStatus }
  | { type: 'txillada.comment_removed'; txilladaId: string; commentId: string };

/** O título vai até 80 letras; um comentário até 300 (o servidor também limpa as palavras proibidas). */
export const TITLE_MAX = 80;
export const COMMENT_MAX = 300;
/** Um comentário de 2 em 2 s por pessoa (o servidor responde 429). */
export const COMMENT_GAP_MS = 2000;
/** Brindes: sem limite por pessoa, mas no máximo 5 por segundo. */
export const CHEERS_PER_S = 5;
/** Quantos comentários se guardam no ecrã (os mesmos 50 que o GET devolve). */
export const KEEP_COMMENTS = 50;
/** A rede de segurança: de quanto em quanto tempo se pergunta à API (se um evento do canal se perder). */
export const POLL_MS = 8000;

export const AUDIENCES: { id: TxilladaAudience; label: string; hint: string }[] = [
  { id: 'everyone', label: 'Todos', hint: 'Quem pode ver o teu perfil' },
  { id: 'followers', label: 'Seguidores', hint: 'Só quem te segue' },
  { id: 'close', label: 'Amigos próximos', hint: 'A tua lista dos mimos' },
];

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
    default:
      return null;
  }
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
}

export function initialLive(dto?: TxilladaDto | null): LiveState {
  const s: LiveState = { status: null, viewers: 0, peak: 0, cheers: 0, commentCount: 0, comments: [], removed: [], cheerBurst: 0, lastCheerFrom: null };
  return dto ? withDto(s, dto) : s;
}

/**
 * O que a API diz (GET /txilladas/:id): os números do servidor, sem andar para trás nos brindes e no pico (um evento pode
 * ter chegado antes da resposta). Um fim nunca volta a 'live'.
 */
export function withDto(s: LiveState, dto: TxilladaDto): LiveState {
  const status = s.status && s.status !== 'live' ? s.status : dto.status;
  return {
    ...s,
    status,
    viewers: Math.max(0, dto.viewers),
    peak: Math.max(s.peak, dto.peakViewers, dto.viewers),
    cheers: Math.max(s.cheers, dto.cheers),
    commentCount: Math.max(s.commentCount, dto.comments),
  };
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
      return { ...s, comments: s.comments.filter((c) => c.id !== ev.commentId), removed: s.removed.includes(ev.commentId) ? s.removed : [...s.removed, ev.commentId].slice(-200) };
  }
}

/** O id do comentário mais recente (para o `?after=`). */
export const lastCommentId = (s: LiveState): string | null => s.comments[s.comments.length - 1]?.id ?? null;

/** O que mostrar no ecrã da Txillada. A Txillada não se grava: acabada, já não se vê. */
export type ViewKind = 'loading' | 'live' | 'ended' | 'error';
export function viewKind(dto: TxilladaDto | null | undefined, live: LiveState, failed: boolean): ViewKind {
  if (live.status === 'ended' || live.status === 'cut') return 'ended';
  if (dto && dto.status !== 'live') return 'ended';
  if (failed) return 'error';
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
}
export function liveUi(dto: TxilladaDto | null | undefined): LiveUi {
  const on = !!dto && dto.status === 'live';
  const host = !!dto?.isHost;
  return { host, canComment: on && dto.canComment, canCheer: on && !host, canReport: on && !host, canShare: on, canBroadcast: on && host };
}

export type CommentAction = 'remove' | 'ban';
/** O toque longo num comentário: o anfitrião apaga qualquer um e expulsa quem não é ele; o autor só apaga o seu. */
export function commentActions(dto: TxilladaDto | null | undefined, c: TxilladaComment, me?: string | null): CommentAction[] {
  if (!dto || dto.status !== 'live') return [];
  if (dto.isHost) return c.author.username === dto.host.username ? ['remove'] : ['remove', 'ban'];
  return me && c.author.username === me ? ['remove'] : [];
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
export function liveSummary(dto: TxilladaDto | null | undefined, s: LiveState, now: number): { duration: string; peak: number; cheers: number; comments: number } {
  return {
    duration: liveClock(elapsed(dto?.startedAt, now, dto?.endedAt)),
    peak: Math.max(s.peak, dto?.peakViewers ?? 0),
    cheers: Math.max(s.cheers, dto?.cheers ?? 0),
    comments: Math.max(s.commentCount, dto?.comments ?? 0),
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
    case 403: return m || 'Não podes ver esta Txillada.';
    case 404: return 'Esta Txillada não existe ou não a podes ver.';
    case 409: return m || 'Já tens uma Txillada a decorrer.';
    case 410: return m || 'A Txillada já acabou.';
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
export function noticeText(data: { title?: unknown } | null | undefined): string {
  const t = typeof data?.title === 'string' ? data.title.trim() : '';
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

// ─── Os balões a flutuar ───────────────────────────────────────────────────────────────────────────────────────────────

/** No máximo 4 balões à vista; um novo a cada 0,65 s quando chegam muitos; cada um fica 9 s. */
export const FLOAT_MAX = 4;
export const FLOAT_STEP_MS = 650;
export const FLOAT_TTL_MS = 9000;
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
export function floatStep(s: FloatState, now: number, max = FLOAT_MAX): FloatState {
  let shown = s.shown.filter((e) => now - e.at < FLOAT_TTL_MS + 600);
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
export function floatView(s: FloatState, now: number, max = FLOAT_MAX): LiveFloatEntry[] {
  const n = s.shown.length;
  return s.shown.map((e, i) => {
    const age = n - 1 - i;
    return { id: e.id, age, leaving: age >= max || now - e.at >= FLOAT_TTL_MS };
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
