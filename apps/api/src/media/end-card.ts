import { createCanvas, GlobalFonts, Path2D, type SKRSContext2D } from '@napi-rs/canvas';
import { existsSync } from 'fs';
import { resolve } from 'path';
import { encodeWav, synthSfx } from '../compose/audio';
import { BOX, DOT, PATHS, SEAL_BLUE, SEAL_CHECK, SEAL_CORAL, SEAL_PATH, sealPaint, type SealTier } from './signature';

/**
 * O cartão do fim de uma tcheka guardada (como o do TikTok): uns segundos depois do vídeo, num fundo escuro com um toque do
 * degradê da marca (#d6334f → #ff9a5b), o logótipo do Txillapp a desenhar-se letra a letra (a mesma geometria de
 * media/signature.ts e da app, lib/wordmark.ts), o ponto do i a coral a saltar, e por baixo o @ de quem publicou (com o
 * selo, se a conta for verificada). Desenhado no canvas do Node (@napi-rs/canvas), frame a frame, para o ffmpeg.
 * Só vai nas cópias que se guardam ou partilham: o vídeo da publicação fica sem ele.
 */

export const END_CARD_FPS = 30;
/** Quanto dura o cartão (segundos). */
export const END_CARD_S = 2.6;
/** O vídeo escurece até ao preto no fim (o cartão nasce do preto): quanto dura essa passagem. */
export const VIDEO_FADE_S = 0.3;
/** O som da tcheka desce até ao silêncio no fim do vídeo. */
export const AUDIO_FADE_S = 0.6;

/** Os tempos da animação (segundos desde o início do cartão). */
export const CARD_TIMES = {
  /** O fundo acende-se do preto. */
  bgIn: 0.32,
  /** As letras desenham-se uma a uma. */
  draw: 0.16, letterGap: 0.075, letterDur: 0.42,
  /** O ponto do i salta (e o «ding» toca). */
  dot: 0.98,
  /** A linha da marca abre-se do meio. */
  line: 1.02,
  /** O @ sobe e aparece. */
  user: 1.16,
  /** txillapp.com, discreto, em baixo. */
  site: 1.4,
} as const;

/** As letras de «txillapp» (os índices de PATHS; o t e o x são um caminho cada, com dois traços): t, x, i, l, l, a, p, p. */
const LETTERS = [[0], [1], [2], [3], [4], [5, 6], [7, 8], [9, 10]];
const CORAL_DOT = '#ff5c6c';
const BRAND = ['#d6334f', '#ff9a5b'] as const;
const BG = '#0b090d';

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const easeOutCubic = (p: number) => 1 - (1 - p) ** 3;
const easeInOutCubic = (p: number) => (p < 0.5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2);
const easeOutBack = (p: number, k = 2.2) => 1 + (k + 1) * (p - 1) ** 3 + k * (p - 1) ** 2;
const at = (t: number, start: number, dur: number) => clamp01((t - start) / dur);

/**
 * O comprimento de um caminho SVG simples (os do logótipo: M, L, H, V, Q e arcos circulares, absolutos ou relativos), para
 * o desenhar com um traço tracejado que avança.
 */
export function pathLength(d: string): number {
  const tok = d.match(/[MmLlHhVvQqAa]|-?\d*\.?\d+(?:e-?\d+)?/g) ?? [];
  let i = 0, x = 0, y = 0, sx = 0, sy = 0, cmd = '', len = 0;
  const num = () => Number(tok[i++]);
  const isNum = () => i < tok.length && !/[A-Za-z]/.test(tok[i]);
  while (i < tok.length) {
    if (!isNum()) cmd = tok[i++];
    const rel = cmd === cmd.toLowerCase();
    const ox = rel ? x : 0, oy = rel ? y : 0;
    switch (cmd.toUpperCase()) {
      case 'M': x = ox + num(); y = oy + num(); sx = x; sy = y; cmd = rel ? 'l' : 'L'; break;
      case 'L': { const nx = ox + num(), ny = oy + num(); len += Math.hypot(nx - x, ny - y); x = nx; y = ny; break; }
      case 'H': { const nx = (rel ? x : 0) + num(); len += Math.abs(nx - x); x = nx; break; }
      case 'V': { const ny = (rel ? y : 0) + num(); len += Math.abs(ny - y); y = ny; break; }
      case 'Q': {
        const cx = ox + num(), cy = oy + num(), nx = ox + num(), ny = oy + num();
        let px = x, py = y;
        for (let k = 1; k <= 24; k++) {
          const u = k / 24, a = (1 - u) ** 2, b = 2 * (1 - u) * u, c = u * u;
          const qx = a * x + b * cx + c * nx, qy = a * y + b * cy + c * ny;
          len += Math.hypot(qx - px, qy - py);
          px = qx; py = qy;
        }
        x = nx; y = ny;
        break;
      }
      case 'A': {
        const r = num(); num(); num(); const large = num(); num();
        const nx = ox + num(), ny = oy + num();
        const chord = Math.hypot(nx - x, ny - y);
        const theta = 2 * Math.asin(Math.min(1, chord / (2 * r)));
        len += r * (large ? 2 * Math.PI - theta : theta);
        x = nx; y = ny;
        break;
      }
      default: i++;
    }
  }
  void sx; void sy;
  return len;
}

