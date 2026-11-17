/**
 * O teclado por cima de um visor em ecrã inteiro (o visor dos mimos, o dos Zás, as tchekas), como no Instagram: o que está
 * atrás fica do mesmo tamanho e no mesmo sítio (pausado e um pouco mais escuro, isso é com cada ecrã) e só a barra de
 * escrever sobe, colada ao teclado. Ao fechar o teclado volta tudo como estava. Contas puras, sem nada do React Native,
 * testadas em tests/keyboardFrame.test.mjs.
 *
 * - No iPhone (Safari e app instalada) o teclado não encolhe a página: tapa-a, e só a zona visível (`visualViewport`) fica
 *   mais baixa. O react-native-web mede a janela por essa zona (useWindowDimensions encolhe), por isso um visor medido pela
 *   janela encolhia para um cartão pequeno ao meio, com faixas pretas dos lados. Agora o tamanho fica o de antes enquanto
 *   o teclado está aberto (`heldSize`) e o teclado só conta para pôr a barra (`keyboardCover`).
 * - No Android (Chrome e app) a janela pode encolher sozinha com o teclado: conta-se o que ela encolheu ou a altura do
 *   teclado, a que for maior (nunca as duas somadas).
 * A conta de até onde se vê com o teclado é a mesma da Txillada (lib/keyboardMath `visibleBottom`).
 */

import { visibleBottom, type VisibleBox } from '@/lib/keyboardMath';

export type { VisibleBox };
export type Size = { w: number; h: number };

/**
 * O tamanho do ecrã para desenhar o visor: enquanto o teclado está aberto (ou se está a escrever) fica o de antes; rodar
 * (outra largura) muda-o sempre; sem teclado segue a medida de agora.
 */
export function heldSize(prev: Size, now: Size, keyboard: boolean): Size {
  if (!prev.w || !prev.h) return now;
  if (Math.abs(now.w - prev.w) > 1) return now;
  if (keyboard) return prev;
  return now;
}

/**
 * Na web, o teclado está aberto? A zona visível bem mais baixa do que a janela (mais de 120 px; `innerH` é a altura de
 * referência, lib/webViewport `webWindowHeight`, lida por `webWindowH`), sem zoom (com a página
 * ampliada a zona também é mais baixa, mas não é o teclado). Devolve a zona, ou null.
 */
export function webKeyboardBox(vv: (VisibleBox & { width?: number; scale?: number }) | null, innerH: number, innerW?: number): VisibleBox | null {
  if (!vv || !innerH) return null;
  if (vv.scale != null && Math.abs(vv.scale - 1) > 0.01) return null;
  if (innerW && vv.width != null && vv.width < innerW - 2) return null;
  return vv.height < innerH - 120 ? { top: Math.max(0, vv.top), height: vv.height } : null;
}

export type CoverIn = {
  web: boolean;
  /** Web: a zona visível quando o teclado está aberto (webKeyboardBox), ou null. */
  vv: VisibleBox | null;
  /** A altura de agora do ecrã (medida no próprio ecrã). */
  rootH: number;
  /** A altura do ecrã sem o teclado (heldSize): é a do visor desenhado. */
  screenH: number;
  /** A altura do teclado no telemóvel (avisos do sistema); 0 na web. */
  kb: number;
};

/**
 * Quanto do fundo do visor (px a partir de baixo, no visor desenhado com `screenH`) o teclado tapa (`cover`), e quanto
 * descer o visor (`shift`) para ficar no mesmo sítio quando o iPhone desloca a zona visível para cima (offsetTop).
 */
export function keyboardCover({ web, vv, rootH, screenH, kb }: CoverIn): { cover: number; shift: number } {
  if (web && vv) {
    // O iPhone desloca a zona visível para cima (offsetTop): o visor desce o mesmo (`shift`) e o fundo da zona visível
    // conta-se em px do visor.
    const shift = Math.max(0, Math.round(vv.top));
    const bottom = visibleBottom({ web, vv: { top: shift, height: vv.height }, nowH: rootH, screenH, kb }) - shift;
    return { cover: Math.max(0, Math.round(screenH - bottom)), shift };
  }
  // Web sem a zona do teclado: só o que a própria página encolheu (Android). Nativo: o teclado ou o que a janela encolheu.
  return { cover: Math.max(0, Math.round(screenH - visibleBottom({ web, vv: null, nowH: rootH, screenH, kb }))), shift: 0 };
}

/** A folga entre a barra de escrever e o teclado. */
export const KB_GAP = 6;

/**
 * Onde fica a barra de escrever (`bottom`, px a partir do fundo do visor desenhado): no lugar de sempre (`rest`) ou, com o
 * teclado aberto, colada a ele. Nunca desce abaixo do lugar de sempre.
 */
export function barBottom(rest: number, cover: number, gap = KB_GAP): number {
  return cover > 0 ? Math.max(rest, cover + gap) : rest;
}
