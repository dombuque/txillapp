// A distância do «À tua volta» numa barra (src/lib/radius.ts, components/RangeSlider.tsx e app/perto.tsx): de 1 a 50 km
// de 1 em 1, o círculo do mapa e o botão de cima seguem o dedo, o pedido à API sai ao largar ou ao parar 300 ms, a barra
// não deixa a folha roubar-lhe o gesto e é "ajustável" para o leitor de ecrã. O servidor aceita o mesmo intervalo.
// Correr em apps/mobile:  node --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const r = await import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'radius.ts')).href);
const read = (...p) => readFileSync(path.join(ROOT, ...p), 'utf8');

test('o intervalo é 1 a 50 km, de 1 em 1, com as marcas de antes', () => {
  assert.deepEqual({ ...r.RADIUS }, { min: 1, max: 50, step: 1, default: 10 });
  assert.deepEqual([...r.RADIUS_MARKS], [5, 10, 20, 30]);
  assert.equal(r.RADIUS_STEPS.at(-1), 50);
});

test('clampRadius: km inteiros e sempre dentro da barra', () => {
  assert.equal(r.clampRadius(12.4), 12);
  assert.equal(r.clampRadius(12.6), 13);
  assert.equal(r.clampRadius(0), 1);
  assert.equal(r.clampRadius(-7), 1);
  assert.equal(r.clampRadius(80), 50);
  assert.equal(r.clampRadius(Number.NaN), 1);
});

test('valueAt / fractionOf: do dedo ao valor e de volta', () => {
  assert.equal(r.valueAt(0, 490), 1);
  assert.equal(r.valueAt(490, 490), 50);
  assert.equal(r.valueAt(-30, 490), 1);
  assert.equal(r.valueAt(9999, 490), 50);
  assert.equal(r.valueAt(110, 490), 12); // 1 + 110/490 × 49 = 12
  assert.equal(r.valueAt(50, 0), 1);
  for (const v of [1, 5, 12, 30, 50]) assert.equal(r.valueAt(r.fractionOf(v) * 490, 490), v);
  assert.equal(r.fractionOf(1), 0);
  assert.equal(r.fractionOf(50), 1);
});

test('RangeSlider: PanResponder sem bibliotecas nativas, não larga o gesto, ajustável com aumentar/diminuir', () => {
  const src = read('src', 'components', 'RangeSlider.tsx');
  assert.match(src, /PanResponder\.create/);
  assert.match(src, /onPanResponderTerminationRequest: \(\) => false/);
  assert.match(src, /accessibilityRole="adjustable"/);
  assert.match(src, /name: 'increment'/);
  assert.match(src, /name: 'decrement'/);
  assert.match(src, /accessibilityValue=\{\{ min, max, now: value/);
  assert.match(src, /touchAction: 'none'/); // no PWA do iPhone o browser não leva o gesto para o scroll
  assert.match(src, /onKeyDown/); // web: setas do teclado
  assert.match(src, /const HIT = 48/);
  assert.doesNotMatch(src, /@react-native-community\/slider/);
});

test('perto: barra na folha «Onde procurar», mapa e botão seguem o dedo, o pedido espera 300 ms ou o largar', () => {
  const src = read('src', 'app', 'perto.tsx');
  assert.doesNotMatch(src, /RADII\.map/);
  assert.match(src, /<RangeSlider[\s\S]*?min=\{RADIUS\.min\}[\s\S]*?max=\{RADIUS\.max\}[\s\S]*?onChange=\{setLiveRadius\}[\s\S]*?onCommit=\{setRadius\}/);
  assert.match(src, /const RADIUS_SETTLE_MS = 300;/);
  assert.match(src, /setTimeout\(\(\) => setRadius\(liveRadius\), RADIUS_SETTLE_MS\)/);
  assert.match(src, /radiusKm: radius, kinds/); // o pedido usa o valor assente
  assert.equal((src.match(/<NearbyMap [^>]*radiusKm=\{liveRadius\}/g) ?? []).length, 2); // o círculo segue o dedo
  assert.match(src, /`\$\{place\.label\} · \$\{liveRadius\} km`/);
  assert.match(src, /radii: RADIUS_STEPS/);
});

test('o servidor aceita km inteiros de 1 a 50 (apps/api nearby.controller)', () => {
  const api = read('..', 'api', 'src', 'nearby', 'nearby.controller.ts');
  assert.match(api, /NEARBY_RADIUS = \{ min: 1, max: 50, default: 10 \}/);
  assert.match(api, /radiusKm: z\.coerce\.number\(\)\.int\(\)\.min\(NEARBY_RADIUS\.min\)\.max\(NEARBY_RADIUS\.max\)/);
});
