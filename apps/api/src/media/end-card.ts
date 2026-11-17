import { createCanvas, GlobalFonts, Path2D, type SKRSContext2D } from '@napi-rs/canvas';
import { existsSync } from 'fs';
import { resolve } from 'path';
import { encodeWav, synthSfx } from '../compose/audio';
import { LOGO_BOX, LOGO_DOT, LOGO_FILL_RULE, LOGO_INK_PATHS } from './marca';
import { SEAL_BLUE, SEAL_CHECK, SEAL_CORAL, SEAL_PATH, sealPaint, type SealTier } from './signature';

/**
 * O cartão do fim de uma tcheka guardada (como o do TikTok): uns segundos depois do vídeo, num fundo escuro com um toque do
 * degradê da marca (#d6334f → #ff9a5b), o logótipo do Txillapp animado (o desenho de media/marca.ts, o mesmo da assinatura
 * e da app): o «tx» sobe e aparece, o «ill» (os dois «ll» laçados: duas pessoas a txillar juntas) cresce a partir da base e
 * balança, o «a», o «p» e o «p» entram um a um, e o ponto do i, a coral, cai de cima e salta até assentar. Por baixo, o @ de
 * quem publicou (com o selo, se a conta for verificada). Desenhado no canvas do Node (@napi-rs/canvas), frame a frame.
 * Só vai nas cópias que se guardam ou partilham: o vídeo da publicação fica sem ele.
 */

export const END_CARD_FPS = 30;
/** Quanto dura o cartão (segundos). */
export const END_CARD_S = 3;
/** O vídeo escurece até ao preto no fim (o cartão nasce do preto): quanto dura essa passagem. */
export const VIDEO_FADE_S = 0.3;
/** O som da tcheka desce até ao silêncio no fim do vídeo. */
export const AUDIO_FADE_S = 0.6;

/** Os tempos da animação (segundos desde o início do cartão). */
export const CARD_TIMES = {
  /** O fundo acende-se do preto. */
  bgIn: 0.32,
  /** O «tx» entra da esquerda, inclinado, com ease-out-back (e depois acompanha o balanço dos «ll»). */
  tx: 0.1, txDur: 0.5,
  /** O «ill» cresce a partir da base (ease-out-back; o sopro toca). */
  grow: 0.15, growDur: 0.6,
  /** Depois balança, as duas pessoas juntas (um balanço amortecido à volta da base). */
  sway: 0.8, swayDur: 1,
  /** O «a», o «p» e o último «p» entram um a um, com um pop. */
  letters: [0.6, 0.72, 0.84], popDur: 0.32,
  /** O ponto do i cai de cima (`dot`) e salta até assentar (em `fall`); o primeiro toque no i é DOT_HIT (o anel e o «ding»). */
  dot: 1, fall: 0.62,
  /** Quando o ponto assenta, o «tx» dá um saltinho. */
  landDur: 0.24,
  /** A linha da marca abre-se do meio. */
  line: 1.42,
  /** O @ sobe e aparece. */
  user: 1.55,
  /** txillapp.com, discreto, em baixo. */
  site: 1.8,
} as const;

/** O salto do ponto (o «bounce» clássico): o primeiro toque é em 1/2,75 do caminho. */
const bounce = (p: number) => {
  const n = 7.5625, d = 2.75;
  const arc = (c: number, top: number) => n * (p - c / d) ** 2 + top;
  if (p < 1 / d) return n * p * p;
  if (p < 2 / d) return arc(1.5, 0.75);
  if (p < 2.5 / d) return arc(2.25, 0.9375);
  return arc(2.625, 0.984375);
};
/** Quando o ponto toca o i pela primeira vez (o anel, o halo e o «ding»). */
export const DOT_HIT = CARD_TIMES.dot + CARD_TIMES.fall / 2.75;
/** Quando o logótipo fica quieto (o ponto assente e o balanço acabado). */
export const LOGO_DONE = Math.max(CARD_TIMES.dot + CARD_TIMES.fall + CARD_TIMES.landDur, CARD_TIMES.sway + CARD_TIMES.swayDur, CARD_TIMES.letters[2] + CARD_TIMES.popDur);

const CORAL_DOT = '#ff5c6c';
const BRAND = ['#d6334f', '#ff9a5b'] as const;
const BG = '#0b090d';

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const easeOutCubic = (p: number) => 1 - (1 - p) ** 3;
const easeOutBack = (p: number, k = 2.2) => 1 + (k + 1) * (p - 1) ** 3 + k * (p - 1) ** 2;
const at = (t: number, start: number, dur: number) => clamp01((t - start) / dur);

