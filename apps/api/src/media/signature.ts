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

/**
 * O selo de verificado (o desenho do VerifiedBadge da app, numa caixa de 24×24): a roseta coral em degradê (verificado
 * pelo Txillapp e a conta oficial), ou azul na verificação paga, e o visto branco por cima.
 */
export type SealTier = 'verified' | 'official' | 'paid';
export const SEAL_PATH =
  'M22.25 12c0-1.43-.88-2.67-2.19-3.34.46-1.39.2-2.9-.81-3.91s-2.52-1.27-3.91-.81c-.66-1.31-1.91-2.19-3.34-2.19s-2.67.88-3.33 2.19c-1.4-.46-2.91-.2-3.92.81s-1.26 2.52-.8 3.91c-1.31.67-2.2 1.91-2.2 3.34s.89 2.67 2.2 3.34c-.46 1.39-.21 2.9.8 3.91s2.52 1.26 3.91.81c.67 1.31 1.91 2.19 3.34 2.19s2.68-.88 3.34-2.19c1.39.45 2.9.2 3.91-.81s1.27-2.52.81-3.91c1.31-.67 2.19-1.91 2.19-3.34z';
const SEAL_CHECK = 'm8 12.4 2.8 2.8L16.4 9.4';
const SEAL_BLUE = '#1d9bf0';
const SEAL_CORAL = ['#ff6b81', '#d6334f'] as const;
/** A cor de cada nível (igual à `sealPaint` de apps/mobile/src/lib/wordmark.ts): só a verificação paga é azul. */
export const sealPaint = (tier: SealTier): 'blue' | 'coral' => (tier === 'paid' ? 'blue' : 'coral');
/** Como na app: 1,05 vezes a letra do @, a uma folga de 0,15 da letra, com o meio a 0,36 da letra acima da linha de base. */
const SEAL_SCALE = 1.05, SEAL_GAP = 0.15, SEAL_LIFT = 0.36;

/** A conta da posição (igual à `signLayout` de apps/mobile/src/lib/wordmark.ts, comparadas nos testes). */
export function signLayout(W: number, H: number, withUser: boolean, seal?: SealTier | null) {
  const base = Math.min(W, H);
  const m = Math.round(base * 0.04);
  const ww = base * 0.2;
  const s = ww / BOX.w;
  const wh = BOX.h * s;
  const userSize = Math.round(base * 0.028);
  const right = W - m;
  const userBaseline = H - m;
  const markBottom = withUser ? userBaseline - userSize * 1.25 : H - m;
  const size = userSize * SEAL_SCALE;
  const badge = withUser && seal
    ? { tier: seal, size, k: size / 24, x: right - size, y: userBaseline - userSize * SEAL_LIFT - size / 2 }
    : null;
  const textRight = badge ? right - size - userSize * SEAL_GAP : right;
  return { s, x: right - ww, y: markBottom - wh, right, userSize, userBaseline, textRight, seal: badge, blur: Math.max(2, s * 5) };
}

const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** O que mais vai gravado na cópia (ex.: os stickers do mimo), já à escala da imagem W×H. */
export type Overlay = (W: number, H: number) => string;

/**
 * SVG transparente do tamanho da imagem, com o que vai por cima (stickers) e a assinatura. Com `withSign` a false só leva
 * o que vai por cima: o ficheiro já vem assinado da câmara da app e uma segunda assinatura (com outra letra e outra sombra
 * no @) ficava por cima da primeira, desfocada, como se estivesse a dobrar. Com `seal` (conta verificada) o selo vai a
 * seguir ao @, com a mesma sombra.
 */
