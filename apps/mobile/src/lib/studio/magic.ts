/**
 * «Montagem mágica»: o motor que faz uma tcheka sozinho, sem React nem browser (testado em tests/studioMagic.test.mjs).
 *
 * Recebe o que se mediu em cada ficheiro (frames reduzidos a 32×56, a energia do som) e a música (andamento e energia) e
 * devolve um projeto no formato do lib/studio/project.ts, com `fx` e camadas no formato do lib/studio/effects.ts:
 * - os melhores momentos de cada vídeo (movimento, nitidez e som; foge de frames tremidos ou escuros);
 * - o ponto de interesse de cada foto, para o zoom lento apontar para o que interessa sem cortar caras;
 * - a ordem com história (abre com o plano mais forte, alterna fotos e vídeos, junta cores e luz parecidas, fecha calmo);
 * - os cortes nas batidas, com os momentos mais vivos nas partes fortes da música;
 * - o estilo da «onda» escolhida (filtro, transições, rampas, texto de abertura, efeitos sonoros);
 * - «Outra versão»: outra semente dá outra montagem, e os clipes trancados ficam como estavam.
 * Tudo corre no aparelho: aqui só há contas.
 *
 * Só importa tipos (o Node corre este ficheiro diretamente): os clipes são `ProjectClip` (project.ts), os efeitos `ClipFx` e
 * o texto `TextOverlay` (effects.ts). Ver docs/estudio-unico.md.
 */
import type { CapulanaSpec, PaletteId, PatternId } from './capulana';
import type { AnimIn, ClipFx, FontId, RampId, TextOverlay, TransitionId } from './effects';
import type { ProjectClip } from './project';

export const MAGIC_VERSION = 1;
/** O tamanho a que os frames são reduzidos para se analisarem. */
export const ANALYSIS = { w: 32, h: 56 } as const;
const FRAME_ASPECT = 9 / 16;

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const r2 = (v: number) => Math.round(v * 100) / 100;
const r3 = (v: number) => Math.round(v * 1000) / 1000;
const r4 = (v: number) => Math.round(v * 10000) / 10000;
const mean = (a: ArrayLike<number>) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i]; return a.length ? s / a.length : 0; };

/** mulberry32 (o mesmo do lib/studio/capulana.ts). */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ================================================================ 1. olhar para um frame

export interface FrameStats {
  /** Luz média (0 a 1). */
  luma: number;
  /** Nitidez: a média do laplaciano (0 = liso ou desfocado; acima de 0,05 já tem pormenor). */
  sharp: number;
  /** Saturação média (0 a 1). */
  sat: number;
  /** A cor média (0 a 1). */
  rgb: [number, number, number];
}

/** O frame em cinzentos (0 a 1), para medir o movimento e a nitidez. */
export function grayOf(rgba: ArrayLike<number>, w: number, h: number): Float32Array {
  const g = new Float32Array(w * h);
  for (let i = 0, p = 0; i < g.length; i++, p += 4) g[i] = (0.299 * rgba[p] + 0.587 * rgba[p + 1] + 0.114 * rgba[p + 2]) / 255;
  return g;
}

export function frameStats(rgba: ArrayLike<number>, w: number, h: number, gray: Float32Array = grayOf(rgba, w, h)): FrameStats {
  let r = 0, g = 0, b = 0, sat = 0;
  const n = w * h;
  for (let p = 0; p < n * 4; p += 4) {
    const R = rgba[p], G = rgba[p + 1], B = rgba[p + 2];
    r += R; g += G; b += B;
    const mx = Math.max(R, G, B), mn = Math.min(R, G, B);
    sat += mx > 0 ? (mx - mn) / mx : 0;
  }
  let lap = 0, cnt = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      lap += Math.abs(4 * gray[i] - gray[i - 1] - gray[i + 1] - gray[i - w] - gray[i + w]);
      cnt++;
    }
  }
  return { luma: r4(mean(gray)), sharp: r4(cnt ? lap / cnt : 0), sat: r4(sat / n), rgb: [r4(r / n / 255), r4(g / n / 255), r4(b / n / 255)] };
}

/**
 * O movimento entre dois frames: a diferença média (0 a 1) e por quantos blocos de 8×8 ela se espalha. Quando tudo mexe ao
 * mesmo tempo (espalhado por quase todos os blocos) é a câmara a tremer ou a varrer, não a cena.
 */
export function frameMotion(a: Float32Array, b: Float32Array, w: number, h: number): { motion: number; spread: number } {
  const bs = 8, bw = Math.ceil(w / bs), bh = Math.ceil(h / bs);
  const acc = new Float32Array(bw * bh), cnt = new Uint16Array(bw * bh);
  let total = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const d = Math.abs(a[y * w + x] - b[y * w + x]);
      total += d;
      const k = Math.floor(y / bs) * bw + Math.floor(x / bs);
      acc[k] += d; cnt[k]++;
    }
  }
  let moving = 0;
  for (let k = 0; k < acc.length; k++) if (cnt[k] && acc[k] / cnt[k] > 0.04) moving++;
  return { motion: r4(total / (w * h)), spread: r4(moving / acc.length) };
}

// ================================================================ 2. os melhores momentos de um vídeo

export interface VideoSample {
  /** Segundos no ficheiro. */
  t: number;
  luma: number;
  sharp: number;
  /** Movimento em relação à amostra anterior (0 na primeira). */
  motion: number;
  spread: number;
  /** A energia do som do vídeo à volta deste instante (0 a 1), se o vídeo tiver som. */
  audio?: number;
}
export interface MomentTrack { duration: number; samples: VideoSample[] }

/** Escuro de mais para se ver (abaixo de 0,07) e a partir de onde já está bem (0,2). */
export const DARK = { min: 0.07, ok: 0.2 } as const;
/** Tremido: quase todos os blocos a mexer (`spread`) com muito movimento. */
export const SHAKY = { spread: 0.9, motion: 0.1, full: 0.25 } as const;

/**
 * A nota de cada amostra (0 a 1): a «vida» (movimento, nitidez e som, em relação ao melhor que o próprio vídeo tem) vezes a
 * qualidade (os frames escuros, tremidos ou desfocados descem muito).
 */
export function sampleScores(track: MomentTrack): number[] {
  const s = track.samples;
  if (!s.length) return [];
  const shakeOf = (x: VideoSample) => (x.spread >= SHAKY.spread && x.motion > SHAKY.motion ? clamp((x.motion - SHAKY.motion) / (SHAKY.full - SHAKY.motion), 0.3, 1) : 0);
  // As referências são o melhor que o vídeo tem (sem contar os frames tremidos): um grande momento curto destaca-se do resto.
  const steady = s.filter((x) => shakeOf(x) === 0);
  const motionRef = Math.max(0.03, ...steady.map((x) => x.motion));
  const sharpRef = Math.max(0.01, ...s.map((x) => x.sharp));
  const hasAudio = s.some((x) => (x.audio ?? 0) > 0);
  return s.map((x) => {
    const shake = shakeOf(x);
    // Movimento a sério é o da cena; o da câmara toda a mexer não conta como vida.
    const motion = clamp(x.motion / motionRef, 0, 1) * (1 - shake);
    const sharp = clamp(x.sharp / sharpRef, 0, 1);
    const life = hasAudio ? 0.42 * motion + 0.26 * sharp + 0.32 * clamp(x.audio ?? 0, 0, 1) : 0.6 * motion + 0.4 * sharp;
    const light = x.luma <= DARK.min ? 0.1 : x.luma >= DARK.ok ? 1 : 0.1 + (0.9 * (x.luma - DARK.min)) / (DARK.ok - DARK.min);
    const burnt = x.luma > 0.94 ? 0.5 : 1;
    const blur = sharp < 0.35 ? 0.55 + sharp : 1;
    return r4(clamp((0.12 + 0.88 * life) * light * burnt * blur * (1 - 0.8 * shake), 0, 1));
  });
}

export interface Moment {
  /** O trecho (segundos no ficheiro). */
  start: number;
  end: number;
  /** A nota média do trecho (0 a 1). */
  score: number;
  /** O instante mais vivo dentro dele. */
  peak: number;
}

/**
 * Os melhores trechos de `want` segundos de um vídeo, do melhor para o pior, sem se sobreporem mais de metade. Um trecho que
 * passe por um bocado mau (nota abaixo de um quarto da média) é castigado: mais vale um bom momento inteiro.
 */