const LENGTHS = PATHS.map(pathLength);
const PATH2D = PATHS.map((p) => new Path2D(p));
const SEAL_2D = new Path2D(SEAL_PATH);
const CHECK_2D = new Path2D(SEAL_CHECK);

const FONT_FILES = [resolve(__dirname, '../../assets/fonts/DejaVuSans-Bold.ttf'), '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'];
const FAMILY = 'TxEndCard';
let fontOk: boolean | null = null;
function ensureFont(): string {
  if (fontOk === null) {
    const f = FONT_FILES.find((p) => existsSync(p));
    fontOk = !!f && !!GlobalFonts.registerFromPath(f, FAMILY);
  }
  return fontOk ? FAMILY : 'sans-serif';
}

export interface EndCardOpts {
  /** O @ (sem o @) de quem publicou, ou o nome de um local. */
  label: string;
  /** Com o @ à frente (pessoas); os locais vão pelo nome. */
  handle: boolean;
  seal: SealTier | null;
}

/** As medidas do cartão num quadro W×H (o mesmo desenho em vertical e na horizontal: conta o lado mais curto). */
export function cardLayout(W: number, H: number) {
  const base = Math.min(W, H);
  const ww = base * 0.6;
  const s = ww / BOX.w;
  const wh = BOX.h * s;
  const cy = H * (H > W ? 0.44 : 0.4);
  const x0 = (W - ww) / 2;
  const y0 = cy - wh / 2;
  const lineY = y0 + wh + base * 0.06;
  const userSize = Math.round(base * 0.05);
  const userBaseline = lineY + base * 0.1;
  return { base, ww, s, wh, x0, y0, lineY, userSize, userBaseline, siteSize: Math.round(base * 0.026), siteY: H - Math.max(base * 0.1, H * 0.07) };
}

