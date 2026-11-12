/**
 * Onde cabe uma folha (Sheet) na web quando o teclado está aberto. No iPhone (Safari e PWA) o teclado não encolhe a página:
 * tapa-a. A zona visível é o `visualViewport`; se for bem mais baixa do que a janela (mais de 120 px), o teclado está aberto
 * e a folha passa a viver só nessa zona (o campo de escrever fica logo acima do teclado). No Android (Chrome) a janela
 * encolhe com o teclado, a diferença não aparece e nada muda. No nativo não há `visualViewport` (devolve null).
 */
export type VisibleBox = { top: number; height: number; width?: number; scale?: number };

/**
 * Com a página encolhida ou ampliada (zoom: `scale` diferente de 1, ou a zona visível mais estreita do que a janela) a altura
 * também difere, mas não é o teclado: nesse caso não se mexe (antes lia-se como teclado e a folha ficava presa em cima).
 */
export function sheetViewport(vv: VisibleBox | null, innerHeight: number, innerWidth?: number): VisibleBox | null {
  if (!vv || !innerHeight) return null;
  if (vv.scale != null && Math.abs(vv.scale - 1) > 0.01) return null;
  if (innerWidth && vv.width != null && vv.width < innerWidth - 2) return null;
  return vv.height < innerHeight - 120 ? { top: Math.max(0, vv.top), height: vv.height } : null;
}

/** Alturas da folha: `full` (comentários) 78% do ecrã, as outras até 85%; com o teclado aberto, nunca mais do que a zona visível. */
export function sheetHeights(screenH: number, box: VisibleBox | null): { full: number; max: number } {
  const full = Math.round(screenH * 0.78);
  const max = Math.round(screenH * 0.85);
  if (!box) return { full, max };
  const room = Math.round(box.height - 8);
  return { full: Math.min(full, room), max: Math.min(max, room) };
}