export function bestMoments(track: MomentTrack, want: number, count = 3): Moment[] {
  const dur = Math.max(0, track.duration);
  const len = clamp(want, 0, dur);
  const s = track.samples;
  if (!s.length || len <= 0) return [{ start: 0, end: r3(len), score: 0, peak: r3(len / 2) }];
  const sc = sampleScores(track);
  const avg = mean(sc);
  const step = Math.max(0.1, Math.min(0.5, len / 6));
  const cands: Moment[] = [];
  for (let st = 0; st <= dur - len + 1e-6; st += step) {
    let sum = 0, n = 0, worst = 1, best = -1, peak = st + len / 2;
    for (let i = 0; i < s.length; i++) {
      if (s[i].t < st - 1e-6 || s[i].t > st + len + 1e-6) continue;
      sum += sc[i]; n++;
      if (sc[i] < worst) worst = sc[i];
      if (sc[i] > best) { best = sc[i]; peak = s[i].t; }
    }
    if (!n) continue;
    // O instante mais vivo é o meio dos melhores (não o primeiro deles), e o trecho que o tem ao centro ganha um nadinha.
    let pt = 0, pn = 0;
    for (let i = 0; i < s.length; i++) if (s[i].t >= st - 1e-6 && s[i].t <= st + len + 1e-6 && sc[i] >= best * 0.95) { pt += s[i].t; pn++; }
    if (pn) peak = pt / pn;
    const score = (sum / n) * (worst < avg * 0.25 ? 0.7 : 1) * (1 - (0.06 * Math.abs(peak - (st + len / 2))) / len);
    cands.push({ start: r3(st), end: r3(st + len), score: r4(score), peak: r3(peak) });
  }
  if (!cands.length) return [{ start: 0, end: r3(len), score: r4(avg), peak: r3(len / 2) }];
  cands.sort((a, b) => b.score - a.score || a.start - b.start);
  const out: Moment[] = [];
  for (const c of cands) {
    if (out.length >= count) break;
    if (out.every((o) => Math.min(o.end, c.end) - Math.max(o.start, c.start) < len * 0.5)) out.push(c);
  }
  return out;
}

// ================================================================ 3. o ponto de interesse de uma foto

export interface Focus {
  /** O ponto de interesse (frações da foto, 0 a 1). */
  x: number;
  y: number;
  /** A caixa do que não se pode cortar (a cara, quando há pele; senão a zona com mais contraste). */
  box: { x0: number; y0: number; x1: number; y1: number };
  /** Há pele que chegue para ser uma cara ou pessoas. */
  face: boolean;
  /** Quão forte é a foto (contraste e cor), 0 a 1. */
  strength: number;
}

/** Pele em YCbCr (apanha tons claros e escuros: Cb 77 a 127, Cr 133 a 173, com alguma luz). */
export function isSkin(r: number, g: number, b: number): boolean {
  const y = 0.299 * r + 0.587 * g + 0.114 * b;
  const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
  const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
  return y > 35 && cb >= 77 && cb <= 127 && cr >= 133 && cr <= 173;
}

/**
 * O ponto de interesse de uma foto reduzida: saliência barata (quanto a cor foge da cor média, mais o contorno, mais a
 * pele), com preferência pelo centro. Com pele que chegue (2 % a 35 % da foto, sem ser a foto quase toda), o ponto e a caixa são os da pele.
 */
export function photoFocus(rgba: ArrayLike<number>, w: number, h: number): Focus {
  const n = w * h;
  const gray = grayOf(rgba, w, h);
  let mr = 0, mg = 0, mb = 0;
  for (let p = 0; p < n * 4; p += 4) { mr += rgba[p]; mg += rgba[p + 1]; mb += rgba[p + 2]; }
  mr /= n; mg /= n; mb /= n;
  let sw = 0, sx = 0, sy = 0, sxx = 0, syy = 0, total = 0;
  let kn = 0, kw = 0, kx = 0, ky = 0, kxx = 0, kyy = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x, p = i * 4;
      const cd = (Math.abs(rgba[p] - mr) + Math.abs(rgba[p + 1] - mg) + Math.abs(rgba[p + 2] - mb)) / 765;
      const edge = x > 0 && x < w - 1 && y > 0 && y < h - 1 ? Math.abs(4 * gray[i] - gray[i - 1] - gray[i + 1] - gray[i - w] - gray[i + w]) : 0;
      const u = (x + 0.5) / w, v = (y + 0.5) / h;
      const prior = 1 - 0.55 * Math.min(1, Math.hypot(u - 0.5, v - 0.45) / 0.7);
      const skin = isSkin(rgba[p], rgba[p + 1], rgba[p + 2]);
      const sal = (cd + 1.5 * edge) * prior;
      total += cd + edge;
      const wt = sal * sal;
      sw += wt; sx += wt * u; sy += wt * v; sxx += wt * u * u; syy += wt * v * v;
      if (skin) {
        // As caras estão quase sempre na metade de cima: a pele de cima pesa mais do que a de baixo (braços, pernas).
        const k = prior * (1.25 - 0.5 * v);
        kn++; kw += k; kx += k * u; ky += k * v; kxx += k * u * u; kyy += k * v * v;
      }
    }
  }
  const strength = r4(clamp((total / n) * 5, 0, 1));
  // Pele a mais (mais de 35 %) é areia, madeira ou uma parede: não é uma cara.
  const skinPart = kn / n;
  const pick = (W: number, X: number, Y: number, XX: number, YY: number, spread: number) => {
    if (!(W > 0)) return { x: 0.5, y: 0.45, box: { x0: 0.25, y0: 0.2, x1: 0.75, y1: 0.7 } };
    const cx = X / W, cy = Y / W;
    const dx = Math.sqrt(Math.max(0, XX / W - cx * cx)) * spread + 0.04, dy = Math.sqrt(Math.max(0, YY / W - cy * cy)) * spread + 0.04;
    return { x: r4(cx), y: r4(cy), box: { x0: r4(clamp(cx - dx, 0, 1)), y0: r4(clamp(cy - dy, 0, 1)), x1: r4(clamp(cx + dx, 0, 1)), y1: r4(clamp(cy + dy, 0, 1)) } };
  };
  const skinBox = pick(kw, kx, ky, kxx, kyy, 1.7);
  // E a pele de uma cara está junta: pontos quentes espalhados (janelas acesas, reflexos do pôr do sol) enchem pouco a caixa.
  const boxArea = (skinBox.box.x1 - skinBox.box.x0) * (skinBox.box.y1 - skinBox.box.y0);
  const face = skinPart >= 0.02 && skinPart <= 0.35 && boxArea <= 0.5 && skinPart / Math.max(boxArea, 1e-6) >= 0.4;
  const f = face ? skinBox : pick(sw, sx, sy, sxx, syy, 1.2);
  return { ...f, face, strength };
}

export interface Framing {
  /** `cover`: a foto enche o quadro (cortada dos lados ou de cima). `frame`: a foto inteira, com moldura de capulana. */
  mode: 'cover' | 'frame';
  /** Para onde aponta o zoom (frações da foto). */
  x: number;
  y: number;
  /** O zoom no início e no fim do clipe (1 = a foto a encher o quadro à justa). */
  from: number;
  to: number;
  /** A caixa que nunca se corta (a cara), se houver. */
  keep?: { x0: number; y0: number; x1: number; y1: number };
}

/**
 * O enquadramento de uma foto ou de um vídeo com proporção `aspect` (largura/altura) num quadro 9:16.
 * - Se a cara (a caixa do ponto de interesse) não cabe na parte que fica à vista, ou se a foto é deitada e há molduras, a
 *   foto vai inteira numa moldura.
 * - Senão enche o quadro, apontada ao ponto de interesse, com um zoom lento até `zoom` (para dentro, ou para fora com `out`)
 *   que nunca aperta mais do que a cara deixa.
 */
