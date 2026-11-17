/**
 * A Txillada moderna (docs/txillada-contrato.md): a lógica pura das reações, de quem está a ver e do ecrã inteiro, sem
 * React nem módulos nativos (testada em tests/txilladaFx.test.mjs). Quem a usa: lib/txilladaFxRoom.ts e
 * components/txillada/*.
 *
 * - As reações rápidas (👋 🍻 🔥 😂 ❤️): cada toque solta um leque de emojis que sobem a flutuar pelo lado direito
 *   (`fxBurst`, `fxAdd`, `fxAlive`). Não se guardam: só passam em tempo real (o 🍻 conta como um brinde).
 * - «@fulano entrou»: em fila e agrupado (`joinAdd`, `joinStep`, `joinedText`), para não inundar o ecrã.
 * - Os olás: «@fulano: Olá 👋» (balão curto) e a saudação do anfitrião em grande (`helloOf`).
 * - O vídeo em ecrã inteiro: cover quando a imagem tem a forma do ecrã; senão inteira, com o fundo desfocado (`videoFit`).
 */

import { t } from '@/lib/i18n';
export type ReactionKind = 'hello' | 'cheers' | 'fire' | 'laugh' | 'heart';

export const REACTIONS: readonly { kind: ReactionKind; emoji: string; label: string; a11y: string }[] = [
  { kind: 'hello', emoji: '👋', get label() { return t('Olá'); }, get a11y() { return t('Dizer olá'); } },
  { kind: 'cheers', emoji: '🍻', label: '', get a11y() { return t('Brindar'); } },
  { kind: 'fire', emoji: '🔥', label: '', get a11y() { return t('Fogo'); } },
  { kind: 'laugh', emoji: '😂', label: '', get a11y() { return t('A rir'); } },
  { kind: 'heart', emoji: '❤️', label: '', get a11y() { return t('Gosto'); } },
];
const KINDS: readonly string[] = REACTIONS.map((r) => r.kind);
export const emojiOf = (k: ReactionKind): string => REACTIONS.find((r) => r.kind === k)?.emoji ?? '❤️';

/** Uma pessoa como vem nos eventos e na lista «A ver agora» (sem ids internos). */
export interface FxPerson { username: string; displayName: string; avatarUrl: string | null; verified?: boolean; verifiedTier?: 'verified' | 'official' | 'paid' | null }

/** Um @ com o selo (as contas verificadas aparecem sempre com o selo, em todo o lado). */
export type FxHandle = Pick<FxPerson, 'username' | 'verified' | 'verifiedTier'>;

export type FxEvent =
  | { type: 'txillada.reaction'; txilladaId: string; kind: ReactionKind; from: FxPerson & { host: boolean }; to: FxHandle | null }
  | { type: 'txillada.joined'; txilladaId: string; user: FxPerson };

const str = (v: unknown): v is string => typeof v === 'string' && v.length > 0;

function person(v: unknown): FxPerson | null {
  if (!v || typeof v !== 'object') return null;
  const x = v as Record<string, unknown>;
  if (!str(x.username)) return null;
  const tier = x.verifiedTier;
  return {
    username: x.username,
    displayName: str(x.displayName) ? x.displayName : x.username,
    avatarUrl: str(x.avatarUrl) ? x.avatarUrl : null,
    verified: x.verified === true,
    verifiedTier: tier === 'verified' || tier === 'official' || tier === 'paid' ? tier : null,
  };
}

/** Lê `txillada.reaction` e `txillada.joined` (só os desta Txillada e bem formados; o resto fica de fora). */
export function parseFxEvent(e: unknown, id?: string): FxEvent | null {
  if (!e || typeof e !== 'object') return null;
  const x = e as Record<string, unknown>;
  if (!str(x.txilladaId) || (id && x.txilladaId !== id)) return null;
  if (x.type === 'txillada.reaction') {
    if (typeof x.kind !== 'string' || !KINDS.includes(x.kind)) return null;
    const from = person(x.from);
    if (!from) return null;
    const t = person(x.to);
    const to: FxHandle | null = t ? { username: t.username, verified: t.verified, verifiedTier: t.verifiedTier } : null;
    return { type: 'txillada.reaction', txilladaId: x.txilladaId, kind: x.kind as ReactionKind, from: { ...from, host: (x.from as { host?: unknown }).host === true }, to };
  }
  if (x.type === 'txillada.joined') {
    const user = person(x.user);
    return user ? { type: 'txillada.joined', txilladaId: x.txilladaId, user } : null;
  }
  return null;
}

