/**
 * Computador (browser com rato): a roda e a barra de deslocamento como numa página normal.
 *
 * O react-native-web põe `overflow: hidden` no body e cada ecrã rola dentro do seu próprio ScrollView, que no computador
 * é só a coluna do meio (576 a 935 px). Sem isto, a roda por cima da barra lateral, das margens ou da coluna da direita não
 * fazia nada, e a barra de deslocamento estava escondida (showsVerticalScrollIndicator={false}): parecia que não havia scroll.
 *
 * - a roda fora de qualquer coisa que role passa para a lista principal do ecrã (a que está no meio de `#tx-main`);
 * - essa lista fica com uma barra de deslocamento fina e visível (`data-tx-scroll`).
 *
 * No telemóvel (e no PWA do telemóvel) não se instala: só com `(hover: hover) and (pointer: fine)`.
 */

/** Ecrãs com a sua própria roda (tchekas, mimos, mapa) ou de outra equipa (Mensagens): aqui não se mexe. */
const OWN_WHEEL = /^\/(messages|reels|r\/|stories\/|m\/|perto|new|call)/;
export const deskScrollSkips = (path: string) => OWN_WHEEL.test(path);

/** Pixels de um evento de roda (algumas ratos mandam linhas ou páginas). */
export function wheelPixels(e: { deltaY: number; deltaMode?: number }, page = 800): number {
  if (e.deltaMode === 1) return e.deltaY * 16;
  if (e.deltaMode === 2) return e.deltaY * page;
  return e.deltaY;
}

export interface ScrollNode {
  parentElement: ScrollNode | null;
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}
type Style = (el: ScrollNode) => { overflowY: string };

/** Este elemento rola na vertical (tem overflow auto/scroll e conteúdo a mais)? */
export const scrollsY = (el: ScrollNode, style: Style) => /(auto|scroll)/.test(style(el).overflowY) && el.scrollHeight > el.clientHeight + 1;

/** Pode ainda andar nesse sentido (para baixo com dy > 0, para cima com dy < 0)? */
export const canMove = (el: ScrollNode, dy: number) => (dy > 0 ? el.scrollTop + el.clientHeight < el.scrollHeight - 1 : el.scrollTop > 0);

/** O primeiro antepassado (ou o próprio) que rola na vertical. */
export function scrollerOf(start: ScrollNode | null, style: Style, stop?: ScrollNode | null): ScrollNode | null {
  for (let el = start, k = 0; el && k < 60; el = el.parentElement, k++) {
    if (el === stop) return null;
    if (scrollsY(el, style)) return el;
  }
  return null;
}

/** O browser já trata esta roda (há por cima do rato alguma coisa que role nesse sentido)? */
export function nativeHandles(target: ScrollNode | null, dy: number, style: Style): boolean {
  for (let el = target, k = 0; el && k < 60; el = el.parentElement, k++) if (scrollsY(el, style) && canMove(el, dy)) return true;
  return false;
}

const CSS = `[data-tx-scroll]{scrollbar-width:thin!important;scrollbar-color:rgba(24,24,27,.28) transparent}
[data-tx-scroll]::-webkit-scrollbar{display:block!important;width:10px}
[data-tx-scroll]::-webkit-scrollbar-thumb{background:rgba(24,24,27,.24);border-radius:8px;border:2px solid transparent;background-clip:padding-box}
[data-tx-scroll]::-webkit-scrollbar-thumb:hover{background-color:rgba(24,24,27,.4)}`;

export const finePointer = () =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(hover: hover) and (pointer: fine)').matches;

/** A lista principal do ecrã: a que rola no meio da coluna `#tx-main` (sem modal aberta). */
function mainScroller(): HTMLElement | null {
  const main = document.getElementById('tx-main');
  if (!main) return null;
  const r = main.getBoundingClientRect();
  const x = Math.round(r.left + r.width / 2);
  const style = (el: ScrollNode) => getComputedStyle(el as unknown as HTMLElement);
  for (const fy of [0.5, 0.7, 0.3, 0.9]) {
    const y = Math.round(Math.max(r.top, 0) + (Math.min(r.bottom, window.innerHeight) - Math.max(r.top, 0)) * fy);
    const hit = document.elementFromPoint(x, y) as unknown as ScrollNode | null;
    if (!hit || !main.contains(hit as unknown as Node)) continue;
    const s = scrollerOf(hit, style);
    if (s && main.contains(s as unknown as Node)) return s as unknown as HTMLElement;
  }
  return null;
}

let installed = false;

/** Liga a roda das margens e a barra visível (uma vez, na web com rato). Devolve a função que desliga. */
export function installDeskScroll(): () => void {
  if (installed || typeof window === 'undefined' || typeof document === 'undefined' || !finePointer()) return () => undefined;
  installed = true;
  const tag = document.createElement('style');
  tag.setAttribute('data-tx', 'desk-scroll');
  tag.textContent = CSS;
  document.head.appendChild(tag);
  const style = (el: ScrollNode) => getComputedStyle(el as unknown as HTMLElement);
  let marked: HTMLElement | null = null;
  const mark = () => {
    if (deskScrollSkips(location.pathname)) return null;
    const s = mainScroller();
    if (s && s !== marked) {
      marked?.removeAttribute('data-tx-scroll');
      s.setAttribute('data-tx-scroll', '');
      marked = s;
    }
    return s;
  };
  const onWheel = (e: WheelEvent) => {
    if (e.defaultPrevented || e.ctrlKey || Math.abs(e.deltaY) < Math.abs(e.deltaX)) return;
    if (deskScrollSkips(location.pathname)) return;
    // Uma folha ou um visor aberto: a roda é dele.
    if (document.querySelector('[aria-modal="true"]')) return;
    const dy = wheelPixels(e, window.innerHeight * 0.8);
    if (!dy || nativeHandles(e.target as unknown as ScrollNode, dy, style)) return;
    const s = mark();
    if (s && canMove(s as unknown as ScrollNode, dy)) s.scrollBy({ top: dy, left: 0, behavior: 'auto' });
  };
  let last = 0;
  const onMove = () => {
    const now = Date.now();
    if (now - last < 700) return;
    last = now;
    mark();
  };
  window.addEventListener('wheel', onWheel, { passive: true });
  window.addEventListener('mousemove', onMove, { passive: true });
  const first = setTimeout(mark, 1200);
  return () => {
    clearTimeout(first);
    window.removeEventListener('wheel', onWheel);
    window.removeEventListener('mousemove', onMove);
    tag.remove();
    marked?.removeAttribute('data-tx-scroll');
    installed = false;
  };
}
