/**
 * Os efeitos do estúdio das tchekas, sem React nem browser (testados em tests/studioEffects.test.mjs). É também o contrato
 * que a montagem no servidor (ffmpeg, para o nativo) tem de reproduzir: ver docs/estudio-efeitos.md.
 *
 * - Cor: matrizes 4×5 (como o feColorMatrix do SVG), os 16 filtros com intensidade e os 8 ajustes, e o pixel de referência
 *   (`applyFxPixel`) que o shader WebGL (lib/studio/renderGL.ts) e o ffmpeg seguem.
 * - Transições entre clipes (por junção, com duração).
 * - Velocidade: rampas (Montaria, Herói, Bala, Flash), inverter e congelar.
 * - Camadas por cima (texto e stickers): o tempo, as animações de entrada, saída e em ciclo, a zona segura e as guias.
 * - A serialização do contrato (`fxContract`, `parseFxContract`, `stringifyFxContract`) e os filtros ffmpeg equivalentes.
 *
 * Nada aqui importa código em tempo de execução: o Node corre este ficheiro diretamente nos testes.
 */

/** Versão do contrato JSON (sobe quando um campo muda de significado). */
export const FX_VERSION = 1;
/** O quadro da tcheka: 9:16 a 30 fps. Todas as medidas em px das camadas são deste quadro. */
export const FRAME = { w: 1080, h: 1920, fps: 30 } as const;

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const num = (v: unknown, d: number, a: number, b: number) => (typeof v === 'number' && Number.isFinite(v) ? clamp(v, a, b) : d);
const r3 = (v: number) => Math.round(v * 1000) / 1000;
const r4 = (v: number) => Math.round(v * 10000) / 10000;

// ================================================================ easing

export const easeOutCubic = (x: number) => 1 - Math.pow(1 - clamp(x, 0, 1), 3);
export const easeInOutCubic = (x: number) => { const t = clamp(x, 0, 1); return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; };
/** Passa um pouco do fim e volta (o «pop»). */
export const easeOutBack = (x: number) => { const t = clamp(x, 0, 1); const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); };

// ================================================================ cor

/**
 * Matriz de cor 4×5, por linhas (R, G, B, A) e colunas (r, g, b, a, deslocamento), com as cores de 0 a 1, como o
 * feColorMatrix do SVG: R' = m0·r + m1·g + m2·b + m3·a + m4.
 */
export type ColorMatrix = number[];
export const IDENTITY: ColorMatrix = [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0];

/** `a ∘ b`: primeiro aplica `b`, depois `a`. */
export function multiply(a: ColorMatrix, b: ColorMatrix): ColorMatrix {
  const out = new Array<number>(20).fill(0);
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 5; j++) {
      let s = j === 4 ? a[i * 5 + 4] : 0;
      for (let k = 0; k < 4; k++) s += a[i * 5 + k] * b[k * 5 + j];
      out[i * 5 + j] = s;
    }
  }
  return out;
}
/** A meio caminho entre a identidade e `m` (a intensidade de um filtro: 0 = sem efeito, 1 = inteiro). */
export const mixMatrix = (m: ColorMatrix, k: number): ColorMatrix => m.map((v, i) => IDENTITY[i] + (v - IDENTITY[i]) * k);
/** Aplica a matriz a uma cor RGB (0 a 1), com o resultado limitado a 0..1. */
export function applyMatrix(m: ColorMatrix, rgb: readonly [number, number, number]): [number, number, number] {
  const [r, g, b] = rgb;
  return [0, 1, 2].map((i) => clamp(m[i * 5] * r + m[i * 5 + 1] * g + m[i * 5 + 2] * b + m[i * 5 + 3] + m[i * 5 + 4], 0, 1)) as [number, number, number];
}
export const isIdentity = (m: ColorMatrix, eps = 1e-4) => m.every((v, i) => Math.abs(v - IDENTITY[i]) < eps);

const rgbM = (m9: number[], off: [number, number, number] = [0, 0, 0]): ColorMatrix => [
  m9[0], m9[1], m9[2], 0, off[0], m9[3], m9[4], m9[5], 0, off[1], m9[6], m9[7], m9[8], 0, off[2], 0, 0, 0, 1, 0,
];
const diag = (r: number, g: number, b: number, off: [number, number, number] = [0, 0, 0]) => rgbM([r, 0, 0, 0, g, 0, 0, 0, b], off);

/** As operações de cor de que se fazem os filtros e os ajustes (as fórmulas são as do CSS/SVG Filter Effects). */
export type ColorOp =
  | ['brightness', number] // ganho: 1 = igual
  | ['contrast', number] // 1 = igual
  | ['saturate', number] // 0 = cinzento, 1 = igual
  | ['hue', number] // graus
  | ['sepia', number] // 0 a 1
  | ['grayscale', number] // 0 a 1
  | ['temperature', number] // -1 frio … 1 quente
  | ['tint', number] // -1 verde … 1 magenta
  | ['fade', number] // 0 a 1: levanta os pretos e baixa os brancos
  | ['colorize', number, number, number, number] // r, g, b (0 a 255) e quanto (0 a 1)
  | ['lift', number, number, number]; // cor nas sombras (0 a 1 por canal)

