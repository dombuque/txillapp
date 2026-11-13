/**
 * As contas do som do estúdio das tchekas, sem React nem browser (testadas em tests/studioAudio.test.mjs):
 * - a forma de onda (picos) e a energia de uma música, e o trecho sugerido (o refrão ou a parte mais forte);
 * - onde há voz numa gravação (para o «ducking»: a música baixa enquanto se fala) e as curvas de ganho da música;
 * - «Ajustar ao ritmo»: os cortes das fotos e dos vídeos a cair nas batidas do trecho escolhido;
 * - os moldes de ritmo (Rápido, Cinemático, Amapiano, Marrabenta, Slow);
 * - o estado do som do estúdio (`StudioMix`) e as assinaturas dele.
 * Só tipos de fora (os valores ficam aqui), para correr no Node sem compilar.
 */
import type { SfxId, VoiceFxId } from './audioDsp';

const EPS = 1e-6;
const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
const r3 = (x: number) => Math.round(x * 1000) / 1000;

// ---------------------------------------------------------------- o estado

export interface Region { start: number; end: number }

/** A voz-off gravada: quando entra na tcheka, quanto dura, o volume, o efeito, onde há voz e a onda (para desenhar). */
export interface VoiceTake {
  id: string;
  /** Segundos da tcheka em que a voz começa. */
  at: number;
  duration: number;
  volume: number;
  fx: VoiceFxId;
  /** Onde há voz (segundos dentro da gravação). */
  regions: Region[];
  /** A onda, de 0 a 1 (uns 60 valores por segundo no máximo). */
  peaks: number[];
  /** O ficheiro da gravação (um `blob:` desta sessão): é o que o rascunho guarda e o que se volta a ler ao abri-lo. */
  uri?: string;
  /** O tipo do ficheiro da gravação. */
  mime?: string;
  /** Segundos cortados no início do ficheiro (a gravação começou antes do 0 da tcheka). */
  skip?: number;
}
export interface PlacedSfx { key: string; id: SfxId; at: number }

export interface StudioMix {
  /** Onde começa o trecho da música (ms dentro da faixa). */
  musicStartMs: number;
  /** Se o início veio da sugestão (enquanto ninguém mexer, uma música nova volta a ter sugestão). */
  musicStartAuto: boolean;
  fadeIn: number;
  fadeOut: number;
  ducking: boolean;
  origFx: VoiceFxId;
  voice: VoiceTake | null;
  sfx: PlacedSfx[];
  sfxVolume: number;
}
export const defaultMix = (): StudioMix => ({ musicStartMs: 0, musicStartAuto: true, fadeIn: 0, fadeOut: 0, ducking: true, origFx: 'normal', voice: null, sfx: [], sfxVolume: 1 });

/**
 * O que obriga a recomeçar a pré-visualização (do ponto onde está): o trecho da música e a voz-off (outra gravação ou outro
 * sítio). O resto (fades, ducking, efeitos, volumes, efeitos sonoros) muda a tocar.
 */
export const mixTimingParts = (m: StudioMix) => [m.musicStartMs, m.voice ? [m.voice.id, m.voice.at] : null];
/** Tudo o que muda o som final (para saber se a volta gravada na pré-visualização ainda vale). */
export const mixParts = (m: StudioMix) => [mixTimingParts(m), m.fadeIn, m.fadeOut, m.ducking, m.origFx, m.voice ? [m.voice.volume, m.voice.fx] : null, m.sfx.map((s) => [s.id, s.at]), m.sfxVolume];

/** Quantos segundos da voz-off ficam dentro da tcheka (para a regra do som). */
export function voiceSecondsIn(v: Pick<VoiceTake, 'at' | 'duration'> | null | undefined, total: number): number {
  if (!v || !(v.duration > 0)) return 0;
  return Math.max(0, Math.min(v.at + v.duration, total) - Math.max(0, v.at));
}

// ---------------------------------------------------------------- forma de onda e energia