/** Um frame do cartão no instante `t` (segundos desde o início). */
export function drawEndCard(g: SKRSContext2D, W: number, H: number, t: number, o: EndCardOpts) {
  const L = cardLayout(W, H);
  const T = CARD_TIMES;
  g.save();
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalAlpha = 1;
  g.globalCompositeOperation = 'source-over';
  g.fillStyle = BG;
  g.fillRect(0, 0, W, H);

  // O toque da marca: duas luzes grandes e suaves (coral em cima à esquerda, laranja em baixo à direita), a respirar devagar.
  const glow = easeOutCubic(at(t, 0, 0.9));
  const big = Math.max(W, H);
  const drift = Math.sin(t * 1.3) * 0.02;
  const light = (cx: number, cy: number, r: number, rgb: string, a: number) => {
    const gr = g.createRadialGradient(cx, cy, 0, cx, cy, r);
    gr.addColorStop(0, `rgba(${rgb},${(a * glow).toFixed(3)})`);
    gr.addColorStop(0.55, `rgba(${rgb},${(a * glow * 0.35).toFixed(3)})`);
    gr.addColorStop(1, `rgba(${rgb},0)`);
    g.fillStyle = gr;
    g.fillRect(0, 0, W, H);
  };
  light(W * (0.16 + drift), H * (0.2 - drift), big * 0.6, '214,51,79', 0.3);
  light(W * (0.88 - drift), H * (0.84 + drift), big * 0.5, '255,154,91', 0.2);
  // Um halo por trás do logótipo, que cresce quando o ponto salta.
  const pop = at(t, T.dot, 0.6);
  light(W / 2, L.y0 + L.wh / 2, L.ww * (0.75 + 0.1 * easeOutCubic(pop)), '255,92,108', 0.12 + 0.07 * Math.sin(Math.PI * pop));
  // Vinheta: os cantos mais escuros (o olho vai para o meio).
  const vg = g.createRadialGradient(W / 2, H / 2, L.base * 0.35, W / 2, H / 2, big * 0.75);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(0,0,0,0.55)');
  g.fillStyle = vg;
  g.fillRect(0, 0, W, H);

  // O logótipo: entra a crescer um pouco (de 0,94 a 1) enquanto as letras se desenham.
  const grow = 0.94 + 0.06 * easeOutCubic(at(t, T.draw, 1.1));
  const mx = W / 2, my = L.y0 + L.wh / 2;
  g.save();
  g.translate(mx, my);
  g.scale(grow, grow);
  g.translate(-mx, -my);
  g.translate(L.x0 - BOX.x * L.s, L.y0 - BOX.y * L.s);
  g.scale(L.s, L.s);
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.lineWidth = 7;
  g.strokeStyle = '#ffffff';
  g.shadowColor = 'rgba(255,255,255,0.28)';
  g.shadowBlur = 5 * L.s;
  LETTERS.forEach((paths, li) => {
    const p = easeInOutCubic(at(t, T.draw + li * T.letterGap, T.letterDur));
    if (p <= 0.004) return;
    for (const k of paths) {
      const len = LENGTHS[k];
      if (p >= 1) g.setLineDash([]);
      else {
        g.setLineDash([len * p, len + 8]);
        g.lineDashOffset = 0;
      }
      g.stroke(PATH2D[k]);
    }
  });
  g.setLineDash([]);
  g.shadowBlur = 0;
  g.shadowColor = 'rgba(0,0,0,0)';
  // O ponto do i, a coral: salta (passa um pouco do tamanho e volta) e solta um anel que se apaga.
  const dp = at(t, T.dot, 0.34);
  if (dp > 0) {
    const ring = at(t, T.dot, 0.62);
    if (ring < 1) {
      g.beginPath();
      g.arc(DOT.cx, DOT.cy, DOT.r * (1 + 2.6 * easeOutCubic(ring)), 0, Math.PI * 2);
      g.strokeStyle = `rgba(255,92,108,${(0.75 * (1 - ring)).toFixed(3)})`;
      g.lineWidth = 1.6 * (1 - ring * 0.6);
      g.stroke();
    }
    g.shadowColor = 'rgba(255,92,108,0.7)';
    g.shadowBlur = 6 * L.s;
    g.beginPath();
    g.arc(DOT.cx, DOT.cy, Math.max(0.01, DOT.r * easeOutBack(dp)), 0, Math.PI * 2);
    g.fillStyle = CORAL_DOT;
    g.fill();
    g.shadowBlur = 0;
    g.shadowColor = 'rgba(0,0,0,0)';
  }
  g.restore();

  // A linha da marca (o degradê coral → laranja), a abrir do meio.
  const lp = easeOutCubic(at(t, T.line, 0.5));
  if (lp > 0) {
    const lw = L.base * 0.15 * lp, lh = Math.max(3, L.base * 0.0075);
    const lx = (W - lw) / 2;
    const lg = g.createLinearGradient(lx, 0, lx + lw, 0);
    lg.addColorStop(0, BRAND[0]);
    lg.addColorStop(1, BRAND[1]);
    g.fillStyle = lg;
    g.beginPath();
    g.roundRect(lx, L.lineY - lh / 2, lw, lh, lh / 2);
    g.fill();
  }

  // O @ (e o selo), a subir e a aparecer.
  const up = easeOutCubic(at(t, T.user, 0.45));
  if (up > 0 && o.label) {
    const family = ensureFont();
    let size = L.userSize;
    const text = `${o.handle ? '@' : ''}${o.label}`;
    const sealK = 1.05, gapK = 0.2;
    const measure = () => { g.font = `bold ${size}px "${family}"`; return g.measureText(text).width; };
    let tw = measure();
    const room = W * 0.84;
    while (size > 12 && tw + (o.seal ? size * (sealK + gapK) : 0) > room) { size -= 2; tw = measure(); }
    const sealSize = size * sealK;
    const total = tw + (o.seal ? sealSize + size * gapK : 0);
    const x = (W - total) / 2;
    const y = L.userBaseline + (1 - up) * L.base * 0.03;
    g.globalAlpha = up;
    g.textAlign = 'left';
    g.textBaseline = 'alphabetic';
    g.fillStyle = 'rgba(255,255,255,0.94)';
    g.shadowColor = 'rgba(0,0,0,0.45)';
    g.shadowBlur = size * 0.25;
    g.shadowOffsetY = size * 0.04;
    g.fillText(text, x, y);
    g.shadowBlur = 0;
    g.shadowOffsetY = 0;
    g.shadowColor = 'rgba(0,0,0,0)';
    if (o.seal) {
      const k = sealSize / 24;
      const sx = x + tw + size * gapK, sy = y - size * 0.36 - sealSize / 2;
      g.save();
      g.translate(sx, sy);
      g.scale(k, k);
      if (sealPaint(o.seal) === 'blue') g.fillStyle = SEAL_BLUE;
      else {
        const sg = g.createLinearGradient(0, 0, 24, 24);
        sg.addColorStop(0, SEAL_CORAL[0]);
        sg.addColorStop(1, SEAL_CORAL[1]);
        g.fillStyle = sg;
      }
      g.fill(SEAL_2D);
      g.strokeStyle = '#ffffff';
      g.lineWidth = 2.2;
      g.lineCap = 'round';
      g.lineJoin = 'round';
      g.stroke(CHECK_2D);
      g.restore();
    }
    g.globalAlpha = 1;
  }

  // txillapp.com, discreto, em baixo.
  const sp = easeOutCubic(at(t, T.site, 0.5));
  if (sp > 0) {
    g.globalAlpha = sp * 0.5;
    g.font = `bold ${L.siteSize}px "${ensureFont()}"`;
    g.textAlign = 'center';
    g.fillStyle = '#ffffff';
    g.fillText('txillapp.com', W / 2, L.siteY);
    g.globalAlpha = 1;
  }

  // O cartão nasce do preto (o vídeo acaba no preto).
  const inA = 1 - easeOutCubic(at(t, 0, T.bgIn));
  if (inA > 0) {
    g.fillStyle = `rgba(0,0,0,${inA.toFixed(3)})`;
    g.fillRect(0, 0, W, H);
  }
  g.restore();
}


