/**
 * A geometria do pano, sem canvas (testada em tests/studioCapulana.test.mjs): por onde passa o pano em cada transição, onde
 * fica a foto dentro da moldura e os contornos dos stickers. O desenho (lib/studio/capulanaRender.ts) e o servidor só
 * preenchem estes polígonos: é o que garante que os dois desenham o mesmo.
 *
 * Não importa nada: o Node corre este ficheiro diretamente.
 */

export type Pt = [number, number];
export interface Box { x: number; y: number; w: number; h: number }

/** As transições de capulana (o pano passa pelo ecrã e deixa ver o clipe seguinte). */
export type CapulanaTransitionId = 'capulana-deslizar' | 'capulana-desenrolar' | 'capulana-rasgar' | 'capulana-losango' | 'capulana-vento';
export interface CapulanaTransitionDef { id: CapulanaTransitionId; name: string; mood: string; /** O `xfade` do ffmpeg mais parecido (sem pano), se o servidor não desenhar o pano. */ ffmpeg: string }
export const CAPULANA_TRANSITIONS: CapulanaTransitionDef[] = [
  { id: 'capulana-deslizar', name: 'Pano', mood: 'O pano atravessa o ecrã de lado, com a franja à frente', ffmpeg: 'wipeleft' },
  { id: 'capulana-desenrolar', name: 'Desenrolar', mood: 'O pano desenrola-se de cima e volta a enrolar', ffmpeg: 'wipedown' },
  { id: 'capulana-rasgar', name: 'Rasgar', mood: 'Dois panos fecham em ziguezague e rasgam para os lados', ffmpeg: 'horzopen' },
  { id: 'capulana-losango', name: 'Losango', mood: 'Um losango de pano abre do centro', ffmpeg: 'diagtl' },
  { id: 'capulana-vento', name: 'Ao vento', mood: 'O pano passa na diagonal, a ondular', ffmpeg: 'wipetl' },
];
const IDS = new Set<string>(CAPULANA_TRANSITIONS.map((t) => t.id));
export const isCapulanaTransition = (v: unknown): v is CapulanaTransitionId => typeof v === 'string' && IDS.has(v);

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
/** A mesma curva das outras transições (`easeInOutCubic` do effects.ts). */
export const ease = (x: number) => { const t = clamp01(x); return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; };
const tri = (x: number) => Math.abs(2 * (x - Math.floor(x)) - 1);
const r1 = (x: number) => Math.round(x * 10) / 10;

export interface PanoShape {
  /** O que fica por baixo de tudo: o clipe anterior (parado) ou já o seguinte. */
  base: 'prev' | 'cur';
  /** Com `base: 'prev'`: onde já se vê o clipe seguinte. */
  reveal: Pt[][];
  /** Onde está o pano (regra `evenodd`: um polígono dentro de outro faz um buraco). */
  cloth: Pt[][];
  /** Quanto o desenho do pano anda com ele (px). */
  shift: Pt;
  /** As bainhas: as bordas do pano que se veem (linhas abertas). */
  hems: Pt[][];
  /** Os rolos do «Desenrolar» (cilindros deitados, à largura do quadro). */
  rolls: Box[];
}

/** Os pontos de uma borda vertical em `x(y)`, de cima para baixo, com `steps` troços. */
function edge(H: number, steps: number, x: (y: number, i: number) => number): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i <= steps; i++) { const y = (H * i) / steps; out.push([r1(x(y, i)), r1(y)]); }
  return out;
}
const rev = (p: Pt[]) => [...p].reverse();
const diamond = (W: number, H: number, r: number): Pt[] => [[r1(W / 2 - (r * W) / 2), H / 2], [W / 2, r1(H / 2 - (r * H) / 2)], [r1(W / 2 + (r * W) / 2), H / 2], [W / 2, r1(H / 2 + (r * H) / 2)]];

/**
 * A forma do pano na transição `type` no ponto `p` (0 a 1), num quadro W×H. Em p = 0 só se vê o clipe anterior e em p = 1
 * só o seguinte; a meio o pano tapa (quase) tudo.
 */
