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

/**
 * O selo de verificado (o mesmo desenho do VerifiedBadge, numa caixa de 24×24): a roseta azul (ou coral em degradê na conta
 * oficial do Txillapp) e o visto branco por cima. A roseta ocupa de 1,75 a 22,25 nos dois eixos.
 */
export const SEAL_BOX = 24;
export const SEAL_PATH =
  'M22.25 12c0-1.43-.88-2.67-2.19-3.34.46-1.39.2-2.9-.81-3.91s-2.52-1.27-3.91-.81c-.66-1.31-1.91-2.19-3.34-2.19s-2.67.88-3.33 2.19c-1.4-.46-2.91-.2-3.92.81s-1.26 2.52-.8 3.91c-1.31.67-2.2 1.91-2.2 3.34s.89 2.67 2.2 3.34c-.46 1.39-.21 2.9.8 3.91s2.52 1.26 3.91.81c.67 1.31 1.91 2.19 3.34 2.19s2.68-.88 3.34-2.19c1.39.45 2.9.2 3.91-.81s1.27-2.52.81-3.91c1.31-.67 2.19-1.91 2.19-3.34z';
export const SEAL_CHECK = 'm8 12.4 2.8 2.8L16.4 9.4';
export const SEAL_CHECK_WIDTH = 2.2;
export const SEAL_BLUE = '#1d9bf0';
/** O degradê da conta oficial: do canto de cima à esquerda ao de baixo à direita da roseta (como o x1=0 y1=0 x2=1 y2=1 do SVG). */
export const SEAL_OFFICIAL = { from: '#ff6b81', to: '#d6334f', x0: 1.75, y0: 1.75, x1: 22.25, y1: 22.25 };

export type SealTier = 'verified' | 'official';
/** O selo de uma conta (null se não é verificada): `official` é a conta do Txillapp; o resto leva o azul. */
export function sealOf(u?: { verified?: boolean | null; verifiedTier?: string | null } | null): SealTier | null {
  if (!u?.verified) return null;
  return u.verifiedTier === 'official' ? 'official' : 'verified';
}

/** O selo mede 1,05 vezes a letra do @ e fica a uma pequena folga dele (em frações da letra). */
export const SEAL_SCALE = 1.05;
export const SEAL_GAP = 0.15;
/** O meio do selo fica a esta altura acima da linha de base do @ (a meio da letra). */
export const SEAL_LIFT = 0.36;

/**
 * Onde fica a assinatura numa foto W×H: o logótipo em baixo à direita e, por baixo, o @ de quem tirou. Com `seal` (conta
 * verificada) o @ e o selo ficam encostados à direita, o selo a seguir ao @: o @ acaba em `textRight` e o selo ocupa a
 * caixa `seal` (canto de cima à esquerda em x, y; lado `size`; `k` = size / 24 para desenhar o path).
 */
export function signLayout(W: number, H: number, withUser: boolean, seal?: SealTier | null) {
  const base = Math.min(W, H);
  const m = Math.round(base * 0.04);
  const ww = base * 0.2;
  const s = ww / WORDMARK_BOX.w;
  const wh = WORDMARK_BOX.h * s;
  const userSize = Math.round(base * 0.028);
  const right = W - m;
  const userBaseline = H - m;
  const markBottom = withUser ? userBaseline - userSize * 1.25 : H - m;
  const size = userSize * SEAL_SCALE;
  const badge = withUser && seal
    ? { tier: seal, size, k: size / SEAL_BOX, x: right - size, y: userBaseline - userSize * SEAL_LIFT - size / 2 }
    : null;
  const textRight = badge ? right - size - userSize * SEAL_GAP : right;
  return { s, x: right - ww, y: markBottom - wh, right, userSize, userBaseline, textRight, seal: badge, blur: Math.max(2, s * 5) };
}