export function framingFor(focus: Focus | undefined, aspect: number, opts: { zoom?: number; out?: boolean; frames?: boolean } = {}): Framing {
  const zoom = clamp(opts.zoom ?? 0.1, 0, 0.4);
  const ar = aspect > 0 ? aspect : FRAME_ASPECT;
  const f = focus ?? { x: 0.5, y: 0.45, box: { x0: 0.3, y0: 0.25, x1: 0.7, y1: 0.65 }, face: false, strength: 0 };
  // A parte da foto que fica à vista sem zoom (frações da largura e da altura).
  const vw = ar > FRAME_ASPECT ? FRAME_ASPECT / ar : 1, vh = ar > FRAME_ASPECT ? 1 : ar / FRAME_ASPECT;
  const bw = f.box.x1 - f.box.x0, bh = f.box.y1 - f.box.y0;
  const cut = f.face && (bw > vw * 0.94 || bh > vh * 0.94);
  if (cut || (opts.frames && vw < 0.62)) {
    const z = 1 + Math.min(zoom, 0.08);
    return { mode: 'frame', x: f.x, y: f.y, from: opts.out ? r3(z) : 1, to: opts.out ? 1 : r3(z), ...(f.face ? { keep: f.box } : {}) };
  }
  const room = f.face ? Math.max(1, Math.min(vw / (bw * 1.08 || 1), vh / (bh * 1.08 || 1))) : 1 + zoom;
  const z = r3(Math.min(1 + zoom, room));
  return { mode: 'cover', x: f.x, y: f.y, from: opts.out ? z : 1, to: opts.out ? 1 : z, ...(f.face ? { keep: f.box } : {}) };
}

const easeIO = (x: number) => { const t = clamp(x, 0, 1); return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; };

/**
 * O retângulo da fonte (px da foto) que enche o quadro W×H no ponto `u` (0 a 1) do clipe, para o `drawImage`. Fica sempre
 * dentro da foto, o mais centrado possível no ponto de interesse, e com a caixa `keep` inteira lá dentro quando ela cabe.
 */
export function coverRect(sw: number, sh: number, fr: Pick<Framing, 'x' | 'y' | 'from' | 'to' | 'keep'>, u: number, W = 1080, H = 1920): { sx: number; sy: number; sw: number; sh: number } {
  const z = Math.max(1, fr.from + (fr.to - fr.from) * easeIO(u));
  const fa = W / H, ar = sw / sh;
  const w = (ar > fa ? sh * fa : sw) / z, h = (ar > fa ? sh : sw / fa) / z;
  const place = (c: number, size: number, full: number, k0?: number, k1?: number) => {
    let p = c * full - size / 2;
    if (k0 != null && k1 != null && (k1 - k0) * full <= size) p = clamp(p, k1 * full - size, k0 * full);
    return clamp(p, 0, Math.max(0, full - size));
  };
  return { sx: r3(place(fr.x, w, sw, fr.keep?.x0, fr.keep?.x1)), sy: r3(place(fr.y, h, sh, fr.keep?.y0, fr.keep?.y1)), sw: r3(w), sh: r3(h) };
}

// ================================================================ 4. o que se sabe de cada ficheiro

/** Um ficheiro escolhido (os campos do `ClipInput` do project.ts, mais a chave). */
export interface MagicSource { key: string; uri: string; video: boolean; mime: string; durationMs?: number; media?: string; speed?: number }

/** O que a análise mediu num ficheiro. */
export interface MagicItem {
  key: string;
  video: boolean;
  /** Largura/altura. */
  aspect: number;
  /** Vídeos: a duração do ficheiro (s). */
  duration: number;
  luma: number;
  sat: number;
  rgb: [number, number, number];
  /** Quão forte é o plano (0 a 1): o melhor momento do vídeo ou a força da foto. */
  strength: number;
  /** Quão calmo é (0 a 1). */
  calm: number;
  /** Quão vivo é (0 a 1): é o que se casa com as partes fortes da música. */
  energy: number;
  focus?: Focus;
  track?: MomentTrack;
  hasAudio?: boolean;
}

/** Junta as medidas de uma foto num `MagicItem`. */
export function photoItem(key: string, aspect: number, stats: FrameStats, focus: Focus): MagicItem {
  const strength = clamp(0.25 + 0.5 * focus.strength + 0.15 * stats.sat + (focus.face ? 0.12 : 0), 0, 0.92) * (stats.luma < DARK.min ? 0.4 : 1);
  return { key, video: false, aspect, duration: 0, luma: stats.luma, sat: stats.sat, rgb: stats.rgb, strength: r4(strength), calm: r4(clamp(0.9 - 0.5 * focus.strength - 0.2 * stats.sat, 0, 1)), energy: r4(clamp(0.15 + 0.4 * focus.strength, 0, 1)), focus };
}

/** Junta as medidas de um vídeo num `MagicItem` (as cores e a luz são as médias das amostras boas). */
export function videoItem(key: string, aspect: number, track: MomentTrack, look: { luma: number; sat: number; rgb: [number, number, number] }, hasAudio?: boolean, focus?: Focus): MagicItem {
  const sc = sampleScores(track);
  const best = bestMoments(track, Math.min(3, track.duration), 1)[0];
  const motion = mean(track.samples.map((s) => s.motion));
  const avg = mean(sc);
  // A energia é a dos melhores instantes (os 3 mais vivos), não a média: um vídeo calmo com um grande momento é vivo.
  const top = [...sc].sort((x, y) => y - x).slice(0, 3);
  return {
    key, video: true, aspect, duration: track.duration, luma: look.luma, sat: look.sat, rgb: look.rgb,
    strength: r4(clamp(0.28 + 0.8 * best.score, 0, 1)), calm: r4(clamp(1 - motion * 9 - avg * 0.3, 0, 1)), energy: r4(clamp(0.25 + 0.75 * mean(top), 0, 1)),
    track, hasAudio, focus,
  };
}

// ================================================================ 4b. os frames de um vídeo (as mesmas contas no site e no telemóvel)

/** Um frame de um vídeo já medido: o instante (s), os cinzentos (para o movimento) e a luz, a cor e a nitidez. */
export interface VideoFrame { t: number; gray: Float32Array; st: FrameStats }
/** Mede um frame reduzido a 32×56 (`rgba`, cortado ao 9:16 como vai aparecer). */
export function videoFrame(t: number, rgba: ArrayLike<number>, w: number = ANALYSIS.w, h: number = ANALYSIS.h): VideoFrame {
  const gray = grayOf(rgba, w, h);
  return { t, gray, st: frameStats(rgba, w, h, gray) };
}

/**
 * A energia do som de um vídeo: um valor (0 a 1) por bloco de 1/`rate` segundos. No site mede-se a 10 Hz (Web Audio);
 * na app vem do servidor (POST /tchekas/compose/analyze) a 4 Hz.
 */
export interface SoundEnergy { energy: number[]; rate: number }

/** A energia do som à volta do instante `t` (s): o máximo do bloco de `t` e dos dois vizinhos (como o site sempre fez). */
export function audioAt(sound: SoundEnergy, t: number): number {
  const e = sound.energy;
  const k = Math.floor(t * sound.rate);
  return Math.max(e[k] ?? 0, e[k + 1] ?? 0, e[Math.max(0, k - 1)] ?? 0);
}

/**
 * As amostras de um vídeo a partir dos frames medidos (por ordem do tempo): o movimento de cada um é em relação ao anterior
 * (o primeiro compara-se com o segundo) e, com som, a energia à volta dele.
 */
export function videoSamples(frames: readonly VideoFrame[], sound?: SoundEnergy | null, w: number = ANALYSIS.w, h: number = ANALYSIS.h): VideoSample[] {
  return frames.map((x, i) => {
    const m = i > 0 ? frameMotion(frames[i - 1].gray, x.gray, w, h) : frames.length > 1 ? frameMotion(x.gray, frames[1].gray, w, h) : { motion: 0, spread: 0 };
    return { t: r3(x.t), luma: x.st.luma, sharp: x.st.sharp, motion: m.motion, spread: m.spread, ...(sound ? { audio: audioAt(sound, x.t) } : {}) };
  });
}

/** A luz e a cor de um vídeo: as médias dos frames medidos. */
export function videoLook(frames: readonly VideoFrame[]): { luma: number; sat: number; rgb: [number, number, number] } {
  const n = Math.max(1, frames.length);
  const avg = (f: (s: FrameStats) => number) => frames.reduce((s, x) => s + f(x.st), 0) / n;
  return { luma: avg((x) => x.luma), sat: avg((x) => x.sat), rgb: [avg((x) => x.rgb[0]), avg((x) => x.rgb[1]), avg((x) => x.rgb[2])] };
}

/** Um vídeo já medido com o som que chegou depois (do servidor): as notas passam a contar com ele; `null` tira-o. */
export function withVideoSound(item: MagicItem, sound: SoundEnergy | null, hasAudio: boolean | undefined): MagicItem {
  if (!item.video || !item.track || !item.track.samples.length) return hasAudio === undefined ? item : { ...item, hasAudio };
  const samples = item.track.samples.map((s) => {
    const rest: VideoSample = { t: s.t, luma: s.luma, sharp: s.sharp, motion: s.motion, spread: s.spread };
    return sound && hasAudio !== false ? { ...rest, audio: audioAt(sound, s.t) } : rest;
  });
  return videoItem(item.key, item.aspect, { duration: item.track.duration, samples }, { luma: item.luma, sat: item.sat, rgb: item.rgb }, hasAudio ?? item.hasAudio, item.focus);
}

