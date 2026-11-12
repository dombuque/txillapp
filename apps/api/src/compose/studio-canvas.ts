import { createCanvas, GlobalFonts, ImageData, loadImage, type Canvas, type Image, type SKRSContext2D } from '@napi-rs/canvas';
import { existsSync, readFileSync } from 'fs';
import { open, writeFile } from 'fs/promises';
import { basename, join, resolve } from 'path';
import { FONTS, FRAME, restingTime, type Overlay, type StickerOverlay, type TransitionId } from './effects';
import { ffmpegFrames, ffmpegSink } from './ffmpeg';
import { overlayBox, overlayRuns } from './fx';
import { FPS } from './plan';
import { drawOverlays, overlaySize, type OverlayEnv } from './renderOverlays';
import { drawTransition, type Scratch } from './renderTransitions';

/**
 * O canvas do Node (@napi-rs/canvas, Skia) a correr o mesmo desenho do estúdio do site: as transições (`drawTransition`,
 * renderTransitions.ts) e os textos e stickers (`drawOverlays`, renderOverlays.ts), cópias fiéis dos ficheiros do site
 * (effects-sync.spec.ts), com as mesmas fontes (assets/fonts/estudio, os woff2 do site). Os frames saem em RGBA para o ffmpeg.
 */

/** As fontes do estúdio (os mesmos woff2 do site) e a dos emojis (Noto Color Emoji na imagem Docker). */
const FONT_DIRS = [resolve(__dirname, '../../assets/fonts/estudio'), resolve(__dirname, '../../../mobile/public/fonts/estudio')];
const EMOJI_FONTS = [
  '/usr/share/fonts/truetype/noto/NotoColorEmoji.ttf', '/usr/share/fonts/noto/NotoColorEmoji.ttf',
  'C:/Windows/Fonts/seguiemj.ttf', '/System/Library/Fonts/Apple Color Emoji.ttc',
];
let fontsReady: boolean | null = null;

/** Regista as fontes uma vez (true se todas as do estúdio ficaram registadas). */
export function ensureStudioFonts(): boolean {
  if (fontsReady !== null) return fontsReady;
  const dir = FONT_DIRS.find((d) => existsSync(join(d, 'inter.woff2')));
  let ok = !!dir;
  for (const f of FONTS) {
    const file = dir ? join(dir, basename(f.file)) : '';
    if (!dir || !existsSync(file) || !GlobalFonts.registerFromPath(file, f.family)) ok = false;
  }
  // Os emojis: no Linux da API, o pacote fonts-noto-color-emoji (no Windows e no macOS, a fonte do sistema). O Skia não vai
  // buscar sozinho a outra fonte um glifo que falte: um emoji no meio de um texto só sai porque a fonte de emojis fica também
  // com o nome «system-ui», a família da lista de `fontCss` depois da do estúdio e da «Inter» (que aqui é a Inter do estúdio,
  // sem emojis), como o browser faria com a fonte do sistema.
  const emoji = EMOJI_FONTS.find((f) => existsSync(f));
  if (emoji) {
    GlobalFonts.registerFromPath(emoji, 'Noto Color Emoji');
    // O mesmo ficheiro registado duas vezes pelo caminho fica só com o 1.º nome: o 2.º vai de uma cópia em memória.
    GlobalFonts.register(readFileSync(emoji), 'system-ui');
  }
  fontsReady = ok;
  return ok;
}

type Ctx = SKRSContext2D;
const asCtx = (g: Ctx) => g as unknown as CanvasRenderingContext2D;

/** Os canvas de trabalho das transições (um por nome, reaproveitados). */
function scratchPool(): Scratch {
  const pool = new Map<string, { c: Canvas; g: Ctx }>();
  return (name, w, h) => {
    let s = pool.get(name);
    if (!s || s.c.width !== w || s.c.height !== h) {
      const c = createCanvas(w, h);
      s = { c, g: c.getContext('2d') };
      pool.set(name, s);
    }
    return s as unknown as { c: HTMLCanvasElement; g: CanvasRenderingContext2D };
  };
}

