// Os comentários a flutuar no visor dos mimos: os últimos 10, um balão de cada vez, no máximo 3 à vista (src/lib/storyFloat.ts).
// Correr em apps/mobile:  node --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const f = await import(new URL('../src/lib/storyFloat.ts', import.meta.url).href);
const read = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8').replace(/\r/g, '');

test('entram os 10 comentários mais recentes, pela ordem', () => {
  const list = Array.from({ length: 25 }, (_, k) => k);
  assert.deepEqual(f.floatPool(list), [15, 16, 17, 18, 19, 20, 21, 22, 23, 24]);
  assert.deepEqual(f.floatPool([1, 2]), [1, 2]);
  assert.deepEqual(f.floatPool(undefined), []);
});

test('com poucos comentários entram um a um e ficam (o relógio pára)', () => {
  assert.deepEqual(f.floatWindow(-1, 2, 3), []);
  assert.deepEqual(f.floatWindow(0, 2, 3).map((e) => [e.index, e.age]), [[0, 0]]);
  assert.deepEqual(f.floatWindow(1, 2, 3).map((e) => [e.index, e.age]), [[0, 1], [1, 0]]);
  assert.deepEqual(f.floatWindow(9, 2, 3).map((e) => [e.index, e.age]), [[0, 1], [1, 0]]);
  assert.equal(f.floatDone(0, 2, 3), false);
  assert.equal(f.floatDone(1, 2, 3), true);
  assert.equal(f.floatDone(-1, 0, 3), true);
  assert.equal(f.floatDone(-1, 5, 0), true, 'sem lugar no cartão não há balões');
});

test('com mais comentários ciclam: no máximo 3 à vista e o mais velho sai a desvanecer', () => {
  for (let tick = 0; tick < 40; tick++) {
    const w = f.floatWindow(tick, 10, 3);
    const shown = w.filter((e) => !e.leaving);
    assert.ok(shown.length <= 3 && shown.length === Math.min(tick + 1, 3), `batida ${tick}`);
    assert.ok(w.filter((e) => e.leaving).length <= 1);
    // O mais novo é o desta batida, em baixo (idade 0); as chaves são únicas (a animação de entrada corre uma vez).
    assert.equal(w.at(-1).index, tick % 10);
    assert.equal(w.at(-1).age, 0);
    assert.equal(new Set(w.map((e) => e.key)).size, w.length);
  }
  assert.deepEqual(f.floatWindow(12, 10, 3).map((e) => [e.index, e.leaving]), [[9, true], [0, false], [1, false], [2, false]]);
  assert.equal(f.floatDone(100, 10, 3), false, 'cicla enquanto o mimo está aberto');
  // Num ecrã com lugar só para dois.
  assert.equal(f.floatWindow(7, 10, 2).filter((e) => !e.leaving).length, 2);
});

test('cada balão sobe pela altura dos mais novos; o que sai sobe mais um bocadinho', () => {
  const w = f.floatWindow(5, 10, 3); // chaves 2 (a sair), 3, 4, 5
  const off = f.floatOffsets(w, { 5: 40, 4: 58 }, 44, 8);
  assert.equal(off[5], 0);
  assert.equal(off[4], 48);
  assert.equal(off[3], 48 + 66);
  assert.equal(off[2], 48 + 66 + 52 + 14);
});

test('o @ curto e o texto numa linha', () => {
  assert.equal(f.floatName('ana'), 'ana');
  assert.equal(f.floatName('um_nome_mesmo_muito_comprido'), 'um_nome_mesmo…');
  assert.equal(f.floatName('um_nome_mesmo_muito_comprido').length, 14);
  assert.equal(f.floatText('  olá\n\n que lindo  '), 'olá que lindo');
});

test('o visor mostra os balões só com comentários, fora da escrita e com a folha fechada, e tocar abre os comentários', () => {
  const v = read('app/stories/[username].tsx');
  assert.match(v, /const floatOn = ready && !!cur && cur\.commentCount > 0 && !cur\.commentsOff && !away && !background;/);
  assert.match(v, /queryKey: \['story-comments', cur\?\.id\], queryFn: \(\) => api\.storyComments\(cur!\.id\), enabled: floatOn, staleTime: 5 \* 60_000/);
  assert.match(v, /\{!typing && panel === null && floatOn && floatQ\.data\?\.length \? \(/);
  assert.match(v, /<StoryFloatComments key=\{cur\.id\} storyId=\{cur\.id\} comments=\{floatQ\.data\} col=\{floatCol\} active=\{!paused\} hidden=\{hideUi\} onOpen=\{\(\) => setPanel\('comments'\)\} \/>/);
  assert.match(v, /floatColumn\(frame\.cardW, frame\.cardH, ratio, /);
  // A mesma cache da folha dos comentários.
  assert.match(read('components/StoryParts.tsx'), /const key = \['story-comments', story\.id\];/);
  // Reduzir movimento: só desvanece.
  const c = read('components/StoryFloatComments.tsx');
  assert.match(c, /useReduceMotion\(\)/);
  assert.match(c, /if \(reduce\) \{ ty\.value = -y; scale\.value = 1; return; \}/);
});