const median = (v: number[]) => { const s = [...v].sort((a, b) => a - b); const k = s.length >> 1; return s.length % 2 ? s[k] : (s[k - 1] + s[k]) / 2; };
/**
 * O ponto de interesse de um vídeo: a mediana dos pontos dos frames (a caixa da cara só conta se a maioria dos frames tiver
 * cara). `undefined` sem frames.
 */
export function videoFocus(list: readonly Focus[]): Focus | undefined {
  if (!list.length) return undefined;
  const faces = list.filter((x) => x.face);
  const face = faces.length * 2 > list.length;
  const from = face ? faces : list;
  const at = (src: readonly Focus[], f: (x: Focus) => number) => r4(median(src.map(f)));
  return {
    x: at(from, (x) => x.x), y: at(from, (x) => x.y),
    box: { x0: at(from, (x) => x.box.x0), y0: at(from, (x) => x.box.y0), x1: at(from, (x) => x.box.x1), y1: at(from, (x) => x.box.y1) },
    face, strength: at(list, (x) => x.strength),
  };
}

/** A ordem do geral para o pormenor: 1/2, 1/4, 3/4, 1/8, 3/8… (frações de 0 a 1). */
export function coarseToFine(n: number): number[] {
  const out: number[] = [];
  for (let den = 2; out.length < n; den *= 2) for (let k = 1; k < den && out.length < n; k += 2) out.push(k / den);
  return out;
}

/** Quantos frames se tiram de um vídeo no telemóvel: cerca de 2 por segundo, no máximo 40 (e pelo menos 4). */
export const VIDEO_SAMPLING = { perSecond: 2, max: 40, min: 4 } as const;

/**
 * Os instantes (s) a ver num vídeo de `duration` segundos: uma grelha regular de ~2 por segundo (no máximo 40), pela ordem do
 * geral para o pormenor (o meio, os quartos, os oitavos…). Quem tem pouco tempo fica com os primeiros e já cobre o vídeo todo.
 */
export function videoSampleTimes(duration: number, count?: number): number[] {
  const dur = Math.max(0, duration);
  if (!(dur > 0)) return [];
  const lo = Math.min(VIDEO_SAMPLING.min, Math.max(1, Math.floor(dur * 10)));
  const n = Math.round(clamp(count ?? Math.round(dur * VIDEO_SAMPLING.perSecond), lo, VIDEO_SAMPLING.max));
  const grid = Array.from({ length: n }, (_, i) => r3(clamp(((i + 0.5) / n) * dur, 0, Math.max(0, dur - 0.05))));
  // A ordem de van der Corput (1/2, 1/4, 3/4, 1/8…) levada à grelha: cada lote novo cai entre os que já se viram.
  let m = 1;
  while (m < n) m *= 2;
  const out: number[] = [];
  const used = new Set<number>();
  for (let j = 0; j < m && out.length < n; j++) {
    const k = (j + 1) % m;
    let r = 0;
    for (let b = k, f = 0.5; b > 0; b >>= 1, f /= 2) if (b & 1) r += f;
    const i = Math.min(n - 1, Math.floor((r + 0.5 / m) * n));
    if (!used.has(i)) { used.add(i); out.push(grid[i]); }
  }
  for (let i = 0; i < n && out.length < n; i++) if (!used.has(i)) { used.add(i); out.push(grid[i]); }
  return out;
}

/** Junta os frames medidos (em qualquer ordem) e o som num `MagicItem` de vídeo (como o site faz). */
export function videoItemFromFrames(key: string, aspect: number, duration: number, frames: readonly VideoFrame[], sound?: SoundEnergy | null, hasAudio?: boolean, focus?: Focus): MagicItem {
  const got = [...frames].sort((a, b) => a.t - b.t);
  if (!got.length) return videoItem(key, aspect, { duration, samples: [] }, { luma: 0.5, sat: 0.3, rgb: [0.5, 0.5, 0.5] }, hasAudio, focus);
  return videoItem(key, aspect, { duration, samples: videoSamples(got, hasAudio === false ? null : sound) }, videoLook(got), hasAudio, focus);
}

const FLAT_LOOK = { luma: 0.5, sharp: 0.05, sat: 0.3, rgb: [0.5, 0.5, 0.5] as [number, number, number] };
const FLAT_FOCUS: Focus = { x: 0.5, y: 0.45, box: { x0: 0.3, y0: 0.25, x1: 0.7, y1: 0.65 }, face: false, strength: 0.3 };
/** Um ficheiro que não se conseguiu ver: valores neutros (entra na montagem pela ordem em que veio, do início). */
export function neutralItem(s: MagicSource): MagicItem {
  return s.video ? videoItem(s.key, FRAME_ASPECT, { duration: Math.max(0.5, (s.durationMs ?? 5000) / 1000), samples: [] }, FLAT_LOOK) : photoItem(s.key, FRAME_ASPECT, FLAT_LOOK, FLAT_FOCUS);
}

// ================================================================ 5. a ordem com história

/** Quão diferentes são dois planos na cor e na luz (0 = iguais, perto de 1 = nada a ver). */
export function lookDistance(a: Pick<MagicItem, 'rgb' | 'luma' | 'sat'>, b: Pick<MagicItem, 'rgb' | 'luma' | 'sat'>): number {
  const dc = Math.hypot(a.rgb[0] - b.rgb[0], a.rgb[1] - b.rgb[1], a.rgb[2] - b.rgb[2]) / Math.sqrt(3);
  return clamp(0.55 * dc * 2 + 0.3 * Math.abs(a.luma - b.luma) * 2 + 0.15 * Math.abs(a.sat - b.sat), 0, 1);
}

/** Quanto custa pôr dois planos do mesmo tipo seguidos (é o que faz alternar fotos e vídeos). */
const SAME_KIND = 0.4;
/** Dois planos «empatam» quando a diferença é menor do que isto: aí a semente escolhe. */
const TIE = 0.06;

/**
 * A ordem dos planos (as chaves): abre com o mais forte, fecha com o mais calmo, e pelo meio vai sempre para o plano mais
 * parecido na cor e na luz, de preferência do outro tipo (foto/vídeo). `fixed` prende chaves a posições (os trancados).
 */
export function orderStory(items: MagicItem[], rnd: () => number = () => 0.5, fixed: Record<number, string> = {}): string[] {
  const n = items.length;
  const by = new Map(items.map((i) => [i.key, i]));
  const out: (string | null)[] = new Array(n).fill(null);
  const used = new Set<string>();
  for (const [pos, key] of Object.entries(fixed)) {
    const p = Number(pos);
    if (p >= 0 && p < n && by.has(key) && !used.has(key) && out[p] === null) { out[p] = key; used.add(key); }
  }
  const free = () => items.filter((i) => !used.has(i.key));
  const top = (list: MagicItem[], val: (i: MagicItem) => number): MagicItem | null => {
    if (!list.length) return null;
    const s = [...list].sort((a, b) => val(b) - val(a));
    const ties = s.filter((i) => val(s[0]) - val(i) < TIE);
    return ties[Math.floor(rnd() * ties.length) % ties.length];
  };
  const put = (p: number, it: MagicItem | null) => { if (it && out[p] === null) { out[p] = it.key; used.add(it.key); } };
  if (n && out[0] === null) put(0, top(free(), (i) => i.strength));
  if (n > 2 && out[n - 1] === null) put(n - 1, top(free(), (i) => i.calm - (i.video ? 0.08 : 0)));
  for (let p = 0; p < n; p++) {
    if (out[p] !== null) continue;
    const prev = p > 0 && out[p - 1] ? by.get(out[p - 1] as string) : undefined;
    const next = p + 1 < n && out[p + 1] ? by.get(out[p + 1] as string) : undefined;
    let best: MagicItem | null = null, cost = Infinity;
    for (const it of free()) {
      let c = rnd() * 0.1;
      if (prev) c += lookDistance(prev, it) + (prev.video === it.video ? SAME_KIND : 0);
      if (next) c += 0.5 * (lookDistance(next, it) + (next.video === it.video ? SAME_KIND : 0));
      if (c < cost) { cost = c; best = it; }
    }
    put(p, best);
  }
  return out.filter((k): k is string => k !== null);
}