// ─── As reações a flutuar ─────────────────────────────────────────────────────────────────────────────────────────────

/** Um emoji a subir: `x` desvio lateral final (px, negativo = para a esquerda), `rot` graus, `scale` final, `delay`/`dur` ms. */
export interface FxParticle { id: string; emoji: string; at: number; delay: number; dur: number; x: number; rot: number; scale: number; size: number }

/** No máximo tantos emojis no ar (os mais antigos saem primeiro); um toque solta um leque de 3 (os dos outros, 2). */
export const FX_MAX = 28;
export const FX_DUR_MS = 2600;
export const FX_REDUCED_MS = 1200;

/** Um número pseudoaleatório de 0 a 1 a partir de uma semente (o mesmo toque dá sempre o mesmo leque; testável). */
export function rand(seed: number): number {
  const s = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return s - Math.floor(s);
}

/**
 * O leque de um toque: `n` emojis que saem quase juntos (40 ms entre eles) e abrem em leque para a esquerda (sobem pelo lado
 * direito e afastam-se da margem), cada um com o seu tamanho, rotação e duração. `reduce`: «reduzir movimento» — um só,
 * sem rodar nem abrir, mais curto.
 */
export function fxBurst(kind: ReactionKind, seed: number, now: number, o: { n?: number; reduce?: boolean } = {}): FxParticle[] {
  const emoji = emojiOf(kind);
  if (o.reduce) return [{ id: `${seed}-0`, emoji, at: now, delay: 0, dur: FX_REDUCED_MS, x: 0, rot: 0, scale: 1, size: 30 }];
  const n = Math.max(1, Math.min(5, o.n ?? 3));
  const out: FxParticle[] = [];
  for (let i = 0; i < n; i++) {
    const r1 = rand(seed + i * 7.1);
    const r2 = rand(seed + i * 13.7 + 1);
    const r3 = rand(seed + i * 3.3 + 2);
    // O leque: de 0 (a direito) até -70 px, com um pouco de sorte à mistura.
    const spread = n === 1 ? 0.5 : i / (n - 1);
    out.push({
      id: `${seed}-${i}`,
      emoji,
      at: now,
      delay: i * 40,
      dur: Math.round(FX_DUR_MS * (0.85 + 0.3 * r1)),
      x: Math.round(-8 - spread * 56 - r2 * 14),
      rot: Math.round((r3 - 0.5) * 50),
      scale: Math.round((0.9 + r1 * 0.5) * 100) / 100,
      size: Math.round(28 + r2 * 10),
    });
  }
  return out;
}

/** Junta um leque aos que já estão no ar: tira os que já acabaram e fica com os últimos `max`. */
export function fxAdd(list: readonly FxParticle[], add: readonly FxParticle[], now: number, max = FX_MAX): FxParticle[] {
  return [...fxAlive(list, now), ...add].slice(-max);
}
/** Os que ainda estão no ar. */
export function fxAlive(list: readonly FxParticle[], now: number): FxParticle[] {
  const out = list.filter((p) => now - p.at < p.delay + p.dur + 100);
  return out.length === list.length ? (list as FxParticle[]) : out;
}

