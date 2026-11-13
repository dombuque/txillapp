// Estúdio das tchekas: desfazer e refazer (até 50 passos), um gesto conta como um passo, e acertos que não são passos.
// Correr em apps/mobile:  node --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const h = await import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'studio', 'history.ts')).href);

test('desfazer e refazer', () => {
  let s = h.initHistory('a');
  assert.equal(h.canUndo(s), false);
  s = h.pushHistory(s, 'b');
  s = h.pushHistory(s, 'c');
  assert.equal(s.present, 'c');
  s = h.undo(s);
  assert.equal(s.present, 'b');
  assert.equal(h.canRedo(s), true);
  s = h.undo(s);
  assert.equal(s.present, 'a');
  assert.equal(h.undo(s), s, 'sem mais para desfazer, fica igual');
  s = h.redo(s);
  s = h.redo(s);
  assert.equal(s.present, 'c');
  assert.equal(h.redo(s), s);
});

test('uma mudança nova depois de desfazer perde o refazer', () => {
  let s = h.pushHistory(h.pushHistory(h.initHistory(1), 2), 3);
  s = h.undo(s);
  s = h.pushHistory(s, 9);
  assert.deepEqual(s.past, [1, 2]);
  assert.equal(s.present, 9);
  assert.deepEqual(s.future, []);
});

test('guarda até 50 passos', () => {
  assert.equal(h.HISTORY_LIMIT, 50);
  let s = h.initHistory(0);
  for (let i = 1; i <= 80; i++) s = h.pushHistory(s, i);
  assert.equal(s.past.length, 50);
  assert.equal(s.past[0], 30);
  let n = 0;
  while (h.canUndo(s)) { s = h.undo(s); n++; }
  assert.equal(n, 50);
  assert.equal(s.present, 30);
});

test('o mesmo estado não conta; um gesto inteiro é um passo só', () => {
  const s0 = h.initHistory({ x: 1 });
  assert.equal(h.pushHistory(s0, s0.present), s0);
  let s = h.pushHistory(s0, { x: 2 });
  s = h.pushHistory(s, { x: 3 }, { merge: true });
  s = h.pushHistory(s, { x: 4 }, { merge: true });
  assert.equal(s.past.length, 1);
  assert.deepEqual(s.present, { x: 4 });
  assert.deepEqual(h.undo(s).present, { x: 1 });
});

test('acertos em todos os estados não são passos', () => {
  let s = h.pushHistory(h.pushHistory(h.initHistory([{ k: 'a' }]), [{ k: 'a' }, { k: 'b' }]), [{ k: 'b' }]);
  const before = s.past.length;
  s = h.mapAll(s, (l) => l.map((c) => (c.k === 'a' ? { ...c, audio: true } : c)));
  assert.equal(s.past.length, before);
  assert.equal(s.past[0][0].audio, true);
  assert.equal(h.undo(s).present[0].audio, true, 'o som que se descobriu fica também ao desfazer');
  assert.equal(h.mapAll(s, (l) => l), s, 'sem mudanças, o mesmo histórico');
});

test('o estúdio tem ↶ ↷ no topo e os atalhos (Ctrl+Z, Ctrl+Shift+Z)', () => {
  const studio = readFileSync(path.join(ROOT, 'src', 'components', 'TchekaStudio.tsx'), 'utf8');
  assert.match(studio, /accessibilityLabel="Desfazer"/);
  assert.match(studio, /accessibilityLabel="Refazer"/);
  const keys = readFileSync(path.join(ROOT, 'src', 'lib', 'studio', 'keys.ts'), 'utf8');
  assert.match(keys, /'undo'/);
  assert.match(keys, /'redo'/);
});
