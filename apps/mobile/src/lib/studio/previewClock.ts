/**
 * O relógio da pré-visualização nativa do estúdio (sem React; testado em tests/studioPreviewClock.test.mjs).
 *
 * No site a pré-visualização é o próprio canvas da montagem. No telemóvel não há canvas: cada coisa toca no seu leitor
 * (os vídeos no expo-video, a música e a voz-off no expo-audio, os textos e stickers em Views) e todos seguem **um relógio
 * só**, o do projeto. Este ficheiro é esse relógio e as contas que dizem a cada leitor onde devia estar:
 * - o tempo do projeto a partir do relógio do sistema (tocar, pausar, saltar, chegar ao fim);
 * - o clipe que está no ecrã, a transição que entra e o zoom lento das fotos;
 * - onde a música (em ciclo, a partir do trecho) e a voz-off deviam estar, e quando é que um leitor se afastou demais;
 * - os efeitos sonoros que caem entre dois tiques.
 */

export interface Clock {
  playing: boolean;
  /** O tempo do projeto (s) no instante `anchor`. */
  base: number;
  /** O relógio do sistema (ms) em que `base` valia. */
  anchor: number;
  total: number;
}

const fin = (n: number, d = 0) => (Number.isFinite(n) ? n : d);
const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));

export const makeClock = (total: number, now = 0): Clock => ({ playing: false, base: 0, anchor: now, total: Math.max(0, fin(total)) });

/** O tempo do projeto agora (nunca passa do fim). */
export function clockTime(c: Clock, now: number): number {
  const t = c.playing ? c.base + (now - c.anchor) / 1000 : c.base;
  return clamp(fin(t), 0, c.total);
}
/** Chegou ao fim a tocar (a pré-visualização pára no último frame, como no site). */
export const clockEnded = (c: Clock, now: number) => c.playing && c.total > 0 && c.base + (now - c.anchor) / 1000 >= c.total - 1e-3;

/** Tocar a partir de `from` (sem ele, de onde está; no fim, recomeça do princípio). */
export function clockPlay(c: Clock, now: number, from?: number): Clock {
  let at = from != null ? clamp(fin(from), 0, c.total) : clockTime(c, now);
  if (at >= c.total - 0.05) at = 0;
  return { ...c, playing: c.total > 0, base: at, anchor: now };
}
export const clockPause = (c: Clock, now: number): Clock => ({ ...c, playing: false, base: clockTime(c, now), anchor: now });
/** Saltar para `t` (continua a tocar se estava a tocar). */
export const clockSeek = (c: Clock, now: number, t: number): Clock => ({ ...c, base: clamp(fin(t), 0, c.total), anchor: now });
/** A sequência mudou de duração: o relógio fica no mesmo instante (ou no fim novo, se encolheu). */
export function clockResize(c: Clock, now: number, total: number): Clock {
  const T = Math.max(0, fin(total));
  const at = Math.min(clockTime(c, now), T);
  return { ...c, total: T, base: at, anchor: now, playing: c.playing && T > 0 && at < T - 1e-3 };
}

// ---------------------------------------------------------------- os clipes

export interface ClockSeg { start: number; dur: number }

/** O clipe no instante `t` e quanto já passou dele. Numa junção conta o seguinte; depois do fim, o último (no fim dele). */
export function segAt(segs: readonly ClockSeg[], t: number): { index: number; local: number } {
  if (!segs.length) return { index: -1, local: 0 };
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    if (t < s.start + s.dur - 1e-6) return { index: i, local: Math.max(0, t - s.start) };
  }
  const last = segs.length - 1;
  return { index: last, local: segs[last].dur };
}

/** A transição que está a decorrer: `p` de 0 a 1 nos primeiros `dur` segundos do clipe que entra (null fora dela). */
export function transitionAt(local: number, tr: { type: string; dur: number } | null | undefined, index: number): { type: string; p: number } | null {
  if (!tr || index <= 0 || tr.type === 'corte' || !(tr.dur > 0) || local >= tr.dur) return null;
  return { type: tr.type, p: clamp(local / tr.dur, 0, 1) };
}