/** Os meus toques: no máximo 8 por segundo (como o servidor); o 👋 de quem vê, 1 a cada 4 s. */
export const REACT_PER_S = 8;
export const HELLO_GAP_MS = 4000;
export function reactGate(times: readonly number[], now: number, kind: ReactionKind, lastHello: number | null, host: boolean): { ok: boolean; times: number[] } {
  const recent = times.filter((t) => now - t < 1000);
  if (recent.length >= REACT_PER_S) return { ok: false, times: recent };
  if (kind === 'hello' && !host && lastHello != null && now - lastHello < HELLO_GAP_MS) return { ok: false, times: recent };
  return { ok: true, times: [...recent, now] };
}

// ─── «@fulano entrou» ─────────────────────────────────────────────────────────────────────────────────────────────────

/** Quem entra espera um bocadinho (para se juntar a quem entra logo a seguir); cada aviso fica 3 s. */
export const JOIN_WAIT_MS = 900;
export const JOIN_SHOW_MS = 3200;
export interface JoinState { buf: { user: FxPerson; at: number }[]; shown: { users: FxPerson[]; at: number } | null }
export const joinInit = (): JoinState => ({ buf: [], shown: null });

/** Alguém entrou (sem repetir quem já está à espera ou à vista; eu não conto). */
export function joinAdd(s: JoinState, user: FxPerson, now: number, me?: string | null): JoinState {
  if (me && user.username === me) return s;
  if (s.buf.some((b) => b.user.username === user.username)) return s;
  return { ...s, buf: [...s.buf, { user, at: now }].slice(-50) };
}

/** Uma batida: o aviso à vista sai ao fim de 3 s; sem aviso, os que esperam juntam-se num só. */
export function joinStep(s: JoinState, now: number): JoinState {
  let shown = s.shown;
  if (shown && now - shown.at >= JOIN_SHOW_MS) shown = null;
  if (!shown && s.buf.length && now - s.buf[0].at >= JOIN_WAIT_MS) return { buf: [], shown: { users: s.buf.map((b) => b.user), at: now } };
  return shown === s.shown ? s : { ...s, shown };
}
export const joinBusy = (s: JoinState): boolean => s.buf.length > 0 || !!s.shown;

/** Um texto com @ (cada @ desenha-se com o selo, se a conta for verificada). */
export type TextPart = { t: 'text'; s: string } | { t: 'user'; u: FxHandle };
export const partsText = (parts: readonly TextPart[]): string => parts.map((p) => (p.t === 'text' ? p.s : `@${p.u.username}`)).join('');
const at = (u: FxHandle): TextPart => ({ t: 'user', u: { username: u.username, verified: !!u.verified, verifiedTier: u.verifiedTier ?? null } });
const tx = (s: string): TextPart => ({ t: 'text', s });

/** «@a entrou», «@a e @b entraram», «@a, @b e @c entraram», «@a, @b e mais 3 entraram». */
export function joinedParts(users: readonly FxHandle[]): TextPart[] {
  const n = users.length;
  if (n === 0) return [];
  if (n === 1) return [at(users[0]), tx(' entrou')];
  if (n === 2) return [at(users[0]), tx(' e '), at(users[1]), tx(' entraram')];
  if (n === 3) return [at(users[0]), tx(', '), at(users[1]), tx(' e '), at(users[2]), tx(' entraram')];
  return [at(users[0]), tx(', '), at(users[1]), tx((' ' + t('e mais {n} entraram', { n: n - 2 })))];
}
export const joinedText = (users: readonly FxHandle[]): string => partsText(joinedParts(users));

// ─── Os olás ──────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface Hello { id: string; at: number; parts: TextPart[]; text: string; avatar: FxPerson; big: boolean }
export const HELLO_MS = 3500;
export const BIG_HELLO_MS = 2800;

/**
 * O que um 👋 mostra: do anfitrião sem destinatário, a saudação em grande («@ana diz olá a todos 👋»); do anfitrião a
 * alguém, «@ana: Olá @rui 👋»; de quem vê, «@rui: Olá 👋». Os outros emojis não têm balão (só sobem a flutuar).
 */
