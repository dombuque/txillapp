/**
 * A conta do teclado partilhada pelo visor dos mimos e dos Zás (lib/keyboardFrame `keyboardCover`) e pela Txillada
 * (lib/txilladaChat `liveKeyboard`): até onde se vê o ecrã com o teclado aberto. Conta pura, sem nada do React Native,
 * testada em tests/keyboardFrame.test.mjs e tests/txilladaVoltar.test.mjs (pelas duas que a usam).
 *
 * - Web: o fundo da zona visível (visualViewport, `top + height`), nunca abaixo do ecrã de agora. Sem a zona (Android,
 *   que encolhe a página), o ecrã de agora.
 * - Nativo: o topo do teclado. Se a janela já encolheu com ele (Android), não se conta duas vezes: tapa o maior entre a
 *   altura do teclado e o que a janela encolheu.
 */

/** A zona visível na web (visualViewport: `top` = offsetTop, `height`). */
export type VisibleBox = { top: number; height: number };

export type VisibleIn = {
  web: boolean;
  /** Web: a zona visível (visualViewport), ou null. */
  vv: VisibleBox | null;
  /** A altura de agora do ecrã ou da janela (no Android encolhe com o teclado; no iPhone a web mede a zona visível). */
  nowH: number;
  /** A altura do ecrã sem o teclado (a do visor ou do palco desenhado, que fica parada enquanto se escreve). */
  screenH: number;
  /** A altura do teclado no telemóvel (avisos do sistema); 0 na web. */
  kb: number;
};

/**
 * Até onde se vê o ecrã (px a contar do topo dele) com o teclado aberto: o que fica abaixo disto está tapado. Sem
 * arredondar (cada ecrã arredonda à sua maneira). Sem `nowH` (ainda por medir) vale `screenH`.
 */
export function visibleBottom({ web, vv, nowH, screenH, kb }: VisibleIn): number {
  const h = nowH || screenH;
  if (web) return vv ? Math.min(h, vv.top + vv.height) : h;
  // O teclado tapa o que a janela ainda não encolheu com ele (no Android encolhe; no iPhone não).
  return Math.min(screenH, h) - Math.max(0, kb - Math.max(0, screenH - h));
}
