/**
 * A Txillada com convidados (até 4 pessoas a transmitir: o anfitrião e até 3 convidados; docs/txillada-contrato.md, 0165):
 * a lógica pura, sem React nem módulos nativos (os testes em tests/txilladaGuests.test.mjs importam este ficheiro).
 *
 * - O estado (`guestsReduce`): quem transmite, os pedidos e os convites à espera (só o anfitrião) e o meu lugar
 *   (só a ver, pedi, fui convidado, a transmitir). Chega pela API (o DTO, de 8 em 8 s) e pelos eventos do canal.
 * - O ecrã (`stageLayout`): 1 pessoa = ecrã inteiro; 2 = uma em cima da outra ao alto (lado a lado num ecrã deitado);
 *   3 = uma grande em cima e duas em baixo; 4 = grelha 2×2. Em quadrados pequenos pede-se a camada de 360p (`tileQuality`).
 * - O que cada um vê (`guestUi`) e os avisos (`guestNotice`).
 */
import type { TxilladaPerson } from '@/lib/txillada';
import { t } from '@/lib/i18n';
import { UNEXPECTED_TEXT } from '@/lib/apiErrors';

/** No máximo 3 convidados ao mesmo tempo (o servidor responde 409 acima disso). */
export const GUESTS_MAX = 3;
/** Uma mudança feita aqui (pedir, aceitar, sair) vale mais do que um DTO pedido antes dela durante este tempo. */
export const LOCAL_GRACE_MS = 4000;

/** O meu lugar: só a ver, pedi para entrar, fui convidado, ou estou a transmitir. */
export type GuestState = 'none' | 'requested' | 'invited' | 'guest';
/** Quem transmite com o anfitrião (`user.id` é o identity dele no LiveKit) e desde quando. */
export interface TxilladaGuest { user: TxilladaPerson; since: string }
/** Um pedido ou um convite à espera (só o anfitrião os vê). */
export interface GuestPending { user: TxilladaPerson; at: string }
type Handle = { username: string; displayName: string; avatarUrl: string | null; verified?: boolean; verifiedTier?: TxilladaPerson['verifiedTier'] };

export type GuestEvent =
  | { type: 'txillada.request'; txilladaId: string; user: TxilladaPerson; requests: GuestPending[]; invites: GuestPending[] }
  | { type: 'txillada.requests'; txilladaId: string; requests: GuestPending[]; invites: GuestPending[] }
  | { type: 'txillada.invite_declined'; txilladaId: string; user: TxilladaPerson }
  | { type: 'txillada.invite'; txilladaId: string; host: Handle }
  | { type: 'txillada.invite_cancelled'; txilladaId: string }
  | { type: 'txillada.request_declined'; txilladaId: string }
  | { type: 'txillada.guest_joined'; txilladaId: string; guest: TxilladaGuest }
  | { type: 'txillada.guest_left'; txilladaId: string; user: TxilladaPerson; reason: 'left' | 'removed' };

const str = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const validPerson = (p: unknown): p is TxilladaPerson => !!p && typeof p === 'object' && str((p as TxilladaPerson).id) && str((p as TxilladaPerson).username);
const validGuest = (g: unknown): g is TxilladaGuest => !!g && typeof g === 'object' && validPerson((g as TxilladaGuest).user);
const pendingList = (v: unknown): GuestPending[] =>
  Array.isArray(v) ? v.filter((x): x is GuestPending => !!x && typeof x === 'object' && validPerson((x as GuestPending).user)) : [];
const guestList = (v: unknown): TxilladaGuest[] => (Array.isArray(v) ? v.filter(validGuest) : []);

