/**
 * As contas da linha do tempo (sem React; testadas em tests/studioTimeline.test.mjs): a escala (píxeis por segundo), o
 * zoom à volta de um ponto, as marcas da régua, o passo de um frame, o íman nas junções e o lugar ao reordenar.
 */

/** Píxeis por segundo: do mais afastado (60 s cabem num telemóvel) ao mais perto (frames quase um a um). */
export const PPS_MIN = 5;
export const PPS_MAX = 480;
export const PPS_DEFAULT = 56;
/** A pré-visualização e a montagem andam a 30 frames por segundo. */
export const FPS = 30;

export const clampPps = (pps: number) => Math.max(PPS_MIN, Math.min(PPS_MAX, Number.isFinite(pps) && pps > 0 ? pps : PPS_DEFAULT));

/** A escala para a sequência inteira caber na largura (com a margem dos dois lados). */
export const fitPps = (total: number, width: number, pad = 0) => clampPps((Math.max(40, width - 2 * pad)) / Math.max(1, total));

/**
 * Zoom por `factor` à volta do ponto `anchorX` (píxeis dentro da vista): o instante que está debaixo do dedo (ou do rato)
 * fica no mesmo sítio. `pad` é a margem antes do segundo 0.
 */
export function zoomAt(o: { pps: number; factor: number; anchorX: number; scrollLeft: number; pad: number }): { pps: number; scrollLeft: number } {
  const pps = clampPps(o.pps * o.factor);
  const t = (o.scrollLeft + o.anchorX - o.pad) / o.pps;
  return { pps, scrollLeft: Math.max(0, t * pps + o.pad - o.anchorX) };
}

/** O instante debaixo de `x` (píxeis dentro do conteúdo que desliza). */
export const timeAtX = (x: number, pps: number, pad: number, total: number) => Math.max(0, Math.min(total, (x - pad) / pps));

const STEPS = [1 / FPS, 0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60];

export interface Tick { t: number; major: boolean; label: string | null }
/**
 * As marcas da régua: as pequenas a pelo menos `minGap` píxeis umas das outras; as grandes (com o tempo escrito) a pelo
 * menos `labelGap`. Ao zoom máximo há uma marca por frame.
 */
export function rulerTicks(pps: number, total: number, opts: { minGap?: number; labelGap?: number } = {}): { minor: number; major: number; ticks: Tick[] } {
  const minGap = opts.minGap ?? 12, labelGap = opts.labelGap ?? 56;
  const minor = STEPS.find((s) => s * pps >= minGap) ?? 60;
  const major = STEPS.find((s) => s >= minor && s * pps >= labelGap && isMultiple(s, minor)) ?? 60;
  const ticks: Tick[] = [];
  const n = Math.floor(total / minor + 1e-6);
  for (let i = 0; i <= n && ticks.length < 4000; i++) {
    const t = Math.round(i * minor * 1000) / 1000;
    const isMajor = isMultiple(t, major);
    ticks.push({ t, major: isMajor, label: isMajor ? rulerLabel(t, major) : null });
  }
  return { minor, major, ticks };
}
function isMultiple(a: number, b: number) {
  const k = a / b;
  return Math.abs(k - Math.round(k)) < 1e-4;
}
/** «0:05»; abaixo do segundo, «0:05,5»; ao nível do frame, «5f» entre os segundos. */
export function rulerLabel(t: number, step = 1): string {
  const whole = Math.floor(t + 1e-6);
  const base = `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
  const frac = t - whole;
  if (frac < 1e-4) return base;
  if (step < 0.1 - 1e-6) return `${Math.round(frac * FPS)}f`;
  return `${base},${Math.round(frac * 10)}`;
}

/** O tempo com décimas, para o mostrador da linha do tempo: «0:07,4». */
export function preciseClock(t: number): string {
  const v = Number.isFinite(t) && t > 0 ? t : 0;
  const tenths = Math.floor(v * 10 + 1e-6);
  const s = Math.floor(tenths / 10);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')},${tenths % 10}`;
}

/** Avança (ou recua) `dir` frames, sempre em cima da grelha dos frames e dentro da sequência. */
export function stepFrame(t: number, dir: number, total: number): number {
  const f = Math.round((Number.isFinite(t) ? t : 0) * FPS) + Math.round(dir);
  const lastFrame = Math.max(0, Math.floor(total * FPS + 1e-6) - 1);
  return Math.max(0, Math.min(lastFrame, f)) / FPS;
}

/** O íman do cursor: perto de uma junção (a menos de `tolPx` píxeis) cola-se a ela. */
export function snapTime(t: number, cuts: number[], pps: number, tolPx = 8): number {
  let best = t, bestD = tolPx / Math.max(1, pps);
  for (const c of cuts) { const d = Math.abs(c - t); if (d <= bestD) { best = c; bestD = d; } }
  return best;
}

/** Os instantes das junções (inclui o 0 e o fim). */
export function cutPoints(durations: number[]): number[] {
  const out = [0];
  let t = 0;
  for (const d of durations) { t += d; out.push(Math.round(t * 1000) / 1000); }
  return out;
}

/**
 * Ao reordenar, os clipes ficam em quadrados iguais (`slot` píxeis com o espaço): o lugar onde o clipe cai para o centro
 * dele em `x` (píxeis desde o início do primeiro quadrado).
 */
export const reorderIndex = (x: number, slot: number, count: number) => Math.max(0, Math.min(count - 1, Math.floor(x / Math.max(1, slot))));

/**
 * Mantém o cursor à vista enquanto toca: quando passa do meio da vista, a linha desliza com ele (fica no meio, como no
 * CapCut); se ficar para trás (recomeçou do início), volta a aparecer.
 */
export function followScroll(o: { x: number; scrollLeft: number; width: number; margin?: number }): number | null {
  const m = o.margin ?? 24;
  if (o.x > o.scrollLeft + o.width / 2 + 0.5 || o.x < o.scrollLeft + m) return Math.max(0, o.x - o.width / 2);
  return null;
}

/** Distância entre dois toques (para a pinça). */
export const pinchDistance = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
