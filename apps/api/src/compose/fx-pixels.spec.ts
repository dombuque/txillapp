import { execFileSync } from 'child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import ffmpegPath from 'ffmpeg-static';
import { applyFxPixel, cubeLut, FILTERS, resolveFx, SHARPEN_K, type ClipFx } from './effects';
import { serverFxChain } from './fx';

/**
 * A cor do servidor é a do site, píxel a píxel: o mesmo frame com o mesmo filtro, pela fórmula do site (`applyFxPixel`, o
 * que o shader WebGL faz, com a nitidez 3×3 antes) e pela cadeia ffmpeg da montagem (convolution → lut3d → vignette), em
 * RGB de 8 bits. O grão fica de fora (é aleatório nos dois lados). Mede-se o ΔE (CIE76, em Lab D65) de todos os píxeis.
 */
const FF = ffmpegPath as unknown as string;
const W = 540, H = 960;
const work = mkdtempSync(join(tmpdir(), 'txfxpx-'));
afterAll(() => rmSync(work, { recursive: true, force: true }));

function rgb24(args: string[]): Buffer {
  return execFileSync(FF, ['-v', 'error', ...args, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { cwd: work, maxBuffer: 64 * 1024 * 1024 });
}
const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
function lab(r: number, g: number, b: number): [number, number, number] {
  const R = lin(r / 255), G = lin(g / 255), B = lin(b / 255);
  const x = (0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047, y = 0.2126 * R + 0.7152 * G + 0.0722 * B, z = (0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883;
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}
/** O frame pela fórmula do site: nitidez 3×3 (vizinhos a 1 px, bordas repetidas), depois a matriz e a vinheta. */
function reference(src: Buffer, fx: ClipFx): Float64Array {
  const p = resolveFx(fx);
  const a = p.sharpen * SHARPEN_K;
  const out = new Float64Array(W * H * 3);
  const px = (x: number, y: number, c: number) => src[((Math.min(H - 1, Math.max(0, y)) * W + Math.min(W - 1, Math.max(0, x))) * 3) + c] / 255;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const rgb = [0, 1, 2].map((c) => {
      const v = px(x, y, c);
      if (a <= 0) return v;
      return Math.min(1, Math.max(0, v * (1 + 4 * a) - a * (px(x - 1, y, c) + px(x + 1, y, c) + px(x, y - 1, c) + px(x, y + 1, c))));
    }) as [number, number, number];
    const o = applyFxPixel(p, rgb, (x + 0.5) / W, (y + 0.5) / H, 0, W, H);
    out.set(o.map((v) => v * 255), (y * W + x) * 3);
  }
  return out;
}

describe('a cor do servidor é a do site (ΔE por píxel)', () => {
  // Um frame com cores fortes (testsrc2) por cima e degradês suaves por baixo (peles, céus, sombras).
  const src = rgb24(['-f', 'lavfi', '-i', `testsrc2=size=${W}x${H / 2}`, '-f', 'lavfi', '-i', `gradients=size=${W}x${H / 2}:c0=0x2b1a12:c1=0xf2c49b:c2=0x3a6fb0:c3=0xe8e8f0:nb_colors=4:seed=7`, '-filter_complex', '[0:v][1:v]vstack,format=rgb24']);
  writeFileSync(join(work, 'src.rgb'), src);
  const cases: [string, ClipFx][] = [
    ...FILTERS.filter((f) => f.id !== 'normal').map((f): [string, ClipFx] => [f.id, { filter: { id: f.id, amount: 1 } }]),
    ['costa-do-sol 0,6 + ajustes', { filter: { id: 'costa-do-sol', amount: 0.6 }, adjust: { brightness: 0.3, contrast: -0.4, saturation: 0.5, temperature: -0.6, hue: 0.2, sharpen: 0.5, vignette: 0.6 } }],
  ];
  const results: Record<string, { mean: number; p99: number }> = {};

  it.each(cases)('%s', (name, fx) => {
    writeFileSync(join(work, 'clip.cube'), cubeLut(resolveFx(fx).matrix, 33));
    // Sem o grão (aleatório): a cadeia até ao `noise`.
    // A cadeia da montagem, seguida de yuv444p como no clipe (sem o 4:2:0, para medir só a cor); o yuv444p apanha a vinheta
    // se ela fugir para YUV (ver serverFxChain).
    const chain = serverFxChain(fx, 'clip.cube').split(',format=yuv420p,noise=')[0];
    const got = rgb24(['-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', `${W}x${H}`, '-i', 'src.rgb', '-vf', `${chain},format=yuv444p`]);
    const ref = reference(src, fx);
    const d: number[] = [];
    for (let i = 0; i < W * H; i++) {
      const A = lab(got[i * 3], got[i * 3 + 1], got[i * 3 + 2]);
      const B = lab(ref[i * 3], ref[i * 3 + 1], ref[i * 3 + 2]);
      d.push(Math.hypot(A[0] - B[0], A[1] - B[1], A[2] - B[2]));
    }
    d.sort((x, y) => x - y);
    const mean = d.reduce((s, v) => s + v, 0) / d.length;
    results[name] = { mean: Math.round(mean * 100) / 100, p99: Math.round(d[Math.floor(d.length * 0.99)] * 100) / 100 };
    expect(mean).toBeLessThan(1); // ΔE < 1: a diferença não se vê
    expect(d[Math.floor(d.length * 0.99)]).toBeLessThan(3);
  });

  afterAll(() => console.log(`ΔE76 (média, percentil 99) por filtro:\n${Object.entries(results).map(([k, v]) => `  ${k}: ${v.mean} / ${v.p99}`).join('\n')}`));
});
