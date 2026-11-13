/**
 * As medidas do estúdio nativo, como no site (TchekaStudio.tsx no telemóvel), sem React (testadas em
 * tests/studioNativeLayout.test.mjs, com os ecrãs de 411×914 e de 360×740 dp):
 *
 *   topo (52) → imagem 9:16 (o que sobra) → [tocar e barra do tempo (48), só com a folha fechada] → linha do tempo → folha
 *
 * A folha fica no fim da coluna (nunca por cima da imagem): a pega (22) e os separadores (50), e o painel com 0 (fechada),
 * ~38 % do ecrã (média, nunca menos de 250 para o primeiro controlo de cada painel ficar inteiro) ou até 72 % (alta, a deixar a
 * linha do tempo à vista). A imagem encolhe para caber no que sobra; sem espaço para ela (folha alta), recolhe.
 */

export type SheetHeight = 'baixa' | 'media' | 'alta';
export const TOP_H = 52;
export const GRAB_H = 22;
export const TABS_H = 50;
export const SHEET_HEAD = GRAB_H + TABS_H;
export const CONTROLS_H = 48;
/** A margem à volta da imagem (em cima e em baixo, e dos lados). */
export const STAGE_PAD_V = 8;
export const STAGE_PAD_H = 24;
/** A imagem mais baixa que vale a pena mostrar; abaixo disto recolhe (como no site, na folha alta). */
export const STAGE_MIN_H = 96;
/** As alturas da linha do tempo sem camadas: normal (régua 22 + clipes 52 + margens) e densa (16 + 48 + margens). */
export const TIMELINE_H = 86;
export const TIMELINE_DENSE_H = 72;

export interface LayoutIn { winH: number; winW: number; top: number; bottom: number; kb?: number; timelineH: number; sheet: SheetHeight }
export interface LayoutOut {
  midH: number;
  highH: number;
  /** A altura do painel (sem a pega e os separadores). */
  sheetH: number;
  /** A altura que fica para a imagem (a área, antes das margens). */
  stageAreaH: number;
}

export function studioLayout(i: LayoutIn): LayoutOut {
  const kb = Math.max(0, i.kb ?? 0);
  const midH = Math.max(250, Math.round(i.winH * 0.38) - SHEET_HEAD);
  const highH = Math.max(midH + 40, Math.round(Math.min(i.winH * 0.72, i.winH - i.top - TOP_H - i.bottom - i.timelineH)) - SHEET_HEAD);
  let sheetH = i.sheet === 'baixa' ? 0 : i.sheet === 'media' ? midH : highH;
  // Com o teclado aberto o painel encolhe para caber por cima dele (a imagem recolhe primeiro).
  if (kb > 0 && sheetH > 0) sheetH = Math.max(120, Math.min(sheetH, i.winH - i.top - i.bottom - kb - TOP_H - i.timelineH - SHEET_HEAD));
  const stageAreaH = Math.max(0, i.winH - i.top - i.bottom - kb - TOP_H - (sheetH > 0 ? 0 : CONTROLS_H) - i.timelineH - SHEET_HEAD - sheetH);
  return { midH, highH, sheetH, stageAreaH };
}

/** A imagem 9:16 com a maior altura que cabe na área (com as margens); `shown: false` quando já não vale a pena mostrá-la. */
export function fitStage(areaW: number, areaH: number): { w: number; h: number; shown: boolean } {
  const h0 = Math.max(0, Math.min(areaH - STAGE_PAD_V, (areaW - STAGE_PAD_H) * (16 / 9)));
  const w = Math.floor(h0 * (9 / 16));
  const h = Math.floor(w * (16 / 9));
  return { w, h, shown: h >= STAGE_MIN_H && w > 0 };
}
