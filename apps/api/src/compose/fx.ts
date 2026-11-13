import {
  animDurations, ffmpegFxChain, FRAME, isIdentity, rampById, rampPieces, REVERSE_MAX_S, resolveFx, type ClipFocus, type ClipFx, type Overlay,
} from './effects';
import { atempo, FPS } from './plan';

/**
 * Os efeitos do estúdio (docs/estudio-efeitos.md) no servidor: as contas sem ffmpeg nem canvas (testadas em fx.spec.ts).
 * As fórmulas são as de effects.ts (a cópia do estúdio do site); aqui só se traduzem para o ffmpeg e para a grelha de frames.
 */

const f4 = (v: number) => (Math.round(v * 10000) / 10000).toString();

// ------------------------------------------------------------------ rampas

export interface RampPiece { out0: number; out1: number; src0: number; src1: number; speed: number }

/**
 * Os bocados da rampa (`rampPieces` a 0,1 s, como diz o contrato), com os vizinhos à mesma velocidade juntos num só (as partes
 * planas das rampas: menos filtros e o `atempo` sem cortes a cada 0,1 s).
 */
export function mergedPieces(trimLen: number, speed: number, fx: ClipFx | undefined): RampPiece[] {
  const out: RampPiece[] = [];
  for (const p of rampPieces(trimLen, speed, fx, 0.1)) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.speed - p.speed) < 1e-3) { last.out1 = p.out1; last.src1 = p.src1; continue; }
    out.push({ ...p });
  }
  return out;
}

/**
 * A rampa como um `setpts` só: o instante de saída de cada frame da fonte (T, segundos desde o início do corte), linear
 * dentro de cada bocado. Dá o mesmo que `trim` + `setpts` por bocado e `concat`, sem partir o vídeo em dezenas de ramos.
 */
export function rampSetpts(pieces: RampPiece[]): string {
  const terms = pieces.map((p, i) => {
    const sel = i === pieces.length - 1 ? `gte(T,${f4(p.src0)})` : i === 0 ? `lt(T,${f4(p.src1)})` : `gte(T,${f4(p.src0)})*lt(T,${f4(p.src1)})`;
    return `${sel}*(${f4(p.out0)}+(T-${f4(p.src0)})/${f4(p.speed)})`;
  });
  return `setpts='(${terms.join('+')})/TB'`;
}

/** O som da rampa: um `atrim` + `atempo` por bocado e `concat` (o tom fica, como no browser com o `playbackRate`). */
export function rampAudio(pieces: RampPiece[], inp: string, out: string): string[] {
  if (pieces.length === 1) {
    const t = atempo(pieces[0].speed);
    return [`${inp}anull${t ? `,${t}` : ''}${out}`];
  }
  const g = [`${inp}asplit=${pieces.length}${pieces.map((_, i) => `[rs${i}]`).join('')}`];
  pieces.forEach((p, i) => {
    const t = atempo(p.speed);
    g.push(`[rs${i}]atrim=start=${f4(p.src0)}:end=${f4(p.src1)},asetpts=PTS-STARTPTS${t ? `,${t}` : ''}[rp${i}]`);
  });
  g.push(`${pieces.map((_, i) => `[rp${i}]`).join('')}concat=n=${pieces.length}:v=0:a=1${out}`);
  return g;
}

/** A velocidade mais alta que a rampa atinge (para tirar frames suficientes da fonte ao inverter). */
export const rampMaxSpeed = (fx: ClipFx | undefined) => Math.max(1, ...(rampById(fx?.ramp)?.points.map((p) => p[1]) ?? [1]));

// ------------------------------------------------------------------ inverter

/** Inverter: até 15 s de corte (o limite do estúdio, `REVERSE_MAX_S`). */
export const reverseTooLong = (trimLen: number) => trimLen > REVERSE_MAX_S + 1e-6;

/**
 * Os bocados (segundos desde o início do corte) em que se inverte o vídeo, do fim para o início: o filtro `reverse` guarda
 * todos os frames em memória, por isso vai aos bocados de `chunk` segundos (1080×1920 a 30 fps: ~190 MB por bocado de 2 s).
 */
