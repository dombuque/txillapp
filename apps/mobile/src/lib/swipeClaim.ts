/**
 * Arbitragem dos deslizes horizontais na web. Um componente que trata o gesto em curso (linha com swipe, carrossel,
 * visor) chama claimSwipe() durante o gesto; a navegação entre separadores (lib/swipeTabs) não muda de menu nesse gesto.
 * releaseSwipe() devolve o gesto (ex.: a linha passou o limite e o gesto passa a ser de navegação).
 */
let claimed = false;
export function claimSwipe(): void { claimed = true; }
export function releaseSwipe(): void { claimed = false; }
export function isSwipeClaimed(): boolean { return claimed; }
/** Reposto no início de cada toque (lib/swipeTabs chama-o no touchstart, em fase de captura). */
export function resetSwipeClaim(): void { claimed = false; }
/** A partir desta distância horizontal (px) o gesto é de mudar de menu, mesmo começando numa linha com swipe. */
export function navSwipeThreshold(): number { return Math.max(140, Math.round(window.innerWidth * 0.4)); }
