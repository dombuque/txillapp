// O leitor de QR no site: que motor usar (BarcodeDetector do browser ou jsqr) e por que pedaços de uma imagem se procura
// (src/lib/qrDecode.ts). E um QR de verdade feito por src/lib/qr.ts lido pelo jsqr, inteiro e pequeno numa "captura".
// Correr em apps/mobile:  node --test tests/*.test.mjs
import { test } from 'node:test';
import './fixtures/alias.mjs'; // o alias @/ (os módulos usam t() de @/lib/i18n)
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const d = await import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'qrDecode.ts')).href);
const { qrMatrix } = await import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'qr.ts')).href);
const jsQR = createRequire(import.meta.url)(path.join(ROOT, 'node_modules', 'jsqr'));

test('motor: BarcodeDetector quando existe e lê QR; senão jsqr', () => {
  assert.equal(d.pickQrEngine(true, ['qr_code', 'ean_13']), 'native'); // Chrome no Android
  assert.equal(d.pickQrEngine(false, null), 'jsqr'); // Safari do iPhone, Firefox
  assert.equal(d.pickQrEngine(true, []), 'jsqr'); // Chrome no Windows: existe mas sem formatos
  assert.equal(d.pickQrEngine(true, ['ean_13']), 'jsqr');
  assert.equal(d.pickQrEngine(true, null), 'native'); // não diz os formatos: confia-se
});

test('tamanhos: fotos grandes reduzem para 1600, imagens pequenas sobem (até 3×)', () => {
  assert.deepEqual(d.fitSize(4032, 3024), { dw: 1600, dh: 1200 });
  assert.deepEqual(d.fitSize(1080, 2400), { dw: 720, dh: 1600 });
  assert.deepEqual(d.fitSize(1000, 800), { dw: 1000, dh: 800 });
  assert.deepEqual(d.fitSize(160, 160), { dw: 480, dh: 480 });
  assert.deepEqual(d.fitSize(400, 300), { dw: 640, dh: 480 });
  assert.deepEqual(d.fitSize(0, 10), { dw: 0, dh: 0 });
});

test('pedaços: primeiro a imagem inteira, depois o meio e as janelas; nunca fora da imagem', () => {
  const p = d.scanPasses(1080, 2400);
  assert.equal(p[0].name, 'inteira');
  assert.deepEqual([p[0].sx, p[0].sy, p[0].sw, p[0].sh, p[0].dw, p[0].dh], [0, 0, 1080, 2400, 720, 1600]);
  assert.equal(p[1].name, 'meio');
  assert.equal(p[2].name, 'janela 1,1');
  assert.equal(p.length, 11);
  for (const x of p) {
    assert.ok(x.sx >= 0 && x.sy >= 0 && x.sx + x.sw <= 1080 && x.sy + x.sh <= 2400, x.name);
    assert.ok(Math.max(x.dw, x.dh) <= 1600);
  }
  // As janelas leem da original: numa captura de 1080×2400, cada uma tem mais píxeis por módulo do que a inteira reduzida.
  assert.ok(p[2].dw / p[2].sw > p[0].dw / p[0].sw);
  // Uma imagem pequena (o QR já recortado) fica só com a inteira.
  assert.equal(d.scanPasses(600, 600).length, 1);
});

test('câmara: o quadrado do meio, até 720', () => {
  assert.deepEqual(d.cameraPass(1280, 720), { sx: 280, sy: 0, sw: 720, sh: 720, dw: 720, dh: 720, name: 'câmara' });
  assert.deepEqual(d.cameraPass(1920, 1080), { sx: 420, sy: 0, sw: 1080, sh: 1080, dw: 720, dh: 720, name: 'câmara' });
  assert.equal(d.cameraPass(0, 0), null);
});

/** Um QR de lib/qr.ts em RGBA, num fundo `w`×`h`, com `px` píxeis por módulo, a começar em (x0, y0). */
function paint(text, w, h, px, x0, y0, bg = 255) {
  const m = qrMatrix(text);
  const n = m.length + 8; // zona de silêncio de 4 módulos
  const data = new Uint8ClampedArray(w * h * 4).fill(bg);
  for (let y = 0; y < n * px; y++) {
    for (let x = 0; x < n * px; x++) {
      const my = Math.floor(y / px) - 4;
      const mx = Math.floor(x / px) - 4;
      const dark = my >= 0 && mx >= 0 && my < m.length && mx < m.length && m[my][mx];
      const i = ((y0 + y) * w + (x0 + x)) * 4;
      const v = dark ? 24 : 255;
      data[i] = data[i + 1] = data[i + 2] = v;
    }
  }
  for (let i = 3; i < data.length; i += 4) data[i] = 255;
  return data;
}

/** Recorta e reduz (vizinho mais próximo) como o canvas faria num pedaço. */
function crop(src, w, p) {
  const out = new Uint8ClampedArray(p.dw * p.dh * 4);
  for (let y = 0; y < p.dh; y++) {
    for (let x = 0; x < p.dw; x++) {
      const sx = Math.min(w - 1, Math.floor(p.sx + ((x + 0.5) * p.sw) / p.dw));
      const sy = Math.floor(p.sy + ((y + 0.5) * p.sh) / p.dh);
      const si = (sy * w + sx) * 4;
      const di = (y * p.dw + x) * 4;
      out[di] = src[si]; out[di + 1] = src[si + 1]; out[di + 2] = src[si + 2]; out[di + 3] = 255;
    }
  }
  return out;
}

test('o jsqr lê o QR do perfil feito por lib/qr.ts', () => {
  const url = 'https://txillapp.com/u/sara.m';
  const w = 400;
  const img = paint(url, w, w, 10, 10, 10);
  assert.equal(jsQR(img, w, w)?.data, url);
});

test('QR pequeno numa captura de ecrã: os pedaços encontram-no onde a imagem inteira reduzida pode falhar', () => {
  const url = 'https://txillapp.com/c/AB12CD';
  const W = 1080, H = 2400;
  // QR com 3 px por módulo no meio de uma captura (fundo cinzento, como uma conversa).
  const img = paint(url, W, H, 3, 420, 1500, 235);
  const hit = d.scanPasses(W, H).find((p) => jsQR(crop(img, W, p), p.dw, p.dh)?.data === url);
  assert.ok(hit, 'algum pedaço tem de ler o QR');
});