export function reverseChunks(trimLen: number, chunk: number): { from: number; len: number }[] {
  const out: { from: number; len: number }[] = [];
  for (let end = trimLen; end > 1e-6; end -= chunk) {
    const from = Math.max(0, end - chunk);
    out.push({ from: Math.round(from * 1000) / 1000, len: Math.round((end - from) * 1000) / 1000 });
  }
  return out;
}

// ------------------------------------------------------------------ cor

/**
 * A cadeia de cor de effects.ts (`ffmpegFxChain`, que já prende a vinheta a RGB com um `format=gbrp` no fim), com a LUT
 * trilinear: a LUT tem uma matriz afim (com o corte a 0..1), por isso dá o mesmo que a tetraédrica dentro de cada célula
 * (só muda nas que cortam o 0 ou o 1) e, no ffmpeg, gasta menos de metade do CPU (o lut3d de 8 bits não tem SIMD): o mesmo
 * ΔE no fx-pixels.spec.ts.
 */
export const serverFxChain = (fx: ClipFx | undefined, lutFile: string): string => ffmpegFxChain(fx, lutFile).replace(':interp=tetrahedral', ':interp=trilinear');

/** A cadeia do clipe tem LUT? (só se a matriz não for a identidade.) */
export const needsLut = (fx: ClipFx | undefined) => !isIdentity(resolveFx(fx).matrix);

// ------------------------------------------------------------------ fotos (enquadramento e moldura)

const clampN = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const r3 = (v: number) => Math.round(v * 1000) / 1000;
const easeIO = (x: number) => { const t = clampN(x, 0, 1); return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; };
/**
 * O retângulo da foto (px da fonte sw×sh) que enche o quadro W×H no instante `u` (0 a 1) com o enquadramento `focus`: a
 * mesma conta de `coverRect` em apps/mobile/src/lib/studio/magic.ts (o zoom lento de `from` a `to`, apontado ao ponto de
 * interesse, sem cortar a caixa `keep` quando ela cabe).
 */
export function coverRect(sw: number, sh: number, fr: Pick<ClipFocus, 'x' | 'y' | 'from' | 'to' | 'keep'>, u: number, W: number = FRAME.w, H: number = FRAME.h): { sx: number; sy: number; sw: number; sh: number } {
  const z = Math.max(1, fr.from + (fr.to - fr.from) * easeIO(u));
  const fa = W / H, ar = sw / sh;
  const w = (ar > fa ? sh * fa : sw) / z, h = (ar > fa ? sh : sw / fa) / z;
  const place = (c: number, size: number, full: number, k0?: number, k1?: number) => {
    let p = c * full - size / 2;
    if (k0 != null && k1 != null && (k1 - k0) * full <= size) p = clampN(p, k1 * full - size, k0 * full);
    return clampN(p, 0, Math.max(0, full - size));
  };
  return { sx: r3(place(fr.x, w, sw, fr.keep?.x0, fr.keep?.x1)), sy: r3(place(fr.y, h, sh, fr.keep?.y0, fr.keep?.y1)), sw: r3(w), sh: r3(h) };
}
/** A foto desenha-se no canvas (frame a frame)? Com moldura de capulana ou com enquadramento (um frame congelado fica parado). */
export const photoOnCanvas = (fx: ClipFx | undefined) => !!fx && (!!fx.moldura || (!!fx.focus && !fx.freeze));

// ------------------------------------------------------------------ camadas

/**
 * Os bocados de uma camada na grelha de frames (frame k = instante k/30 do vídeo final): `still` onde ela está parada (uma
 * imagem só) e `anim` onde se mexe (entrada, saída, ciclo; um GIF mexe-se sempre). `k1` inclusivo; `F` frames no vídeo.
 */
export interface OverlayRun { kind: 'still' | 'anim' | 'cycle'; k0: number; k1: number; /** `cycle`: os frames de um período, que se repetem até k1 */ period?: number }
/**
 * Os ciclos repetem-se a cada tantos frames (a 30 fps): pulsar a 1,2 Hz dá uma volta em 25 frames; balançar a 0,9 Hz dá 3
 * voltas em 100. Entre a entrada e a saída, a camada em ciclo desenha-se só durante um período e o ffmpeg repete-o.
 */