/** Os frames do cartão (RGBA, W×H), um de cada vez. */
export function* endCardFrames(W: number, H: number, o: EndCardOpts, seconds = END_CARD_S, fps = END_CARD_FPS): Generator<Uint8Array> {
  const c = createCanvas(W, H);
  const g = c.getContext('2d');
  const n = Math.round(seconds * fps);
  for (let k = 0; k < n; k++) {
    drawEndCard(g, W, H, k / fps, o);
    const d = g.getImageData(0, 0, W, H).data;
    yield new Uint8Array(d.buffer, d.byteOffset, d.byteLength);
  }
}

/** Um frame do cartão em PNG (para ver como fica e para os testes). */
export function endCardPng(W: number, H: number, t: number, o: EndCardOpts): Buffer {
  const c = createCanvas(W, H);
  drawEndCard(c.getContext('2d'), W, H, t, o);
  return c.toBuffer('image/png');
}

/**
 * O som do cartão (WAV estéreo, 48 kHz, `seconds`): um sopro suave enquanto o logótipo se desenha e um «ding» quando o ponto
 * do i salta. Os mesmos efeitos sonoros do estúdio (compose/audio.ts), mais baixos.
 */
export function endCardSting(seconds = END_CARD_S, rate = 48_000): Uint8Array {
  const n = Math.round(seconds * rate);
  const L = new Float32Array(n), R = new Float32Array(n);
  const add = (s: Float32Array, atS: number, gain: number, pan: number) => {
    const start = Math.round(atS * rate);
    for (let i = 0; i < s.length && start + i < n; i++) {
      L[start + i] += s[i] * gain * (1 - pan);
      R[start + i] += s[i] * gain * (1 + pan);
    }
  };
  add(synthSfx('whoosh', rate), CARD_TIMES.draw - 0.05, 0.22, -0.15);
  add(synthSfx('ding', rate), CARD_TIMES.dot, 0.34, 0.1);
  // Um fim limpo (sem estalido no corte).
  const tail = Math.round(0.25 * rate);
  for (let i = 0; i < tail; i++) { const k = 1 - i / tail; L[n - tail + i] *= k; R[n - tail + i] *= k; }
  return encodeWav([L, R], rate);
}