/** Os picos de `samples` em `buckets` bocados (0 a 1, relativos ao pico mais alto). */
export function peaks(samples: ArrayLike<number>, buckets: number): number[] {
  const n = Math.max(1, Math.floor(buckets));
  const out = new Array<number>(n).fill(0);
  const len = samples.length;
  if (!len) return out;
  const step = len / n;
  let top = 0;
  for (let b = 0; b < n; b++) {
    const a = Math.floor(b * step), z = Math.min(len, Math.max(a + 1, Math.floor((b + 1) * step)));
    // Nos bocados grandes não é preciso ver todas as amostras: chega uma em cada poucas (a onda fica igual).
    const stride = Math.max(1, Math.floor((z - a) / 256));
    let m = 0;
    for (let i = a; i < z; i += stride) { const v = Math.abs(samples[i]); if (v > m) m = v; }
    out[b] = m;
    if (m > top) top = m;
  }
  return top > 0 ? out.map((v) => Math.round((v / top) * 1000) / 1000) : out;
}

/** A energia (RMS) em blocos de `blockS` segundos. */
export function energyBlocks(samples: ArrayLike<number>, rate: number, blockS = 0.1): number[] {
  const size = Math.max(1, Math.round(rate * blockS));
  const n = Math.floor(samples.length / size);
  const out: number[] = [];
  const stride = Math.max(1, Math.floor(size / 512));
  for (let b = 0; b < n; b++) {
    let e = 0, k = 0;
    for (let i = b * size; i < (b + 1) * size; i += stride) { const v = samples[i]; e += v * v; k++; }
    out.push(Math.sqrt(e / Math.max(1, k)));
  }
  return out;
}

export type StartMode = 'forte' | 'subida' | 'calmo' | 'inicio';
export interface StartSuggestion {
  /** Onde começa o trecho (segundos dentro da faixa). */
  start: number;
  /** «Refrão» quando o trecho começa numa entrada forte (a música sobe ali), senão «Parte mais forte», «Parte calma» ou «Início». */
  label: 'Refrão' | 'Parte mais forte' | 'Antes do refrão' | 'Parte calma' | 'Início';
}

/**
 * O trecho sugerido para uma tcheka de `windowS` segundos (deteção de energia em blocos de 0,1 s):
 * - `forte`: a janela com mais energia, com um bónus para as que começam numa subida forte (a entrada do refrão ou do «drop»),
 *   e nunca no primeiro segundo e meio quando há mais para escolher (a introdução);
 * - `subida`: a entrada mais forte fica a 40% da janela (ouve-se a subida e o refrão a entrar);
 * - `calmo`: a janela mais tranquila que ainda tem som (para o «Slow»);
 * - `inicio`: o princípio.
 * O início acerta no golpe mais próximo (até 0,35 s antes), para a música entrar numa batida.
 */
