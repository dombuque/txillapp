// Testes do cartão do QR do perfil como imagem (src/lib/profileQrCard.ts): o desenho (fundo branco, QR nítido e certo,
// @username e logótipo), o texto da partilha, o nome do ficheiro e as notas depois de partilhar.
// Correr em apps/mobile:  node --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import './aliasHooks.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const c = await import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'profileQrCard.ts')).href);
const marca = await import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'marca.ts')).href);
const { qrMatrix } = await import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'qr.ts')).href);

const URLS = ['https://txillapp.com/u/malta', 'https://txillapp.com/c/ABCD2345', `https://txillapp.com/u/${'x'.repeat(30)}`];

/** Volta a montar a matriz a partir do caminho do QR (em unidades de módulo, com 1 de margem). */
function matrixFromPath(d, n) {
  const m = Array.from({ length: n }, () => Array(n).fill(false));
  for (const [, x, y, w] of d.matchAll(/M(\d+) (\d+)h(\d+)v1h-\d+z/g)) for (let i = 0; i < +w; i++) m[+y - 1][+x - 1 + i] = true;
  return m;
}

test('o caminho do QR tem exatamente os módulos escuros da matriz, em tiras', () => {
  for (const u of URLS) {
    const m = qrMatrix(u);
    const d = c.qrPath(m);
    assert.deepEqual(matrixFromPath(d, m.length), m);
    // Tiras: nunca duas seguidas na mesma linha a tocar-se.
    for (const [, x, y, w] of d.matchAll(/M(\d+) (\d+)h(\d+)/g)) {
      const row = m[+y - 1];
      if (+x - 2 >= 0) assert.equal(row[+x - 2], false);
      if (+x - 1 + +w < row.length) assert.equal(row[+x - 1 + +w], false);
    }
  }
});

test('o cartão: 1080 de largura, fundo branco, QR centrado com módulos inteiros e margem branca à volta', () => {
  for (const u of URLS) {
    const m = qrMatrix(u);
    const l = c.qrCardLayout(m, 'malta');
    assert.equal(l.width, 1080);
    assert.ok(l.height > l.width && l.height < 1400, 'um pouco mais alto que largo (cabe o @ e o logótipo)');
    assert.ok(Number.isInteger(l.qr.module) && l.qr.module >= 8, 'módulos de píxeis inteiros e grandes');
    assert.equal(l.qr.size, l.qr.module * (m.length + 2));
    assert.ok(Math.abs(l.qr.x + l.qr.size / 2 - l.width / 2) <= 1, 'QR ao centro');
    assert.ok(l.qr.x >= c.QR_CARD.margin && l.qr.y >= c.QR_CARD.margin, 'margem branca');
    assert.match(l.svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="1080" height="\d+" viewBox="0 0 1080 \d+">/);
    assert.ok(l.svg.includes(`<rect width="1080" height="${l.height}" fill="#ffffff"/>`), 'fundo branco a toda a imagem');
    assert.ok(l.svg.includes(`translate(${l.qr.x} ${l.qr.y}) scale(${l.qr.module})`));
    assert.ok(l.svg.includes(c.qrPath(m)), 'o QR que se desenha é o da ligação');
    assert.ok(l.svg.endsWith('</svg>'));
  }
});

test('o @username vai por baixo do QR, ao centro, a negrito, e encolhe se não couber; o logótipo fica por baixo dele', () => {
  const l = c.qrCardLayout(qrMatrix(URLS[0]), '  malta ');
  assert.equal(l.text.text, '@malta');
  assert.equal(l.text.align, 'center');
  assert.equal(l.text.x, 540);
  assert.equal(l.text.weight, 800);
  assert.equal(l.text.maxWidth, 1080 - 2 * c.QR_CARD.margin);
  assert.ok(l.text.y > l.qr.y + l.qr.size, 'abaixo do QR');
  // O logótipo (lib/marca.ts, o mesmo do Wordmark) com o ponto do i a coral, abaixo do @ e acima da margem de baixo.
  const B = marca.LOGO_BOX;
  const g = l.svg.match(/<g transform="translate\((-?[\d.]+) (-?[\d.]+)\) scale\(([\d.]+)\)"><path fill="#18181b"/);
  assert.ok(g, 'tem o logótipo');
  const s = +g[3];
  const top = +g[2] + B.y * s;
  const left = +g[1] + B.x * s;
  assert.ok(top > l.text.y, 'logótipo abaixo do @');
  assert.ok(Math.abs(B.h * s - c.QR_CARD.markH) < 0.01, 'com a altura do cartão');
  assert.ok(top + B.h * s <= l.height - c.QR_CARD.margin + 1, 'com margem por baixo');
  assert.ok(Math.abs(left + (B.w * s) / 2 - 540) < 1, 'logótipo ao centro');
  assert.ok(marca.LOGO_INK_PATHS.every((d) => l.svg.includes(d)) && l.svg.includes(`<path fill="#d6334f" d="${marca.LOGO_DOT_PATHS[0]}"`));
  assert.equal(l.label, 'QR do perfil de @malta no Txillapp');
});

