/**
 * O logótipo "txillapp" em traços (os mesmos do componente Wordmark): serve para desenhar a assinatura nas fotos,
 * no browser (canvas) e no telemóvel (Skia). Caixa de -4,-3 a 150,51; traço de 7 com pontas redondas; o ponto do i a coral.
 */
const circle = (cx: number, cy: number, r: number) => `M${cx + r} ${cy}a${r} ${r} 0 1 0 ${-2 * r} 0a${r} ${r} 0 1 0 ${2 * r} 0`;

export const WORDMARK_BOX = { x: -4, y: -3, w: 154, h: 54 };
export const WORDMARK_STROKE = 7;
export const WORDMARK_PATHS: string[] = [
  'M7 5V27Q7 34 14 34M0 14H14',
  'M20 14Q27 24 34 34M34 14Q27 24 20 34',
  'M42 14V34',
  'M51 3V34',
  'M61 3V34',
  circle(77, 24, 9.5),
  'M86.5 14V34',
  circle(106, 24, 9.5),
  'M96.5 14V46',
  circle(135, 24, 9.5),
  'M125.5 14V46',
];
export const WORDMARK_DOT = { cx: 42, cy: 3.5, r: 4.2 };

/** Onde fica a assinatura numa foto W×H: o logótipo em baixo à direita e, por baixo, o @ de quem tirou. */
export function signLayout(W: number, H: number, withUser: boolean) {
  const base = Math.min(W, H);
  const m = Math.round(base * 0.04);
  const ww = base * 0.2;
  const s = ww / WORDMARK_BOX.w;
  const wh = WORDMARK_BOX.h * s;
  const userSize = Math.round(base * 0.028);
  const right = W - m;
  const userBaseline = H - m;
  const markBottom = withUser ? userBaseline - userSize * 1.25 : H - m;
  return { s, x: right - ww, y: markBottom - wh, right, userSize, userBaseline, blur: Math.max(2, s * 5) };
}