/** As formas das letras (cada uma enche-se à parte, com LOGO_FILL_RULE: sobrepõem-se). */
const INK_2D = LOGO_INK_PATHS.map((d) => new Path2D(d));
/** Os paths de LOGO_INK_PATHS: 0 «tx», 1 último «p», 2 «p», 3 «a», 4 «ill» (o i e os dois «ll»). */
const INK = { tx: 0, p2: 1, p1: 2, a: 3, ill: 4 } as const;
/** A base do «ill» (o fundo dos laços), à volta da qual cresce e balança (unidades do logótipo). */
export const ILL_PIVOT = { x: 275, y: 337.9 } as const;
/** A linha de base das letras e o meio de cada uma (o «a», o «p», o último «p»): daqui crescem no pop. */
const LETTER_BASE = 312;
const LETTER_CX = [316.7, 349.2, 382] as const;
/** De onde cai o ponto (unidades do logótipo, acima do i). */
const DOT_DROP = 60;
/** O balanço do «ill» (graus): o primeiro para a direita, a apagar-se (os laços nunca tocam o «tx» nem o «a»). */
const SWAY_DEG = 3.5;
/** O ease-out-back do «ill»: o pop uniforme no fim passa ~4 % (os laços não tocam o «tx» nem o «a»). */
const ILL_BACK = 1;
/** O «tx»: de onde entra (unidades à esquerda), a inclinação com que entra, o aceno e os saltos no ritmo dos «ll». */
const TX_FROM = 40, TX_TILT = 14, TX_NOD = 2.5, TX_HOP = 3.2, TX_LAND = 2.2;
/** O ease-out-back da entrada do «tx» é suave: passa só ~1,5 unidades do sítio (o i está a 2,6), sem tocar no «ill». */
const TX_BACK = 1;
/** O pé do «tx», à volta do qual se inclina e acena. */
const TX_PIVOT = { x: 223, y: 333 } as const;

/** Uma letra: opacidade, deslocação e escala (uniforme) à volta de (px, py). */
export interface PartPose { alpha: number; dx: number; dy: number; rotate: number; scale: number; px: number; py: number }
/** O «ill»: cresce na vertical a partir da base (`grow` ≤ 1) e o excesso do ease-out-back é uma escala uniforme (`scale` ≥ 1). */
export interface IllPose { grow: number; scale: number; rotate: number }