/** Lê um evento dos convidados (o JSON do canal). Só o que vem bem formado e, com `id`, só desta Txillada. */
export function parseGuestEvent(e: unknown, id?: string): GuestEvent | null {
  if (!e || typeof e !== 'object') return null;
  const x = e as Record<string, unknown>;
  if (typeof x.type !== 'string' || !str(x.txilladaId) || (id && x.txilladaId !== id)) return null;
  const txilladaId = x.txilladaId;
  switch (x.type) {
    case 'txillada.request':
      return validPerson(x.user) ? { type: x.type, txilladaId, user: x.user, requests: pendingList(x.requests), invites: pendingList(x.invites) } : null;
    case 'txillada.requests':
      return { type: x.type, txilladaId, requests: pendingList(x.requests), invites: pendingList(x.invites) };
    case 'txillada.invite_declined':
      return validPerson(x.user) ? { type: x.type, txilladaId, user: x.user } : null;
    case 'txillada.invite': {
      const h = x.host as Handle | undefined;
      return h && str(h.username) ? { type: x.type, txilladaId, host: h } : null;
    }
    case 'txillada.invite_cancelled':
    case 'txillada.request_declined':
      return { type: x.type, txilladaId };
    case 'txillada.guest_joined':
      return validGuest(x.guest) ? { type: x.type, txilladaId, guest: x.guest } : null;
    case 'txillada.guest_left':
      return validPerson(x.user) ? { type: x.type, txilladaId, user: x.user, reason: x.reason === 'removed' ? 'removed' : 'left' } : null;
    default:
      return null;
  }
}

export interface GuestsState {
  guests: TxilladaGuest[];
  requests: GuestPending[];
  invites: GuestPending[];
  mine: GuestState;
  /** Quem me convidou (o cartão do convite). */
  inviter: Handle | null;
  /** Quando mudei o meu lugar aqui (um DTO mais antigo não o desfaz). */
  localAt: number;
}
export const guestsInit = (): GuestsState => ({ guests: [], requests: [], invites: [], mine: 'none', inviter: null, localAt: 0 });

/** Os convidados por ordem de entrada, sem repetidos. */
function sortGuests(list: readonly TxilladaGuest[]): TxilladaGuest[] {
  const seen = new Set<string>();
  const out: TxilladaGuest[] = [];
  for (const g of list) {
    if (seen.has(g.user.id)) continue;
    seen.add(g.user.id);
    out.push(g);
  }
  return out.sort((a, b) => (Date.parse(a.since) || 0) - (Date.parse(b.since) || 0));
}
const sameGuests = (a: readonly TxilladaGuest[], b: readonly TxilladaGuest[]) => a.length === b.length && a.every((g, i) => g.user.id === b[i].user.id && g.user.username === b[i].user.username);
const samePending = (a: readonly GuestPending[], b: readonly GuestPending[]) => a.length === b.length && a.every((g, i) => g.user.id === b[i].user.id);

type DtoLike = { guests?: unknown; guestState?: unknown; requests?: unknown; invites?: unknown; host?: Handle; isHost?: boolean };
export type GuestsAct =
  | { t: 'dto'; dto: DtoLike; now: number }
  | { t: 'event'; ev: GuestEvent; me: string | null }
  | { t: 'mine'; mine: GuestState; now: number; guests?: TxilladaGuest[] }
  | { t: 'lists'; guests?: unknown; requests?: unknown; invites?: unknown };

const STATES: readonly string[] = ['none', 'requested', 'invited', 'guest'];

