// O logótipo animado do Txillapp (o «GIF Txillapp» que se põe nas conversas, nos comentários, nas notas e nos mimos).
//
// A animação (aprovada pelo dono): o «tx» entra da esquerda inclinado e depois acena e dá pequenos saltos no ritmo dos «ll»;
// os dois «ll» (duas pessoas a txillar) crescem da linha de base e balançam juntos; «a p p» entram um a um; o ponto vermelho
// cai e salta no «i»; no fim tudo desvanece e recomeça (em ciclo).
// Regra do dono: os dois «ll» nunca são cortados nem deformados no resultado final (a margem do desenho deixa-lhes espaço
// para o balanço e para o crescimento, e a escala final é sempre igual nos dois eixos).
//
// Parte de assets/marca/txillapp-logo.svg (os paths, por esta ordem: tx, último p, p, a, ponto, i+ll).
//
// Na raiz do repo:
//   node scripts/marca/anim-logo.mjs [--largura 480] [--fps 30] [--frames <pasta>]
//
// Gera, em apps/web/public/marca/ e apps/mobile/public/marca/ (servidos pelo site, com cache):
//   txillapp-animado.webp / .gif          letras pretas, fundo transparente (para fundos claros)
//   txillapp-animado-branco.webp / .gif   letras brancas, fundo transparente (para fundos escuros, fotos e vídeos)
//   txillapp-animado-fundo.webp / .gif    letras pretas sobre fundo branco (a versão aprovada)
//   txillapp-final.png / -branco.png / -fundo.png   a última imagem parada (antes do desvanecer), para «Reduzir movimento»
// O ponto do «i» é sempre vermelho. O WebP guarda a transparência com borda suave; o GIF é a reserva (transparência de 1 bit).
// --frames <pasta> grava também as imagens PNG de cada variante (para conferir ou para o ffmpeg).
import sharp from 'sharp';
import { mkdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : d;
};
const WIDTH = Number(arg('largura', 480));
const FPS = Number(arg('fps', 30));
const FRAMES_DIR = arg('frames', null);
const OUT = [join(ROOT, 'apps', 'web', 'public', 'marca'), join(ROOT, 'apps', 'mobile', 'public', 'marca')];

const src = readFileSync(join(ROOT, 'assets', 'marca', 'txillapp-logo.svg'), 'utf8');
const ps = [...src.matchAll(/<path fill="([^"]+)"([^>]*) d="([^"]+)"/g)].map((m) => ({ fill: m[1], rule: /evenodd/.test(m[2]) ? ' fill-rule="evenodd"' : '', d: m[3] }));
if (ps.length !== 6) throw new Error(`o logótipo devia ter 6 paths (tem ${ps.length})`);
const [TX, P2, P1, A, DOT, ILL] = ps; // 0 tx, 1 último p, 2 p, 3 a, 4 ponto, 5 i+ll
const RED = DOT.fill;

const VB = { x: 197.964, y: 266.11, w: 199.348, h: 71.798 };
const PAD = 14;
const W = WIDTH;
const H = Math.round((W * (VB.h + PAD * 2)) / (VB.w + PAD * 2));
const DUR = 3.6;
const N = Math.round(FPS * DUR);
/** O momento da imagem parada: tudo assente, antes de começar a desvanecer. */
const T_FINAL = DUR - 0.35;

const clamp = (v) => Math.max(0, Math.min(1, v));
const back = (t) => {
  const c1 = 1.70158, c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};
const bounce = (t) => {
  const n1 = 7.5625, d1 = 2.75;
  if (t < 1 / d1) return n1 * t * t;
  if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
  if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
  return n1 * (t -= 2.625 / d1) * t + 0.984375;
};
const prog = (t, a, b) => clamp((t - a) / (b - a));

