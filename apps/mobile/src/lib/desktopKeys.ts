/**
 * Teclado e rato no computador: as regras (puras, testadas em tests/desktopKeys.test.mjs) e os ganchos que as ligam.
 *
 * - atalhos globais: «/» ou Ctrl/Cmd+K pesquisa, «n» nova publicação, «g» e depois «h», «m», «p» ou «n» (Início, Mensagens,
 *   Perfil, Notificações), «?» a ajuda. Nunca enquanto se escreve, nem com uma folha ou visor aberto. Nas Mensagens o
 *   Ctrl/Cmd+K é da equipa das Mensagens (procurar conversas): aqui não se apanha;
 * - visores (mimos, Zás, foto em grande): ←/→ anterior e seguinte, espaço pausa, Esc fecha; nas tchekas ↑/↓ (e a roda);
 * - menus: a posição do menu pendente junto ao botão (ou ao rato, no botão direito), sempre dentro da janela.
 * No telemóvel nada disto se liga (useDesktop e/ou `(hover: hover) and (pointer: fine)`).
 */

export type ShortcutAction = 'search' | 'new' | 'home' | 'messages' | 'profile' | 'notifications' | 'help';
export interface KeyLike { key: string; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean; shiftKey?: boolean }
export interface ShortcutCtx { typing: boolean; overlay: boolean; path: string }

/** Quanto tempo a seguir ao «g» se espera pela segunda tecla. */
export const CHORD_MS = 1500;
const CHORD: Record<string, ShortcutAction> = { h: 'home', m: 'messages', p: 'profile', n: 'notifications' };
export const ROUTE_OF: Record<Exclude<ShortcutAction, 'help'>, string> = {
  search: '/search', new: '/new', home: '/', messages: '/messages', profile: '/profile', notifications: '/notifications',
};

/** A lista mostrada na ajuda («?»). */
export const SHORTCUTS: { keys: string[]; label: string }[] = [
  { keys: ['/'], label: 'Pesquisar' },
  { keys: ['Ctrl', 'K'], label: 'Pesquisar (nas Mensagens: procurar conversas)' },
  { keys: ['n'], label: 'Nova publicação' },
  { keys: ['g', 'h'], label: 'Ir para o Início' },
  { keys: ['g', 'm'], label: 'Ir para as Mensagens' },
  { keys: ['g', 'p'], label: 'Ir para o Perfil' },
  { keys: ['g', 'n'], label: 'Ir para as Notificações' },
  { keys: ['←', '→'], label: 'Fotos, mimos e Zás: anterior e seguinte' },
  { keys: ['↑', '↓'], label: 'Tchekas: anterior e seguinte' },
  { keys: ['Espaço'], label: 'Pausar o mimo ou a tcheka' },
  { keys: ['Esc'], label: 'Fechar a folha, o menu ou o visor' },
  { keys: ['?'], label: 'Mostrar estes atalhos' },
];

export const inMessages = (path: string) => path === '/messages' || path.startsWith('/messages/');

/**
 * Que atalho é esta tecla? `chordAt` é quando se carregou no «g» (null se não houve). Devolve a ação (ou null) e o novo
 * `chordAt` (o «g» arma a segunda tecla; qualquer outra tecla desarma-a).
 */
export function shortcutFor(e: KeyLike, ctx: ShortcutCtx, chordAt: number | null, now: number): { action: ShortcutAction | null; chordAt: number | null } {
  const none = { action: null, chordAt: null };
  if (ctx.typing || ctx.overlay) return none;
  const k = e.key;
  const mod = !!(e.ctrlKey || e.metaKey);
  if (mod && !e.altKey && (k === 'k' || k === 'K')) return inMessages(ctx.path) ? none : { action: 'search', chordAt: null };
  if (mod || e.altKey) return none;
  if (chordAt != null && now - chordAt <= CHORD_MS) {
    const a = CHORD[k.toLowerCase()];
    if (a) return { action: a, chordAt: null };
  }
  if (k === '?') return { action: 'help', chordAt: null };
  if (k === '/') return { action: 'search', chordAt: null };
  if (k === 'g' || k === 'G') return { action: null, chordAt: now };
  if (k === 'n' || k === 'N') return { action: 'new', chordAt: null };
  return none;
}

export type ViewerKey = 'prev' | 'next' | 'up' | 'down' | 'pause' | 'close';
/** Teclas dos visores (mimos, Zás, foto em grande, tchekas). Com Ctrl/Cmd/Alt não é connosco (atalhos do browser). */
export function viewerKey(e: KeyLike): ViewerKey | null {
  if (e.ctrlKey || e.metaKey || e.altKey) return null;
  switch (e.key) {
    case 'ArrowLeft': return 'prev';
    case 'ArrowRight': return 'next';
    case 'ArrowUp': return 'up';
    case 'ArrowDown': return 'down';
    case ' ': case 'Spacebar': return 'pause';
    case 'Escape': case 'Esc': return 'close';
    default: return null;
  }
}

/** O alvo da tecla é um sítio onde se escreve (aí as letras e as setas são do texto). */
export function isTypingTarget(el: { tagName?: string; isContentEditable?: boolean; getAttribute?: (n: string) => string | null } | null | undefined): boolean {
  if (!el) return false;
  const tag = (el.tagName ?? '').toUpperCase();
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') {
    const t = (el.getAttribute?.('type') ?? 'text').toLowerCase();
    return !['checkbox', 'radio', 'button', 'submit', 'range', 'color', 'file'].includes(t);
  }
  return !!el.isContentEditable;
}

