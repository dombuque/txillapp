// Gera TODOS os ficheiros da marca do Txillapp a partir dos vetores de origem em assets/marca/:
//   txillapp-logo.svg            o logótipo completo «txillapp» (o ponto do i na cor vermelha, o resto na cor da tinta)
//   txillapp-simbolo.svg         o símbolo «tx» com o ponto vermelho (ícone da app)
//   txillapp-simbolo-branco.svg  o mesmo todo branco (notificações, ícone monocromático do Android)
//
// Para trocar a marca: substituir estes três SVG (o logótipo com paths sem `transform`) e correr, na raiz do repo:
//   node scripts/marca/gerar.mjs
// Opcional: --folha <ficheiro.png> grava uma folha com todos os ícones gerados lado a lado, para conferir.
//
// O que gera:
//   apps/mobile/assets/images: icon.png (iOS, 1024 sem transparência), android-icon-foreground/background/monochrome.png
//     (ícone adaptativo), splash-icon.png, favicon.png, notification-icon.png
//   apps/web/public e apps/mobile/public: favicon.svg, favicon.ico, favicon-32.png, apple-touch-icon.png, icon.svg,
//     icon-192.png, icon-512.png, icon-maskable-512.png, badge-96.png, og-image.png
//   store: icon-1024.png (App Store), logo-whatsapp-branco.png, logo-whatsapp-coral.png
//   apps/mobile/src/lib/marca.ts, apps/web/src/lib/marca.ts, apps/api/src/media/marca.ts: os paths do logótipo para o código
import sharp from 'sharp';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SRC = join(ROOT, 'assets', 'marca');
const at = (...p) => join(ROOT, ...p);

/** Fundo do ícone da app (como o favicon): branco. Contorno cinzento claro nos ícones arredondados do navegador. */
const BG = '#ffffff';
const EDGE = '#d4d4d8';
/** O coral da app, só para o fundo do logótipo do WhatsApp (o vermelho do logótipo vem do próprio SVG). */
const CORAL_BG = '#d6334f';

// ---------------------------------------------------------------- leitura dos SVG

function readSvg(name) {
  const text = readFileSync(join(SRC, name), 'utf8');
  const open = text.match(/<svg\b[^>]*>/i);
  if (!open) throw new Error(`${name}: não é um SVG`);
  const vb = open[0].match(/viewBox\s*=\s*"([^"]+)"/i);
  if (!vb) throw new Error(`${name}: falta o viewBox`);
  const viewBox = vb[1].trim().split(/[\s,]+/).map(Number);
  const inner = text.slice(open.index + open[0].length, text.lastIndexOf('</svg>'));
  const paths = [...inner.matchAll(/<path\b([^>]*?)\/?>/gi)].map((m) => {
    const attr = (k) => m[1].match(new RegExp(`(?:^|\\s)${k}\\s*=\\s*"([^"]*)"`, 'i'))?.[1];
    return { fill: (attr('fill') ?? '#000000').toUpperCase(), d: attr('d') ?? '', transform: attr('transform'), rule: attr('fill-rule') };
  });
  return { name, viewBox, inner, paths };
}

const svgDoc = (vb, body, w, h) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb.join(' ')}" width="${w}" height="${h}">${body}</svg>`;

/** A caixa do desenho (em unidades do viewBox), medida a desenhar o SVG em ponto grande e a ver onde há tinta. */
async function inkBox(vb, body, px = 4000) {
  const scale = px / Math.max(vb[2], vb[3]);
  const w = Math.round(vb[2] * scale);
  const h = Math.round(vb[3] * scale);
  const { data } = await sharp(Buffer.from(svgDoc(vb, body, w, h))).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (data[(y * w + x) * 4 + 3] > 8) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
  if (x1 < 0) throw new Error('desenho vazio');
  const r = (v) => Math.round(v * 1000) / 1000;
  return { x: r(vb[0] + x0 / scale), y: r(vb[1] + y0 / scale), w: r((x1 + 1 - x0) / scale), h: r((y1 + 1 - y0) / scale) };
}

/** Põe um desenho (o seu interior e a sua caixa) dentro da caixa x,y,w,h, centrado e sem deformar. */
const place = (art, x, y, w, h) =>
  `<svg x="${x}" y="${y}" width="${w}" height="${h}" viewBox="${art.box.x} ${art.box.y} ${art.box.w} ${art.box.h}" preserveAspectRatio="xMidYMid meet" overflow="visible">${art.inner}</svg>`;

