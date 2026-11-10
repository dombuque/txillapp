/**
 * Arbitragem dos deslizes horizontais (sobretudo na web; o "pager interno" em baixo serve também o telemóvel). Um componente que trata o gesto em curso (linha com swipe, carrossel,
 * visor) chama claimSwipe() durante o gesto; a navegação entre separadores (lib/swipeTabs) não muda de menu nesse gesto.
 * releaseSwipe() devolve o gesto (ex.: a linha passou o limite e o gesto passa a ser de navegação).
 */
let claimed = false;
export function claimSwipe(): void { claimed = true; }
export function releaseSwipe(): void { claimed = false; }
export function isSwipeClaimed(): boolean { return claimed; }
/** Reposto no início de cada toque (lib/swipeTabs chama-o no touchstart, em fase de captura). */
export function resetSwipeClaim(): void { claimed = false; }
/**
 * A partir desta distância horizontal (px) o gesto é de mudar de menu (ou de separador), mesmo começando numa linha com swipe.
 * Na web lê a largura da janela; no telemóvel (onde `window.innerWidth` não existe) passa-se a largura do ecrã.
 */
export function navSwipeThreshold(width?: number): number {
  const w = width ?? (typeof window !== 'undefined' ? window.innerWidth : 0);
  return Math.max(140, Math.round((w || 0) * 0.4));
}

/**
 * "Pager interno": um ecrã com separadores próprios (ex.: Mensagens, com Conversas, TxillGroups e Pedidos) regista-se aqui
 * enquanto está à vista. Um deslize grande muda primeiro de separador dentro do ecrã; só quando já está no primeiro/último
 * e se desliza para fora é que o gesto passa para fora (na web, mudar de menu da barra de baixo).
 * `dir = 1` = separador seguinte (o dedo vai para a esquerda); `dir = -1` = o anterior.
 */
export type SwipeDir = 1 | -1;
export interface InnerPager {
  canGo(dir: SwipeDir): boolean;
  go(dir: SwipeDir): void;
}
let pager: InnerPager | null = null;
/** O ecrã regista-se ao ganhar o foco e limpa (null) ao perdê-lo. */
export function registerInnerPager(p: InnerPager | null): void { pager = p; }
export function innerPager(): InnerPager | null { return pager; }

/** Para mudar de separador o gesto tem de ser claramente para o lado: |dx| pelo menos 1,8 vezes |dy| (o mesmo de lib/swipeTabs). */
const PAGER_RATIO = 1.8;
/** Um deslize rápido (px/s) também conta, desde que já tenha andado 30% da largura. */
const PAGER_FLING = 600;

/** Para onde vai um deslize: dedo para a esquerda (dx < 0) = seguinte. */
export function swipeDir(dx: number): SwipeDir { return dx < 0 ? 1 : -1; }

export interface SwipeGesture {
  dx: number;
  dy?: number;
  /** Velocidade horizontal ao largar (px/s); sem ela só conta a distância. */
  vx?: number;
  /** Largura do ecrã. */
  width: number;
  /** O limite de "deslize grande" (por omissão navSwipeThreshold(width)). */
  threshold?: number;
}

/** Deslize grande: passou o limite (ou foi rápido e já vai em 30% da largura), sempre bem mais para o lado do que na vertical. */
export function isBigSwipe(g: SwipeGesture): boolean {
  const ax = Math.abs(g.dx);
  if (!ax || ax < Math.abs(g.dy ?? 0) * PAGER_RATIO) return false;
  if (ax >= (g.threshold ?? navSwipeThreshold(g.width))) return true;
  return g.vx !== undefined && Math.abs(g.vx) >= PAGER_FLING && Math.sign(g.vx) === Math.sign(g.dx) && ax >= g.width * 0.3;
}

/**
 * A decisão de um deslize ao largar (lógica pura, testada em tests/swipePager.test.mjs):
 * - `none`: pequeno (é da linha, ou não é nada);
 * - `inner`: grande e o ecrã tem para onde ir → muda de separador dentro do ecrã;
 * - `outer`: grande mas sem pager, ou já na ponta → o que se fazia antes (na web, mudar de menu).
 */
export function decideSwipe(g: SwipeGesture, p: InnerPager | null): { to: 'none' | 'inner' | 'outer'; dir: SwipeDir } {
  const dir = swipeDir(g.dx);
  if (!isBigSwipe(g)) return { to: 'none', dir };
  return { to: p?.canGo(dir) ? 'inner' : 'outer', dir };
}
