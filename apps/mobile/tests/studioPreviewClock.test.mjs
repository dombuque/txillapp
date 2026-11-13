// Estúdio nativo: o relógio da pré-visualização (um relógio só para os vídeos, a música, a voz-off e as camadas).
// Correr em apps/mobile:  node --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const k = await import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'studio', 'previewClock.ts')).href);

test('tocar, pausar, saltar e chegar ao fim', () => {
  let c = k.makeClock(20, 0);
  assert.equal(k.clockTime(c, 5000), 0, 'parado não anda');
  c = k.clockPlay(c, 1000);
  assert.equal(k.clockTime(c, 3500), 2.5);
  c = k.clockPause(c, 4000);
  assert.equal(k.clockTime(c, 9000), 3);
  c = k.clockSeek(c, 9000, 7);
  assert.equal(k.clockTime(c, 12000), 7);
  c = k.clockPlay(c, 12000);
  assert.equal(k.clockEnded(c, 24000), false);
  assert.equal(k.clockEnded(c, 25000), true);
  assert.equal(k.clockTime(c, 40000), 20, 'nunca passa do fim');
  c = k.clockPlay(k.clockPause(c, 40000), 41000);
  assert.equal(k.clockTime(c, 41000), 0, 'no fim, tocar recomeça do princípio');
});

test('a sequência encolhe: o relógio fica no fim novo e pára', () => {
  let c = k.clockPlay(k.makeClock(20, 0), 0, 15);
  c = k.clockResize(c, 1000, 10);
  assert.equal(k.clockTime(c, 2000), 10);
  assert.equal(c.playing, false);
  c = k.clockResize(k.clockPlay(k.makeClock(20, 0), 0, 3), 1000, 30);
  assert.equal(c.playing, true);
  assert.equal(k.clockTime(c, 1000), 4);
});

test('o clipe no ecrã, a transição a entrar e o zoom das fotos', () => {
  const segs = [{ start: 0, dur: 3 }, { start: 3, dur: 2 }, { start: 5, dur: 4 }];
  assert.deepEqual(k.segAt(segs, 0), { index: 0, local: 0 });
  assert.deepEqual(k.segAt(segs, 3), { index: 1, local: 0 }, 'na junção conta o seguinte');
  assert.deepEqual(k.segAt(segs, 99), { index: 2, local: 4 });
  assert.equal(k.segAt([], 1).index, -1);
  assert.equal(k.transitionAt(0.2, { type: 'fundido', dur: 0.5 }, 0), null, 'no primeiro não há');
  assert.deepEqual(k.transitionAt(0.25, { type: 'fundido', dur: 0.5 }, 1), { type: 'fundido', p: 0.5 });
  assert.equal(k.transitionAt(0.6, { type: 'fundido', dur: 0.5 }, 1), null);
  assert.equal(k.transitionAt(0.1, { type: 'corte', dur: 0.5 }, 1), null);
  assert.deepEqual(k.photoZoom(1.5, 3), { scale: 1.035, x: 0.5, y: 0.5 });
  assert.deepEqual(k.photoZoom(1.5, 3, { freeze: { from: 'a', at: 1 } }), { scale: 1, x: 0.5, y: 0.5 });
  assert.deepEqual(k.photoZoom(3, 3, { focus: { x: 0.3, y: 0.2, from: 1.1, to: 1.3 } }), { scale: 1.3, x: 0.3, y: 0.2 });
});

test('onde a música e a voz-off deviam estar, e quando um leitor se afastou', () => {
  assert.equal(k.musicPosition(2, 30000, 180), 32);
  assert.equal(k.musicPosition(10, 175000, 180), 5, 'acaba e recomeça do princípio da faixa');
  assert.equal(k.musicPosition(3, 1000, null), 4);
  const v = { at: 2, duration: 4, skip: 0.3 };
  assert.equal(k.voicePosition(1, v, 20), null);
  assert.equal(k.voicePosition(3, v, 20), 1.3);
  assert.equal(k.voicePosition(6.5, v, 20), null);
  assert.equal(k.voicePosition(4.5, v, 4), null, 'para lá do fim da tcheka não se ouve');
  assert.equal(k.drift(3, 3.2), 'ok');
  assert.equal(k.drift(3, 3.4), 'seek');
  assert.equal(k.drift(3, 3.4, 2), 'ok', 'a 2× a folga é maior');
  assert.equal(k.drift(3, NaN), 'seek');
});

test('os efeitos sonoros de cada tique, os volumes e o inverso aos saltos', () => {
  const cues = [{ at: 1 }, { at: 2 }, { at: 2.5 }];
  assert.deepEqual(k.cuesBetween(cues, 1.9, 2.6), [{ at: 2 }, { at: 2.5 }]);
  assert.deepEqual(k.cuesBetween(cues, 2.6, 1), [], 'para trás, nenhum');
  assert.deepEqual(k.cuesBetween(cues, 0, 5), [], 'um salto grande não dispara tudo');
  assert.equal(k.channelVolume(0.8, 0.5, 0.3), 0.12);
  assert.equal(k.channelVolume(2, 1, 1), 1);
  assert.equal(k.reverseStep(1.23, 8), 1.25);
  assert.equal(k.clockKey(7.9, 20.2), '7/20');
});