export interface Rect { x: number; y: number; w: number; h: number }
/**
 * Onde abre o menu pendente: por baixo do botão, alinhado à direita dele (os «⋯» estão à direita), e para cima ou para a
 * esquerda se não couber. Nunca sai da janela (margem de 8).
 */
export function menuPosition(anchor: Rect, size: { w: number; h: number }, view: { w: number; h: number }, gap = 6): { left: number; top: number } {
  const m = 8;
  let left = anchor.x + anchor.w - size.w;
  if (left < m) left = anchor.x;
  left = Math.max(m, Math.min(left, view.w - size.w - m));
  let top = anchor.y + anchor.h + gap;
  if (top + size.h > view.h - m) {
    const above = anchor.y - gap - size.h;
    top = above >= m ? above : Math.max(m, view.h - size.h - m);
  }
  return { left: Math.round(left), top: Math.round(top) };
}

/** Rato a sério (não um ecrã tátil): a condição das coisas «de computador». */
export const finePointer = () =>
  typeof document !== 'undefined' && typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(hover: hover) and (pointer: fine)').matches;

/** Há uma folha, menu ou visor aberto por cima (o Modal do react-native-web põe aria-modal). */
export const overlayOpen = () => typeof document !== 'undefined' && !!document.querySelector('[aria-modal="true"]');

/** Onde foi o último clique (para o menu abrir junto ao botão mesmo quando o evento do toque já não traz o elemento). */
let lastDown: { x: number; y: number } | null = null;
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('pointerdown', (e) => { lastDown = { x: e.clientX, y: e.clientY }; }, { capture: true, passive: true });
}
const CLICKABLE = '[role="button"],[role="link"],[role="menuitem"],[role="tab"]';
type ElLike = { getBoundingClientRect?: () => DOMRect; closest?: (s: string) => ElLike | null };
const rectOfEl = (el: ElLike | null | undefined): Rect | null => {
  const box = el?.closest?.(CLICKABLE) ?? el;
  if (!box?.getBoundingClientRect) return null;
  const r = box.getBoundingClientRect();
  return r.width || r.height ? { x: r.left, y: r.top, w: r.width, h: r.height } : null;
};

/** O retângulo (na janela) do botão que recebeu o toque, para o menu abrir junto a ele. Na app nativa: null. */
export function anchorOf(e: unknown): Rect | null {
  if (typeof document === 'undefined') return null;
  const ev = e as { currentTarget?: ElLike; target?: ElLike; nativeEvent?: { target?: ElLike; clientX?: number; clientY?: number; pageX?: number; pageY?: number } } | null;
  const direct = rectOfEl(ev?.currentTarget) ?? rectOfEl(ev?.target) ?? rectOfEl(ev?.nativeEvent?.target);
  if (direct) return direct;
  // O evento já não traz o elemento: o que está onde se clicou.
  const pt = lastDown ?? (typeof ev?.nativeEvent?.clientX === 'number' ? { x: ev.nativeEvent.clientX, y: ev.nativeEvent.clientY ?? 0 } : null);
  if (!pt) return null;
  const hit = rectOfEl(document.elementFromPoint?.(pt.x, pt.y) as unknown as ElLike);
  return hit ?? { x: pt.x, y: pt.y, w: 0, h: 0 };
}

/**
 * A roda do rato como «seguinte/anterior» (tchekas): um passo por gesto, com uma pausa para o deslize do trackpad não
 * saltar várias de uma vez. Devolve -1, 0 ou 1.
 */
export function wheelStep(state: { acc: number; until: number }, dy: number, now: number, threshold = 40, quiet = 450): -1 | 0 | 1 {
  if (now < state.until) { state.acc = 0; state.until = Math.max(state.until, now + 150); return 0; }
  state.acc += dy;
  if (Math.abs(state.acc) < threshold) return 0;
  const dir = state.acc > 0 ? 1 : -1;
  state.acc = 0;
  state.until = now + quiet;
  return dir;
}

export interface RectZoom { scale: number; x: number; y: number }
/**
 * Zoom com a roda numa foto retangular (visor de fotos no computador): à volta do cursor (fx, fy, a partir do centro),
 * entre 1× e 5×, e sem a borda da foto entrar no visor (`photo` é o tamanho da foto a 1×, `view` o do visor).
 */
export function rectZoomAt(z: RectZoom, factor: number, fx: number, fy: number, photo: { w: number; h: number }, view: { w: number; h: number }): RectZoom {
  const next = Math.max(1, Math.min(5, z.scale * factor));
  if (next < 1.01) return { scale: 1, x: 0, y: 0 };
  const k = next / z.scale;
  return clampRectPan({ scale: next, x: fx - (fx - z.x) * k, y: fy - (fy - z.y) * k }, photo, view);
}
export function clampRectPan(z: RectZoom, photo: { w: number; h: number }, view: { w: number; h: number }): RectZoom {
  const lx = Math.max(0, (photo.w * z.scale - view.w) / 2);
  const ly = Math.max(0, (photo.h * z.scale - view.h) / 2);
  return { scale: z.scale, x: Math.max(-lx, Math.min(lx, z.x)) + 0, y: Math.max(-ly, Math.min(ly, z.y)) + 0 };
}

/** Quantas colunas tem a grelha (perfil, explorar): 3 no telemóvel; no computador, mais quando a coluna é larga. */
export function gridColumns(width: number, desktop: boolean): number {
  if (!desktop) return 3;
  return width >= 1100 ? 5 : width >= 720 ? 4 : 3;
}

/** Setas num grupo de separadores (role=tablist): -1 anterior, 1 seguinte, null outra tecla. */
export function tabArrow(e: KeyLike): -1 | 1 | null {
  if (e.ctrlKey || e.metaKey || e.altKey) return null;
  return e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : null;
}