export const LOOP_PERIOD: Record<string, number> = { pulsar: 25, balancar: 100 };
export function overlayRuns(o: Overlay, F: number): OverlayRun[] {
  const k0 = Math.max(0, Math.ceil(o.start * FPS - 1e-6));
  const k1 = Math.min(F - 1, Math.floor(o.end * FPS + 1e-6));
  if (k1 < k0) return [];
  const gif = o.kind === 'sticker' && o.sticker.type === 'gif';
  const period = gif ? undefined : LOOP_PERIOD[o.anim.loop];
  const { inDur, outDur } = animDurations(o);
  const kindAt = (k: number): OverlayRun['kind'] => {
    if (gif) return 'anim';
    const t = k / FPS;
    if (o.anim.in !== 'nenhuma' && inDur > 0 && t < o.start + inDur) return 'anim';
    if (o.anim.out !== 'nenhuma' && outDur > 0 && t > o.end - outDur) return 'anim';
    return period ? 'cycle' : 'still';
  };
  const runs: OverlayRun[] = [];
  for (let k = k0; k <= k1; k++) {
    const kind = kindAt(k);
    const last = runs[runs.length - 1];
    if (last && last.kind === kind && last.k1 === k - 1) last.k1 = k;
    else runs.push({ kind, k0: k, k1: k });
  }
  // Um ciclo mais curto do que 2 períodos não compensa: fica em vídeo, frame a frame.
  for (const r of runs) if (r.kind === 'cycle') { if (r.k1 - r.k0 + 1 >= 2 * period!) r.period = period; else r.kind = 'anim'; }
  return runs.reduce<OverlayRun[]>((out, r) => {
    const last = out[out.length - 1];
    if (last && last.kind === 'anim' && r.kind === 'anim' && last.k1 === r.k0 - 1) last.k1 = r.k1;
    else out.push(r);
    return out;
  }, []);
}

/**
 * A caixa (px do quadro, já cortada ao quadro) onde uma camada pode desenhar durante a vida dela: o círculo que a contém em
 * qualquer rotação, com a escala máxima das animações (o «pop» passa 10 %, o «pulsar» 7 %), a margem das sombras e do néon,
 * a ondulação e o «subir» (140 px). `w`, `h`: o tamanho natural (overlaySize).
 */
export function overlayBox(o: Overlay, size: { w: number; h: number }, W: number = FRAME.w, H: number = FRAME.h): { x: number; y: number; w: number; h: number } | null {
  const ins = [o.anim.in, o.anim.out];
  if (o.kind === 'text' && o.bg === 'pano' && o.pano) {
    // A faixa de capulana: de lado a lado, à altura do texto (não roda nem escala com a animação), com a sombra por baixo.
    const h = o.size * 2.6 * o.scale;
    const y0 = Math.max(0, Math.floor(o.y * H - h / 2 - 4 - (o.anim.out === 'subir' ? 140 : 0)));
    const y1 = Math.min(H, Math.ceil(o.y * H + h / 2 + h * 0.06 + 4 + (o.anim.in === 'subir' ? 140 : 0)));
    return y1 - y0 < 2 ? null : { x: 0, y: y0, w: W, h: y1 - y0 };
  }
  const S = o.scale * (ins.includes('pop') ? 1.1 : 1) * (o.anim.loop === 'pulsar' ? 1.07 : 1);
  let m: number;
  if (o.kind === 'text') {
    const fs = o.size * 1.3; // o maior acerto de tamanho das fontes (k)
    m = fs * S * (o.neon || ins.includes('brilho') ? 2.6 : 0.7) + (ins.includes('ondulacao') ? 0.4 * fs * S : 0) + fs * 0.2 * S;
  } else {
    m = 48 * S + (o.sticker.type === 'emoji' ? 0.15 * 230 * S : 0);
  }
  const R = 0.5 * Math.hypot(size.w, size.h) * S + m + 4;
  const cx = o.x * W, cy = o.y * H;
  const down = o.anim.in === 'subir' ? 140 : 0, up = o.anim.out === 'subir' ? 140 : 0;
  const x0 = Math.max(0, Math.floor(cx - R)), x1 = Math.min(W, Math.ceil(cx + R));
  const y0 = Math.max(0, Math.floor(cy - R - up)), y1 = Math.min(H, Math.ceil(cy + R + down));
  if (x1 - x0 < 2 || y1 - y0 < 2) return null;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
