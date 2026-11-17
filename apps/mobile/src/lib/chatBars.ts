/**
 * As barras das conversas em ecrãs estreitos (320 a 360 px), sem React: testadas em tests/chatBars.test.mjs.
 *
 * - A barra de escrever: a 320 px a câmara e os quatro ícones de 44 deixavam uns 67 px ao campo e o «Mensagem…» partia
 *   em duas linhas. Com a pílula estreita os ícones ficam com 40 (o toque continua a chegar aos 44 com o hitSlop) e, se
 *   ainda for pouco, a galeria sai da barra e fica no menu «+» (como no WhatsApp, onde os ícones saem para dar lugar).
 * - O cabeçalho: a 320 px os quatro botões da direita deixavam só «Z» do nome. Os botões passam a 40 de largura e, a
 *   360 px ou menos, o Mixar e a videochamada passam para o menu «⋯».
 */

/** A largura dos botões da direita do cabeçalho (o hitSlop leva o toque até aos 44). */
export const HEADER_ACTION_W = 40;
/** Até esta largura do ecrã, o Mixar e a videochamada vão para o menu «⋯». */
export const HEADER_NARROW = 360;

export function headerInMenu(screenWidth: number): boolean {
  return screenWidth > 0 && screenWidth <= HEADER_NARROW;
}

/** Os ícones da pílula da barra de escrever, pela largura da pílula: a largura de cada um e se a galeria cabe. */
export function composerTools(pillWidth: number): { toolW: number; gallery: boolean } {
  if (pillWidth > 0 && pillWidth <= 340) return { toolW: 40, gallery: false };
  if (pillWidth > 0 && pillWidth < 380) return { toolW: 40, gallery: true };
  return { toolW: 44, gallery: true };
}