export function guestsReduce(s: GuestsState, a: GuestsAct): GuestsState {
  switch (a.t) {
    case 'dto': {
      // Um servidor antigo (sem os campos) não muda nada.
      const guests = a.dto.guests === undefined ? s.guests : sortGuests(guestList(a.dto.guests));
      const requests = a.dto.requests === undefined ? s.requests : pendingList(a.dto.requests);
      const invites = a.dto.invites === undefined ? s.invites : pendingList(a.dto.invites);
      const fresh = typeof a.dto.guestState === 'string' && STATES.includes(a.dto.guestState) ? (a.dto.guestState as GuestState) : s.mine;
      const mine = a.now - s.localAt < LOCAL_GRACE_MS ? s.mine : fresh;
      const inviter = mine === 'invited' ? (s.inviter ?? a.dto.host ?? null) : null;
      if (sameGuests(guests, s.guests) && samePending(requests, s.requests) && samePending(invites, s.invites) && mine === s.mine && inviter === s.inviter) return s;
      return { ...s, guests: sameGuests(guests, s.guests) ? s.guests : guests, requests, invites, mine, inviter };
    }
    case 'mine': {
      const guests = a.guests ? sortGuests(guestList(a.guests)) : s.guests;
      return { ...s, mine: a.mine, localAt: a.now, inviter: a.mine === 'invited' ? s.inviter : null, guests };
    }
    case 'lists':
      return {
        ...s,
        guests: a.guests === undefined ? s.guests : sortGuests(guestList(a.guests)),
        requests: a.requests === undefined ? s.requests : pendingList(a.requests),
        invites: a.invites === undefined ? s.invites : pendingList(a.invites),
      };
    case 'event': {
      const ev = a.ev;
      const isMe = (u: { username: string }) => !!a.me && u.username === a.me;
      switch (ev.type) {
        case 'txillada.request':
        case 'txillada.requests':
          return { ...s, requests: ev.requests, invites: ev.invites };
        case 'txillada.invite_declined':
          return { ...s, invites: s.invites.filter((x) => x.user.id !== ev.user.id) };
        case 'txillada.invite':
          return s.mine === 'guest' ? s : { ...s, mine: 'invited', inviter: ev.host, localAt: 0 };
        case 'txillada.invite_cancelled':
          return s.mine === 'invited' ? { ...s, mine: 'none', inviter: null, localAt: 0 } : s;
        case 'txillada.request_declined':
          return s.mine === 'requested' ? { ...s, mine: 'none', localAt: 0 } : s;
        case 'txillada.guest_joined': {
          const guests = sortGuests([...s.guests.filter((g) => g.user.id !== ev.guest.user.id), ev.guest]);
          const out = { ...s, guests, requests: s.requests.filter((x) => x.user.id !== ev.guest.user.id), invites: s.invites.filter((x) => x.user.id !== ev.guest.user.id) };
          return isMe(ev.guest.user) ? { ...out, mine: 'guest', inviter: null, localAt: 0 } : out;
        }
        case 'txillada.guest_left': {
          const out = { ...s, guests: s.guests.filter((g) => g.user.id !== ev.user.id) };
          return isMe(ev.user) && s.mine === 'guest' ? { ...out, mine: 'none', localAt: 0 } : out;
        }
      }
    }
  }
  return s;
}

/** O aviso a mostrar por um evento (ou null). `host`: sou o anfitrião. */
export function guestNotice(ev: GuestEvent, me: string | null, host: boolean): string | null {
  switch (ev.type) {
    case 'txillada.request':
      return host ? t('@{username} pediu para entrar', { username: ev.user.username }) : null;
    case 'txillada.invite_declined':
      return host ? t('@{username} recusou o convite', { username: ev.user.username }) : null;
    case 'txillada.request_declined':
      return t('O anfitrião recusou o teu pedido');
    case 'txillada.invite_cancelled':
      return t('O anfitrião retirou o convite');
    case 'txillada.guest_joined':
      return me && ev.guest.user.username === me ? t('Estás a transmitir') : t('@{username} entrou no ecrã', { username: ev.guest.user.username });
    case 'txillada.guest_left':
      if (me && ev.user.username === me) return ev.reason === 'removed' ? t('O anfitrião tirou-te de transmitir') : null;
      return host ? t('@{username} saiu do ecrã', { username: ev.user.username }) : null;
    default:
      return null;
  }
}