/** O desenho centrado num quadrado `size`, com o lado maior a medir `frac` do quadrado. */
function centered(art, size, frac) {
  const k = (size * frac) / Math.max(art.box.w, art.box.h);
  const w = art.box.w * k;
  const h = art.box.h * k;
  return place(art, (size - w) / 2, (size - h) / 2, w, h);
}

/** O desenho centrado num quadrado `size`, com a diagonal da caixa a caber num círculo de diâmetro `frac` (zonas seguras). */
function inCircle(art, size, frac) {
  const diag = Math.hypot(art.box.w, art.box.h);
  return centered(art, size, (frac * Math.max(art.box.w, art.box.h)) / diag);
}

const square = (size, body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">${body}</svg>`;
const rounded = (size) => {
  const rx = size * (112 / 512);
  const sw = size * (6 / 512);
  return `<rect width="${size}" height="${size}" rx="${rx}" fill="${BG}"/><rect x="${sw / 2}" y="${sw / 2}" width="${size - sw}" height="${size - sw}" rx="${rx - sw / 2}" fill="none" stroke="${EDGE}" stroke-width="${sw}"/>`;
};

const png = (svg, size, opaque = false) => {
  let s = sharp(Buffer.from(svg), { density: 72 * Math.max(1, Math.ceil(size / 256)) }).resize(size, size);
  if (opaque) s = s.flatten({ background: BG }).removeAlpha();
  return s.png({ compressionLevel: 9 }).toBuffer();
};

function write(rel, data) {
  const file = at(rel);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, data);
  console.log('  ' + rel.replace(/\\/g, '/'));
}

/** favicon.ico com PNG lá dentro (16, 32 e 48), formato aceite por todos os navegadores atuais. */
function ico(pngs) {
  const head = Buffer.alloc(6 + 16 * pngs.length);
  head.writeUInt16LE(0, 0);
  head.writeUInt16LE(1, 2);
  head.writeUInt16LE(pngs.length, 4);
  let offset = head.length;
  pngs.forEach(({ size, buf }, i) => {
    const e = 6 + 16 * i;
    head[e] = size >= 256 ? 0 : size;
    head[e + 1] = size >= 256 ? 0 : size;
    head.writeUInt16LE(1, e + 4);
    head.writeUInt16LE(32, e + 6);
    head.writeUInt32LE(buf.length, e + 8);
    head.writeUInt32LE(offset, e + 12);
    offset += buf.length;
  });
  return Buffer.concat([head, ...pngs.map((p) => p.buf)]);
}

// ---------------------------------------------------------------- o módulo do código

const round2 = (d) => d.replace(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi, (n) => String(Math.round(Number(n) * 100) / 100));

/** Separa o ponto do i (a forma com a cor mais viva) da tinta (o resto). */
function splitLogo(logo) {
  const fills = [...new Set(logo.paths.map((p) => p.fill))];
  const chroma = (hex) => { const n = parseInt(hex.slice(1).padEnd(6, '0').slice(0, 6), 16); const c = [n >> 16, (n >> 8) & 255, n & 255]; return Math.max(...c) - Math.min(...c); };
  const dotFill = fills.reduce((a, b) => (chroma(b) > chroma(a) ? b : a));
  if (chroma(dotFill) < 40) throw new Error('txillapp-logo.svg: não encontrei o ponto vermelho (um path com uma cor viva).');
  const ink = logo.paths.filter((p) => p.fill !== dotFill);
  const dot = logo.paths.filter((p) => p.fill === dotFill);
  return { ink, dot, dotFill, inkFill: ink[0]?.fill ?? '#000000' };
}

/** O logótipo só com paths, a tinta e o ponto nas cores dadas. */
const recolor = (logo, ink, dot) => {
  const s = splitLogo(logo);
  return { ...logo, inner: [...s.ink.map((p) => `<path fill="${ink}" d="${p.d}"/>`), ...s.dot.map((p) => `<path fill="${dot ?? s.dotFill}" d="${p.d}"/>`)].join('') };
};