/** Uma imagem da animação (SVG), com a cor das letras e o fundo pedidos (null = transparente). */
function frame(t, { ink, bg }) {
  const fillOf = (p) => (p === DOT ? RED : ink);
  const path = (p) => `<path fill="${fillOf(p)}"${p.rule} d="${p.d}"/>`;
  const base = 333; // linha de base das letras
  // tx: entra da esquerda com balanço e depois acompanha o ritmo dos «ll» (pequenos saltos e um aceno)
  const kt = prog(t, 0.0, 0.55);
  const ex = kt <= 0 ? -40 : -40 * (1 - back(kt));
  const tcx = 223, tcy = base;
  const ph = (t - 0.95) / 1.35;
  const on = t > 0.95 && t < 2.3;
  const hop = on ? -Math.abs(Math.sin(ph * Math.PI * 3)) * 3.2 * (1 - ph) : 0;
  const nod = on ? -Math.sin(ph * Math.PI * 3 + 0.6) * 6 * (1 - ph) : kt < 1 ? (1 - kt) * -14 : 0;
  const land = t > 1.85 && t < 2.15 ? -Math.sin(((t - 1.85) / 0.3) * Math.PI) * 2.2 : 0;
  const tx = `<g opacity="${clamp(kt * 2)}" transform="translate(${ex.toFixed(3)} ${(hop + land).toFixed(3)}) translate(${tcx} ${tcy}) rotate(${nod.toFixed(3)}) translate(${-tcx} ${-tcy})">${path(TX)}</g>`;
  // ill: cresce da base (as duas pessoas levantam-se) e depois balançam juntas
  const kg = prog(t, 0.25, 0.95);
  const sy = kg <= 0 ? 0.001 : back(kg);
  const sway = on ? Math.sin(ph * Math.PI * 3) * 5 * (1 - ph) : 0;
  const cx = 275, cy = 337.9;
  const ill = kg <= 0 ? '' : `<g transform="translate(${cx} ${cy}) rotate(${sway.toFixed(3)}) scale(1 ${sy.toFixed(4)}) translate(${-cx} ${-cy})">${path(ILL)}</g>`;
  // a, p, p: entram um a um
  const pop = (p, t0, cxp) => {
    const k = prog(t, t0, t0 + 0.35);
    if (k <= 0) return '';
    const s = 0.55 + 0.45 * back(k);
    return `<g opacity="${clamp(k * 1.6)}" transform="translate(${cxp} ${base}) scale(${s.toFixed(4)}) translate(${-cxp} ${-base})">${path(p)}</g>`;
  };
  const letters = pop(A, 0.75, 316) + pop(P2, 0.9, 349.6) + pop(P1, 1.05, 382.6);
  // ponto vermelho: cai de cima e salta no «i»
  const kd = prog(t, 1.15, 1.85);
  const dy = kd <= 0 ? -60 : -60 * (1 - bounce(kd));
  const dot = kd <= 0 && t < 1.15 ? '' : `<g transform="translate(0 ${dy.toFixed(3)})">${path(DOT)}</g>`;
  // fim: desvanece para recomeçar em ciclo
  const fade = 1 - prog(t, DUR - 0.3, DUR);
  const box = `x="${VB.x - PAD}" y="${VB.y - PAD}" width="${VB.w + PAD * 2}" height="${VB.h + PAD * 2}"`;
  const rect = bg ? `<rect ${box} fill="${bg}"/>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="${VB.x - PAD} ${VB.y - PAD} ${VB.w + PAD * 2} ${VB.h + PAD * 2}">${rect}<g opacity="${fade}">${tx}${ill}${letters}${dot}</g></svg>`;
}

const VARIANTS = [
  { name: 'txillapp-animado', ink: '#000000', bg: null, still: 'txillapp-final.png' },
  { name: 'txillapp-animado-branco', ink: '#ffffff', bg: null, still: 'txillapp-final-branco.png' },
  { name: 'txillapp-animado-fundo', ink: '#000000', bg: '#ffffff', still: 'txillapp-final-fundo.png' },
];

/** As durações de cada imagem em ms (inteiros que somam a duração total). */
const delaysIn = (step) => Array.from({ length: N }, (_, i) => step * (Math.round(((i + 1) * 1000) / FPS / step) - Math.round((i * 1000) / FPS / step)));
const delays = delaysIn(1);
/** O GIF só guarda centésimos de segundo: 30, 30, 40 ms… para o ciclo durar o mesmo. */
const gifDelays = delaysIn(10);

for (const d of OUT) mkdirSync(d, { recursive: true });
const write = (file, buf) => {
  for (const d of OUT) writeFileSync(join(d, file), buf);
};
const kb = (file) => `${(statSync(join(OUT[0], file)).size / 1024).toFixed(0)} KB`;

for (const v of VARIANTS) {
  const pngs = [];
  for (let i = 0; i < N; i++) pngs.push(await sharp(Buffer.from(frame(i / FPS, v))).png().toBuffer());
  if (FRAMES_DIR) {
    const dir = join(FRAMES_DIR, v.name);
    mkdirSync(dir, { recursive: true });
    pngs.forEach((b, i) => writeFileSync(join(dir, `f${String(i).padStart(3, '0')}.png`), b));
  }
  const anim = () => sharp(pngs, { join: { animated: true } });
  const webp = await anim().webp({ loop: 0, delay: delays, quality: 82, alphaQuality: 90, effort: 6, smartSubsample: true }).toBuffer();
  write(`${v.name}.webp`, webp);
  const gif = await anim().gif({ loop: 0, delay: gifDelays, effort: 10, colours: v.bg ? 16 : 32, dither: 0, interFrameMaxError: 4 }).toBuffer();
  write(`${v.name}.gif`, gif);
  if (v.still) write(v.still, await sharp(Buffer.from(frame(T_FINAL, v))).png({ compressionLevel: 9 }).toBuffer());
  console.log(`${v.name}: ${W}x${H}, ${N} imagens a ${FPS} fps; webp ${kb(`${v.name}.webp`)}, gif ${kb(`${v.name}.gif`)}${v.still ? `, ${v.still} ${kb(v.still)}` : ''}`);
}
