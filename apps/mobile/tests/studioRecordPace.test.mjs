// Estúdio do site: o ritmo dos frames da gravação (lib/studio/recordPace.ts).
// Correr em apps/mobile:  node --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const R = await import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'studio', 'recordPace.ts')).href);

/** Tiques de um ecrã de `hz` com até `jitter` ms de atraso (o fio ocupado), durante `s` segundos. */
function ticks(hz, jitter, s, seed = 3) {
  let r = seed;
  const rnd = () => ((r = (r * 1103515245 + 12345) % 2147483648) / 2147483648);
  return Array.from({ length: Math.round(hz * s) }, (_, k) => 1000 + (k * 1000) / hz + rnd() * jitter);
}
/** O ciclo antigo: desenha se já passaram 30 ms desde o último desenho. */
function oldDraws(ts) {
  let last = 0;
  const out = [];
  for (const now of ts) if (now - last >= 30) { last = now; out.push(now); }
  return out;
}
function newDraws(ts) {
  let p = R.makePacer(ts[0]);
  const out = [];
  for (const now of ts) { const k = R.paceTick(p, now); p = k.pacer; if (k.frame !== null) out.push({ now, frame: k.frame }); }
  return out;
}
const gapsOf = (xs) => xs.slice(1).map((x, i) => x - xs[i]);

test('60 Hz com 6 ms de atraso: o ciclo antigo misturava frames de 33 e 50 ms; o novo fica na grelha de 30 fps', () => {
  const ts = ticks(60, 6, 10);
  const old = gapsOf(oldDraws(ts));
  const oldOff = old.filter((g) => g > 40).length;
  assert.ok(oldOff > 20, `antigo: ${oldOff} frames de ~50 ms em 10 s`);
  const nw = newDraws(ts);
  // Cada frame desenhado tem o seu instante na grelha (n / 30): sem frames repetidos nem saltados.
  const frames = nw.map((d) => d.frame);
  assert.ok(frames.every((f, i) => i === 0 || f === frames[i - 1] + 1), 'frames seguidos');
  assert.ok(Math.abs(frames.length - 300) <= 1, `30 fps (${frames.length} em 10 s)`);
});

test('120 Hz e 90 Hz: também 30 fps certos', () => {
  for (const hz of [90, 120]) {
    const nw = newDraws(ticks(hz, 3, 10));
    assert.ok(Math.abs(nw.length - 300) <= 1, `${hz} Hz: ${nw.length}`);
    assert.ok(nw.every((d, i) => i === 0 || d.frame === nw[i - 1].frame + 1));
  }
});

test('uma página atrasada salta para o frame certo (não acumula) e uma espera desloca a grelha', () => {
  let p = R.makePacer(0);
  let k = R.paceTick(p, 0);
  assert.equal(k.frame, 0);
  k = R.paceTick(k.pacer, 200); // 200 ms sem tiques
  assert.equal(k.frame, 6);
  assert.equal(k.skipped, 5);
  p = R.shiftPacer(k.pacer, 1000);
  assert.equal(R.paceTick(p, 1100).frame, null, 'a espera não conta como atraso');
  assert.equal(R.paceTick(p, 1000 + 7 * (1000 / 30)).frame, 7);
  assert.equal(R.frameTime(p, 2, 15), 2.5);
});

test('o formato: H.264 primeiro, VP8 antes do VP9; o débito chega para a conversão do servidor', () => {
  assert.equal(R.pickRecorderType((t) => t === 'video/webm;codecs=vp9,opus' || t === 'video/webm;codecs=vp8,opus'), 'video/webm;codecs=vp8,opus');
  assert.equal(R.pickRecorderType((t) => t.startsWith('video/mp4')), 'video/mp4;codecs=avc1,mp4a.40.2');
  assert.equal(R.pickRecorderType(() => false), '');
  assert.equal(R.pickRecorderType(() => { throw new Error('x'); }), '');
  assert.ok(R.REC_BITRATE >= 6_000_000);
});

test('o estúdio do site usa a grelha e pede cada frame ao gravador', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src', 'components', 'TchekaStudio.tsx'), 'utf8');
  assert.match(src, /paceTick\(/);
  assert.match(src, /captureStream\?\.\(0\)/);
  assert.match(src, /requestFrame/);
  assert.ok(!/nowMs - lastDraw >= 30/.test(src));
});