// ================================================================ 6. a música

/** A energia (RMS) em blocos de `blockS` segundos, de 0 a 1 (em relação ao bloco mais forte). */
export function energyBlocks(samples: ArrayLike<number>, rate: number, blockS = 0.1): number[] {
  const size = Math.max(1, Math.round(rate * blockS));
  const out: number[] = [];
  let max = 0;
  for (let i = 0; i + size <= samples.length || (i === 0 && samples.length > 0); i += size) {
    let s = 0;
    const end = Math.min(samples.length, i + size);
    for (let k = i; k < end; k++) s += samples[k] * samples[k];
    const v = Math.sqrt(s / Math.max(1, end - i));
    out.push(v);
    if (v > max) max = v;
  }
  return max > 0 ? out.map((v) => r4(v / max)) : out;
}

/**
 * Onde começar a música (segundos) para uma tcheka de `windowS` segundos: a janela com mais energia (`forte`), com a
 * subida a 40 % (`subida`) ou a mais tranquila que ainda tem som (`calmo`). `energy` vem em blocos de `blockS` segundos.
 */
export function pickMusicStart(energy: number[], windowS: number, mode: 'forte' | 'subida' | 'calmo' = 'forte', blockS = 0.1): number {
  const win = Math.max(1, Math.round(windowS / blockS));
  if (energy.length <= win) return 0;
  const pre = [0];
  for (const e of energy) pre.push(pre[pre.length - 1] + e);
  let best = 0, score = -Infinity;
  for (let i = 0; i + win <= energy.length; i += 2) {
    const avg = (pre[i + win] - pre[i]) / win;
    const before = i >= 10 ? (pre[i] - pre[i - 10]) / 10 : avg;
    const rise = Math.max(0, (pre[Math.min(energy.length, i + 10)] - pre[i]) / 10 - before);
    const sc = mode === 'calmo' ? (avg > 0.08 ? -avg : -9) : avg + 0.5 * rise;
    if (sc > score + 1e-9) { score = sc; best = i; }
  }
  if (mode === 'subida') best = Math.max(0, best - Math.round(win * 0.4));
  return r3(best * blockS);
}

/** A música, já no trecho escolhido: `startMs` cai numa batida, e a energia começa aí. */
export interface MusicInfo {
  /** Onde começa o trecho (ms dentro da faixa). */
  startMs: number;
  /** Batidas por minuto (null = sem ritmo claro: usa 120). */
  bpm: number | null;
  /** A energia a partir de `startMs`, em blocos de 0,1 s (0 a 1). */
  energy: number[];
}

// ================================================================ 7. as ondas

export type WaveId = 'marginal' | 'noite' | 'tofo' | 'casamento' | 'malta' | 'marrabenta';
/** As rampas do effects.ts (cópia dos pontos: um teste confirma que são iguais quando o effects.ts existe). */
export const RAMP_POINTS: Record<string, [number, number][]> = {
  montaria: [[0, 2], [0.18, 2], [0.28, 0.45], [0.45, 0.45], [0.55, 2], [0.75, 2], [0.85, 0.5], [1, 0.5]],
  heroi: [[0, 1], [0.3, 1], [0.42, 0.25], [0.7, 0.25], [0.82, 1], [1, 1]],
  bala: [[0, 3], [0.36, 3], [0.44, 0.15], [0.62, 0.15], [0.7, 3], [1, 3]],
  flash: [[0, 0.6], [0.3, 0.6], [0.38, 4], [0.62, 4], [0.7, 0.6], [1, 0.6]],
};
/** Onde está o «momento» de cada rampa (fração do clipe montado): é aí que cai o instante mais vivo do vídeo. */
export const RAMP_MOMENT: Record<string, number> = { montaria: 0.365, heroi: 0.56, bala: 0.53, flash: 0.5 };

/** ∫₀ᵘ velocidade (igual ao `rampIntegral` do effects.ts). */
export function rampIntegral(points: readonly [number, number][], u: number): number {
  const x = clamp(u, 0, 1);
  const at = (q: number) => {
    for (let i = 1; i < points.length; i++) {
      const [u0, s0] = points[i - 1], [u1, s1] = points[i];
      if (q <= u1) return u1 > u0 ? s0 + ((s1 - s0) * (q - u0)) / (u1 - u0) : s1;
    }
    return points[points.length - 1][1];
  };
  let s = 0;
  for (let i = 1; i < points.length; i++) {
    const [u0, s0] = points[i - 1], [u1] = points[i];
    if (x <= u0) break;
    const b = Math.min(x, u1);
    s += ((s0 + at(b)) / 2) * (b - u0);
  }
  return s;
}
const rampAvg = (id?: string) => (id && RAMP_POINTS[id] ? rampIntegral(RAMP_POINTS[id], 1) : 1);

export interface Wave {
  id: WaveId;
  name: string;
  /** O carácter, numa linha (no cartão). */
  mood: string;
  /** O que a onda faz, em poucas palavras (por baixo, no cartão escolhido). */
  recipe: string;
  /** As cores do cartão (de cima para baixo) e o pano dele. */
  colors: [string, string];
  pano: { pattern: PatternId; palette: PaletteId };
  filter: { id: string; amount: number };
  /** As transições normais e as das partes fortes da música (ids do effects.ts), e a duração (s). */
  transitions: TransitionId[];
  strong: TransitionId[];
  transDur: number;
  /** A transição de capulana da onda (entra de vez em quando, se o estúdio já as tiver). */
  panoTransition: TransitionId;
  /** Batidas por foto: nas partes normais e nas fortes; e na abertura e no fecho. */
  photoBeats: number;
  photoBeatsStrong: number;
  openBeats: number;
  closeBeats: number;
  /** Quantos segundos de cada vídeo (antes de acertar nas batidas). */
  videoS: number;
  /** A rampa nos vídeos mais vivos (no máximo `rampMax` por tcheka). */
  ramp: RampId | null;
  rampMax: number;
  /** O zoom lento das fotos (0,1 = 10 %). */
  zoom: number;
  /** Os textos de abertura sugeridos, a letra e a animação. */
  openers: string[];
  font: FontId;
  textColor: string;
  textAnim: AnimIn;
  neon: boolean;
  /** Os efeitos sonoros: na abertura, nos cortes fortes, na rampa e no fim (ids do audioDsp.ts). */
  sfx: { open?: string; cut?: string; ramp?: string; end?: string };
  /** O trecho da música e os fades. */
  start: 'forte' | 'subida' | 'calmo';
  fadeIn: number;
  fadeOut: number;
}

