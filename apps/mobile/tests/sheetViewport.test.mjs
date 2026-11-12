// A folha (Sheet) na web com o teclado aberto: no iPhone o teclado tapa a página sem a encolher, por isso a folha passa a
// viver só na zona visível (visualViewport) e o campo dos comentários fica à vista (src/lib/sheetViewport.ts, Sheet.tsx).
// Correr em apps/mobile:  node --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const m = await import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'sheetViewport.ts')).href);

test('sheetViewport: só conta como teclado aberto quando a zona visível é bem mais baixa do que a janela', () => {
  assert.equal(m.sheetViewport(null, 800), null, 'nativo: sem visualViewport');
  assert.equal(m.sheetViewport({ top: 0, height: 800 }, 800), null, 'sem teclado');
  assert.equal(m.sheetViewport({ top: 0, height: 700 }, 800), null, 'barra do Safari a mexer: não é teclado');
  assert.deepEqual(m.sheetViewport({ top: 120, height: 420 }, 844), { top: 120, height: 420 }, 'iPhone com teclado');
  assert.deepEqual(m.sheetViewport({ top: -3, height: 420 }, 844), { top: 0, height: 420 }, 'elástico do Safari não põe a folha acima do topo');
});

test('sheetHeights: sem teclado 78% / 85% do ecrã; com teclado nunca maior do que a zona visível', () => {
  assert.deepEqual(m.sheetHeights(844, null), { full: 658, max: 717 });
  assert.deepEqual(m.sheetHeights(844, { top: 0, height: 420 }), { full: 412, max: 412 });
  assert.deepEqual(m.sheetHeights(844, { top: 0, height: 760 }), { full: 658, max: 717 });
});

test('a Sheet usa a zona visível só na web e mantém a altura do teclado do nativo (sem a somar duas vezes)', () => {
  const s = readFileSync(path.join(ROOT, 'src', 'components', 'Sheet.tsx'), 'utf8');
  assert.match(s, /const box = Platform\.OS === 'web' && typeof window !== 'undefined' \? sheetViewport\(vv, window\.innerHeight, window\.innerWidth\) : null;/);
  assert.match(s, /box && \{ position: 'absolute', left: 0, right: 0, top: box\.top, height: box\.height, flex: 0 \}/);
  // Com a zona visível, o teclado já está fora da conta: não se soma o kb (que no web é sempre 0) nem a barra de baixo.
  assert.match(s, /paddingBottom: box \? 12 : Math\.max\(insets\.bottom, 16\) \+ \(kb \? kb - insets\.bottom : 0\)/);
  assert.match(s, /full \? \{ height: heights\.full \} : \{ maxHeight: heights\.max \}/);
});
