/**
 * O ecrã de preparar a Txillada com o teclado aberto (components/txillada/TxilladaPrep). Contas puras, testadas em
 * tests/prepKeyboard.test.mjs.
 *
 * - No iPhone (Safari e app instalada) o teclado não encolhe a página: tapa-a, e só a zona visível (`visualViewport`) fica
 *   mais baixa. O react-native-web mede a janela por essa zona, por isso o cartão 9:16 (lib/storyFrame) encolhia para
 *   metade da largura, ao meio, e tudo lá dentro ficava apertado e cortado. Agora o cartão é medido sem o teclado
 *   (`stableScreen`: fica parado enquanto se escreve) e só o painel de baixo sobe para cima do teclado (`prepPanel`),
 *   com a altura que couber, a rolar por dentro, e o campo onde se escreve fica à vista (`scrollToShow`).
 * - No Android (Chrome e app) a janela pode encolher sozinha com o teclado: conta-se só a parte que ela não encolheu.
 */

export type Size = { w: number; h: number };

/** O tamanho do ecrã para desenhar o cartão: fica o de antes enquanto se escreve (o teclado não conta); rodar muda-o. */
export function stableScreen(prev: Size, now: Size, typing: boolean): Size {
  if (!prev.w || !prev.h) return now;
  if (now.w !== prev.w) return now;
  if (typing) return prev;
  return now;
}

/** Quanto o cabeçalho do cartão (fechar, «Txillada», virar a câmara) ocupa em cima: o painel nunca sobe para cima dele. */
export const PREP_HEADER_H = 68;
/** A folga entre o painel e o teclado. */
export const PREP_KB_GAP = 8;

export type VisibleIn = {
  web: boolean;
  /** A zona visível na web (visualViewport: `top` = offsetTop), ou null. */
  vv: { top: number; height: number } | null;
  /** A altura de agora do ecrã (medida). */
  rootH: number;
  /** A altura do ecrã sem o teclado (stableScreen). */
  screenH: number;
  /** A altura do teclado no telemóvel (avisos do sistema); 0 na web. */
  kb: number;
};

/** Onde acaba (e começa) a parte do ecrã que se vê, em px do ecrã, com o teclado aberto ou não. */
export function visibleArea({ web, vv, rootH, screenH, kb }: VisibleIn): { top: number; bottom: number } {
  const h = rootH || screenH;
  if (web) {
    if (!vv) return { top: 0, bottom: h };
    return { top: Math.max(0, vv.top), bottom: Math.min(h, vv.top + vv.height) };
  }
  // Nativo: o teclado tapa o fundo; se a janela já encolheu com ele (Android), só falta tirar o que ela não encolheu.
  const shrunk = Math.max(0, screenH - h);
  return { top: 0, bottom: h - Math.max(0, kb - shrunk) };
}

export type PanelIn = { cardTop: number; cardH: number; visTop: number; visBottom: number; header?: number; gap?: number };

/**
 * O painel de baixo do cartão (título, tipo, angariação, «Começar Txillada»): `bottom` é quanto sobe a partir do fundo do
 * cartão (0 sem teclado) e `maxHeight` a altura que tem, entre o cabeçalho (ou o topo visível) e o teclado; o que não
 * couber rola por dentro.
 */
export function prepPanel({ cardTop, cardH, visTop, visBottom, header = PREP_HEADER_H, gap = PREP_KB_GAP }: PanelIn): { bottom: number; maxHeight: number } {
  const cardBottom = cardTop + cardH;
  const bottom = visBottom < cardBottom ? Math.ceil(cardBottom - visBottom) + gap : 0;
  const top = Math.max(cardTop + header, visTop + gap);
  const maxHeight = Math.max(96, Math.floor(cardBottom - bottom - top));
  return { bottom, maxHeight };
}

/**
 * Para onde rolar para que [start, start+size] fique à vista numa janela de `view` px que está em `offset` (vertical ou de
 * lado); null quando já se vê. Maior do que a janela: mostra-se o início.
 */
export function scrollToShow(start: number, size: number, offset: number, view: number, pad = 8): number | null {
  if (!(view > 0)) return null;
  const a = start - pad;
  const b = start + size + pad;
  if (b - a >= view) return Math.max(0, a) === offset ? null : Math.max(0, a);
  if (a < offset) return Math.max(0, a);
  if (b > offset + view) return Math.max(0, b - view);
  return null;
}