export const WAVES: Wave[] = [
  {
    id: 'marginal', name: 'Marginal ao pôr do sol', mood: 'Dourado, lento e com brisa', recipe: 'Planos longos a fundir, luz quente, câmara lenta no melhor momento',
    colors: ['#ff9d4d', '#7a1f3d'], pano: { pattern: 'sol', palette: 'marginal' },
    filter: { id: 'costa-do-sol', amount: 0.8 }, transitions: ['fundido', 'fundido', 'brilho'], strong: ['brilho', 'zoom'], transDur: 0.7, panoTransition: 'capulana-vento',
    photoBeats: 4, photoBeatsStrong: 2, openBeats: 4, closeBeats: 6, videoS: 3.6, ramp: 'heroi', rampMax: 1, zoom: 0.12,
    openers: ['Fim de tarde na Marginal', 'Pôr do sol em Maputo', 'Hora dourada'], font: 'elegante', textColor: '#ffffff', textAnim: 'aparecer', neon: false,
    sfx: { open: 'vinil', ramp: 'whoosh' }, start: 'subida', fadeIn: 1.2, fadeOut: 2.5,
  },
  {
    id: 'noite', name: 'Noite de Maputo', mood: 'Néon, cortes secos e graves', recipe: 'Um corte por batida nas partes fortes, glitch e flash, paragem em bala',
    colors: ['#3b2b8f', '#0b0718'], pano: { pattern: 'losangos', palette: 'neon' },
    filter: { id: 'noite-de-maputo', amount: 0.85 }, transitions: ['corte', 'glitch', 'zoom'], strong: ['flash', 'glitch'], transDur: 0.3, panoTransition: 'capulana-rasgar',
    photoBeats: 2, photoBeatsStrong: 1, openBeats: 4, closeBeats: 4, videoS: 2.2, ramp: 'bala', rampMax: 2, zoom: 0.16,
    openers: ['Maputo não dorme', 'A noite é nossa', 'Sexta em Maputo'], font: 'futuro', textColor: '#2ec5ff', textAnim: 'brilho', neon: true,
    sfx: { open: 'riser', cut: 'boom', ramp: 'whoosh' }, start: 'forte', fadeIn: 0, fadeOut: 1,
  },
  {
    id: 'tofo', name: 'Praia do Tofo', mood: 'Azul, sal e mar aberto', recipe: 'A deslizar como as ondas, cores de mergulho, câmara lenta no salto',
    colors: ['#2ec5ff', '#0b4a6f'], pano: { pattern: 'escamas', palette: 'indico' },
    filter: { id: 'tofo', amount: 0.7 }, transitions: ['deslizar-esquerda', 'fundido', 'deslizar-cima'], strong: ['desfoque', 'zoom'], transDur: 0.5, panoTransition: 'capulana-deslizar',
    photoBeats: 4, photoBeatsStrong: 2, openBeats: 4, closeBeats: 4, videoS: 3, ramp: 'heroi', rampMax: 1, zoom: 0.1,
    openers: ['Tofo, sal e sol', 'Dias de praia', 'Inhambane, terra de boa gente'], font: 'praia', textColor: '#ffffff', textAnim: 'ondulacao', neon: false,
    sfx: { open: 'whoosh', ramp: 'whoosh' }, start: 'forte', fadeIn: 0.6, fadeOut: 1.5,
  },
  {
    id: 'casamento', name: 'Casamento', mood: 'Claro, elegante e emocionado', recipe: 'Fundidos longos, luz cremosa, tudo devagar e as palmas no fim',
    colors: ['#f3dcc4', '#9a6b5c'], pano: { pattern: 'flores', palette: 'coral' },
    filter: { id: 'xima', amount: 0.65 }, transitions: ['fundido', 'fundido', 'desfoque'], strong: ['brilho', 'fundido'], transDur: 0.9, panoTransition: 'capulana-desenrolar',
    photoBeats: 4, photoBeatsStrong: 4, openBeats: 6, closeBeats: 8, videoS: 4, ramp: 'heroi', rampMax: 1, zoom: 0.08,
    openers: ['O nosso dia', 'Para sempre', 'Lobolo e festa'], font: 'elegante', textColor: '#ffffff', textAnim: 'aparecer', neon: false,
    sfx: { open: 'ding', end: 'palmas' }, start: 'subida', fadeIn: 1.5, fadeOut: 3,
  },
  {
    id: 'malta', name: 'Txiling com a malta', mood: 'Descontraído, rápido e a rir', recipe: 'Dois tempos por plano, zoom e deslizes, a montanha-russa da velocidade',
    colors: ['#ff5c6c', '#7a1027'], pano: { pattern: 'ziguezague', palette: 'coral' },
    filter: { id: 'txillapp', amount: 0.7 }, transitions: ['zoom', 'deslizar-esquerda', 'corte', 'deslizar-direita'], strong: ['flash', 'zoom'], transDur: 0.35, panoTransition: 'capulana-losango',
    photoBeats: 2, photoBeatsStrong: 2, openBeats: 4, closeBeats: 4, videoS: 2.6, ramp: 'montaria', rampMax: 1, zoom: 0.14,
    openers: ['Txiling com a malta', 'Só boa onda', 'A malta toda'], font: 'marcador', textColor: '#ffd60a', textAnim: 'pop', neon: false,
    sfx: { open: 'pop', cut: 'pop', end: 'palmas' }, start: 'forte', fadeIn: 0, fadeOut: 1,
  },
  {
    id: 'marrabenta', name: 'Marrabenta', mood: 'Festa, cor e pé no chão', recipe: 'O passo da dança: um tempo, dois tempos, cortes secos e tambor',
    colors: ['#f0b400', '#b3261e'], pano: { pattern: 'faixas', palette: 'machamba' },
    filter: { id: 'marrabenta', amount: 0.9 }, transitions: ['corte', 'deslizar-direita', 'corte', 'deslizar-esquerda'], strong: ['flash', 'girar'], transDur: 0.3, panoTransition: 'capulana-deslizar',
    photoBeats: 2, photoBeatsStrong: 1, openBeats: 2, closeBeats: 4, videoS: 2.4, ramp: 'flash', rampMax: 1, zoom: 0.14,
    openers: ['É marrabenta!', 'Dança, Moçambique', 'Baila até de manhã'], font: 'retro', textColor: '#ffd60a', textAnim: 'pop', neon: false,
    sfx: { open: 'tambor', cut: 'tambor', end: 'palmas' }, start: 'forte', fadeIn: 0, fadeOut: 1,
  },
];
const WAVE_BY_ID = new Map(WAVES.map((w) => [w.id, w]));
export const waveById = (id: string | null | undefined): Wave => WAVE_BY_ID.get(id as WaveId) ?? WAVES[0];

/** As fases do ecrã «a montar» (pela ordem em que acontecem). */
export const MAGIC_PHASES = [
  { id: 'ver', label: 'A ver os teus vídeos…', done: 'Melhores momentos escolhidos' },
  { id: 'fotos', label: 'A enquadrar as fotos…', done: 'Fotos enquadradas' },
  { id: 'ritmo', label: 'A apanhar o ritmo…', done: 'Ritmo apanhado' },
  { id: 'historia', label: 'A contar a história…', done: 'História em ordem' },
  { id: 'onda', label: 'A dar-lhe a onda…', done: 'Onda aplicada' },
] as const;
/** A fase do som dos vídeos (na app a energia vem do servidor; no site faz parte de «A ver os teus vídeos…»). */
export const MAGIC_SOUND_PHASE = { id: 'som', label: 'A ouvir o som…', done: 'Som dos vídeos ouvido' } as const;
export type MagicPhase = (typeof MAGIC_PHASES)[number]['id'] | typeof MAGIC_SOUND_PHASE.id;
export interface MagicPhaseInfo { id: MagicPhase; label: string; done: string }
/** As fases que se mostram, pela ordem: com `sound`, a do som entra a seguir às fotos (os envios têm mais tempo). */
export function magicPhases(sound = false): MagicPhaseInfo[] {
  return sound ? [MAGIC_PHASES[0], MAGIC_PHASES[1], MAGIC_SOUND_PHASE, ...MAGIC_PHASES.slice(2)] : [...MAGIC_PHASES];
}

// ================================================================ 8. a montagem

/** Os efeitos de um clipe: o `ClipFx` do effects.ts (com o enquadramento `focus` e a moldura de capulana). */
export type MagicFx = ClipFx;
/** Um clipe da montagem: o `ProjectClip` do project.ts. */
export type MagicClip = ProjectClip;
/** O texto de abertura: um `TextOverlay` do effects.ts (com o pano das letras, se houver). */
export type MagicText = TextOverlay;
export type StoryRole = 'abertura' | 'meio' | 'forte' | 'fecho';
export interface MagicResult {
  v: number;
  seed: number;
  wave: WaveId;
  clips: MagicClip[];
  /** Quanto dura cada clipe na tcheka e onde começa (s). */
  durations: number[];
  starts: number[];
  total: number;
  overlays: MagicText[];
  /** A música: onde começa o trecho e o andamento usado (a batida 0 cai no 0 da tcheka). */
  music: { startMs: number; bpm: number; beat: number; fadeIn: number; fadeOut: number } | null;
  /** Os efeitos sonoros (ids do audioDsp.ts) e quando entram (s). */
  sfx: { id: string; at: number }[];
  /** Porque é que cada clipe está onde está (para o ecrã do resultado). */
  story: { key: string; role: StoryRole; why: string }[];
  /** O pano da tcheka (transições, molduras e letras). */
  pano: CapulanaSpec;
  /** Os ficheiros que não couberam nos 60 s. */
  left: string[];
}

export interface MagicInput {
  sources: MagicSource[];
  items: MagicItem[];
  music: MusicInfo | null;
  wave: WaveId;
  seed: number;
  /** O estúdio já tem as transições, as molduras e as letras de capulana ligadas (por omissão não: só ids do effects.ts). */
  capulana?: boolean;
  /**
   * Quem desenha e monta já sabe enquadrar os vídeos pelo ponto de interesse (`fx.focus` nos vídeos). Por omissão não: o
   * servidor só aceita o enquadramento nas fotos, e o ponto de interesse dos vídeos serve para o texto fugir da cara.
   */
  videoFocus?: boolean;
  /** O texto de abertura (em vez do sugerido); '' para não pôr texto. */
  title?: string;
  /** «Outra versão»: a montagem anterior e as chaves dos clipes trancados (ficam no lugar e como estavam). */
  keep?: { result: MagicResult; locked: string[] };
}