async function codeModule(logo) {
  const bad = logo.paths.find((p) => p.transform);
  if (bad) throw new Error('txillapp-logo.svg: há paths com `transform`; aplica as transformações aos paths (ex. no Illustrator ou com o svgo) e volta a correr.');
  if (/<(g|circle|rect|ellipse|polygon|polyline|line|use)\b/i.test(logo.inner.replace(/<g>\s*|<\/g>/gi, '')))
    throw new Error('txillapp-logo.svg: o logótipo deve ser só <path>s (converte círculos e formas em paths).');
  const { ink, dot, dotFill, inkFill } = splitLogo(logo);
  const rule = logo.paths.some((p) => p.rule === 'evenodd') ? 'evenodd' : 'nonzero';
  const dotBox = await inkBox(logo.viewBox, dot.map((p) => `<path d="${p.d}"/>`).join(''));
  const DOT = { cx: +(dotBox.x + dotBox.w / 2).toFixed(3), cy: +(dotBox.y + dotBox.h / 2).toFixed(3), r: +(Math.max(dotBox.w, dotBox.h) / 2).toFixed(3) };
  const list = (ps) => `[\n${ps.map((p) => `  '${round2(p.d).replace(/\s+/g, ' ').trim()}',`).join('\n')}\n]`;
  return `/**
 * O logótipo «txillapp» (o desenho oficial, em formas cheias). GERADO por scripts/marca/gerar.mjs a partir de
 * assets/marca/txillapp-logo.svg: não editar à mão; para trocar o logótipo, troca o SVG e corre o script.
 *
 * As coordenadas são as do SVG de origem: a caixa do desenho é LOGO_BOX (x, y, largura, altura). Para desenhar com altura H:
 * escala H / LOGO_BOX.h e translação (-LOGO_BOX.x, -LOGO_BOX.y). Cada path enche-se com a regra LOGO_FILL_RULE, um a um
 * (não juntar os paths num só, porque as formas sobrepõem-se).
 */
export const LOGO_BOX = { x: ${logo.box.x}, y: ${logo.box.y}, w: ${logo.box.w}, h: ${logo.box.h} } as const;
/** A cor da tinta e a do ponto do i no desenho original. */
export const LOGO_INK = '${inkFill}';
export const LOGO_DOT_COLOR = '${dotFill}';
export const LOGO_FILL_RULE: 'nonzero' | 'evenodd' = '${rule}';
/** As letras (tudo menos o ponto do i). */
export const LOGO_INK_PATHS: readonly string[] = ${list(ink)};
/** O ponto do i. */
export const LOGO_DOT_PATHS: readonly string[] = ${list(dot)};
/** O círculo do ponto do i (para o animar, ex. a saltar enquanto carrega). */
export const LOGO_DOT = { cx: ${DOT.cx}, cy: ${DOT.cy}, r: ${DOT.r} } as const;

/** O logótipo em marcação SVG (sem o <svg> à volta), com a tinta e o ponto nas cores dadas. */
export function logoSvgPaths(ink: string = LOGO_INK, dot: string = LOGO_DOT_COLOR): string {
  const rule = LOGO_FILL_RULE === 'evenodd' ? ' fill-rule="evenodd"' : '';
  return [...LOGO_INK_PATHS.map((d) => \`<path fill="\${ink}"\${rule} d="\${d}"/>\`), ...LOGO_DOT_PATHS.map((d) => \`<path fill="\${dot}"\${rule} d="\${d}"/>\`)].join('');
}
`;
}

// ---------------------------------------------------------------- tudo