export function panoShape(type: CapulanaTransitionId, p: number, W: number, H: number): PanoShape {
  const t = clamp01(p);
  switch (type) {
    case 'capulana-desenrolar': {
      const roll = H * 0.035;
      const y1 = -roll + (H + 2 * roll) * ease(t / 0.62);
      const y0 = -roll + (H + 2 * roll) * ease((t - 0.38) / 0.62);
      return {
        base: 'prev', shift: [0, 0],
        reveal: [[[0, 0], [W, 0], [W, r1(y0)], [0, r1(y0)]]],
        cloth: [[[0, r1(y0)], [W, r1(y0)], [W, r1(y1)], [0, r1(y1)]]],
        hems: [],
        rolls: [{ x: 0, y: r1(y1 - roll / 2), w: W, h: r1(roll) }, { x: 0, y: r1(y0 - roll / 2), w: W, h: r1(roll) }],
      };
    }
    case 'capulana-rasgar': {
      // Fecha até 45 %, fica fechado até 55 % (é aí que troca o clipe por baixo) e rasga até ao fim.
      const k = t < 0.5 ? ease(t / 0.45) : 1 - ease((t - 0.55) / 0.45);
      const A = W * 0.06, teeth = 9;
      const z = (y: number) => A * (2 * tri((y / H) * teeth) - 1);
      const L = edge(H, teeth * 2, (y) => -A + k * (W / 2 + A) + z(y));
      const R = edge(H, teeth * 2, (y) => W + A - k * (W / 2 + A) + z(y));
      return {
        base: t < 0.5 ? 'prev' : 'cur', shift: [0, 0], reveal: [], rolls: [],
        cloth: [[[-2 * A, 0], ...L, [-2 * A, H]], [[W + 2 * A, 0], ...R, [W + 2 * A, H]]],
        hems: [L, R],
      };
    }
    case 'capulana-losango': {
      const R = 2.06;
      const outer = diamond(W, H, R * ease(t / 0.75)), inner = diamond(W, H, R * ease((t - 0.25) / 0.75));
      return { base: 'prev', shift: [0, 0], reveal: [inner], cloth: [outer, inner], hems: [[...outer, outer[0]], [...inner, inner[0]]], rolls: [] };
    }
    case 'capulana-vento': {
      const band = W * 0.7, lean = W * 0.35, amp = W * 0.035;
      const c = -amp + (W + lean + band + 4 * amp) * ease(t);
      const wave = (y: number) => amp * Math.sin(2 * Math.PI * ((y / H) * 1.5 + t * 1.2));
      const lead = edge(H, 32, (y) => c - lean * (y / H) + wave(y));
      const trail = edge(H, 32, (y) => c - band - lean * (y / H) + wave(y) - amp);
      const far = -(lean + band + 4 * amp);
      return { base: 'prev', shift: [r1(c), 0], reveal: [[[far, 0], ...trail, [far, H]]], cloth: [[...trail, ...rev(lead)]], hems: [lead, trail], rolls: [] };
    }
    case 'capulana-deslizar':
    default: {
      // A franja: bicos pequenos à frente e atrás do pano.
      const band = W * 0.62, A = W * 0.022, teeth = 22;
      const c = -A + (W + band + 2 * A) * ease(t);
      const lead = edge(H, teeth * 2, (_y, i) => c + (i % 2 ? A : 0));
      const trail = edge(H, teeth * 2, (_y, i) => c - band + (i % 2 ? A : 0));
      const far = -(band + 4 * A);
      return { base: 'prev', shift: [r1(c), 0], reveal: [[[far, 0], ...trail, [far, H]]], cloth: [[...trail, ...rev(lead)]], hems: [lead, trail], rolls: [] };
    }
  }
}