export function suggestStart(samples: ArrayLike<number>, rate: number, windowS: number, mode: StartMode = 'forte'): StartSuggestion {
  const B = 0.1;
  const e = energyBlocks(samples, rate, B);
  const total = e.length * B;
  const W = Math.max(1, Math.round(clamp(windowS, 1, 600) / B));
  // Uma música que mal passa da tcheka (menos de 4 s a mais) fica do início.
  if (mode === 'inicio' || e.length < W + 40) return { start: 0, label: 'Início' };
  const acc = new Float64Array(e.length + 1);
  for (let i = 0; i < e.length; i++) acc[i + 1] = acc[i] + e[i];
  const mean = (a: number, b: number) => { const x = clamp(a, 0, e.length), y = clamp(b, 0, e.length); return y > x ? (acc[y] - acc[x]) / (y - x) : 0; };
  const last = e.length - W;
  const top = Math.max(...e, EPS);
  // A subida em cada bloco: os 2 s depois contra os 2 s antes (só a parte positiva).
  const rise = (i: number) => Math.max(0, mean(i, i + 20) - mean(i - 20, i)) / top;
  const intro = Math.min(15, Math.floor(last / 4));
  let best = 0, bestScore = -Infinity, bestRise = 0;
  if (mode === 'calmo') {
    const median = [...e].sort((x, y) => x - y)[Math.floor(e.length / 2)] ?? 0;
    for (let i = 0; i <= last; i++) {
      const m = mean(i, i + W);
      if (m < median * 0.25) continue; // silêncio não é calma
      const s = -m;
      if (s > bestScore) { bestScore = s; best = i; }
    }
    return { start: snapOnset(e, best, B), label: 'Parte calma' };
  }
  let maxRise = 0, maxRiseAt = 0;
  for (let i = 1; i < e.length - 1; i++) { const r = rise(i); if (r > maxRise) { maxRise = r; maxRiseAt = i; } }
  if (mode === 'subida') {
    const s = clamp(Math.round(maxRiseAt - W * 0.4), 0, last);
    return { start: snapOnset(e, s, B), label: 'Antes do refrão' };
  }
  for (let i = intro; i <= last; i++) {
    const r = rise(i);
    const score = mean(i, i + W) / top + 0.6 * r;
    if (score > bestScore + EPS) { bestScore = score; best = i; bestRise = r; }
  }
  return { start: snapOnset(e, best, B), label: bestRise > 0.12 ? 'Refrão' : 'Parte mais forte' };
}

/** Acerta o bloco `i` no golpe (a maior subida de um bloco para o seguinte) até 0,35 s antes ou 0,1 s depois. */
function snapOnset(e: number[], i: number, B: number): number {
  let at = i, best = 0;
  for (let k = Math.max(1, i - 3); k <= Math.min(e.length - 1, i + 1); k++) {
    const d = e[k] - e[k - 1];
    if (d > best) { best = d; at = k; }
  }
  return r3(Math.max(0, at * B));
}

// ---------------------------------------------------------------- voz e ducking

/**
 * Onde há voz numa gravação: blocos de 20 ms com energia acima de um limiar (o maior entre um mínimo fixo e 1/6 do
 * percentil 95), juntando falhas de menos de 0,35 s e com 60 ms de folga para cada lado.
 */
export function voiceActivity(samples: ArrayLike<number>, rate: number, opts: { minGap?: number; pad?: number } = {}): Region[] {
  const B = 0.02;
  const e = energyBlocks(samples, rate, B);
  if (!e.length) return [];
  const sorted = [...e].sort((x, y) => x - y);
  const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? 0;
  const thr = Math.max(0.01, p95 / 6);
  const minGap = opts.minGap ?? 0.35, pad = opts.pad ?? 0.06;
  const out: Region[] = [];
  let open: Region | null = null;
  for (let i = 0; i < e.length; i++) {
    const t = i * B;
    if (e[i] >= thr) {
      if (open && t - open.end <= minGap) open.end = t + B;
      else { if (open) out.push(open); open = { start: t, end: t + B }; }
    }
  }
  if (open) out.push(open);
  const dur = samples.length / rate;
  return out.map((r) => ({ start: r3(Math.max(0, r.start - pad)), end: r3(Math.min(dur, r.end + pad)) }));
}

/** Os pontos (tempo, ganho) do ducking da música: a descer `attack` antes de cada fala, a voltar `release` depois. */
export function duckPoints(regions: Region[], total: number, duck: { gain: number; attack: number; release: number }): { t: number; g: number }[] {
  const pts: { t: number; g: number }[] = [{ t: 0, g: 1 }];
  const merged: Region[] = [];
  // Falas com menos de attack + release entre elas ficam juntas (a música não sobe e desce a meio).
  for (const r of [...regions].sort((a, b) => a.start - b.start)) {
    const prev = merged[merged.length - 1];
    if (prev && r.start - prev.end < duck.attack + duck.release) prev.end = Math.max(prev.end, r.end);
    else merged.push({ ...r });
  }
  for (const r of merged) {
    if (r.end <= 0 || r.start >= total) continue;
    const a = Math.max(0, r.start - duck.attack);
    const last = pts[pts.length - 1];
    if (a > last.t) pts.push({ t: r3(a), g: 1 });
    pts.push({ t: r3(Math.max(a, r.start)), g: duck.gain });
    pts.push({ t: r3(r.end), g: duck.gain });
    pts.push({ t: r3(r.end + duck.release), g: 1 });
  }
  if (pts[pts.length - 1].t < total) pts.push({ t: r3(total), g: pts[pts.length - 1].g });
  return pts;
}