const ENCODE_X264 = (threads?: number) => ['-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '17', '-g', String(FPS * 2), '-pix_fmt', 'yuv420p', '-r', String(FPS), ...(threads ? ['-threads', String(threads)] : [])];

/**
 * A transição no início de um clipe, desenhada como no site: `prev` (PNG) é o último frame do clipe anterior, já com os
 * efeitos; `head` são os primeiros `frames` frames deste clipe em RGBA (W×H); `p = (k/30)/dur`. Sai um bocado H.264 igual
 * aos outros (junta-se com o concat).
 */
export async function renderTransitionHead(o: {
  prev: string | null; head: string; frames: number; type: TransitionId; dur: number; W: number; H: number; out: string; cwd: string; signal?: AbortSignal; threads?: number;
}): Promise<void> {
  const { W, H } = o;
  // Sem o frame do anterior (não devia acontecer), um quadro preto: com `corte` só se desenha o clipe.
  const prev = o.prev ? await loadImage(join(o.cwd, o.prev)) : createCanvas(W, H);
  const cur = createCanvas(W, H), cg = cur.getContext('2d');
  const outC = createCanvas(W, H), g = outC.getContext('2d');
  const scratch = scratchPool();
  const bytes = W * H * 4;
  const sink = ffmpegSink(['-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${W}x${H}`, '-framerate', String(FPS), '-i', 'pipe:0', '-vf', 'setsar=1', ...ENCODE_X264(o.threads), '-an', '-y', o.out], { cwd: o.cwd, signal: o.signal });
  const fh = await open(join(o.cwd, o.head), 'r');
  try {
    const buf = Buffer.alloc(bytes);
    for (let k = 0; k < o.frames; k++) {
      const { bytesRead } = await fh.read(buf, 0, bytes, k * bytes);
      if (bytesRead < bytes) break; // o clipe tinha menos frames: fica o que houver
      cg.putImageData(new ImageData(new Uint8ClampedArray(buf.buffer, buf.byteOffset, bytes), W, H), 0, 0);
      drawTransition(asCtx(g), prev as unknown as CanvasImageSource, cur as unknown as CanvasImageSource, o.type, k / FPS / o.dur, W, H, scratch);
      { const d = g.getImageData(0, 0, W, H).data; await sink.write(new Uint8Array(d.buffer, d.byteOffset, d.byteLength)); }
    }
  } catch (e) {
    await sink.end().catch(() => undefined);
    throw e;
  } finally {
    await fh.close();
  }
  await sink.end();
}

// ------------------------------------------------------------------ camadas

/** A imagem de um sticker (Txillapp ou GIF): fixa, ou o frame do GIF a cada instante. */
export interface StickerImages {
  /** O frame `k` (do vídeo final) de cada GIF; uma vez por frame, por ordem. */
  gifFrame?: (o: StickerOverlay, k: number) => Promise<{ img: Canvas; w: number; h: number } | null>;
  still: (o: StickerOverlay) => { img: Canvas | Image; w: number; h: number } | null;
}

/**
 * Uma camada já desenhada: uma imagem (PNG) ou um vídeo com alfa (qtrle em .mov) entre os frames k0 e k1 (inclusive), em x, y.
 * `cycle`: o vídeo é um período só, que o ffmpeg repete até k1.
 */
export interface LayerFile { file: string; x: number; y: number; k0: number; k1: number; anim: boolean; cycle?: boolean }

/**
 * Desenha as camadas (texto e stickers) com `drawOverlays`, cada uma na caixa dela: onde está parada, uma imagem só (PNG);
 * onde se mexe (entrada, saída, ciclo, GIF), os frames a 30 fps num vídeo com alfa. `F`: frames do vídeo final.
 */
export async function renderLayers(overlays: Overlay[], F: number, images: StickerImages, o: { cwd: string; signal?: AbortSignal; onFrame?: () => void }): Promise<LayerFile[]> {
  ensureStudioFonts();
  const W = FRAME.w, H = FRAME.h;
  const measure = createCanvas(4, 4).getContext('2d');
  const out: LayerFile[] = [];
  let n = 0;
  for (const ov of overlays) {
    const runs = overlayRuns(ov, F);
    if (!runs.length) continue;
    let current: { img: Canvas | Image; w: number; h: number } | null = ov.kind === 'sticker' ? images.still(ov) : null;
    const env: OverlayEnv = { W, H, image: () => current as unknown as { img: CanvasImageSource; w: number; h: number } | null };
    const isGif = ov.kind === 'sticker' && ov.sticker.type === 'gif';
    if (isGif && images.gifFrame) current = await images.gifFrame(ov as StickerOverlay, runs[0].k0);
    // Um sticker do Txillapp ou um GIF sem imagem não se desenha (como no site enquanto não chega).
    if (ov.kind === 'sticker' && (ov.sticker.type === 'txill' || isGif) && !current) continue;
    const box = overlayBox(ov, overlaySize(asCtx(measure), ov, env), W, H);
    if (!box) continue;
    const c = createCanvas(box.w, box.h), g = c.getContext('2d');
    const paint = (t: number) => {
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, box.w, box.h);
      g.translate(-box.x, -box.y);
      drawOverlays(asCtx(g), [ov], t, env);
    };
    for (const r of runs) {
      const file = `layer_${n++}.${r.kind === 'still' ? 'png' : 'mov'}`;
      if (r.kind === 'still') {
        paint(Math.max(r.k0 / FPS, Math.min(r.k1 / FPS, restingTime(ov))));
        await writeFile(join(o.cwd, file), await c.encode('png'));
      } else {
        const sink = ffmpegSink(['-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${box.w}x${box.h}`, '-framerate', String(FPS), '-i', 'pipe:0', '-c:v', 'qtrle', '-pix_fmt', 'argb', '-y', file], { cwd: o.cwd, signal: o.signal });
        try {
          const last = r.kind === 'cycle' ? r.k0 + r.period! - 1 : r.k1;
          for (let k = r.k0; k <= last; k++) {
            if (isGif && images.gifFrame && k !== runs[0].k0) current = await images.gifFrame(ov as StickerOverlay, k);
            paint(k / FPS);
            { const d = g.getImageData(0, 0, box.w, box.h).data; await sink.write(new Uint8Array(d.buffer, d.byteOffset, d.byteLength)); }
            o.onFrame?.();
          }
        } catch (e) {
          await sink.end().catch(() => undefined);
          throw e;
        }
        await sink.end();
      }
      out.push({ file, x: box.x, y: box.y, k0: r.k0, k1: r.k1, anim: r.kind !== 'still', ...(r.kind === 'cycle' ? { cycle: true } : {}) });
    }
  }
  return out;
}

// ------------------------------------------------------------------ GIFs

/**
 * Os frames de um GIF animado no tempo do vídeo final: o ffmpeg lê-o em ciclo (`-ignore_loop 0`) durante a vida da camada, a
 * 30 fps e já à largura `gw` (a escala e a rotação fazem-se no desenho, como no site). Os frames chegam por ordem.
 */
export function gifReader(file: string, o: { seconds: number; gw: number; gh: number; cwd: string; signal?: AbortSignal }) {
  const bytes = o.gw * o.gh * 4;
  const it = ffmpegFrames(
    [
      '-protocol_whitelist', 'file', '-format_whitelist', 'gif', '-ignore_loop', '0', '-t', o.seconds.toFixed(3), '-i', file,
      '-vf', `fps=${FPS},scale=${o.gw}:${o.gh}:flags=lanczos,format=rgba`, '-f', 'rawvideo', '-pix_fmt', 'rgba', 'pipe:1',
    ],
    bytes,
    { cwd: o.cwd, signal: o.signal },
  );
  const c = createCanvas(o.gw, o.gh), g = c.getContext('2d');
  let have = false;
  return {
    /** O frame seguinte (o último repete-se se o ffmpeg acabar antes). */
    async next(): Promise<Canvas> {
      const r = await it.next();
      if (!r.done) {
        g.putImageData(new ImageData(new Uint8ClampedArray(r.value.buffer, r.value.byteOffset, bytes), o.gw, o.gh), 0, 0);
        have = true;
      }
      if (!have) throw new Error('GIF sem frames');
      return c;
    },
    async close() { await it.return(undefined).catch(() => undefined); },
  };
}

/** Um GIF/WebP animado decodificado pelo sharp (o ffmpeg 6 não lê WebP animado): os frames e os tempos deles. */
export async function stillFramesOf(input: Buffer, gw: number, gh: number): Promise<{ frames: Canvas[]; delays: number[] }> {
  const sharp = (await import('sharp')).default;
  const meta = await sharp(input, { animated: true, limitInputPixels: 40_000_000 }).metadata();
  const pages = Math.min(meta.pages ?? 1, 300);
  const frames: Canvas[] = [];
  for (let i = 0; i < pages; i++) {
    const raw = await sharp(input, { page: i, pages: 1, limitInputPixels: 40_000_000 }).resize(gw, gh, { fit: 'fill' }).ensureAlpha().raw().toBuffer();
    const c = createCanvas(gw, gh);
    c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(raw.buffer, raw.byteOffset, gw * gh * 4), gw, gh), 0, 0);
    frames.push(c);
  }
  const delays = (meta.delay ?? []).slice(0, pages).map((d) => (d > 10 ? d : 100));
  while (delays.length < pages) delays.push(100);
  return { frames, delays };
}