export function signatureSvg(W: number, H: number, username?: string | null, extra = '', withSign = true, seal?: SealTier | null): string {
  const head = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`;
  if (!withSign) return `${head}\n${extra}\n</svg>`;
  const L = signLayout(W, H, !!username, seal);
  const d = PATHS.map((p) => `<path d="${p}"/>`).join('');
  const mark = (stroke: string, fill: string, extra = '') =>
    `<g ${extra} transform="translate(${L.x - BOX.x * L.s} ${L.y - BOX.y * L.s}) scale(${L.s})" fill="none" stroke="${stroke}" stroke-width="7" stroke-linecap="round" stroke-linejoin="round">${d}<circle cx="${DOT.cx}" cy="${DOT.cy}" r="${DOT.r}" fill="${fill}" stroke="none"/></g>`;
  // O @: uma sombra desfocada por baixo e o texto nítido por cima.
  const text = (fill: string, extra: string) => `<text ${extra} x="${L.textRight}" y="${L.userBaseline}" text-anchor="end" font-family="DejaVu Sans, Helvetica, Arial, sans-serif" font-weight="700" font-size="${L.userSize}" fill="${fill}">@${esc(username ?? '')}</text>`;
  const user = username ? `${text('#000000', 'filter="url(#sh)" opacity="0.5" transform="translate(0 1)"')}${text('#ffffff', 'fill-opacity="0.92"')}` : '';
  // O selo: a sombra da roseta (como a do @), a roseta e, por cima, o visto branco.
  const b = L.seal;
  const at = b ? `transform="translate(${b.x.toFixed(2)} ${b.y.toFixed(2)}) scale(${b.k.toFixed(4)})"` : '';
  const badge = b
    ? `<g filter="url(#sh)" opacity="0.5" transform="translate(0 1)"><path ${at} fill="#000000" d="${SEAL_PATH}"/></g>
<g ${at}><path fill="${sealPaint(b.tier) === 'blue' ? SEAL_BLUE : 'url(#seal-coral)'}" d="${SEAL_PATH}"/><path fill="none" stroke="#ffffff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" d="${SEAL_CHECK}"/></g>`
    : '';
  const grad = b && sealPaint(b.tier) === 'coral'
    ? `<linearGradient id="seal-coral" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${SEAL_CORAL[0]}"/><stop offset="1" stop-color="${SEAL_CORAL[1]}"/></linearGradient>`
    : '';
  return `${head}
<defs><filter id="sh" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="${(L.blur / 2).toFixed(2)}"/></filter>${grad}</defs>
${extra}
<g filter="url(#sh)" transform="translate(0 ${(L.s * 2).toFixed(2)})" opacity="0.45">${mark('#000000', '#000000')}</g>
${mark('#ffffff', '#ff5c6c')}
${user}${badge}
</svg>`;
}

/** Foto com a assinatura (JPEG). Respeita a rotação guardada na foto. `withSign` a false: só o que vai por cima (stickers). */
export async function signImage(bytes: Buffer, username?: string | null, overlay?: Overlay, withSign = true, seal?: SealTier | null): Promise<Buffer> {
  const base = sharp(bytes).rotate();
  const meta = await base.metadata();
  const W = meta.width ?? 1080, H = meta.height ?? 1080;
  const extra = overlay?.(W, H) ?? '';
  if (!withSign && !extra) return base.jpeg({ quality: 92 }).toBuffer();
  return base
    .composite([{ input: Buffer.from(signatureSvg(W, H, username, extra, withSign, seal)), top: 0, left: 0 }])
    .jpeg({ quality: 92 })
    .toBuffer();
}

/** Vídeo com a assinatura sobreposta (MP4, mesmo som). `withSign` a false: só o que vai por cima; sem nada, sai como está. */
export async function signVideo(bytes: Buffer, username?: string | null, overlay?: Overlay, withSign = true, seal?: SealTier | null): Promise<Buffer> {
  const dir = await mkdtemp(join(tmpdir(), 'txsign-'));
  try {
    const src = join(dir, 'in.mp4'), png = join(dir, 'sign.png'), out = join(dir, 'out.mp4');
    await writeFile(src, bytes);
    const { stdout } = await run(ffprobe.path, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'json', src], { timeout: 30_000 });
    const st = (JSON.parse(stdout) as { streams?: { width?: number; height?: number }[] }).streams?.[0];
    const W = st?.width ?? 1080, H = st?.height ?? 1920;
    const extra = overlay?.(W, H) ?? '';
    if (!withSign && !extra) return bytes;
    await sharp(Buffer.from(signatureSvg(W, H, username, extra, withSign, seal))).png().toFile(png);
    await run(FFMPEG, ['-y', '-i', src, '-i', png, '-filter_complex', '[0:v][1:v]overlay=0:0:format=auto', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-pix_fmt', 'yuv420p', '-c:a', 'copy', '-movflags', '+faststart', out], { timeout: 4 * 60_000, maxBuffer: 10 * 1024 * 1024 });
    return await readFile(out);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