/** Se o ponto está dentro dos polígonos (regra `evenodd`). */
export function insidePolys(polys: Pt[][], x: number, y: number): boolean {
  let inside = false;
  for (const poly of polys) {
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i], [xj, yj] = poly[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

/**
 * Que parte do quadro mostra cada coisa (0 a 1), medido numa grelha de `n`×`n` pontos: o clipe anterior, o pano e o seguinte.
 * Serve os testes e o servidor (para conferir a implementação dele).
 */
export function panoCoverage(type: CapulanaTransitionId, p: number, W = 1080, H = 1920, n = 24): { prev: number; cloth: number; cur: number } {
  const s = panoShape(type, p, W, H);
  let cloth = 0, cur = 0;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const x = ((i + 0.5) * W) / n, y = ((j + 0.5) * H) / n;
      if (insidePolys(s.cloth, x, y)) cloth++;
      else if (s.base === 'cur' || insidePolys(s.reveal, x, y)) cur++;
    }
  }
  const all = n * n;
  return { prev: (all - cloth - cur) / all, cloth: cloth / all, cur: cur / all };
}

// ---------------------------------------------------------------- molduras

/** Uma foto pede moldura quando é mais larga do que o 9:16 (em «cover» perdia mais de `tol` da largura). */
export function needsFrame(iw: number, ih: number, W = 1080, H = 1920, tol = 0.12): boolean {
  if (!(iw > 0 && ih > 0)) return false;
  return (W / H) / (iw / ih) < 1 - tol;
}

export interface FrameLayout {
  /** Onde fica a foto (inteira, sem cortes). */
  photo: Box;
  /** A margem clara à volta da foto e o fio escuro por fora dela (px). */
  border: number;
  line: number;
  radius: number;
}
/** A moldura: a foto inteira, o maior possível dentro de 86 % × 62 % do quadro, um pouco acima do meio. */
export function frameLayout(iw: number, ih: number, W = 1080, H = 1920): FrameLayout {
  const ar = iw > 0 && ih > 0 ? iw / ih : 1;
  const maxW = W * 0.86, maxH = H * 0.62;
  let w = maxW, h = w / ar;
  if (h > maxH) { h = maxH; w = h * ar; }
  return { photo: { x: r1((W - w) / 2), y: r1(H * 0.46 - h / 2), w: r1(w), h: r1(h) }, border: Math.round(W * 0.016), line: Math.round(W * 0.005), radius: Math.round(W * 0.012) };
}

// ---------------------------------------------------------------- stickers

export type CapulanaShapeId = 'circulo' | 'losango' | 'estrela' | 'coracao' | 'selo';
export const CAPULANA_SHAPES: { id: CapulanaShapeId; name: string }[] = [
  { id: 'coracao', name: 'Coração' }, { id: 'estrela', name: 'Estrela' }, { id: 'selo', name: 'Selo' }, { id: 'losango', name: 'Losango' }, { id: 'circulo', name: 'Círculo' },
];
const SHAPE_IDS = new Set<string>(CAPULANA_SHAPES.map((s) => s.id));
export const isCapulanaShape = (v: unknown): v is CapulanaShapeId => typeof v === 'string' && SHAPE_IDS.has(v);

/** O contorno do sticker, centrado em (0, 0) e dentro de um círculo de raio `r` (polígono fechado). */
export function stickerOutline(shape: CapulanaShapeId, r: number): Pt[] {
  const out: Pt[] = [];
  const polar = (n: number, rad: (i: number, a: number) => number) => {
    for (let i = 0; i < n; i++) { const a = -Math.PI / 2 + (2 * Math.PI * i) / n; const q = rad(i, a) * r; out.push([r1(q * Math.cos(a)), r1(q * Math.sin(a))]); }
  };
  switch (shape) {
    case 'losango': return [[0, -r], [r1(r * 0.78), 0], [0, r], [r1(-r * 0.78), 0]];
    case 'estrela': polar(10, (i) => (i % 2 ? 0.46 : 1)); return out;
    case 'selo': polar(96, (_i, a) => 0.93 + 0.07 * Math.cos(12 * a)); return out;
    case 'coracao':
      for (let i = 0; i < 64; i++) {
        const a = (2 * Math.PI * i) / 64;
        const x = 16 * Math.pow(Math.sin(a), 3), y = -(13 * Math.cos(a) - 5 * Math.cos(2 * a) - 2 * Math.cos(3 * a) - Math.cos(4 * a));
        out.push([r1((x / 18.5) * r), r1(((y - 2.5) / 18.5) * r)]);
      }
      return out;
    case 'circulo':
    default: polar(64, () => 1); return out;
  }
}