export const MAGIC_MAX_S = 58;
export const MAGIC_MIN_S = 6;
const MIN_VIDEO_OUT = 1;
const FALLBACK_BPM = 120;

/** A batida que conta para os cortes: a da música, dobrada enquanto for mais curta do que 0,42 s (músicas muito rápidas). */
export function beatUnit(bpm: number | null | undefined): number {
  let u = 60 / (bpm && bpm > 30 && bpm < 300 ? bpm : FALLBACK_BPM);
  while (u < 0.42) u *= 2;
  return u;
}

const energyAt = (energy: number[], t0: number, t1: number) => {
  if (!energy.length) return 0.5;
  const a = clamp(Math.floor(t0 * 10), 0, energy.length - 1), b = clamp(Math.ceil(t1 * 10), a + 1, energy.length);
  let s = 0;
  for (let i = a; i < b; i++) s += energy[i];
  return s / (b - a);
};
/** O limiar das «partes fortes»: acima do percentil 65 da energia do trecho. */
function strongLevel(energy: number[]): number {
  if (!energy.length) return 2;
  const s = [...energy].sort((a, b) => a - b);
  return Math.max(0.05, s[Math.floor(s.length * 0.65)]);
}

/**
 * Faz a montagem. Com as mesmas entradas (e a mesma semente) dá sempre o mesmo resultado; outra semente dá outra versão.
 */