/** O que mostrar a cada um. */
export interface GuestUi {
  /** Quem vê: «Pedir para entrar». */
  canRequest: boolean;
  /** Pedi e espero (tocar desiste). */
  waiting: boolean;
  /** Fui convidado: o cartão com aceitar e recusar. */
  invited: boolean;
  /** Estou a transmitir: microfone, virar e «Sair do ecrã». */
  onStage: boolean;
  /** O anfitrião: o botão dos convidados (com o número de pedidos). */
  hostPanel: boolean;
  /** Já há 3 a transmitir. */
  full: boolean;
  pending: number;
}
export function guestUi(dto: { status: string; isHost: boolean } | null | undefined, s: GuestsState): GuestUi {
  const on = !!dto && dto.status === 'live';
  const host = on && !!dto?.isHost;
  return {
    canRequest: on && !host && s.mine === 'none',
    waiting: on && !host && s.mine === 'requested',
    invited: on && !host && s.mine === 'invited',
    onStage: on && !host && s.mine === 'guest',
    hostPanel: host,
    full: s.guests.length >= GUESTS_MAX,
    pending: host ? s.requests.length : 0,
  };
}

/** O que o anfitrião pode fazer a alguém da lista «A ver agora»: convidar, já convidado, já a transmitir, ou sem lugar. */
export function viewerGuestAction(s: GuestsState, username: string): 'invite' | 'invited' | 'guest' | 'requested' | 'full' {
  if (s.guests.some((g) => g.user.username === username)) return 'guest';
  if (s.requests.some((g) => g.user.username === username)) return 'requested';
  if (s.invites.some((g) => g.user.username === username)) return 'invited';
  return s.guests.length >= GUESTS_MAX ? 'full' : 'invite';
}

// ─── Convidar por @ (0168) ────────────────────────────────────────────────────────────────────────────────────────────

/** O @ escrito em «Convidar por @»: sem o @ e sem espaços. Null se não é um @ possível (3 a 30: letras, números, _ e .). */
export function inviteHandle(text: string): string | null {
  const t = String(text ?? '').trim().replace(/^@+/, '').trim();
  return /^[A-Za-z0-9_.]{3,30}$/.test(t) ? t : null;
}

/** O que se escreve no campo: só o que cabe num @ (o @ do princípio fica de fora, o campo já o mostra). */
export function inviteInput(text: string): string {
  return String(text ?? '').replace(/^\s*@+/, '').replace(/[^A-Za-z0-9_.]/g, '').slice(0, 30);
}

/**
 * Cada sugestão em «Convidar por @»: o botão à direita. `can`: dá para convidar (senão o rótulo diz porquê). Sem lugar
 * (3 a transmitir) não se convida ninguém novo; quem pediu para entrar aceita-se com o mesmo toque.
 */
export function inviteRow(s: GuestsState, username: string): { label: string; can: boolean } {
  const u = username.toLowerCase();
  const has = (list: readonly { user: { username: string } }[]) => list.some((g) => g.user.username.toLowerCase() === u);
  if (has(s.guests)) return { label: t('A transmitir'), can: false };
  if (has(s.invites)) return { label: t('Convidado'), can: false };
  if (s.guests.length >= GUESTS_MAX) return { label: t('Sem lugar'), can: false };
  if (has(s.requests)) return { label: t('Aceitar'), can: true };
  return { label: t('Convidar'), can: true };
}

/** O aviso depois de convidar: a pessoa recebe o convite no ecrã (se está a ver) ou um aviso que abre a Txillada. */
export function inviteSentText(username: string): string {
  return t('Convite enviado a @{username}', { username });
}

/**
 * Convidar pelo @ não deu: em palavras claras. A mensagem do servidor vale mais (já convidado, já a transmitir, não pode ver,
 * expulso), menos no 404: quem não existe e quem tem um bloqueio contigo respondem o mesmo (não se diz qual).
 */
export function inviteErrorText(e: { status?: number; code?: string; message?: string; extra?: Record<string, unknown> } | null | undefined, username: string): string {
  const code = e?.code ?? (typeof e?.extra?.code === 'string' ? e.extra.code : undefined);
  const m = e?.message && e.message !== UNEXPECTED_TEXT() ? e.message : '';
  switch (e?.status) {
    case 404: return t('Não encontrámos @{username}. Confirma o @ e tenta outra vez.', { username });
    case 409:
      if (code === 'already_invited') return t('Já convidaste @{username}. Espera pela resposta.', { username });
      if (code === 'guests_full' || /Já há \d/.test(m)) return t('Já há {guestsMax} a transmitir contigo. Tira alguém para convidares outra pessoa.', { guestsMax: GUESTS_MAX });
      return m || t('Não deu para convidar @{username}.', { username });
    case 403: return m || t('Não podes convidar @{username} para transmitir.', { username });
    case 400: return m || t('Não deu para convidar @{username}.', { username });
    case 429: return t('Calma! Muitos convites seguidos. Espera um bocadinho.');
    default: return m || t('Não consegui enviar o convite. Verifica a internet e tenta outra vez.');
  }
}

