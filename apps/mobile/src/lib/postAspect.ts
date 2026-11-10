/** Proporções das publicações, como no Instagram: entre 4:5 (vertical) e 1,91:1 (horizontal). */
export const POST_RATIO_MIN = 4 / 5;
export const POST_RATIO_MAX = 1.91;
export const POST_RATIO_DEFAULT = 4 / 5;
/** Proporção (largura/altura) limitada ao intervalo das publicações. */
export function clampPostRatio(width?: number | null, height?: number | null): number {
  if (!width || !height) return 1;
  return Math.min(POST_RATIO_MAX, Math.max(POST_RATIO_MIN, width / height));
}
