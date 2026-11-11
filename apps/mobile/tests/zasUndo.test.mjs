// Testes da janela para desfazer um Zás (src/components/zas/zasUndo.ts): a contagem 6…1, a barra a esvaziar e a regra
// de só criar o Zás no servidor quando a janela acaba (assim ninguém o recebe durante esses 6 segundos).
// Correr em apps/mobile:  node --experimental-strip-types --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const U = await import(pathToFileURL(path.join(ROOT, 'src', 'components', 'zas', 'zasUndo.ts')).href);

test('a janela é de 6 segundos', () => {
  assert.equal(U.ZAS_UNDO_MS, 6000);
});

test('contagem: 6 logo ao enviar, desce de segundo a segundo, 0 no fim', () => {
  assert.equal(U.undoSecondsLeft(1000, 1000), 6);
  assert.equal(U.undoSecondsLeft(1000, 1001), 6);
  assert.equal(U.undoSecondsLeft(1000, 2000), 5);
  assert.equal(U.undoSecondsLeft(1000, 6500), 1);
  assert.equal(U.undoSecondsLeft(1000, 6999), 1);
  assert.equal(U.undoSecondsLeft(1000, 7000), 0);
  assert.equal(U.undoSecondsLeft(1000, 90000), 0);
  assert.equal(U.undoSecondsLeft(1000, 0), 6, 'relógio para trás não passa de 6');
});

test('barra: cheia ao enviar, a meio aos 3 s, vazia no fim', () => {
  assert.equal(U.undoFraction(0, 0), 1);
  assert.equal(U.undoFraction(0, 3000), 0.5);
  assert.equal(U.undoFraction(0, 6000), 0);
  assert.equal(U.undoFraction(0, 9000), 0);
  assert.equal(U.undoFraction(0, -500), 1);
  assert.equal(U.undoFraction(0, 100, 0), 0);
});

test('só se cria no servidor depois da janela (mesmo que a subida seja rápida)', () => {
  assert.equal(U.waitBeforeCreate(0, 800), 5200);
  assert.equal(U.waitBeforeCreate(0, 6000), 0);
  assert.equal(U.waitBeforeCreate(0, 12000), 0);
});

test('esperar a janela: acaba no fim, ou logo ao desfazer', async () => {
  const t0 = Date.now();
  assert.equal(await U.waitUndoWindow(t0, () => false, 120, 20), false);
  assert.ok(Date.now() - t0 >= 110, 'esperou a janela toda');
  let undone = false;
  setTimeout(() => { undone = true; }, 40);
  const t1 = Date.now();
  assert.equal(await U.waitUndoWindow(t1, () => undone, 5000, 10), true);
  assert.ok(Date.now() - t1 < 1000, 'acordou logo ao desfazer');
});