export function opMatrix(op: ColorOp): ColorMatrix {
  switch (op[0]) {
    case 'brightness': return diag(op[1], op[1], op[1]);
    case 'contrast': { const c = op[1], o = (1 - c) / 2; return diag(c, c, c, [o, o, o]); }
    case 'saturate': {
      const s = op[1];
      return rgbM([0.213 + 0.787 * s, 0.715 - 0.715 * s, 0.072 - 0.072 * s, 0.213 - 0.213 * s, 0.715 + 0.285 * s, 0.072 - 0.072 * s, 0.213 - 0.213 * s, 0.715 - 0.715 * s, 0.072 + 0.928 * s]);
    }
    case 'hue': {
      const a = (op[1] * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
      return rgbM([
        0.213 + c * 0.787 - s * 0.213, 0.715 - c * 0.715 - s * 0.715, 0.072 - c * 0.072 + s * 0.928,
        0.213 - c * 0.213 + s * 0.143, 0.715 + c * 0.285 + s * 0.14, 0.072 - c * 0.072 - s * 0.283,
        0.213 - c * 0.213 - s * 0.787, 0.715 - c * 0.715 + s * 0.715, 0.072 + c * 0.928 + s * 0.072,
      ]);
    }
    case 'sepia': {
      const k = 1 - clamp(op[1], 0, 1);
      return rgbM([0.393 + 0.607 * k, 0.769 - 0.769 * k, 0.189 - 0.189 * k, 0.349 - 0.349 * k, 0.686 + 0.314 * k, 0.168 - 0.168 * k, 0.272 - 0.272 * k, 0.534 - 0.534 * k, 0.131 + 0.869 * k]);
    }
    case 'grayscale': {
      const k = 1 - clamp(op[1], 0, 1);
      return rgbM([0.2126 + 0.7874 * k, 0.7152 - 0.7152 * k, 0.0722 - 0.0722 * k, 0.2126 - 0.2126 * k, 0.7152 + 0.2848 * k, 0.0722 - 0.0722 * k, 0.2126 - 0.2126 * k, 0.7152 - 0.7152 * k, 0.0722 + 0.9278 * k]);
    }
    case 'temperature': { const t = op[1]; return diag(1 + 0.18 * t, 1 + 0.04 * t, 1 - 0.22 * t); }
    case 'tint': { const t = op[1]; return diag(1 + 0.04 * t, 1 - 0.12 * t, 1 + 0.04 * t); }
    case 'fade': { const f = clamp(op[1], 0, 1), k = 1 - 0.22 * f, o = 0.1 * f; return diag(k, k, k, [o, o, o]); }
    case 'colorize': { const a = clamp(op[4], 0, 1), k = 1 - a; return diag(k, k, k, [(op[1] / 255) * a, (op[2] / 255) * a, (op[3] / 255) * a]); }
    case 'lift': { const [, r, g, b] = op; return diag(1 - r, 1 - g, 1 - b, [r, g, b]); }
  }
}
/** As operações pela ordem (a primeira aplica-se primeiro). */
export const opsMatrix = (ops: readonly ColorOp[]): ColorMatrix => ops.reduce<ColorMatrix>((m, op) => multiply(opMatrix(op), m), IDENTITY);

// ---------------------------------------------------------------- filtros

export interface FilterDef {
  id: string;
  name: string;
  /** A personalidade, numa linha (aparece por baixo do nome e no leitor de ecrã). */
  mood: string;
  ops: ColorOp[];
  sharpen?: number;
  vignette?: number;
  grain?: number;
  /** Cor da bolinha do filtro (quando ainda não há miniatura). */
  swatch: string;
}

/** Os 16 filtros (o primeiro é sem filtro). A intensidade mistura cada um com o original. */
export const FILTERS: FilterDef[] = [
  { id: 'normal', name: 'Normal', mood: 'Sem filtro', ops: [], swatch: '#9aa0a6' },
  { id: 'matapa', name: 'Matapa', mood: 'Verde fundo da folha de mandioca, terra quente', ops: [['temperature', 0.15], ['tint', -0.35], ['saturate', 1.12], ['contrast', 1.06], ['lift', 0.02, 0.05, 0.01]], swatch: '#4f7d3a' },
  { id: 'costa-do-sol', name: 'Costa do Sol', mood: 'Fim de tarde dourado na marginal', ops: [['temperature', 0.45], ['brightness', 1.06], ['saturate', 1.25], ['contrast', 1.05], ['fade', 0.1]], vignette: 0.15, swatch: '#f2a541' },
  { id: 'xima', name: 'Xima', mood: 'Claro, cremoso e suave', ops: [['brightness', 1.08], ['contrast', 0.9], ['saturate', 0.8], ['fade', 0.3], ['temperature', 0.12], ['colorize', 255, 244, 225, 0.06]], swatch: '#efe6d2' },
  { id: 'noite-de-maputo', name: 'Noite de Maputo', mood: 'Néon azul e magenta, sombras frias', ops: [['temperature', -0.55], ['tint', 0.3], ['contrast', 1.22], ['saturate', 1.2], ['brightness', 0.95], ['lift', 0.03, 0, 0.09]], vignette: 0.45, swatch: '#3b2b8f' },
  { id: 'marrabenta', name: 'Marrabenta', mood: 'Vivo, quente e com contraste, para dançar', ops: [['saturate', 1.5], ['contrast', 1.15], ['temperature', 0.18], ['brightness', 1.03]], swatch: '#e8432e' },
  { id: 'capulana', name: 'Capulana', mood: 'Cores fortes como um pano novo', ops: [['saturate', 1.7], ['hue', 12], ['contrast', 1.12]], sharpen: 0.15, swatch: '#f0b400' },
  { id: 'ilha', name: 'Ilha', mood: 'Turquesa e pedra branca da Ilha de Moçambique', ops: [['temperature', -0.2], ['tint', -0.1], ['brightness', 1.06], ['saturate', 1.12], ['contrast', 0.98], ['colorize', 64, 200, 210, 0.06]], swatch: '#3fbac2' },
  { id: 'tofo', name: 'Tofo', mood: 'Oceano azul e verde, de mergulho', ops: [['temperature', -0.32], ['saturate', 1.25], ['contrast', 1.08], ['hue', -6]], swatch: '#1f7fbf' },
  { id: 'gorongosa', name: 'Gorongosa', mood: 'Savana: verdes de terra e luz dura', ops: [['temperature', 0.28], ['saturate', 0.88], ['contrast', 1.12], ['tint', -0.15]], sharpen: 0.2, vignette: 0.25, swatch: '#8a7a3c' },
  { id: 'limpopo', name: 'Limpopo', mood: 'Pôr do sol laranja sobre o rio', ops: [['temperature', 0.6], ['tint', 0.18], ['saturate', 1.15], ['contrast', 1.06], ['colorize', 255, 120, 60, 0.08]], vignette: 0.25, swatch: '#ff7a3d' },
  { id: 'cacimba', name: 'Cacimba', mood: 'Neblina da manhã, tudo calmo', ops: [['fade', 0.45], ['contrast', 0.85], ['saturate', 0.75], ['temperature', -0.1], ['brightness', 1.05]], swatch: '#b8c4cc' },
  { id: 'vintage', name: 'Vintage', mood: 'Machimbombo dos anos 70, com grão', ops: [['sepia', 0.4], ['fade', 0.25], ['temperature', 0.2], ['contrast', 0.95], ['saturate', 0.85]], grain: 0.35, vignette: 0.35, swatch: '#a5784a' },
  { id: 'pb', name: 'P&B', mood: 'Mafalala a preto e branco, documental', ops: [['grayscale', 1], ['contrast', 1.3], ['brightness', 1.02]], grain: 0.2, sharpen: 0.15, swatch: '#6b6b6b' },
  { id: 'polana', name: 'Polana', mood: 'Preto e branco suave e elegante', ops: [['grayscale', 1], ['contrast', 0.92], ['fade', 0.15], ['brightness', 1.05], ['sepia', 0.08]], swatch: '#cfcfcf' },
  { id: 'txillapp', name: 'Txillapp', mood: 'O coral da casa', ops: [['colorize', 214, 51, 79, 0.1], ['saturate', 1.12], ['contrast', 1.06], ['temperature', 0.08]], swatch: '#d6334f' },
];
const FILTER_BY_ID = new Map(FILTERS.map((f) => [f.id, f]));
export const filterById = (id: string | null | undefined): FilterDef | undefined => (id ? FILTER_BY_ID.get(id) : undefined);

// ---------------------------------------------------------------- ajustes

export interface Adjust {
  /** -1 a 1 */ brightness: number;
  /** -1 a 1 */ contrast: number;
  /** -1 a 1 */ saturation: number;
  /** -1 (frio) a 1 (quente) */ temperature: number;
  /** -1 a 1 (= -180° a 180°) */ hue: number;
  /** 0 a 1 */ sharpen: number;
  /** 0 a 1 */ vignette: number;
  /** 0 a 1 */ grain: number;
}
export type AdjustKey = keyof Adjust;
export const ADJUSTS: { id: AdjustKey; label: string; min: number; max: number }[] = [
  { id: 'brightness', label: 'Brilho', min: -1, max: 1 },
  { id: 'contrast', label: 'Contraste', min: -1, max: 1 },
  { id: 'saturation', label: 'Saturação', min: -1, max: 1 },
  { id: 'temperature', label: 'Temperatura', min: -1, max: 1 },
  { id: 'hue', label: 'Matiz', min: -1, max: 1 },
  { id: 'sharpen', label: 'Nitidez', min: 0, max: 1 },
  { id: 'vignette', label: 'Vinheta', min: 0, max: 1 },
  { id: 'grain', label: 'Grão', min: 0, max: 1 },
];
export function adjustOps(a: Partial<Adjust>): ColorOp[] {
  const ops: ColorOp[] = [];
  if (a.brightness) ops.push(['brightness', 1 + 0.45 * a.brightness]);
  if (a.contrast) ops.push(['contrast', 1 + 0.5 * a.contrast]);
  if (a.saturation) ops.push(['saturate', 1 + a.saturation]);
  if (a.temperature) ops.push(['temperature', a.temperature]);
  if (a.hue) ops.push(['hue', a.hue * 180]);
  return ops;
}

// ================================================================ o que fica em cada clipe (ClipFx)

export type TransitionId =
  | 'corte' | 'fundido' | 'deslizar-esquerda' | 'deslizar-direita' | 'deslizar-cima' | 'deslizar-baixo'
  | 'zoom' | 'desfoque' | 'girar' | 'flash' | 'brilho' | 'glitch';
export interface ClipTransition { type: TransitionId; /** segundos */ dur: number }
export type RampId = 'montaria' | 'heroi' | 'bala' | 'flash';

/**
 * Os efeitos de um clipe (o campo `fx` do clipe na linha do tempo). Tudo opcional: um clipe sem `fx` fica como está, com
 * a transição por omissão (`DEFAULT_TRANSITION`) na entrada.
 */
export interface ClipFx {
  filter?: { id: string; /** 0 a 1 */ amount: number };
  adjust?: Partial<Adjust>;
  /** A transição que entra neste clipe, vinda do anterior (no primeiro clipe não conta). */
  transition?: ClipTransition;
  /** Só vídeos: a rampa de velocidade (por cima da velocidade do clipe). */
  ramp?: RampId;
  /** Só vídeos: ao contrário (o som original deste clipe fica calado). */
  reverse?: boolean;
  /** Só fotos: a foto é um frame congelado do clipe `from` (a chave) no segundo `at` do ficheiro; fica parada (sem zoom). */
  freeze?: { from: string; at: number };
}

/** A transição quando o clipe não tem nenhuma escolhida (a de sempre: fundido de 0,5 s). */
export const DEFAULT_TRANSITION: ClipTransition = { type: 'fundido', dur: 0.5 };
export const TRANSITION_MIN_S = 0.15;
export const TRANSITION_MAX_S = 1.5;

export interface TransitionDef {
  id: TransitionId;
  name: string;
  /** O filtro ffmpeg equivalente (`xfade`), sobre o último frame do clipe anterior parado (ver o doc). */
  ffmpeg: string;
  /** O ffmpeg dá o mesmo desenho (true) ou um parecido (false; para igual, usar o compositor de lib/studio/renderTransitions.ts). */
  exact: boolean;
}
export const TRANSITIONS: TransitionDef[] = [
  { id: 'corte', name: 'Corte', ffmpeg: '', exact: true },
  { id: 'fundido', name: 'Fundido', ffmpeg: 'fade', exact: false },
  { id: 'deslizar-esquerda', name: 'Esquerda', ffmpeg: 'slideleft', exact: false },
  { id: 'deslizar-direita', name: 'Direita', ffmpeg: 'slideright', exact: false },
  { id: 'deslizar-cima', name: 'Cima', ffmpeg: 'slideup', exact: false },
  { id: 'deslizar-baixo', name: 'Baixo', ffmpeg: 'slidedown', exact: false },
  { id: 'zoom', name: 'Zoom', ffmpeg: 'zoomin', exact: false },
  { id: 'desfoque', name: 'Desfoque', ffmpeg: 'hblur', exact: false },
  { id: 'girar', name: 'Girar', ffmpeg: 'radial', exact: false },
  { id: 'flash', name: 'Flash', ffmpeg: 'fadewhite', exact: false },
  { id: 'brilho', name: 'Brilho', ffmpeg: 'fadefast', exact: false },
  { id: 'glitch', name: 'Glitch', ffmpeg: 'pixelize', exact: false },
];
const TRANSITION_IDS = new Set<string>(TRANSITIONS.map((t) => t.id));

/** A transição que vale na entrada do clipe `index` com `clipDur` segundos (no primeiro, nenhuma; nunca mais de 80 % do clipe). */
export function transitionFor(fx: ClipFx | undefined, index: number, clipDur: number): ClipTransition | null {
  if (index <= 0) return null;
  const t = fx?.transition ?? DEFAULT_TRANSITION;
  if (t.type === 'corte') return null;
  const dur = Math.min(clamp(t.dur, TRANSITION_MIN_S, TRANSITION_MAX_S), Math.max(0, clipDur * 0.8));
  return dur >= 0.05 ? { type: t.type, dur } : null;
}

// ---------------------------------------------------------------- velocidade

export interface RampDef { id: RampId; name: string; mood: string; /** (u, velocidade): u de 0 a 1 no tempo do clipe já montado. */ points: [number, number][] }
/** As rampas (como no CapCut/TikTok): a velocidade muda ao longo do clipe, por cima da velocidade dele. */
export const RAMPS: RampDef[] = [
  { id: 'montaria', name: 'Montaria', mood: 'Rápido, lento, rápido, lento', points: [[0, 2], [0.18, 2], [0.28, 0.45], [0.45, 0.45], [0.55, 2], [0.75, 2], [0.85, 0.5], [1, 0.5]] },
  { id: 'heroi', name: 'Herói', mood: 'Normal e câmara lenta no momento', points: [[0, 1], [0.3, 1], [0.42, 0.25], [0.7, 0.25], [0.82, 1], [1, 1]] },
  { id: 'bala', name: 'Bala', mood: 'Muito rápido e quase parado a meio', points: [[0, 3], [0.36, 3], [0.44, 0.15], [0.62, 0.15], [0.7, 3], [1, 3]] },
  { id: 'flash', name: 'Flash', mood: 'Calmo e um disparo a 4×', points: [[0, 0.6], [0.3, 0.6], [0.38, 4], [0.62, 4], [0.7, 0.6], [1, 0.6]] },
];
const RAMP_BY_ID = new Map(RAMPS.map((r) => [r.id, r]));
export const rampById = (id: string | null | undefined): RampDef | undefined => (id ? RAMP_BY_ID.get(id as RampId) : undefined);

/** A velocidade da rampa em `u` (0 a 1), linear entre os pontos. */
export function rampSpeedAt(points: readonly [number, number][], u: number): number {
  const x = clamp(u, 0, 1);
  for (let i = 1; i < points.length; i++) {
    const [u0, s0] = points[i - 1], [u1, s1] = points[i];
    if (x <= u1) return u1 > u0 ? s0 + ((s1 - s0) * (x - u0)) / (u1 - u0) : s1;
  }
  return points[points.length - 1][1];
}
/** ∫₀ᵘ velocidade (o caminho andado na fonte, em unidades do clipe montado). */
export function rampIntegral(points: readonly [number, number][], u: number): number {
  const x = clamp(u, 0, 1);
  let s = 0;
  for (let i = 1; i < points.length; i++) {
    const [u0, s0] = points[i - 1], [u1] = points[i];
    if (x <= u0) break;
    const b = Math.min(x, u1);
    s += ((s0 + rampSpeedAt(points, b)) / 2) * (b - u0);
  }
  return s;
}
/** A velocidade média da rampa (1 = o clipe fica com a mesma duração). */
export const rampAverage = (points: readonly [number, number][]) => rampIntegral(points, 1);

/** Quanto um vídeo dura no vídeo final: o corte, à velocidade dele e com a rampa. As fotos ficam com `trimLen`. */
export function fxSeconds(trimLen: number, speed: number, fx?: ClipFx): number {
  const sp = speed > 0 ? speed : 1;
  const ramp = rampById(fx?.ramp);
  return Math.max(0, trimLen) / sp / (ramp ? rampAverage(ramp.points) : 1);
}
/**
 * Onde está a fonte (segundos desde o início do corte) no instante `tl` do clipe montado com `outDur` segundos, para um
 * corte de `trimLen` segundos. Com rampa, avança pela curva; ao contrário, anda do fim para o início.
 */
export function sourceOffset(tl: number, outDur: number, trimLen: number, speed: number, fx?: ClipFx): number {
  const ramp = rampById(fx?.ramp);
  let off: number;
  if (ramp && outDur > 0) off = (trimLen * rampIntegral(ramp.points, tl / outDur)) / rampAverage(ramp.points);
  else off = tl * (speed > 0 ? speed : 1);
  off = clamp(off, 0, trimLen);
  return fx?.reverse ? trimLen - off : off;
}
/** A velocidade de leitura do vídeo nesse instante (para o `playbackRate`): a do clipe vezes a da rampa. */
export function playbackRateAt(tl: number, outDur: number, speed: number, fx?: ClipFx): number {
  const ramp = rampById(fx?.ramp);
  const sp = speed > 0 ? speed : 1;
  return ramp && outDur > 0 ? sp * rampSpeedAt(ramp.points, tl / outDur) : sp;
}
/**
 * A rampa em bocados de velocidade constante (para o ffmpeg: `trim` + `setpts` + `atempo` por bocado e `concat`). Cada
 * bocado tem `step` segundos no vídeo final; `src0`/`src1` são segundos desde o início do corte.
 */
export function rampPieces(trimLen: number, speed: number, fx: ClipFx | undefined, step = 1 / 10): { out0: number; out1: number; src0: number; src1: number; speed: number }[] {
  const D = fxSeconds(trimLen, speed, fx);
  const n = Math.max(1, Math.ceil(D / step - 1e-9));
  const plain = { ...fx, reverse: false };
  const out: { out0: number; out1: number; src0: number; src1: number; speed: number }[] = [];
  for (let i = 0; i < n; i++) {
    const o0 = (D * i) / n, o1 = (D * (i + 1)) / n;
    const s0 = sourceOffset(o0, D, trimLen, speed, plain), s1 = sourceOffset(o1, D, trimLen, speed, plain);
    out.push({ out0: r4(o0), out1: r4(o1), src0: r4(s0), src1: r4(s1), speed: r4((s1 - s0) / (o1 - o0 || 1)) });
  }
  return out;
}
/** Inverter na web: no máximo estes segundos de vídeo (os frames ficam em memória como JPEG pequenos). */
export const REVERSE_MAX_S = 15;
export const REVERSE_FPS = 24;
/** Quantos frames é preciso tirar para inverter `trimLen` segundos (0 se passar do limite). */
export const reverseFrameCount = (trimLen: number) => (trimLen > REVERSE_MAX_S + 1e-6 ? 0 : Math.max(1, Math.ceil(trimLen * REVERSE_FPS)));
/** O frame (índice) a mostrar para a posição `off` (segundos desde o início do corte). */
export const reverseFrameIndex = (off: number, count: number) => clamp(Math.floor(off * REVERSE_FPS + 1e-6), 0, Math.max(0, count - 1));
/**
 * Congelar a meio de um clipe: divide-o no ponto `at` (segundos do ficheiro) se ficar pelo menos `min` s de cada lado; senão,
 * a foto entra a seguir ao clipe (`null`).
 */
export function freezeSplit(trim: { start: number; end: number }, at: number, min = 0.3): { before: { start: number; end: number }; after: { start: number; end: number } } | null {
  if (at - trim.start < min || trim.end - at < min) return null;
  return { before: { start: trim.start, end: r3(at) }, after: { start: r3(at), end: trim.end } };
}

// ---------------------------------------------------------------- os parâmetros do desenho

/** O que o desenho de um clipe precisa (WebGL, fallback no canvas ou ffmpeg). */
export interface FxParams { matrix: ColorMatrix; sharpen: number; vignette: number; grain: number }
export const NO_FX: FxParams = { matrix: IDENTITY, sharpen: 0, vignette: 0, grain: 0 };
/** Constantes do desenho (iguais no shader e no ffmpeg). */
export const SHARPEN_K = 0.6; // força do núcleo 3×3 com nitidez 1
export const VIGNETTE_ANGLE = Math.PI / 2.6; // ângulo da vinheta com 1 (ffmpeg `vignette=angle=`)
export const GRAIN_AMP = 0.16; // grão 1: ±0,08 em cada pixel

/** O filtro (com a intensidade) e depois os ajustes, numa matriz só, mais nitidez, vinheta e grão. */
export function resolveFx(fx: ClipFx | undefined): FxParams {
  if (!fx) return NO_FX;
  const f = filterById(fx.filter?.id);
  const k = clamp(fx.filter?.amount ?? 1, 0, 1);
  const fm = f && f.ops.length ? mixMatrix(opsMatrix(f.ops), k) : IDENTITY;
  const a = fx.adjust ?? {};
  const matrix = multiply(opsMatrix(adjustOps(a)), fm);
  return {
    matrix,
    sharpen: clamp((f?.sharpen ?? 0) * k + (a.sharpen ?? 0), 0, 1),
    vignette: clamp((f?.vignette ?? 0) * k + (a.vignette ?? 0), 0, 1),
    grain: clamp((f?.grain ?? 0) * k + (a.grain ?? 0), 0, 1),
  };
}
export const fxIsNone = (p: FxParams) => isIdentity(p.matrix) && p.sharpen < 1e-3 && p.vignette < 1e-3 && p.grain < 1e-3;

/** O fator da vinheta à distância normalizada `d` do centro (0 no centro, 1 no canto): cos(ângulo·d)⁴, como o ffmpeg. */
export function vignetteFactor(vignette: number, d: number): number {
  if (vignette <= 0) return 1;
  if (d >= 1) return Math.pow(Math.cos(vignette * VIGNETTE_ANGLE), 4);
  const c = Math.cos(vignette * VIGNETTE_ANGLE * clamp(d, 0, 1));
  return c * c * c * c;
}
/** A distância normalizada ao centro (0 no centro, 1 nos cantos), em px, como o `vignette` do ffmpeg (aspect=1). */
export const vignetteDistance = (u: number, v: number, w: number = FRAME.w, h: number = FRAME.h) => Math.hypot((u - 0.5) * w, (v - 0.5) * h) / Math.hypot(w / 2, h / 2);
/**
 * O pixel de referência (o que o shader faz): `rgb` já com a nitidez, depois a matriz, a vinheta (u, v de 0 a 1 num quadro
 * de w×h) e o grão (`noise` de -0,5 a 0,5).
 */
export function applyFxPixel(p: FxParams, rgb: readonly [number, number, number], u = 0.5, v = 0.5, noise = 0, w: number = FRAME.w, h: number = FRAME.h): [number, number, number] {
  const c = applyMatrix(p.matrix, rgb);
  const d = vignetteDistance(u, v, w, h);
  const f = vignetteFactor(p.vignette, d);
  const g = noise * p.grain * GRAIN_AMP;
  return c.map((x) => clamp(x * f + g, 0, 1)) as [number, number, number];
}

// ================================================================ camadas por cima (texto e stickers)

export type AnimIn = 'nenhuma' | 'aparecer' | 'maquina' | 'subir' | 'pop' | 'brilho' | 'ondulacao';
export type AnimLoop = 'nenhuma' | 'pulsar' | 'balancar';
export const ANIMS: { id: AnimIn; name: string }[] = [
  { id: 'nenhuma', name: 'Nenhuma' }, { id: 'aparecer', name: 'Aparecer' }, { id: 'maquina', name: 'Máquina de escrever' }, { id: 'subir', name: 'Subir' },
  { id: 'pop', name: 'Pop' }, { id: 'brilho', name: 'Brilho' }, { id: 'ondulacao', name: 'Ondulação' },
];
export const LOOPS: { id: AnimLoop; name: string }[] = [{ id: 'nenhuma', name: 'Parado' }, { id: 'pulsar', name: 'Pulsar' }, { id: 'balancar', name: 'Balançar' }];
export interface OverlayAnim { in: AnimIn; out: AnimIn; loop: AnimLoop; /** segundos */ inDur: number; outDur: number }

export interface OverlayBase {
  id: string;
  /** Segundos no vídeo final. */
  start: number;
  end: number;
  /** O centro, em frações do quadro (0 a 1). */
  x: number;
  y: number;
  /** 1 = tamanho natural. */
  scale: number;
  /** Graus, no sentido dos ponteiros do relógio. */
  rot: number;
  anim: OverlayAnim;
}
export type FontId = 'classica' | 'cartaz' | 'grito' | 'praia' | 'marcador' | 'elegante' | 'maquina' | 'retro' | 'mao' | 'futuro';
export interface TextOverlay extends OverlayBase {
  kind: 'text';
  text: string;
  font: FontId;
  /** Altura da letra em px do quadro de 1080×1920 (antes da escala). */
  size: number;
  color: string;
  align: 'left' | 'center' | 'right';
  /** Fundo atrás de cada linha: cheio (na cor, com a letra a contrastar) ou suave (vidro escuro). */
  bg: 'nenhum' | 'cheio' | 'suave';
  outline: boolean;
  shadow: boolean;
  neon: boolean;
}
export type StickerContent =
  | { type: 'emoji'; emoji: string }
  | { type: 'txill'; id: string }
  | { type: 'gif'; id: string; url: string; w: number; h: number }
  | { type: 'mention'; username: string }
  | { type: 'location'; name: string }
  | { type: 'time'; format: 'hora' | 'data' | 'hora-data'; /** quando foi posto (ms desde 1970): é a hora que aparece */ at: number };
export interface StickerOverlay extends OverlayBase {
  kind: 'sticker';
  sticker: StickerContent;
  /** O estilo das etiquetas (menção, local e hora). */
  variant: 'branco' | 'coral' | 'escuro';
}
export type Overlay = TextOverlay | StickerOverlay;
export const MAX_OVERLAYS = 20;

export const TEXT_COLORS = ['#ffffff', '#111111', '#d6334f', '#ff8a5c', '#ffd60a', '#3ddc97', '#2ec5ff', '#7a5cff', '#ff4fd8'] as const;

export interface FontDef { id: FontId; name: string; family: string; weight: number; style?: 'italic'; /** ficheiro em public/ (servido em /) */ file: string; /** a família no Google Fonts (o servidor usa o TTF dela) */ google: string; /** acerto de tamanho para as letras parecerem do mesmo tamanho */ k: number }
export const FONTS: FontDef[] = [
  { id: 'classica', name: 'Clássica', family: 'TxInter', weight: 800, file: '/fonts/estudio/inter.woff2', google: 'Inter 800', k: 1 },
  { id: 'cartaz', name: 'Cartaz', family: 'TxBebas', weight: 400, file: '/fonts/estudio/bebas.woff2', google: 'Bebas Neue', k: 1.25 },
  { id: 'grito', name: 'Grito', family: 'TxAnton', weight: 400, file: '/fonts/estudio/anton.woff2', google: 'Anton', k: 1.05 },
  { id: 'praia', name: 'Praia', family: 'TxPacifico', weight: 400, file: '/fonts/estudio/pacifico.woff2', google: 'Pacifico', k: 0.95 },
  { id: 'marcador', name: 'Marcador', family: 'TxMarker', weight: 400, file: '/fonts/estudio/marker.woff2', google: 'Permanent Marker', k: 1 },
  { id: 'elegante', name: 'Elegante', family: 'TxPlayfair', weight: 700, style: 'italic', file: '/fonts/estudio/playfair.woff2', google: 'Playfair Display 700 itálico', k: 1.05 },
  { id: 'maquina', name: 'Máquina', family: 'TxSpaceMono', weight: 700, file: '/fonts/estudio/spacemono.woff2', google: 'Space Mono 700', k: 0.9 },
  { id: 'retro', name: 'Retro', family: 'TxLobster', weight: 400, file: '/fonts/estudio/lobster.woff2', google: 'Lobster', k: 1.05 },
  { id: 'mao', name: 'À mão', family: 'TxCaveat', weight: 700, file: '/fonts/estudio/caveat.woff2', google: 'Caveat 700', k: 1.3 },
  { id: 'futuro', name: 'Futuro', family: 'TxOrbitron', weight: 800, file: '/fonts/estudio/orbitron.woff2', google: 'Orbitron 800', k: 0.88 },
];
const FONT_BY_ID = new Map(FONTS.map((f) => [f.id, f]));
export const fontById = (id: string): FontDef => FONT_BY_ID.get(id as FontId) ?? FONTS[0];
/** O `font` do canvas para um texto (com o acerto de tamanho da fonte). */
export function fontCss(id: string, size: number): string {
  const f = fontById(id);
  return `${f.style === 'italic' ? 'italic ' : ''}${f.weight} ${Math.round(size * f.k)}px ${f.family}, "Inter", system-ui, -apple-system, sans-serif`;
}

let ovSeq = 0;
const newId = (p: string) => { ovSeq += 1; return `${p}${Date.now().toString(36)}${ovSeq.toString(36)}`; };
export const DEFAULT_ANIM: OverlayAnim = { in: 'pop', out: 'aparecer', loop: 'nenhuma', inDur: 0.45, outDur: 0.35 };
/** Um texto novo: no meio da zona segura, do instante `at` até 4 s depois (ou ao fim). */
export function newText(at: number, total: number, text = ''): TextOverlay {
  const start = clamp(at, 0, Math.max(0, total - 0.5));
  return {
    id: newId('t'), kind: 'text', text, start: r3(start), end: r3(Math.min(total || start + 4, start + 4)), x: 0.5, y: 0.45, scale: 1, rot: 0,
    anim: { ...DEFAULT_ANIM }, font: 'classica', size: 96, color: '#ffffff', align: 'center', bg: 'nenhum', outline: false, shadow: true, neon: false,
  };
}
export function newSticker(sticker: StickerContent, at: number, total: number): StickerOverlay {
  const start = clamp(at, 0, Math.max(0, total - 0.5));
  return {
    id: newId('s'), kind: 'sticker', sticker, start: r3(start), end: r3(total > start ? total : start + 4), x: 0.5, y: 0.38, scale: 1, rot: sticker.type === 'emoji' ? 0 : -4,
    anim: { in: 'pop', out: 'aparecer', loop: sticker.type === 'emoji' || sticker.type === 'txill' ? 'pulsar' : 'nenhuma', inDur: 0.4, outDur: 0.3 }, variant: 'branco',
  };
}

/** Como uma camada está num instante (já com as animações). */
export interface AnimFrame {
  visible: boolean;
  alpha: number;
  /** px do quadro */ dx: number;
  dy: number;
  scale: number;
  /** graus */ rot: number;
  /** fração das letras que se veem (máquina de escrever) */ chars: number;
  /** 0 a 1: brilho a mais (entrada «Brilho») */ glow: number;
  /** 0 a 1: amplitude da ondulação das letras */ wave: number;
}
const HIDDEN: AnimFrame = { visible: false, alpha: 0, dx: 0, dy: 0, scale: 1, rot: 0, chars: 1, glow: 0, wave: 0 };
/** As durações de entrada e de saída que cabem na camada (cada uma até metade do tempo dela). */
export function animDurations(o: Pick<OverlayBase, 'start' | 'end' | 'anim'>): { inDur: number; outDur: number } {
  const span = Math.max(0, o.end - o.start);
  return {
    inDur: o.anim.in === 'nenhuma' ? 0 : clamp(o.anim.inDur, 0.05, Math.max(0.05, span / 2)),
    outDur: o.anim.out === 'nenhuma' ? 0 : clamp(o.anim.outDur, 0.05, Math.max(0.05, span / 2)),
  };
}
function applyAnim(f: AnimFrame, kind: AnimIn, p: number, dir: 1 | -1) {
  // p: 0 = fora, 1 = no lugar.
  const e = easeOutCubic(p);
  switch (kind) {
    case 'aparecer': f.alpha *= e; break;
    case 'maquina': f.chars = Math.min(f.chars, clamp(p, 0, 1)); break;
    case 'subir': f.dy += dir * (1 - e) * 140; f.alpha *= e; break;
    case 'pop': f.scale *= dir === 1 ? Math.max(0, easeOutBack(p)) : 0.6 + 0.4 * e; f.alpha *= Math.min(1, p * 3); break;
    case 'brilho': f.alpha *= e; f.glow = Math.max(f.glow, 1 - p); break;
    case 'ondulacao': f.wave = Math.max(f.wave, 1 - e); f.alpha *= Math.min(1, p * 2.5); break;
    case 'nenhuma': break;
  }
}
/** A camada no instante `t` (segundos do vídeo final): entrada, saída e o ciclo (pulsar/balançar). */
export function animState(o: Pick<OverlayBase, 'start' | 'end' | 'anim'>, t: number): AnimFrame {
  if (!(o.end > o.start) || t < o.start - 1e-6 || t > o.end + 1e-6) return HIDDEN;
  const f: AnimFrame = { visible: true, alpha: 1, dx: 0, dy: 0, scale: 1, rot: 0, chars: 1, glow: 0, wave: 0 };
  const { inDur, outDur } = animDurations(o);
  if (inDur > 0 && t < o.start + inDur) applyAnim(f, o.anim.in, (t - o.start) / inDur, 1);
  if (outDur > 0 && t > o.end - outDur) applyAnim(f, o.anim.out, (o.end - t) / outDur, -1);
  const lt = t - o.start;
  if (o.anim.loop === 'pulsar') f.scale *= 1 + 0.07 * Math.sin(2 * Math.PI * 1.2 * lt);
  else if (o.anim.loop === 'balancar') f.rot += 8 * Math.sin(2 * Math.PI * 0.9 * lt);
  f.alpha = clamp(f.alpha, 0, 1);
  f.visible = f.alpha > 0.001 && f.scale > 0.001;
  return f;
}
/** O deslocamento vertical de cada letra na ondulação (px do quadro, para uma letra de `size`). */
export const waveOffset = (i: number, t: number, wave: number, size: number) => (wave <= 0 ? 0 : Math.sin(t * 9 - i * 0.6) * size * 0.35 * wave);
/** Quantas letras se veem com a máquina de escrever. */
export const visibleChars = (len: number, chars: number) => (chars >= 1 ? len : Math.max(0, Math.floor(len * chars + 1e-6)));
/** Um instante em que a camada já se vê inteira (para a mostrar em pausa enquanto se edita). */
export const restingTime = (o: Pick<OverlayBase, 'start' | 'end' | 'anim'>) => { const { inDur, outDur } = animDurations(o); return Math.min(o.start + inDur + 0.05, Math.max(o.start, o.end - outDur - 0.05)); };

/** Preto ou branco, o que se lê melhor por cima da cor (para o texto num fundo cheio e para o contorno). */
export function contrastOn(hex: string): '#111111' | '#ffffff' {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return '#111111';
  const n = parseInt(m[1], 16);
  const lin = (c: number) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
  const L = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  return L > 0.4 ? '#111111' : '#ffffff';
}
const DIAS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const MESES = ['jan.', 'fev.', 'mar.', 'abr.', 'mai.', 'jun.', 'jul.', 'ago.', 'set.', 'out.', 'nov.', 'dez.'];
/** O texto do sticker da hora, na hora de Moçambique (UTC+2, sem hora de verão): «22:41», «Qui, 12 nov.». */
export function timeLabel(format: 'hora' | 'data' | 'hora-data', at: number): string[] {
  const d = new Date(at + 2 * 3600 * 1000);
  const hora = `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
  const data = `${DIAS[d.getUTCDay()]}, ${d.getUTCDate()} ${MESES[d.getUTCMonth()]}`;
  return format === 'hora' ? [hora] : format === 'data' ? [data] : [hora, data];
}

// ---------------------------------------------------------------- zona segura e guias

/**
 * A zona segura da tcheka, em frações do quadro: em cima ficam o topo do ecrã e as abas; à direita, os botões (cheers,
 * comentários, repost, guardar, partilhar); em baixo, o nome, a legenda e a música. O que estiver fora pode ficar tapado.
 */
export const SAFE = { top: 0.1, right: 0.17, bottom: 0.24, left: 0.05 } as const;
/** A caixa (centro, meia largura e meia altura, em frações) cabe na zona segura? */
export const insideSafe = (b: { x: number; y: number; hw: number; hh: number }) => b.x - b.hw >= SAFE.left - 1e-6 && b.x + b.hw <= 1 - SAFE.right + 1e-6 && b.y - b.hh >= SAFE.top - 1e-6 && b.y + b.hh <= 1 - SAFE.bottom + 1e-6;
/** O meio da zona segura (onde os textos e stickers novos aparecem). */
export const SAFE_CENTER = { x: SAFE.left + (1 - SAFE.left - SAFE.right) / 2, y: SAFE.top + (1 - SAFE.top - SAFE.bottom) / 2 };
export const SNAP = 0.018;
/**
 * Ao arrastar: cola às guias (o meio do quadro, o meio da zona segura e as margens da zona segura) quando passa perto.
 * Devolve a posição e as guias que se acenderam (para as desenhar).
 */
export function snapMove(x: number, y: number, box: { hw: number; hh: number }, snap = SNAP): { x: number; y: number; vx: number | null; hy: number | null } {
  let vx: number | null = null, hy: number | null = null;
  let nx = x, ny = y;
  const xs: [number, number][] = [[0.5, 0.5], [SAFE_CENTER.x, SAFE_CENTER.x], [SAFE.left + box.hw, SAFE.left], [1 - SAFE.right - box.hw, 1 - SAFE.right]];
  const ys: [number, number][] = [[0.5, 0.5], [SAFE_CENTER.y, SAFE_CENTER.y], [SAFE.top + box.hh, SAFE.top], [1 - SAFE.bottom - box.hh, 1 - SAFE.bottom]];
  for (const [p, line] of xs) if (Math.abs(x - p) < snap) { nx = p; vx = line; break; }
  for (const [p, line] of ys) if (Math.abs(y - p) < snap) { ny = p; hy = line; break; }
  return { x: clamp(nx, 0, 1), y: clamp(ny, 0, 1), vx, hy };
}
/** A rotação cola a 0°, 90°, 180° e 270° quando passa a menos de 4°. */
export function snapAngle(deg: number): number {
  const n = ((deg % 360) + 540) % 360 - 180;
  for (const a of [-180, -90, 0, 90, 180]) if (Math.abs(n - a) < 4) return a === -180 ? 180 : a;
  return Math.round(n * 10) / 10;
}

// ================================================================ o contrato (JSON)

const isStr = (v: unknown, max = 200): v is string => typeof v === 'string' && v.length <= max;
const COLOR = /^#[0-9a-f]{6}$/i;
const ANIM_IDS = new Set<string>(ANIMS.map((a) => a.id));
const LOOP_IDS = new Set<string>(LOOPS.map((a) => a.id));
const RAMP_IDS = new Set<string>(RAMPS.map((r) => r.id));
const FONT_IDS = new Set<string>(FONTS.map((f) => f.id));
const ADJUST_IDS = ADJUSTS.map((a) => a.id);

/** Um `fx` limpo (valores dentro dos limites, sem campos desconhecidos); `undefined` quando não tem nada. */
export function sanitizeFx(x: unknown): ClipFx | undefined {
  if (!x || typeof x !== 'object') return undefined;
  const o = x as Record<string, unknown>;
  const out: ClipFx = {};
  const f = o.filter as Record<string, unknown> | undefined;
  if (f && isStr(f.id, 40) && filterById(f.id) && f.id !== 'normal') out.filter = { id: f.id, amount: r3(num(f.amount, 1, 0, 1)) };
  const a = o.adjust as Record<string, unknown> | undefined;
  if (a && typeof a === 'object') {
    const adj: Partial<Adjust> = {};
    for (const d of ADJUSTS) { const v = num(a[d.id], 0, d.min, d.max); if (Math.abs(v) > 1e-4) adj[d.id] = r3(v); }
    if (Object.keys(adj).length) out.adjust = adj;
  }
  const t = o.transition as Record<string, unknown> | undefined;
  if (t && isStr(t.type, 30) && TRANSITION_IDS.has(t.type)) out.transition = { type: t.type as TransitionId, dur: r3(num(t.dur, DEFAULT_TRANSITION.dur, TRANSITION_MIN_S, TRANSITION_MAX_S)) };
  if (isStr(o.ramp, 20) && RAMP_IDS.has(o.ramp)) out.ramp = o.ramp as RampId;
  if (o.reverse === true) out.reverse = true;
  const z = o.freeze as Record<string, unknown> | undefined;
  if (z && isStr(z.from, 300)) out.freeze = { from: z.from, at: r3(num(z.at, 0, 0, 3600)) };
  return Object.keys(out).length ? out : undefined;
}

function sanitizeAnim(x: unknown): OverlayAnim {
  const o = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>;
  return {
    in: isStr(o.in, 20) && ANIM_IDS.has(o.in) ? (o.in as AnimIn) : DEFAULT_ANIM.in,
    out: isStr(o.out, 20) && ANIM_IDS.has(o.out) ? (o.out as AnimIn) : DEFAULT_ANIM.out,
    loop: isStr(o.loop, 20) && LOOP_IDS.has(o.loop) ? (o.loop as AnimLoop) : 'nenhuma',
    inDur: r3(num(o.inDur, DEFAULT_ANIM.inDur, 0.05, 3)),
    outDur: r3(num(o.outDur, DEFAULT_ANIM.outDur, 0.05, 3)),
  };
}
function sanitizeSticker(x: unknown): StickerContent | null {
  if (!x || typeof x !== 'object') return null;
  const s = x as Record<string, unknown>;
  switch (s.type) {
    case 'emoji': return isStr(s.emoji, 32) && s.emoji.trim() ? { type: 'emoji', emoji: s.emoji } : null;
    case 'txill': return isStr(s.id, 80) && /^[a-z0-9-]+$/.test(s.id) ? { type: 'txill', id: s.id } : null;
    case 'gif': {
      // Só GIFs do GIPHY (o mesmo que lib/gifs.ts aceita).
      if (!isStr(s.id, 40) || !/^[A-Za-z0-9]{4,40}$/.test(s.id) || !isStr(s.url, 600) || !/^https:\/\/media[0-9]?\.giphy\.com\/media\/[^?#]*\.(gif|webp)$/.test(s.url)) return null;
      return { type: 'gif', id: s.id, url: s.url, w: Math.round(num(s.w, 200, 1, 4000)), h: Math.round(num(s.h, 200, 1, 4000)) };
    }
    case 'mention': { const u = isStr(s.username, 40) ? s.username.replace(/^@/, '') : ''; return /^[A-Za-z0-9_.]{1,30}$/.test(u) ? { type: 'mention', username: u } : null; }
    case 'location': return isStr(s.name, 80) && s.name.trim() ? { type: 'location', name: s.name.trim() } : null;
    case 'time': return { type: 'time', format: s.format === 'data' || s.format === 'hora-data' ? s.format : 'hora', at: Math.round(num(s.at, 0, 0, 8.64e15)) };
    default: return null;
  }
}
/** Uma camada limpa, ou null se não servir. */
export function sanitizeOverlay(x: unknown): Overlay | null {
  if (!x || typeof x !== 'object') return null;
  const o = x as Record<string, unknown>;
  if (!isStr(o.id, 60) || !o.id) return null;
  const start = r3(num(o.start, 0, 0, 3600));
  const end = r3(num(o.end, start + 4, 0, 3600));
  if (!(end > start)) return null;
  const base: OverlayBase = { id: o.id, start, end, x: r4(num(o.x, 0.5, -0.5, 1.5)), y: r4(num(o.y, 0.5, -0.5, 1.5)), scale: r3(num(o.scale, 1, 0.1, 8)), rot: r3(num(o.rot, 0, -360, 360)), anim: sanitizeAnim(o.anim) };
  if (o.kind === 'text') {
    const text = isStr(o.text, 400) ? o.text.slice(0, 200) : '';
    if (!text.trim()) return null;
    return {
      ...base, kind: 'text', text, font: isStr(o.font, 20) && FONT_IDS.has(o.font) ? (o.font as FontId) : 'classica', size: Math.round(num(o.size, 84, 24, 300)),
      color: isStr(o.color, 7) && COLOR.test(o.color) ? o.color.toLowerCase() : '#ffffff', align: o.align === 'left' || o.align === 'right' ? o.align : 'center',
      bg: o.bg === 'cheio' || o.bg === 'suave' ? o.bg : 'nenhum', outline: o.outline === true, shadow: o.shadow === true, neon: o.neon === true,
    };
  }
  if (o.kind === 'sticker') {
    const sticker = sanitizeSticker(o.sticker);
    if (!sticker) return null;
    return { ...base, kind: 'sticker', sticker, variant: o.variant === 'coral' || o.variant === 'escuro' ? o.variant : 'branco' };
  }
  return null;
}

/** O contrato dos efeitos de uma tcheka (ver docs/estudio-efeitos.md). */
export interface FxContract {
  v: number;
  frame: { w: number; h: number; fps: number };
  /** Pela ordem da sequência: a chave do clipe e os efeitos dele. */
  clips: { id: string; fx?: ClipFx }[];
  overlays: Overlay[];
}
export function fxContract(clips: { id: string; fx?: ClipFx }[], overlays: readonly Overlay[]): FxContract {
  return {
    v: FX_VERSION,
    frame: { w: FRAME.w, h: FRAME.h, fps: FRAME.fps },
    clips: clips.map((c) => { const fx = sanitizeFx(c.fx); return fx ? { id: c.id, fx } : { id: c.id }; }),
    overlays: overlays.map(sanitizeOverlay).filter((o): o is Overlay => !!o).slice(0, MAX_OVERLAYS),
  };
}
/** Lê um contrato (texto ou objeto); o que não se perceber cai. Versões mais novas do que esta dão erro. */
export function parseFxContract(src: string | unknown): FxContract {
  const o = (typeof src === 'string' ? JSON.parse(src) : src) as Record<string, unknown> | null;
  if (!o || typeof o !== 'object') throw new Error('contrato inválido');
  const v = typeof o.v === 'number' ? o.v : 0;
  if (v > FX_VERSION) throw new Error(`versão ${v} do contrato é mais nova do que ${FX_VERSION}`);
  const clips = Array.isArray(o.clips) ? o.clips : [];
  return fxContract(
    clips.filter((c): c is { id: string; fx?: unknown } => !!c && typeof c === 'object' && isStr((c as { id?: unknown }).id, 300)).map((c) => ({ id: c.id, fx: sanitizeFx(c.fx) })),
    Array.isArray(o.overlays) ? (o.overlays as unknown[]).map(sanitizeOverlay).filter((x): x is Overlay => !!x) : [],
  );
}
/** JSON estável: as chaves por ordem alfabética (a mesma montagem dá sempre o mesmo texto). */
export function stringifyFxContract(c: FxContract): string {
  const sort = (v: unknown): unknown => (Array.isArray(v) ? v.map(sort) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, sort((v as Record<string, unknown>)[k])])) : v);
  return JSON.stringify(sort(c));
}

// ================================================================ ffmpeg (a montagem no servidor)

const f4 = (v: number) => (Math.round(v * 10000) / 10000).toString();
/**
 * Uma LUT 3D (.cube) com a matriz de cor: o ffmpeg aplica-a com `lut3d` (com o corte a 0..1 no fim, como o shader). `n`
 * pontos por eixo (33 é o habitual). Ordem do .cube: o vermelho muda mais depressa.
 */
export function cubeLut(m: ColorMatrix, n = 33): string {
  const lines = ['TITLE "Txillapp estudio"', `LUT_3D_SIZE ${n}`, 'DOMAIN_MIN 0 0 0', 'DOMAIN_MAX 1 1 1'];
  for (let b = 0; b < n; b++) for (let g = 0; g < n; g++) for (let r = 0; r < n; r++) {
    const c = applyMatrix(m, [r / (n - 1), g / (n - 1), b / (n - 1)]);
    lines.push(`${c[0].toFixed(6)} ${c[1].toFixed(6)} ${c[2].toFixed(6)}`);
  }
  return lines.join('\n') + '\n';
}
/**
 * A cadeia de filtros ffmpeg de um clipe (depois de o pôr no quadro 1080×1920): nitidez (`convolution` 3×3, igual ao
 * shader), cor (`lut3d` com o ficheiro de `cubeLut`), vinheta (`vignette` em RGB, a mesma fórmula) e grão (`noise` só na
 * luminância; aleatório, por isso só parecido). Vazio quando o clipe não tem efeitos.
 */
export function ffmpegFxChain(fx: ClipFx | undefined, lutFile = 'clip.cube'): string {
  const p = resolveFx(fx);
  if (fxIsNone(p)) return '';
  const parts: string[] = ['format=gbrp'];
  if (p.sharpen > 1e-3) {
    const a = Math.round(p.sharpen * SHARPEN_K * 100);
    const k = `0 -${a} 0 -${a} ${100 + 4 * a} -${a} 0 -${a} 0`;
    parts.push(`convolution='${k}:${k}:${k}:${k}:0rdiv=0.01:1rdiv=0.01:2rdiv=0.01:3rdiv=0.01'`);
  }
  if (!isIdentity(p.matrix)) parts.push(`lut3d=file='${lutFile}':interp=tetrahedral`);
  if (p.vignette > 1e-3) parts.push(`vignette=angle=${f4(p.vignette * VIGNETTE_ANGLE)}:dither=0`);
  if (p.grain > 1e-3) parts.push(`format=yuv420p,noise=c0s=${Math.max(1, Math.round(p.grain * GRAIN_AMP * 0.5 * 255))}:c0f=t+u`);
  return parts.join(',');
}
/** A transição em ffmpeg: `xfade` com a duração e o ponto (segundos do vídeo até ao fim do clipe anterior). */
export function ffmpegTransition(t: ClipTransition | null, offset: number): string {
  if (!t) return '';
  const def = TRANSITIONS.find((d) => d.id === t.type);
  if (!def || !def.ffmpeg) return '';
  return `xfade=transition=${def.ffmpeg}:duration=${f4(t.dur)}:offset=${f4(offset)}`;
}
