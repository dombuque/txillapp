import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import ffmpegPath from 'ffmpeg-static';
import ffprobe from 'ffprobe-static';
import sharp from 'sharp';

const run = promisify(execFile);
const FFMPEG = (ffmpegPath as unknown as string | null) ?? 'ffmpeg';

/**
 * A assinatura do Txillapp gravada nos ficheiros que as pessoas guardam (fotos e vídeos dos mimos): o logótipo em branco
 * com o ponto do i a coral, sombra suave, e por baixo o @ de quem publicou. A mesma geometria da app (lib/wordmark.ts).
 */
const circle = (cx: number, cy: number, r: number) => `M${cx + r} ${cy}a${r} ${r} 0 1 0 ${-2 * r} 0a${r} ${r} 0 1 0 ${2 * r} 0`;
const BOX = { x: -4, y: -3, w: 154, h: 54 };
const PATHS = [
  'M7 5V27Q7 34 14 34M0 14H14', 'M20 14Q27 24 34 34M34 14Q27 24 20 34', 'M42 14V34', 'M51 3V34', 'M61 3V34',
  circle(77, 24, 9.5), 'M86.5 14V34', circle(106, 24, 9.5), 'M96.5 14V46', circle(135, 24, 9.5), 'M125.5 14V46',
];
const DOT = { cx: 42, cy: 3.5, r: 4.2 };

function layout(W: number, H: number, withUser: boolean) {
  const base = Math.min(W, H);
  const m = Math.round(base * 0.04);
  const ww = base * 0.2;
  const s = ww / BOX.w;
  const wh = BOX.h * s;
  const userSize = Math.round(base * 0.028);
  const right = W - m;
  const userBaseline = H - m;
  const markBottom = withUser ? userBaseline - userSize * 1.25 : H - m;
  return { s, x: right - ww, y: markBottom - wh, right, userSize, userBaseline, blur: Math.max(2, s * 5) };
}

const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** O que mais vai gravado na cópia (ex.: os stickers do mimo), já à escala da imagem W×H. */
export type Overlay = (W: number, H: number) => string;

/**
 * SVG transparente do tamanho da imagem, com o que vai por cima (stickers) e a assinatura. Com `withSign` a false só leva
 * o que vai por cima: o ficheiro já vem assinado da câmara da app e uma segunda assinatura (com outra letra e outra sombra
 * no @) ficava por cima da primeira, desfocada, como se estivesse a dobrar.
 */
export function signatureSvg(W: number, H: number, username?: string | null, extra = '', withSign = true): string {
  const head = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`;
  if (!withSign) return `${head}\n${extra}\n</svg>`;
  const L = layout(W, H, !!username);
  const d = PATHS.map((p) => `<path d="${p}"/>`).join('');
  const mark = (stroke: string, fill: string, extra = '') =>
    `<g ${extra} transform="translate(${L.x - BOX.x * L.s} ${L.y - BOX.y * L.s}) scale(${L.s})" fill="none" stroke="${stroke}" stroke-width="7" stroke-linecap="round" stroke-linejoin="round">${d}<circle cx="${DOT.cx}" cy="${DOT.cy}" r="${DOT.r}" fill="${fill}" stroke="none"/></g>`;
  // O @: uma sombra desfocada por baixo e o texto nítido por cima.
  const text = (fill: string, extra: string) => `<text ${extra} x="${L.right}" y="${L.userBaseline}" text-anchor="end" font-family="DejaVu Sans, Helvetica, Arial, sans-serif" font-weight="700" font-size="${L.userSize}" fill="${fill}">@${esc(username ?? '')}</text>`;
  const user = username ? `${text('#000000', 'filter="url(#sh)" opacity="0.5" transform="translate(0 1)"')}${text('#ffffff', 'fill-opacity="0.92"')}` : '';
  return `${head}
<defs><filter id="sh" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="${(L.blur / 2).toFixed(2)}"/></filter></defs>
${extra}
<g filter="url(#sh)" transform="translate(0 ${(L.s * 2).toFixed(2)})" opacity="0.45">${mark('#000000', '#000000')}</g>
${mark('#ffffff', '#ff5c6c')}
${user}
</svg>`;
}

/** Foto com a assinatura (JPEG). Respeita a rotação guardada na foto. `withSign` a false: só o que vai por cima (stickers). */
export async function signImage(bytes: Buffer, username?: string | null, overlay?: Overlay, withSign = true): Promise<Buffer> {
  const base = sharp(bytes).rotate();
  const meta = await base.metadata();
  const W = meta.width ?? 1080, H = meta.height ?? 1080;
  const extra = overlay?.(W, H) ?? '';
  if (!withSign && !extra) return base.jpeg({ quality: 92 }).toBuffer();
  return base
    .composite([{ input: Buffer.from(signatureSvg(W, H, username, extra, withSign)), top: 0, left: 0 }])
    .jpeg({ quality: 92 })
    .toBuffer();
}

/** Vídeo com a assinatura sobreposta (MP4, mesmo som). `withSign` a false: só o que vai por cima; sem nada, sai como está. */
export async function signVideo(bytes: Buffer, username?: string | null, overlay?: Overlay, withSign = true): Promise<Buffer> {
  const dir = await mkdtemp(join(tmpdir(), 'txsign-'));
  try {
    const src = join(dir, 'in.mp4'), png = join(dir, 'sign.png'), out = join(dir, 'out.mp4');
    await writeFile(src, bytes);
    const { stdout } = await run(ffprobe.path, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'json', src], { timeout: 30_000 });
    const st = (JSON.parse(stdout) as { streams?: { width?: number; height?: number }[] }).streams?.[0];
    const W = st?.width ?? 1080, H = st?.height ?? 1920;
    const extra = overlay?.(W, H) ?? '';
    if (!withSign && !extra) return bytes;
    await sharp(Buffer.from(signatureSvg(W, H, username, extra, withSign))).png().toFile(png);
    await run(FFMPEG, ['-y', '-i', src, '-i', png, '-filter_complex', '[0:v][1:v]overlay=0:0:format=auto', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-pix_fmt', 'yuv420p', '-c:a', 'copy', '-movflags', '+faststart', out], { timeout: 4 * 60_000, maxBuffer: 10 * 1024 * 1024 });
    return await readFile(out);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