test('o desenho não tem letras (o @ pinta-se à parte) e é sempre o mesmo para as mesmas entradas', () => {
  const m = qrMatrix(URLS[1]);
  const a = c.qrCardLayout(m, 'malta');
  assert.deepEqual(c.qrCardLayout(m, 'malta'), a);
  assert.ok(!/<text/.test(a.svg));
  assert.ok(!a.svg.includes('malta'));
});

test('o texto da partilha: com convite fala do convite; sem convite, o convite para seguir', () => {
  assert.equal(c.qrShareText('malta', true), 'Segue-me no Txillapp (@malta) e entra com o meu convite: ganhamos vibes os dois.');
  assert.equal(c.qrShareText('malta', false), 'Segue @malta no Txillapp, a rede da malta:');
  assert.ok(!c.qrShareText('malta', true).includes('http'), 'a ligação vai à parte');
});

test('o nome do ficheiro é seguro', () => {
  assert.equal(c.qrFileName('malta.fixe_1'), 'txillapp-qr-malta.fixe_1.png');
  assert.equal(c.qrFileName('../../etc'), 'txillapp-qr-....etc.png');
  assert.equal(c.qrFileName(''), 'txillapp-qr-perfil.png');
  assert.equal(c.qrFileName('çá ê/'), 'txillapp-qr-perfil.png');
  assert.match(c.qrFileName('a'.repeat(100)), /^txillapp-qr-a{40}\.png$/);
});

test('as notas depois de partilhar', () => {
  assert.equal(c.qrShareNote('shared'), '');
  assert.equal(c.qrShareNote('cancelled'), '');
  assert.equal(c.qrShareNote('link'), '');
  assert.equal(c.qrShareNote('saved-link'), 'Imagem do QR guardada na galeria');
  assert.equal(c.qrShareNote('downloaded'), 'Imagem descarregada e ligação copiada');
  assert.equal(c.qrShareNote('downloaded-only'), 'Imagem descarregada');
  assert.equal(c.qrShareNote('copied'), 'Ligação copiada');
  assert.equal(c.qrShareNote('failed'), 'Não consegui partilhar');
});

test('a folha usa a imagem no «Partilhar» e o «Copiar» continua a copiar a ligação', () => {
  const src = readFileSync(path.join(ROOT, 'src', 'components', 'ProfileQrSheet.tsx'), 'utf8');
  assert.match(src, /shareProfileQr\(img, qrShareText\(username, !!link\), url/);
  assert.match(src, /Clipboard\.setStringAsync\(url\)/);
  assert.ok(!/\bShare\.share\(/.test(src), 'já não partilha só o texto');
  for (const f of ['profileQrImage.ts', 'profileQrImage.web.ts']) {
    const s = readFileSync(path.join(ROOT, 'src', 'lib', f), 'utf8');
    assert.match(s, /export async function renderProfileQr\(url: string, username: string\)/);
    assert.match(s, /export async function shareProfileQr\(/);
    assert.match(s, /export function forgetProfileQr\(/);
  }
  const web = readFileSync(path.join(ROOT, 'src', 'lib', 'profileQrImage.web.ts'), 'utf8');
  assert.match(web, /toBlob\(.*'image\/png'\)/);
  assert.match(web, /navigator\.canShare\(full\)/);
  assert.match(web, /a\.download = img\.name/);
  assert.match(web, /navigator\.clipboard\.writeText\(url\)/);
});