// ─── O ecrã ───────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface Rect { x: number; y: number; w: number; h: number }

/**
 * Os quadrados de `n` pessoas (1 a 4) numa caixa `w×h`, com `gap` entre eles (pela ordem: o anfitrião, depois os convidados
 * por ordem de entrada):
 * - 1: o ecrã inteiro;
 * - 2: ao alto (um telemóvel), uma em cima da outra — cada uma fica quase quadrada e a cara vê-se bem; deitado (um
 *   computador), lado a lado;
 * - 3: o anfitrião grande em cima (metade da altura, a largura toda) e dois em baixo;
 * - 4: grelha 2×2.
 */
export function stageLayout(n: number, w: number, h: number, gap = 2): Rect[] {
  const W = Math.max(0, Math.round(w));
  const H = Math.max(0, Math.round(h));
  const half = (len: number) => Math.floor((len - gap) / 2);
  const rest = (len: number) => len - half(len) - gap;
  const k = Math.max(1, Math.min(4, Math.floor(n) || 1));
  if (k === 1) return [{ x: 0, y: 0, w: W, h: H }];
  if (k === 2) {
    if (H >= W) return [{ x: 0, y: 0, w: W, h: half(H) }, { x: 0, y: half(H) + gap, w: W, h: rest(H) }];
    return [{ x: 0, y: 0, w: half(W), h: H }, { x: half(W) + gap, y: 0, w: rest(W), h: H }];
  }
  const top = half(H);
  const y2 = top + gap;
  const h2 = rest(H);
  const left = { x: 0, y: y2, w: half(W), h: h2 };
  const right = { x: half(W) + gap, y: y2, w: rest(W), h: h2 };
  if (k === 3) return [{ x: 0, y: 0, w: W, h: top }, left, right];
  return [{ x: 0, y: 0, w: half(W), h: top }, { x: half(W) + gap, y: 0, w: rest(W), h: top }, left, right];
}

export type TileQuality = 'high' | 'low';
/**
 * A camada de vídeo a pedir (simulcast): a de 720p quando o quadrado ocupa perto de metade do ecrã ou mais (1 ou 2
 * pessoas, e o grande das 3); a de 360p nos pequenos (os dois de baixo das 3 e os quatro da grelha), para poupar rede.
 */
export function tileQuality(r: Rect, w: number, h: number): TileQuality {
  const area = Math.max(1, w * h);
  return (r.w * r.h) / area >= 0.45 ? 'high' : 'low';
}

/** As pessoas no ecrã, pela ordem dos quadrados: o anfitrião e os convidados (por ordem de entrada, até 3). */
export function stagePeople<P extends { id: string }>(host: P, guests: readonly { user: P }[]): P[] {
  const out: P[] = [host];
  for (const g of guests) if (g.user.id !== host.id && !out.some((p) => p.id === g.user.id) && out.length < 1 + GUESTS_MAX) out.push(g.user);
  return out;
}

/** O identity de quem pode aparecer no ecrã (as faixas dos outros não se recebem: um bloqueio, ou quem já saiu). */
export function stageIds(host: { id: string }, guests: readonly { user: { id: string } }[]): string[] {
  return stagePeople(host, guests).map((p) => p.id);
}

/** A etiqueta do quadrado (o @ com o selo) vai em cima à esquerda; nos de cima, abaixo do cabeçalho do ecrã. */
export function labelOffset(r: Rect, headerBottom: number): number {
  return r.y < 1 ? Math.max(8, headerBottom) : 8;
}