/** O valor de uma curva por pontos (linear entre eles) no instante `t`. */
export function curveAt(pts: { t: number; g: number }[], t: number): number {
  if (!pts.length) return 1;
  if (t <= pts[0].t) return pts[0].g;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    if (t <= b.t) return b.t - a.t > EPS ? a.g + ((b.g - a.g) * (t - a.t)) / (b.t - a.t) : b.g;
  }
  return pts[pts.length - 1].g;
}

// ---------------------------------------------------------------- ajustar ao ritmo

export interface BeatItem {
  video: boolean;
  /** Duração no vídeo final (segundos). */
  seconds: number;
  /** Vídeos: o corte (segundos no ficheiro), a duração do ficheiro e a velocidade. */
  trim?: { start: number; end: number };
  length?: number;
  speed?: number;
}
export interface BeatFit {
  /** Fotos: quantas batidas fica cada uma (1, 2 ou 4). */
  beats: (number | null)[];
  /** Vídeos: o corte novo (o fim mexe para o corte cair numa batida); null se não mudou. */
  trims: ({ start: number; end: number } | null)[];
}

const BEAT_CHOICES = [1, 2, 4] as const;

/**
 * «Ajustar ao ritmo»: cada corte cai numa batida da grelha (`grid`, segundos da tcheka, já a partir do trecho escolhido).
 * - Fotos: o número de batidas (1, 2 ou 4) mais perto do tempo que tinham (ou as de `photoBeats`, num molde).
 * - Vídeos: o fim do corte mexe para a batida mais perto (para trás, ou para a frente se o ficheiro tiver para dar), com
 *   pelo menos 0,5 s; com `maxBeats`, ficam no máximo com essas batidas.
 * Os cortes contam a partir do anterior, já acertado (como `rhythmDurations`: uma foto que começa numa batida acaba
 * `beats` batidas depois).
 */
export function fitToBeats(items: BeatItem[], grid: number[], opts: { photoBeats?: (photoIndex: number) => number; maxBeats?: number | null } = {}): BeatFit {
  const period = grid.length > 1 ? grid[1] - grid[0] : 0.5;
  const beatAt = (i: number) => (i < grid.length ? grid[i] : (grid[grid.length - 1] ?? 0) + (i - grid.length + 1) * period);
  const firstAfter = (t: number) => { let i = 0; while (beatAt(i) < t - EPS) i++; return i; };
  let t = 0;
  let photo = 0;
  const beats: (number | null)[] = [];
  const trims: ({ start: number; end: number } | null)[] = [];
  for (const it of items) {
    if (!it.video) {
      const want = opts.photoBeats ? opts.photoBeats(photo) : BEAT_CHOICES.reduce((b, c) => (Math.abs(c * period - it.seconds) < Math.abs(b * period - it.seconds) - EPS ? c : b), 2 as number);
      photo += 1;
      beats.push(want);
      trims.push(null);
      // Como rhythmDurations: acaba `want` batidas depois da primeira batida a pelo menos 0,25 s do início.
      let i = 0;
      while (beatAt(i) < t + 0.25 - EPS) i++;
      t = beatAt(i + want - 1);
      continue;
    }
    beats.push(null);
    const speed = it.speed && it.speed > 0 ? it.speed : 1;
    const trim = it.trim ?? { start: 0, end: it.seconds * speed };
    const length = it.length ?? trim.end;
    const end = t + it.seconds;
    const fits = (b: number) => trim.start + (beatAt(b) - t) * speed <= length + EPS;
    // A primeira batida a pelo menos 0,5 s; depois a última antes do fim, ou a seguinte se ficar mais perto e o ficheiro der.
    const k = firstAfter(t + 0.5);
    let b = k;
    while (beatAt(b + 1) <= end + EPS) b++;
    if (beatAt(b) > end + EPS) {
      if (!fits(b)) { trims.push(null); t = end; continue; } // curto demais para chegar à primeira batida
    } else if (fits(b + 1) && beatAt(b + 1) - end < end - beatAt(b)) b += 1;
    if (opts.maxBeats) {
      // No máximo `maxBeats` batidas a contar da primeira depois do início do clipe.
      let j = 0;
      while (beatAt(j) <= t + EPS) j++;
      b = Math.min(b, Math.max(k, j + opts.maxBeats - 1));
    }
    const seconds = beatAt(b) - t;
    const newEnd = Math.round(Math.min(length, trim.start + seconds * speed) * 1000) / 1000;
    trims.push(Math.abs(newEnd - trim.end) > 0.005 ? { start: trim.start, end: newEnd } : null);
    t += (newEnd - trim.start) / speed;
  }
  return { beats, trims };
}