export function helloOf(e: Extract<FxEvent, { type: 'txillada.reaction' }>, id: string, now: number): Hello | null {
  if (e.kind !== 'hello') return null;
  const big = e.from.host && !e.to;
  const parts = big ? [at(e.from), tx((' ' + t('diz olá a todos 👋')))] : e.to ? [at(e.from), tx((t(': Olá') + ' ')), at(e.to), tx(' 👋')] : [at(e.from), tx(t(': Olá 👋'))];
  return { id, at: now, parts, text: partsText(parts), avatar: e.from, big };
}
/** Junta um olá (no máximo 3 balões à vista; os mais antigos e os passados do tempo saem). */
export function helloAdd(list: readonly Hello[], h: Hello, now: number): Hello[] {
  const alive = helloAlive(list, now);
  const bigs = h.big ? [h] : alive.filter((x) => x.big);
  const smalls = [...alive.filter((x) => !x.big), ...(h.big ? [] : [h])].slice(-3);
  return [...bigs, ...smalls];
}
export function helloAlive(list: readonly Hello[], now: number): Hello[] {
  const out = list.filter((h) => now - h.at < (h.big ? BIG_HELLO_MS : HELLO_MS));
  return out.length === list.length ? (list as Hello[]) : out;
}

// ─── Quem está a ver ──────────────────────────────────────────────────────────────────────────────────────────────────

/** Os avatares empilhados ao lado do contador: os primeiros `max` e quantos ficam de fora. */
export function viewerStack<T>(items: readonly T[], total: number, max = 3): { shown: T[]; more: number; count: number } {
  const count = Math.max(total, items.length);
  const shown = items.slice(0, max);
  return { shown, more: Math.max(0, count - shown.length), count };
}

/** Quem acabou de entrar passa para a frente da lista «A ver agora» (até a API responder outra vez). */
export function withJoined(items: readonly FxPerson[], user: FxPerson): FxPerson[] {
  return [user, ...items.filter((u) => u.username !== user.username)];
}

// ─── O ecrã inteiro ───────────────────────────────────────────────────────────────────────────────────────────────────

export type VideoFit = 'cover' | 'contain';

/**
 * Como mostrar um vídeo `vw×vh` num ecrã `sw×sh`. Cover (enche de ponta a ponta) quando a forma da imagem é parecida com a
 * do ecrã (um vídeo ao alto num telemóvel, um deitado num computador): corta pouco. Senão a imagem inteira (contain), com
 * o fundo desfocado do próprio vídeo atrás — nunca se corta quase tudo (uma faixa deitada num telemóvel) nem ficam barras
 * pretas. Sem medidas ainda (0), cover.
 */
export function videoFit(vw: number, vh: number, sw: number, sh: number): VideoFit {
  if (!(vw > 0 && vh > 0 && sw > 0 && sh > 0)) return 'cover';
  const r = vw / vh / (sw / sh);
  return r >= 0.72 && r <= 1.45 ? 'cover' : 'contain';
}

/**
 * Onde ficam os controlos por cima do vídeo. No telemóvel ocupam a largura toda (com as margens seguras); no computador
 * (`wide`) ficam numa coluna ao centro da largura do vídeo ao alto (altura × 9/16, entre 400 e 560 px), com o vídeo e o
 * fundo desfocado à volta.
 */
export function liveLayout(o: { w: number; h: number; top: number; bottom: number; left?: number; right?: number; wide: boolean }) {
  const colW = o.wide ? Math.round(Math.min(o.w, Math.max(400, Math.min(560, (o.h * 9) / 16)))) : o.w;
  const colLeft = o.wide ? Math.round((o.w - colW) / 2) : 0;
  const padTop = Math.max(o.top, o.wide ? 16 : 10) + 6;
  const padBottom = Math.max(o.bottom, 10) + 6;
  const side = Math.max(12, o.left ?? 0, o.right ?? 0);
  return {
    colLeft,
    colW,
    padTop,
    padBottom,
    side,
    /** Os comentários a flutuar: à esquerda, até 72 % da coluna. */
    floatW: Math.max(200, Math.min(380, Math.round(colW * 0.72))),
    /** A faixa por onde sobem as reações: à direita. */
    fxW: 92,
  };
}