export function buildMontage(input: MagicInput): MagicResult {
  const wave = waveById(input.wave);
  const waveIx = WAVES.indexOf(wave);
  const rnd = seeded(((Math.abs(Math.floor(input.seed)) % 1000000) + 1) * 97 + waveIx);
  const src = new Map(input.sources.map((s) => [s.key, s]));
  const items = input.items.filter((i) => src.has(i.key));
  const by = new Map(items.map((i) => [i.key, i]));
  const unit = beatUnit(input.music?.bpm);
  const energy = input.music?.energy ?? [];
  const strongAt = strongLevel(energy);
  const pano: CapulanaSpec = { ...wave.pano, seed: Math.floor(rnd() * 1000) };

  // Os trancados ficam na posição e com o clipe que tinham.
  const prev = input.keep?.result;
  const locked = new Map<string, MagicClip>();
  const fixed: Record<number, string> = {};
  if (prev) {
    prev.clips.forEach((c, i) => { if (input.keep?.locked.includes(c.key) && by.has(c.key)) { locked.set(c.key, c); fixed[Math.min(i, items.length - 1)] = c.key; } });
  }

  let order = orderStory(items, rnd, fixed);

  interface Slot { key: string; beats: number; ramp?: RampId; out: number }
  const plan = (keys: string[]): Slot[] => {
    let t = 0, ramps = 0;
    return keys.map((key, i) => {
      const it = by.get(key) as MagicItem;
      const lk = locked.get(key);
      if (lk) {
        const out = lk.video ? (lk.trim.end - lk.trim.start) / (lk.speed || 1) / rampAvg(lk.fx?.ramp) : lk.seconds;
        if (lk.fx?.ramp) ramps++;
        t += out;
        return { key, beats: Math.max(1, Math.round(out / unit)), ramp: lk.fx?.ramp, out };
      }
      const first = i === 0, last = i === keys.length - 1 && keys.length > 1;
      let beats: number, ramp: RampId | undefined;
      if (!it.video) {
        const strong = energyAt(energy, t, t + unit * wave.photoBeats) >= strongAt;
        beats = first ? wave.openBeats : last ? wave.closeBeats : strong ? wave.photoBeatsStrong : wave.photoBeats;
        if (!first && !last && wave.id === 'marrabenta') beats = i % 2 ? 1 : 2;
      } else {
        const speed = src.get(key)?.speed && (src.get(key)?.speed as number) > 0 ? (src.get(key)?.speed as number) : 1;
        const want = wave.videoS * (first ? 1.25 : last ? 1.2 : 1);
        beats = Math.max(1, Math.round(want / unit));
        const strong = energyAt(energy, t, t + beats * unit) >= strongAt;
        // A rampa vai para os vídeos mais vivos, numa parte forte da música, com pelo menos 2 s para se notar.
        if (wave.ramp && ramps < wave.rampMax && it.energy >= 0.55 && (strong || !energy.length) && beats * unit >= 2 && it.duration >= beats * unit * rampAvg(wave.ramp)) { ramp = wave.ramp; ramps++; }
        const maxBeats = Math.floor(it.duration / (speed * rampAvg(ramp)) / unit + 1e-6);
        if (maxBeats < 1) { const out = it.duration / speed; t += out; return { key, beats: 1, out }; }
        beats = Math.min(beats, maxBeats);
      }
      const out = beats * unit;
      t += out;
      return { key, beats, ramp, out };
    });
  };

  // Os vídeos mais vivos vão para as partes mais fortes da música (só trocam de lugar entre vídeos do meio, não trancados).
  let slots = plan(order);
  if (energy.length) {
    let t = 0;
    const mids: { pos: number; e: number }[] = [];
    slots.forEach((s, i) => {
      const it = by.get(s.key) as MagicItem;
      if (it.video && i > 0 && i < slots.length - 1 && !locked.has(s.key)) mids.push({ pos: i, e: energyAt(energy, t, t + s.out) });
      t += s.out;
    });
    if (mids.length > 1) {
      const vids = mids.map((m) => order[m.pos]).sort((a, b) => (by.get(b) as MagicItem).energy - (by.get(a) as MagicItem).energy);
      const next = [...order];
      [...mids].sort((a, b) => b.e - a.e).forEach((m, k) => { next[m.pos] = vids[k]; });
      order = next;
      slots = plan(order);
    }
  }

  // Cabe em 58 s (encurta os mais longos; se mesmo assim não couber, ficam de fora os do meio) e tem pelo menos 6 s.
  const totalOf = (s: Slot[]) => s.reduce((n, x) => n + x.out, 0);
  const left: string[] = [];
  for (let guard = 0; guard < 400 && totalOf(slots) > MAGIC_MAX_S; guard++) {
    let big = -1;
    slots.forEach((s, i) => { if (!locked.has(s.key) && s.beats > 1 && (big < 0 || s.out > slots[big].out)) big = i; });
    if (big >= 0) {
      const s = slots[big];
      const nb = Math.max(1, Math.floor(s.beats / 2));
      const ramp = s.ramp && nb * unit >= 2 ? s.ramp : undefined;
      slots[big] = { ...s, beats: nb, ramp, out: nb * unit };
      continue;
    }
    let drop = -1;
    for (let i = slots.length - 2; i > 0; i--) if (!locked.has(slots[i].key)) { drop = i; break; }
    if (drop < 0) break;
    left.push(slots[drop].key);
    slots.splice(drop, 1);
  }
  for (let guard = 0; guard < 6 && slots.length && totalOf(slots) < MAGIC_MIN_S; guard++) {
    let grew = false;
    slots = slots.map((s) => {
      const it = by.get(s.key) as MagicItem;
      if (locked.has(s.key)) return s;
      if (!it.video) { grew = true; return { ...s, beats: s.beats * 2, out: s.beats * 2 * unit }; }
      const speed = src.get(s.key)?.speed && (src.get(s.key)?.speed as number) > 0 ? (src.get(s.key)?.speed as number) : 1;
      const nb = Math.min(s.beats * 2, Math.floor(it.duration / (speed * rampAvg(s.ramp)) / unit + 1e-6));
      if (nb > s.beats) { grew = true; return { ...s, beats: nb, out: nb * unit }; }
      return s;
    });
    if (!grew) break;
  }

  // Os clipes.
  const clips: MagicClip[] = [];
  const durations: number[] = [], starts: number[] = [];
  const story: MagicResult['story'] = [];
  const sfx: MagicResult['sfx'] = [];
  let t = 0, cutSfx = 0, sincePano = 2;
  slots.forEach((s, i) => {
    const it = by.get(s.key) as MagicItem;
    const so = src.get(s.key) as MagicSource;
    const first = i === 0, last = i === slots.length - 1 && slots.length > 1;
    const strong = energy.length > 0 && energyAt(energy, t, t + Math.min(s.out, unit * 2)) >= strongAt;
    const lk = locked.get(s.key);
    let clip: MagicClip;
    if (lk) {
      clip = lk;
    } else {
      const fx: MagicFx = {};
      const amount = r2(wave.filter.amount * (it.luma < 0.22 ? 0.7 : 1));
      if (wave.filter.id !== 'normal' && amount > 0) fx.filter = { id: wave.filter.id, amount };
      if (i > 0) {
        // As transições fortes são para as partes fortes (menos no fecho, que é calmo), sem repetir a do corte anterior.
        const pool = strong && !last ? wave.strong : wave.transitions;
        const before0 = clips[i - 1]?.fx?.transition?.type;
        let type = pool[Math.floor(rnd() * pool.length) % pool.length];
        if (type === before0 && type !== 'corte' && type !== 'fundido') type = pool[(pool.indexOf(type) + 1) % pool.length];
        let dur = r2(Math.min(wave.transDur, s.out * 0.5));
        let tp: CapulanaSpec | undefined;
        const before = by.get(slots[i - 1].key) as MagicItem;
        // O pano entra quando a cena muda muito (outra cor, outra luz) ou no fecho, e nunca em dois cortes seguidos.
        if (input.capulana && sincePano >= 2 && s.out >= 1.2 && (last || lookDistance(before, it) > 0.22 || rnd() < 0.2)) {
          type = wave.panoTransition; dur = r2(Math.min(0.8, s.out * 0.6)); tp = pano; sincePano = 0;
        } else sincePano++;
        if (type !== 'corte' && dur >= 0.15) fx.transition = tp ? { type, dur, pano: tp } : { type, dur };
        else fx.transition = { type: 'corte', dur: 0.15 };
        if (strong && wave.sfx.cut && cutSfx < 4 && !last) { sfx.push({ id: wave.sfx.cut, at: r3(Math.max(0, t - 0.03)) }); cutSfx++; }
      }
      if (it.video) {
        const speed = so.speed && so.speed > 0 ? so.speed : 1;
        if (s.ramp) fx.ramp = s.ramp;
        const avg = rampAvg(s.ramp);
        const len = Math.min(it.duration, s.out * speed * avg);
        let start = 0;
        if (it.track && it.duration - len > 0.05) {
          // Quase sempre o melhor momento; às vezes outro quase tão bom (é o que muda de versão para versão).
          const ms = bestMoments(it.track, len, 3).filter((x, k, all) => k === 0 || x.score >= all[0].score * 0.85);
          const m = ms[ms.length > 1 && rnd() < 0.35 ? 1 + (Math.floor(rnd() * (ms.length - 1)) % (ms.length - 1)) : 0];
          // O instante mais vivo cai no «momento» da rampa ou, sem rampa, na batida mais forte da música dentro do clipe.
          let frac: number;
          if (s.ramp) frac = rampIntegral(RAMP_POINTS[s.ramp], RAMP_MOMENT[s.ramp] ?? 0.5) / avg;
          else {
            let bestB = 0, bestE = -1;
            for (let b = 0; b < s.beats; b++) { const e = energyAt(energy, t + b * unit, t + (b + 1) * unit); if (e > bestE + 1e-9) { bestE = e; bestB = b; } }
            frac = energy.length ? (bestB * unit) / s.out : 0.35;
          }
          const wantStart = m.peak - frac * len;
          start = clamp(clamp(wantStart, m.start - len * 0.3, m.start + len * 0.3), 0, it.duration - len);
        }
        const fr = framingFor(it.focus, it.aspect, { zoom: 0, frames: false });
        if (input.videoFocus && it.focus && Math.abs(it.aspect - FRAME_ASPECT) > 0.05) fx.focus = { x: fr.x, y: fr.y, from: 1, to: 1 };
        clip = { key: so.key, media: so.media ?? so.key, uri: so.uri, video: true, mime: so.mime, durationMs: so.durationMs ?? Math.round(it.duration * 1000), seconds: 3, beats: s.beats, speed, length: it.duration, trim: { start: r3(start), end: r3(start + len) }, ...(it.hasAudio != null ? { hasAudio: it.hasAudio } : {}), fx };
        if (s.ramp && wave.sfx.ramp) sfx.push({ id: wave.sfx.ramp, at: r3(t + s.out * (RAMP_MOMENT[s.ramp] ?? 0.5) * 0.7) });
      } else {
        const fr = framingFor(it.focus, it.aspect, { zoom: wave.zoom, out: rnd() < 0.3, frames: !!input.capulana });
        fx.focus = { x: fr.x, y: fr.y, from: fr.from, to: fr.to, ...(fr.keep ? { keep: fr.keep } : {}) };
        if (fr.mode === 'frame' && input.capulana) fx.moldura = pano;
        clip = { key: so.key, media: so.media ?? so.key, uri: so.uri, video: false, mime: so.mime, durationMs: so.durationMs, seconds: r3(s.out), beats: s.beats, speed: 1, length: 0, trim: { start: 0, end: 0 }, fx };
      }
    }
    clips.push(clip);
    durations.push(r3(s.out));
    starts.push(r3(t));
    const role: StoryRole = first ? 'abertura' : last ? 'fecho' : strong ? 'forte' : 'meio';
    const why = lk ? 'Trancado: ficou como estava' : first ? 'Abre com o plano mais forte' : last ? 'Fecha num plano calmo' : s.ramp ? 'Câmara no momento mais vivo' : strong ? 'Na parte forte da música' : it.video ? 'O melhor momento do vídeo' : 'Cor e luz a condizer';
    story.push({ key: s.key, role, why });
    t += s.out;
  });
  const total = r3(t);

  if (wave.sfx.open && total > 1) sfx.unshift({ id: wave.sfx.open, at: 0 });
  if (wave.sfx.end && total > 4) sfx.push({ id: wave.sfx.end, at: r3(Math.max(0, total - 1.2)) });

  // O texto de abertura: fora da cara do primeiro plano e dentro da zona segura.
  const overlays: MagicText[] = [];
  const title = input.title ?? wave.openers[Math.floor(rnd() * wave.openers.length) % wave.openers.length];
  if (title.trim() && total >= 2) {
    const first = clips[0], i0 = first ? by.get(first.key) : undefined;
    const f0 = i0?.focus;
    // Com moldura, o texto vai para cima da foto (o cimo dela: 0,46 − metade da altura; ver `frameLayout`); senão foge da cara.
    const frameTop = first?.fx?.moldura && i0 ? 0.46 - Math.min(0.62, (0.86 * FRAME_ASPECT) / (i0.aspect > 0 ? i0.aspect : 1)) / 2 - 0.02 : null;
    const y = frameTop != null ? r3(Math.max(0.14, (0.1 + frameTop) / 2)) : f0 && f0.y < 0.48 ? 0.66 : 0.3;
    const end = r3(Math.min(total - 0.1, Math.max(2.2, Math.min(3.6, durations[0] ?? 3))));
    overlays.push({
      id: `magica-${input.seed}`, kind: 'text', text: title.trim().slice(0, 80), start: 0.2, end, x: frameTop != null ? 0.5 : 0.44, y, scale: 1, rot: 0,
      anim: { in: wave.textAnim, out: 'aparecer', loop: 'nenhuma', inDur: 0.5, outDur: 0.4 },
      font: wave.font, size: frameTop != null ? 76 : title.length > 18 ? 84 : 104, color: wave.textColor, align: 'center', bg: 'nenhum', outline: false, shadow: true, neon: wave.neon,
      ...(input.capulana && (wave.id === 'marrabenta' || wave.id === 'malta') ? { pano } : {}),
    });
  }

  return {
    v: MAGIC_VERSION, seed: input.seed, wave: wave.id, clips, durations, starts, total, overlays,
    music: input.music ? { startMs: Math.round(input.music.startMs), bpm: input.music.bpm ?? FALLBACK_BPM, beat: r4(unit), fadeIn: wave.fadeIn, fadeOut: Math.min(wave.fadeOut, r2(total / 3)) } : null,
    sfx: sfx.slice(0, 12), story, pano, left,
  };
}

/** A semente da «Outra versão» (nunca repete a anterior). */
export const nextMagicSeed = (seed: number) => (Math.abs(Math.floor(seed)) + 1) % 1000000;

/** Onde há cortes (s): o início de cada clipe menos o primeiro. */
export const magicCuts = (r: Pick<MagicResult, 'starts'>) => r.starts.slice(1);

/** Uma assinatura curta da montagem (para saber se duas versões são iguais). */
export function magicSignature(r: MagicResult): string {
  return r.clips.map((c, i) => `${c.key}:${r.durations[i]}:${c.trim.start}:${c.fx?.transition?.type ?? '-'}:${c.fx?.ramp ?? '-'}`).join('|') + `#${r.overlays[0]?.text ?? ''}`;
}