async function main() {
  const folhaIdx = process.argv.indexOf('--folha');
  const folha = folhaIdx > 0 ? process.argv[folhaIdx + 1] : null;

  const logo = readSvg('txillapp-logo.svg');
  const sym = readSvg('txillapp-simbolo.svg');
  const symW = readSvg('txillapp-simbolo-branco.svg');
  for (const a of [logo, sym, symW]) a.box = await inkBox(a.viewBox, a.inner);

  console.log('a gerar a partir de assets/marca:');

  // --- App nativa (Expo)
  const img = 'apps/mobile/assets/images';
  // iOS: 1024 sem transparência, fundo branco, o símbolo com ~62% ao centro (o sistema arredonda os cantos).
  const ios = square(1024, `<rect width="1024" height="1024" fill="${BG}"/>${centered(sym, 1024, 0.62)}`);
  write(`${img}/icon.png`, await png(ios, 1024, true));
  write('store/icon-1024.png', await png(ios, 1024, true));
  // Android adaptativo (108 dp): só os 72 dp do meio se veem (66,7%) e o recorte pode ser um círculo de 66 dp (61%).
  // O símbolo fica com 62% da parte visível (como no iOS) e cabe sempre no círculo seguro.
  const fg = (art) => square(1024, centered(art, 1024, 0.62 * (72 / 108)));
  write(`${img}/android-icon-foreground.png`, await png(fg(sym), 1024));
  write(`${img}/android-icon-background.png`, await png(square(1024, `<rect width="1024" height="1024" fill="${BG}"/>`), 1024, true));
  write(`${img}/android-icon-monochrome.png`, await png(fg(symW), 1024));
  // Arranque: o logótipo completo ao centro (o plugin mostra a imagem com 200 dp de largura).
  write(`${img}/splash-icon.png`, await png(square(1024, centered(logo, 1024, 0.5)), 1024));
  // Notificações do Android: só a forma, a branco sobre transparente (o sistema pinta-a).
  write(`${img}/notification-icon.png`, await png(square(96, centered(symW, 96, 0.84)), 96));

  // --- Navegador e PWA (o site e a app web têm os mesmos ícones)
  const fav = square(512, rounded(512) + centered(sym, 512, 0.74));
  const any = square(512, rounded(512) + centered(sym, 512, 0.62));
  const maskable = square(512, `<rect width="512" height="512" fill="${BG}"/>${inCircle(sym, 512, 0.72)}`);
  const touch = square(180, `<rect width="180" height="180" fill="${BG}"/>${centered(sym, 180, 0.62)}`);
  const badge = square(96, centered(symW, 96, 0.84));
  const ogLogoW = 760;
  const ogLogoH = (logo.box.h / logo.box.w) * ogLogoW;
  const og = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630" width="1200" height="630">
  <defs><filter id="b" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="70"/></filter></defs>
  <rect width="1200" height="630" fill="#ebebea"/>
  <circle cx="1040" cy="60" r="260" fill="${CORAL_BG}" opacity="0.35" filter="url(#b)"/>
  <circle cx="120" cy="600" r="240" fill="#fcd34d" opacity="0.45" filter="url(#b)"/>
  ${place(logo, (1200 - ogLogoW) / 2, (630 - ogLogoH) / 2, ogLogoW, ogLogoH)}</svg>`;
  const ogPng = await sharp(Buffer.from(og)).png({ compressionLevel: 9 }).toBuffer();
  const favPngs = await Promise.all([16, 32, 48].map(async (size) => ({ size, buf: await png(fav, size) })));
  for (const pub of ['apps/web/public', 'apps/mobile/public']) {
    write(`${pub}/favicon.svg`, fav);
    write(`${pub}/favicon.ico`, ico(favPngs));
    write(`${pub}/favicon-32.png`, favPngs[1].buf);
    write(`${pub}/icon.svg`, any);
    write(`${pub}/icon-192.png`, await png(any, 192));
    write(`${pub}/icon-512.png`, await png(any, 512));
    write(`${pub}/icon-maskable-512.png`, await png(maskable, 512, true));
    write(`${pub}/apple-touch-icon.png`, await png(touch, 180, true));
    write(`${pub}/badge-96.png`, await png(badge, 96));
    write(`${pub}/og-image.png`, ogPng);
  }
  write(`${img}/favicon.png`, favPngs[2].buf);

  // --- Logótipo para o grupo do WhatsApp (corta em círculo): fundo branco, e fundo coral com o logótipo a branco.
  const wa = (bg, art) => square(1024, `<rect width="1024" height="1024" fill="${bg}"/>${inCircle(art, 1024, 0.86)}`);
  write('store/logo-whatsapp-branco.png', await png(wa(BG, logo), 1024, true));
  write('store/logo-whatsapp-coral.png', await png(wa(CORAL_BG, recolor(logo, '#FFFFFF', '#111111')), 1024, true));

  // --- O código
  const mod = await codeModule(logo);
  for (const f of ['apps/mobile/src/lib/marca.ts', 'apps/web/src/lib/marca.ts', 'apps/api/src/media/marca.ts']) write(f, mod);
  // A conta da posição da assinatura (app e API, comparadas nos testes) vive em ficheiros que não importam nada: a caixa
  // do logótipo vai escrita lá diretamente.
  const box = `{ x: ${logo.box.x}, y: ${logo.box.y}, w: ${logo.box.w}, h: ${logo.box.h} }`;
  for (const [f, re] of [
    ['apps/mobile/src/lib/wordmark.ts', /(export const WORDMARK_BOX = )\{[^}]*\}/],
    ['apps/api/src/media/signature.ts', /(export const BOX = )\{[^}]*\}/],
  ]) {
    const text = readFileSync(at(f), 'utf8');
    if (!re.test(text)) throw new Error(`${f}: não encontrei a linha da caixa do logótipo`);
    const next = text.replace(re, `$1${box}`);
    if (next !== text) write(f, next);
  }

  if (folha) await contactSheet(folha, { ios, fg: fg(sym), mono: fg(symW), any, maskable, touch, fav, badge, og: ogPng, logo });
  console.log('feito.');
}

// ---------------------------------------------------------------- folha de conferência (--folha)

async function contactSheet(out, a) {
  const cell = 220;
  const tiles = [];
  const tile = async (label, svgOrPng, size, { mask, bg = '#e5e5e5', under } = {}) => {
    let buf = Buffer.isBuffer(svgOrPng) ? svgOrPng : await png(svgOrPng, size);
    buf = await sharp(buf).resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
    if (under) buf = await sharp(await png(under, size)).composite([{ input: buf }]).png().toBuffer();
    if (mask) buf = await sharp(buf).composite([{ input: Buffer.from(mask(size)), blend: 'dest-in' }]).png().toBuffer();
    tiles.push({ label, buf, size, bg });
  };
  const circle = (s) => `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}"><circle cx="${s / 2}" cy="${s / 2}" r="${s / 2}"/></svg>`;
  const squircle = (s) => `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}"><rect width="${s}" height="${s}" rx="${s * 0.225}"/></svg>`;
  // O Android mostra os 72 dp do meio do ícone adaptativo e recorta-os (aqui em círculo).
  const crop = async (svg) => sharp(await png(svg, 1024)).extract({ left: 171, top: 171, width: 682, height: 682 }).png().toBuffer();
  const white = square(1024, `<rect width="1024" height="1024" fill="${BG}"/>`);
  const adaptive = await sharp(await png(white, 1024)).composite([{ input: await png(a.fg, 1024) }]).png().toBuffer();
  const adaptiveCrop = await sharp(adaptive).extract({ left: 171, top: 171, width: 682, height: 682 }).png().toBuffer();
  await tile('iOS icon.png', a.ios, 180);
  await tile('iPhone (arredondado)', a.ios, 180, { mask: squircle });
  await tile('Android redondo', adaptiveCrop, 180, { mask: circle });
  await tile('Android squircle', adaptiveCrop, 180, { mask: squircle });
  await tile('foreground', a.fg, 180, { bg: '#c8c8c8' });
  await tile('monochrome', a.mono, 180, { bg: '#555' });
  await tile('Android tema', await crop(a.mono), 180, { mask: circle, bg: '#e5e5e5', under: square(1024, '<rect width="1024" height="1024" fill="#3d4a5c"/>') });
  await tile('PWA 512', a.any, 180);
  await tile('PWA 192', await png(a.any, 192), 96);
  await tile('maskable', a.maskable, 180);
  await tile('maskable redondo', a.maskable, 180, { mask: circle });
  await tile('apple-touch 180', a.touch, 180);
  await tile('favicon 32', await png(a.fav, 32), 32);
  await tile('favicon 16', await png(a.fav, 16), 16);
  await tile('badge-96', a.badge, 96, { bg: '#555' });
  const cols = 5;
  const rows = Math.ceil(tiles.length / cols);
  const W = cols * cell;
  const H = rows * (cell + 30) + 390;
  const comps = [];
  const labels = [];
  tiles.forEach((t, i) => {
    const x = (i % cols) * cell;
    const y = Math.floor(i / cols) * (cell + 30);
    labels.push(`<rect x="${x + 10}" y="${y + 10}" width="${cell - 20}" height="${cell - 20}" rx="12" fill="${t.bg}"/><text x="${x + cell / 2}" y="${y + cell + 18}" font-family="Arial" font-size="15" text-anchor="middle" fill="#333">${t.label}</text>`);
    comps.push({ input: t.buf, left: Math.round(x + (cell - t.size) / 2), top: Math.round(y + (cell - t.size) / 2) });
  });
  const ogTop = rows * (cell + 30) + 10;
  comps.push({ input: await sharp(a.og).resize(640, 336).png().toBuffer(), left: 10, top: ogTop });
  labels.push(`<text x="330" y="${ogTop + 350}" font-family="Arial" font-size="15" text-anchor="middle" fill="#333">og-image 1200x630</text>`);
  const logoW = W - 680;
  const logoH = Math.round((a.logo.box.h / a.logo.box.w) * logoW);
  const lg = `<svg xmlns="http://www.w3.org/2000/svg" width="${logoW}" height="${logoH * 2 + 40}"><rect width="${logoW}" height="${logoH + 20}" fill="#fff"/><rect y="${logoH + 20}" width="${logoW}" height="${logoH + 20}" fill="#111"/>${place(a.logo, 20, 10, logoW - 40, logoH)}${place(recolor(a.logo, '#FFFFFF'), 20, logoH + 30, logoW - 40, logoH)}</svg>`;
  comps.push({ input: Buffer.from(lg), left: 670, top: ogTop });
  const base = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="#f7f7f7"/>${labels.join('')}</svg>`;
  mkdirSync(dirname(out), { recursive: true });
  await sharp(Buffer.from(base)).composite(comps).png().toFile(out);
  console.log('  folha: ' + out);
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