/** As poses do logótipo no instante `t` (o mesmo que o GIF da marca, no tempo do cartão). */
export function logoPose(t: number) {
  const T = CARD_TIMES;
  // O «tx»: entra da esquerda inclinado (ease-out-back); durante o balanço dos «ll» acena e dá pequenos saltos no mesmo
  // ritmo (o aceno entra devagar, sem salto de pose); e um saltinho quando o ponto assenta.
  const kt = at(t, T.tx, T.txDur);
  const ph = at(t, T.sway, T.swayDur);
  const on = ph > 0 && ph < 1;
  const hop = on ? -Math.abs(Math.sin(ph * Math.PI * 3)) * TX_HOP * (1 - ph) : 0;
  const nod = on ? -Math.sin(ph * Math.PI * 3 + 0.6) * TX_NOD * (1 - ph) * clamp01(ph * 6) : -(1 - easeOutCubic(kt)) * TX_TILT;
  const kl = at(t, T.dot + T.fall, T.landDur);
  const land = kl > 0 && kl < 1 ? -Math.sin(kl * Math.PI) * TX_LAND : 0;
  const tx: PartPose = { alpha: clamp01(kt * 2), dx: kt <= 0 ? -TX_FROM : -TX_FROM * (1 - easeOutBack(kt, TX_BACK)), dy: hop + land, rotate: nod, scale: 1, px: TX_PIVOT.x, py: TX_PIVOT.y };
  // O «ill»: o ease-out-back até 1 é crescer na vertical; o que passa de 1 (o pop) é uniforme, para os «ll» não se deformarem.
  const kg = at(t, T.grow, T.growDur);
  const b = kg <= 0 ? 0 : easeOutBack(kg, ILL_BACK);
  const u = at(t, T.sway, T.swayDur);
  const rotate = u > 0 && u < 1 ? SWAY_DEG * Math.sin(u * Math.PI * 3) * (1 - u) : 0;
  const ill: IllPose = { grow: clamp01(b), scale: Math.max(1, b), rotate };
  const letters: PartPose[] = T.letters.map((t0, i) => {
    const k = at(t, t0, T.popDur);
    return { alpha: clamp01(k * 1.6), dx: 0, dy: 0, rotate: 0, scale: k <= 0 ? 0 : 0.55 + 0.45 * easeOutBack(k, 1.70158), px: LETTER_CX[i], py: LETTER_BASE };
  });
  const kd = at(t, T.dot, T.fall);
  const dot = { alpha: t < T.dot ? 0 : clamp01(kd * 8), dy: -DOT_DROP * (1 - bounce(kd)) };
  return { tx, ill, letters, dot };
}
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
  const s = ww / LOGO_BOX.w;
  const wh = LOGO_BOX.h * s;
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

  // O logótipo, parte a parte (logoPose: a mesma coreografia do GIF da marca).
  const P = logoPose(t);
  g.save();
  g.translate(L.x0 - LOGO_BOX.x * L.s, L.y0 - LOGO_BOX.y * L.s);
  g.scale(L.s, L.s);
  g.fillStyle = '#ffffff';
  // O brilho é em píxeis do ecrã (o shadowBlur não segue a escala): o mesmo de antes, 5 unidades do logótipo antigo.
  g.shadowColor = 'rgba(255,255,255,0.28)';
  g.shadowBlur = L.ww / 30.8;
  const part = (i: number, p: PartPose) => {
    if (p.alpha <= 0 || p.scale <= 0) return;
    g.save();
    g.globalAlpha = p.alpha;
    g.translate(p.px + p.dx, p.py + p.dy);
    if (p.rotate) g.rotate((p.rotate * Math.PI) / 180);
    g.scale(p.scale, p.scale);
    g.translate(-p.px, -p.py);
    g.fill(INK_2D[i], LOGO_FILL_RULE);
    g.restore();
  };
  part(INK.tx, P.tx);
  // O referencial do «ill» (à volta da base): o balanço leva também o ponto e o anel, que assentam no i.
  const illFrame = () => {
    g.translate(ILL_PIVOT.x, ILL_PIVOT.y);
    g.rotate((P.ill.rotate * Math.PI) / 180);
    g.scale(P.ill.scale, P.ill.scale * P.ill.grow);
    g.translate(-ILL_PIVOT.x, -ILL_PIVOT.y);
  };
  if (P.ill.grow > 0.002) {
    g.save();
    illFrame();
    g.fill(INK_2D[INK.ill], LOGO_FILL_RULE);
    g.restore();
  }
  part(INK.a, P.letters[0]);
  part(INK.p1, P.letters[1]);
  part(INK.p2, P.letters[2]);
  g.shadowBlur = 0;
  g.shadowColor = 'rgba(0,0,0,0)';
  // O ponto do i, a coral: cai de cima, salta até assentar e, no primeiro toque, solta um anel que se apaga.
  if (P.dot.alpha > 0) {
    g.save();
    illFrame();
    const ring = at(t, DOT_HIT, 0.62);
    if (ring > 0 && ring < 1) {
      g.beginPath();
      g.arc(LOGO_DOT.cx, LOGO_DOT.cy, LOGO_DOT.r * (1 + 2.6 * easeOutCubic(ring)), 0, Math.PI * 2);
      g.strokeStyle = `rgba(255,92,108,${(0.75 * (1 - ring)).toFixed(3)})`;
      g.lineWidth = 2 * (1 - ring * 0.6);
      g.stroke();
    }
    g.globalAlpha = P.dot.alpha;
    g.shadowColor = 'rgba(255,92,108,0.7)';
    g.shadowBlur = L.ww / 25.7;
    g.beginPath();
    g.arc(LOGO_DOT.cx, LOGO_DOT.cy + P.dot.dy, LOGO_DOT.r, 0, Math.PI * 2);
    g.fillStyle = CORAL_DOT;
    g.fill();
    g.restore();
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
 * O som do cartão (WAV estéreo, 48 kHz, `seconds`): um sopro suave enquanto o «ill» cresce e um «ding» quando o ponto do
 * i toca no i. Os mesmos efeitos sonoros do estúdio (compose/audio.ts), mais baixos.
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
  add(synthSfx('whoosh', rate), CARD_TIMES.grow - 0.05, 0.22, -0.15);
  add(synthSfx('ding', rate), DOT_HIT, 0.34, 0.1);
  // Um fim limpo (sem estalido no corte).
  const tail = Math.round(0.25 * rate);
  for (let i = 0; i < tail; i++) { const k = 1 - i / tail; L[n - tail + i] *= k; R[n - tail + i] *= k; }
  return encodeWav([L, R], rate);
}
