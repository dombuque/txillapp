/**
 * Ler QR no site (só browser: importado pelos ficheiros .web). Dois motores:
 *  - o BarcodeDetector do browser, quando existe e lê QR (Chrome no Android, Safari no Mac);
 *  - o jsqr (JavaScript puro, carregado só quando é preciso) nos outros (Safari do iPhone, Firefox, Chrome no Windows).
 * As contas (que motor, que recortes) estão em qrDecode.ts.
 */
import { pickQrEngine, scanPasses, type QrEngine, type ScanPass } from './qrDecode';

type Detected = { rawValue?: string };
type Detector = { detect: (src: CanvasImageSource | ImageBitmap) => Promise<Detected[]> };
type DetectorCtor = { new (o: { formats: string[] }): Detector; getSupportedFormats?: () => Promise<string[]> };
type JsQr = typeof import('jsqr').default;

const Ctor = (): DetectorCtor | undefined => (globalThis as { BarcodeDetector?: DetectorCtor }).BarcodeDetector;

let enginePromise: Promise<QrEngine> | null = null;
/** Que motor este browser usa (decide-se uma vez). */
export function qrEngine(): Promise<QrEngine> {
  if (!enginePromise) {
    enginePromise = (async () => {
      const C = Ctor();
      if (!C) return pickQrEngine(false, null);
      let formats: string[] | null = null;
      try {
        formats = C.getSupportedFormats ? await C.getSupportedFormats() : null;
      } catch {
        formats = null;
      }
      return pickQrEngine(true, formats);
    })();
  }
  return enginePromise;
}

let detector: Detector | null = null;
function nativeDetector(): Detector | null {
  const C = Ctor();
  if (!C) return null;
  try {
    detector ??= new C({ formats: ['qr_code'] });
  } catch {
    detector = null;
  }
  return detector;
}

let jsqrPromise: Promise<JsQr> | null = null;
/** O jsqr, carregado na primeira vez que faz falta (fica fora do pacote principal do site). */
export function loadJsQr(): Promise<JsQr> {
  jsqrPromise ??= import('jsqr').then((m) => ((m as { default?: JsQr }).default ?? (m as unknown as JsQr)));
  jsqrPromise.catch(() => { jsqrPromise = null; });
  return jsqrPromise;
}

/** O texto do primeiro QR que o BarcodeDetector vê em `src`, ou null. */
export async function detectNative(src: CanvasImageSource): Promise<string | null> {
  const d = nativeDetector();
  if (!d) return null;
  try {
    const found = await d.detect(src);
    const hit = found.find((f) => typeof f.rawValue === 'string' && f.rawValue.length > 0);
    return hit?.rawValue ?? null;
  } catch {
    return null;
  }
}

/** Uma tela reaproveitada (o getImageData com willReadFrequently fica na memória do processador, mais rápido). */
export function makeCanvas(): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } | null {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  return ctx ? { canvas, ctx } : null;
}

/** Desenha o pedaço `p` de `src` na tela (fundo branco, para PNG com transparência). */
export function drawPass(c: { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D }, src: CanvasImageSource, p: ScanPass) {
  c.canvas.width = p.dw;
  c.canvas.height = p.dh;
  c.ctx.fillStyle = '#fff';
  c.ctx.fillRect(0, 0, p.dw, p.dh);
  c.ctx.imageSmoothingEnabled = true;
  c.ctx.imageSmoothingQuality = 'high';
  c.ctx.drawImage(src, p.sx, p.sy, p.sw, p.sh, 0, 0, p.dw, p.dh);
}

/** O jsqr sobre o que está na tela. `both`: também com as cores trocadas (QR claro em fundo escuro). */
export function readJsQr(jsQR: JsQr, c: { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D }, both: boolean): string | null {
  const { width, height } = c.canvas;
  if (!width || !height) return null;
  const img = c.ctx.getImageData(0, 0, width, height);
  const hit = jsQR(img.data, width, height, { inversionAttempts: both ? 'attemptBoth' : 'dontInvert' });
  return hit && hit.data ? hit.data : null;
}

async function loadImage(uri: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.decoding = 'async';
  img.src = uri;
  try {
    await img.decode();
  } catch {
    await new Promise<void>((ok, fail) => {
      if (img.complete && img.naturalWidth) return ok();
      img.onload = () => ok();
      img.onerror = () => fail(new Error('imagem'));
    });
  }
  return img;
}

/**
 * O texto do QR numa imagem (blob:, data: ou um endereço do próprio site), ou null se não houver nenhum que se leia.
 * Primeiro o BarcodeDetector (se houver), depois o jsqr, em cada pedaço de scanPasses.
 */
export async function scanImageWeb(uri: string): Promise<string | null> {
  const img = await loadImage(uri);
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  if (!w || !h) return null;
  const engine = await qrEngine();
  const c = makeCanvas();
  if (!c) return engine === 'native' ? detectNative(img) : null;
  const passes = scanPasses(w, h);
  if (engine === 'native') {
    for (const p of passes.slice(0, 2)) {
      drawPass(c, img, p);
      const hit = await detectNative(c.canvas);
      if (hit) return hit;
    }
  }
  let jsQR: JsQr;
  try {
    jsQR = await loadJsQr();
  } catch {
    return null;
  }
  for (const p of passes) {
    drawPass(c, img, p);
    const hit = readJsQr(jsQR, c, true);
    if (hit) return hit;
    // Deixa o browser respirar entre recortes (o jsqr numa imagem de 1600 leva umas dezenas de ms).
    await new Promise((r) => setTimeout(r, 0));
  }
  return null;
}
