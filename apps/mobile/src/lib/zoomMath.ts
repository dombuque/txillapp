/**
 * Contas do zoom da foto em grande (components/ZoomableImage): limites da escala e do arrastar, zoom à volta de um ponto,
 * duplo toque e roda do rato. Funções puras, sem React; o 'worklet' deixa-as correr no UI thread (Reanimated) e não muda
 * nada fora dele (nos testes e na web são funções normais).
 *
 * O estado é { scale, x, y }: a foto (o círculo de `base` px no centro do visor) é deslocada (x, y) e ampliada à volta do
 * seu centro. Os pontos (fx, fy) são medidos a partir do centro do visor.
 */

export const ZOOM_MIN = 1;
export const ZOOM_MAX = 5;
/** Duplo toque: 1× ↔ 2,5×. */
export const ZOOM_DOUBLE = 2.5;
/** A apertar pode encolher um pouco abaixo de 1×; ao largar volta a 1×. */
export const ZOOM_PINCH_MIN = 0.6;
/** Abaixo disto conta como «em repouso» (1×): um toque fecha. */
export const ZOOM_REST = 1.01;
/** Arrastar para lá do limite anda só esta fração (efeito elástico); ao largar volta ao sítio. */
export const PAN_RESIST = 0.35;
/** Toque: o dedo anda menos do que isto e larga antes deste tempo. */
export const TAP_SLOP = 10;
export const TAP_MS = 350;
/** Duplo toque: o segundo chega antes deste tempo e perto do primeiro. */
export const DOUBLE_TAP_MS = 280;
export const DOUBLE_TAP_SLOP = 40;

export type Zoom = { scale: number; x: number; y: number };
/** `base`: diâmetro do círculo a 1×; `w`, `h`: tamanho do visor. */
export type Box = { base: number; w: number; h: number };

export const REST: Zoom = { scale: 1, x: 0, y: 0 };

export function clamp(v: number, lo: number, hi: number): number {
  'worklet';
  return Math.min(hi, Math.max(lo, v));
}

export function atRest(scale: number): boolean {
  'worklet';
  return scale < ZOOM_REST;
}

/** Quanto a foto pode andar para cada lado: só o que sobra fora do visor (a borda da foto nunca entra no ecrã). */
export function panLimit(scale: number, box: Box): { x: number; y: number } {
  'worklet';
  const size = box.base * scale;
  return { x: Math.max(0, (size - box.w) / 2), y: Math.max(0, (size - box.h) / 2) };
}

export function clampPan(z: Zoom, box: Box): Zoom {
  'worklet';
  const lim = panLimit(z.scale, box);
  // + 0: sem -0 (sem folga o limite é ±0).
  return { scale: z.scale, x: clamp(z.x, -lim.x, lim.x) + 0, y: clamp(z.y, -lim.y, lim.y) + 0 };
}

/** Muda a escala para `next` sem mexer o ponto (fx, fy) que está debaixo dos dedos. */
export function zoomAt(z: Zoom, next: number, fx: number, fy: number): Zoom {
  'worklet';
  const k = next / z.scale;
  return { scale: next, x: fx - (fx - z.x) * k, y: fy - (fy - z.y) * k };
}

/**
 * Um passo do aperto de dois dedos: `factor` = quanto a distância entre os dedos mudou desde o passo anterior; `f` e `prev`
 * = o ponto médio dos dedos agora e antes (a foto também acompanha os dedos se andarem juntos).
 */
export function pinchStep(z: Zoom, factor: number, f: { x: number; y: number }, prev: { x: number; y: number }): Zoom {
  'worklet';
  const next = clamp(z.scale * (factor > 0 && Number.isFinite(factor) ? factor : 1), ZOOM_PINCH_MIN, ZOOM_MAX);
  const a = zoomAt(z, next, prev.x, prev.y);
  return { scale: next, x: a.x + f.x - prev.x, y: a.y + f.y - prev.y };
}

/** Arrastar com um dedo (dx, dy desde o passo anterior). Para lá do limite custa mais (PAN_RESIST). */
export function panStep(z: Zoom, dx: number, dy: number, box: Box): Zoom {
  'worklet';
  const lim = panLimit(z.scale, box);
  const step = (v: number, d: number, l: number) => {
    const n = v + d;
    return Math.abs(n) > l && Math.sign(d) === Math.sign(n) ? v + d * PAN_RESIST : n;
  };
  return { scale: z.scale, x: step(z.x, dx, lim.x), y: step(z.y, dy, lim.y) };
}

/** Ao largar: a escala volta a [1, 5] e a foto para dentro dos limites. A 1× fica centrada. */
export function settle(z: Zoom, box: Box): Zoom {
  'worklet';
  const scale = clamp(z.scale, ZOOM_MIN, ZOOM_MAX);
  if (atRest(scale)) return REST;
  return clampPan({ scale, x: z.x, y: z.y }, box);
}

/** Duplo toque: ampliada volta a 1×; em repouso amplia para 2,5× à volta do ponto tocado. */
export function doubleTapTarget(z: Zoom, fx: number, fy: number, box: Box): Zoom {
  'worklet';
  if (!atRest(z.scale)) return REST;
  return clampPan(zoomAt(REST, ZOOM_DOUBLE, fx, fy), box);
}

/** Roda do rato ou aperto no trackpad (Chrome manda wheel com ctrlKey): quanto multiplicar a escala. */
export function wheelFactor(deltaY: number, deltaMode: number, pinch: boolean): number {
  const px = deltaY * (deltaMode === 1 ? 16 : deltaMode === 2 ? 400 : 1);
  return Math.exp(-clamp(px, -100, 100) * (pinch ? 0.01 : 0.002));
}

/** Um passo da roda: zoom à volta do cursor, sempre dentro de [1, 5] e dos limites. */
export function wheelStep(z: Zoom, factor: number, fx: number, fy: number, box: Box): Zoom {
  const next = clamp(z.scale * factor, ZOOM_MIN, ZOOM_MAX);
  if (atRest(next)) return REST;
  return clampPan(zoomAt(z, next, fx, fy), box);
}

/** O anel branco do círculo vai desaparecendo ao ampliar (1× → 1,4×). */
export function ringOpacity(scale: number): number {
  'worklet';
  if (scale <= 1) return 1;
  if (scale >= 1.4) return 0;
  return (1.4 - scale) / 0.4;
}

export function isTap(dx: number, dy: number, ms: number): boolean {
  return Math.hypot(dx, dy) < TAP_SLOP && ms < TAP_MS;
}

export function isDoubleTap(prev: { t: number; x: number; y: number } | null, now: { t: number; x: number; y: number }): boolean {
  return !!prev && now.t - prev.t < DOUBLE_TAP_MS && Math.hypot(now.x - prev.x, now.y - prev.y) < DOUBLE_TAP_SLOP;
}