/**
 * O zoom lento de uma foto no instante `local`: de 1 a 1,07 ao centro (docs/estudio-efeitos.md, «Fotos»); um frame congelado
 * fica parado; com `focus` (Montagem mágica), de `from` a `to`, a puxar para o ponto de interesse.
 */
export function photoZoom(local: number, dur: number, fx?: { freeze?: unknown; focus?: { x: number; y: number; from: number; to: number } } | null): { scale: number; x: number; y: number } {
  const u = clamp(dur > 0 ? local / dur : 0, 0, 1);
  if (fx?.freeze) return { scale: 1, x: 0.5, y: 0.5 };
  if (fx?.focus) {
    const f = fx.focus;
    return { scale: fin(f.from, 1) + (fin(f.to, 1.07) - fin(f.from, 1)) * u, x: clamp(fin(f.x, 0.5), 0, 1), y: clamp(fin(f.y, 0.5), 0, 1) };
  }
  return { scale: 1 + 0.07 * u, x: 0.5, y: 0.5 };
}

// ---------------------------------------------------------------- os leitores

/**
 * Onde a música devia estar (s dentro da faixa): toca a partir do trecho (`startMs`) e, quando a faixa acaba, recomeça do
 * princípio dela (em ciclo, como o `-stream_loop -1` + `atrim` do servidor).
 */
export function musicPosition(t: number, startMs: number, trackSeconds: number | null | undefined): number {
  const pos = Math.max(0, fin(startMs) / 1000 + Math.max(0, fin(t)));
  const D = trackSeconds && trackSeconds > 0.2 ? trackSeconds : 0;
  return D ? pos % D : pos;
}

/** Onde a voz-off devia estar (s dentro da gravação), ou null quando não se ouve neste instante. */
export function voicePosition(t: number, v: { at: number; duration: number; skip?: number } | null | undefined, total: number): number | null {
  if (!v || !(v.duration > 0)) return null;
  if (t < v.at - 1e-6 || t >= Math.min(total, v.at + v.duration) - 1e-3) return null;
  return Math.max(0, t - v.at) + Math.max(0, v.skip ?? 0);
}

export type Drift = 'ok' | 'seek';
/**
 * Um leitor afastou-se do relógio? Dentro da folga (por omissão 0,25 s, mais um pouco a velocidades altas) deixa-se andar:
 * saltar a cada tique dava soluços. Fora dela, volta-se a pôr no sítio.
 */
export function drift(expected: number, actual: number, rate = 1, tolerance = 0.25): Drift {
  if (!Number.isFinite(actual)) return 'seek';
  return Math.abs(expected - actual) > tolerance * Math.max(1, Math.abs(rate)) ? 'seek' : 'ok';
}

/** Os efeitos sonoros que caem em `[from, to)`: os que se disparam neste tique (num salto para trás, nenhum). */
export function cuesBetween<T extends { at: number }>(cues: readonly T[], from: number, to: number): T[] {
  if (!(to > from) || to - from > 1.5) return [];
  return cues.filter((c) => c.at >= from - 1e-6 && c.at < to - 1e-6);
}

/**
 * O volume de um canal neste instante: o volume do misturador × o fade (0 a 1) × o ducking (0 a 1), arredondado às centésimas
 * (um leitor só recebe um volume novo quando muda de facto).
 */
export const channelVolume = (volume: number, fade = 1, duck = 1) => Math.round(clamp(fin(volume, 1), 0, 1) * clamp(fin(fade, 1), 0, 1) * clamp(fin(duck, 1), 0, 1) * 100) / 100;

/**
 * Ao contrário, um vídeo não toca: a pré-visualização salta de frame em frame para trás. O ponto do ficheiro para o tique
 * de agora, alinhado a passos de `1 / fps` (para não pedir o mesmo frame duas vezes).
 */
export function reverseStep(src: number, fps = 8): number {
  const step = 1 / Math.max(1, fps);
  return Math.max(0, Math.round(fin(src) / step) * step);
}

/** «0:07 / 0:20» só muda uma vez por segundo: a chave para saber se o texto do relógio tem de ser redesenhado. */
export const clockKey = (t: number, total: number) => `${Math.floor(Math.max(0, fin(t)))}/${Math.floor(Math.max(0, fin(total)))}`;
