// No site, o watchPositionAsync do expo-location troca o número da subscrição pelo do browser e as posições nunca chegam
// (no iPhone a folha "Enviar localização" ficava em "A procurar a tua posição…"). Toda a app segue a posição através de
// lib/watchPosition.ts. Correr em apps/mobile:  node --experimental-strip-types --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const files = (dir) => readdirSync(dir).flatMap((n) => {
  const p = path.join(dir, n);
  return statSync(p).isDirectory() ? files(p) : /\.(tsx?|jsx?)$/.test(n) ? [p] : [];
});

test('só lib/watchPosition.ts chama o watchPositionAsync do expo-location', () => {
  const bad = files(path.join(ROOT, 'src'))
    .filter((f) => !f.endsWith(path.join('lib', 'watchPosition.ts')))
    .filter((f) => /Location\.watchPositionAsync\s*\(/.test(readFileSync(f, 'utf8')))
    .map((f) => path.relative(ROOT, f));
  assert.deepEqual(bad, []);
});

test('no site, o seguir da posição tem erros e tempo-limite', () => {
  const src = readFileSync(path.join(ROOT, 'src/lib/watchPosition.ts'), 'utf8');
  assert.match(src, /navigator\.geolocation/);
  assert.match(src, /watchPosition\(\s*\n?\s*\(p\)/);
  assert.match(src, /timeout:/);
  assert.match(src, /onError\?\.\(webGeoError/);
});
