// TxillCam no PWA do iPhone: ao virar para a câmara da frente, a imagem ficava num retângulo pequeno ao meio (~56%).
// O espelho e o zoom passam para uma caixa à volta do <video> (o Safari perdia o object-fit: cover no vídeo rodado e
// transformado) e cada câmara tem um <video> novo (src/lib/webCamera.ts e src/components/TxCamera.tsx).
// Correr em apps/mobile:  node --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const w = await import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'webCamera.ts')).href);
const cam = readFileSync(path.join(ROOT, 'src', 'components', 'TxCamera.tsx'), 'utf8');

test('viewTransform: espelho só na frente; zoom digital; valores estranhos não estragam o visor', () => {
  assert.deepEqual(w.viewTransform(true, 1), { transform: 'scaleX(-1) scale(1)' });
  assert.deepEqual(w.viewTransform(false, 2), { transform: 'scale(2)' });
  assert.deepEqual(w.viewTransform(true, NaN), { transform: 'scaleX(-1) scale(1)' });
  assert.deepEqual(w.viewTransform(false, 0), { transform: 'scale(1)' });
});

test('freshVideoFor: só pede um <video> novo quando já havia outro stream', () => {
  const a = {}, b = {};
  assert.equal(w.freshVideoFor(null, a), false, 'primeira vez: usa o que há');
  assert.equal(w.freshVideoFor(a, a), false, 'o mesmo stream (a sessão partilhada devolveu-o)');
  assert.equal(w.freshVideoFor(a, b), true, 'virou de câmara');
});

test('nextVideo: espera pelo <video> novo e desiste a tempo', async () => {
  const old = { n: 0 };
  let cur = old;
  setTimeout(() => { cur = { n: 1 }; }, 30);
  assert.equal((await w.nextVideo(() => cur, old, 1000, 5)).n, 1);
  const t0 = Date.now();
  assert.equal(await w.nextVideo(() => old, old, 40, 5), old, 'sem elemento novo: segue com o antigo');
  assert.ok(Date.now() - t0 < 500);
});

test('no visor o <video> não leva transform nem filtro: vão na caixa à volta', () => {
  const m = cam.match(/dom\('video', \{\s*key: `v\$\{vkey\}`[\s\S]*?\}\)/);
  assert.ok(m, 'encontrei o <video> do visor');
  assert.doesNotMatch(m[0], /transform|filter/);
  assert.match(m[0], /style: fill/);
  assert.match(cam, /\{ key: 'vbox', style: \{ \.\.\.VIEW_BOX, \.\.\.viewTransform\(facing === 'user', digital\), filter: lookCss\(LOOKS\[look\]\)/);
});

test('ao trocar de câmara monta-se um <video> novo antes de lhe dar o stream', () => {
  assert.match(cam, /if \(v && freshVideoFor\(v\.srcObject, s\)\) \{\s*lastDims\.current = '';\s*setVkey\(\(n\) => n \+ 1\);\s*v = await nextVideo\(\(\) => video\.current, v\);/);
});