/** Quanto mexer no início da música para uma batida cair no 0 da tcheka (a fase da grelha, se for mais de 40 ms). */
export const downbeatShift = (offset: number, period: number) => (offset > 0.04 && offset < period - 0.04 ? r3(offset) : 0);

// ---------------------------------------------------------------- moldes

export type TransitionId = 'none' | 'fade' | 'slide';
export interface Template {
  id: string;
  name: string;
  /** Uma linha para o cartão. */
  desc: string;
  /** Batidas por foto e o máximo de batidas por vídeo (sem música: os segundos de cada foto). */
  photoBeats: 1 | 2 | 4;
  videoBeats: number | null;
  photoSeconds: 2 | 3 | 5;
  transition: TransitionId;
  start: StartMode;
  fadeIn: number;
  fadeOut: number;
  /** O desenho do cartão: as durações relativas dos cortes. */
  pattern: number[];
}

export const TEMPLATES: Template[] = [
  { id: 'rapido', name: 'Rápido', desc: 'Um corte por batida, secos, no refrão', photoBeats: 1, videoBeats: 2, photoSeconds: 2, transition: 'none', start: 'forte', fadeIn: 0, fadeOut: 0.5, pattern: [1, 1, 1, 1, 1, 1, 1, 1] },
  { id: 'cinematico', name: 'Cinemático', desc: '4 batidas por plano, a fundir, com a subida', photoBeats: 4, videoBeats: null, photoSeconds: 5, transition: 'fade', start: 'subida', fadeIn: 1.5, fadeOut: 2.5, pattern: [4, 4, 4] },
  { id: 'amapiano', name: 'Amapiano', desc: '2 batidas, a deslizar, no log drum', photoBeats: 2, videoBeats: 4, photoSeconds: 3, transition: 'slide', start: 'forte', fadeIn: 0.3, fadeOut: 1, pattern: [2, 2, 1, 1, 2, 2] },
  { id: 'marrabenta', name: 'Marrabenta', desc: 'Ritmo de festa: 1 e 2 batidas, secos', photoBeats: 2, videoBeats: 2, photoSeconds: 2, transition: 'none', start: 'forte', fadeIn: 0, fadeOut: 1, pattern: [1, 2, 1, 2, 1, 2] },
  { id: 'slow', name: 'Slow', desc: 'Planos longos a fundir, na parte calma', photoBeats: 4, videoBeats: null, photoSeconds: 5, transition: 'fade', start: 'calmo', fadeIn: 2, fadeOut: 3, pattern: [5, 5] },
];

/**
 * As batidas por foto num molde: a Marrabenta alterna 1 e 2 (o «passo» da dança), os outros usam sempre as do molde.
 * `i` é o lugar da foto entre as fotos.
 */
export const templatePhotoBeats = (t: Template, i: number): 1 | 2 | 4 => (t.id === 'marrabenta' ? (i % 2 === 0 ? 1 : 2) : t.photoBeats);
