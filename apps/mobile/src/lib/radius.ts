/**
 * O raio do «À tua volta» (folha «Onde procurar»): uma barra de 1 a 50 km, de 1 em 1 km. O servidor aceita o mesmo
 * (apps/api, nearby.controller: NEARBY_RADIUS). As marcas discretas da barra ficam nas distâncias de antes (5, 10, 20, 30).
 * `STEPS` são as paragens das sugestões "Ver até … km" quando não há nada por perto.
 */
export const RADIUS = { min: 1, max: 50, step: 1, default: 10 } as const;
export const RADIUS_MARKS = [5, 10, 20, 30] as const;
export const RADIUS_STEPS = [5, 10, 20, 30, 50] as const;

/** Um valor qualquer (do dedo, do teclado, de fora) para um km inteiro dentro da barra. */
export function clampRadius(v: number, min: number = RADIUS.min, max: number = RADIUS.max, step: number = RADIUS.step): number {
  if (!Number.isFinite(v)) return min;
  const s = step > 0 ? step : 1;
  const snapped = min + Math.round((v - min) / s) * s;
  return Math.min(max, Math.max(min, snapped));
}

/** Onde está o dedo (px desde o início da faixa útil, com `width` px) → valor da barra. */
export function valueAt(x: number, width: number, min: number = RADIUS.min, max: number = RADIUS.max, step: number = RADIUS.step): number {
  if (!(width > 0)) return min;
  const f = Math.min(1, Math.max(0, x / width));
  return clampRadius(min + f * (max - min), min, max, step);
}

/** Valor → fração (0 a 1) da faixa: para pôr o botão e as marcas. */
export function fractionOf(v: number, min: number = RADIUS.min, max: number = RADIUS.max): number {
  if (max <= min) return 0;
  return Math.min(1, Math.max(0, (v - min) / (max - min)));
}
