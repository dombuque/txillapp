// Estúdio nativo: a onda de um MP3 pelos ganhos dos frames (sem descodificar). O MP3 de teste é gerado aqui, bit a bit.
// Correr em apps/mobile:  node --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const m = await import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'studio', 'mp3Envelope.ts')).href);

/** Um frame MPEG-1 Layer III mono a 128 kbit/s e 44,1 kHz (417 bytes) com o `global_gain` dos dois granules. */
function frame(gain) {
  const size = Math.floor((144000 * 128) / 44100);
  const b = new Uint8Array(size);
  b[0] = 0xff; b[1] = 0xfb; b[2] = 0x90; b[3] = 0xc0; // sem CRC, 128 kbit/s, 44,1 kHz, mono
  let pos = 32 + 9 + 5 + 4; // main_data_begin, private, scfsi
  const put = (v, n) => { for (let k = n - 1; k >= 0; k--) { if ((v >> k) & 1) b[pos >> 3] |= 0x80 >> (pos & 7); pos++; } };
  for (let g = 0; g < 2; g++) { put(500, 12); put(100, 9); put(gain, 8); put(0, 59 - 29); }
  return b;
}
function mp3(gains, id3 = true) {
  const parts = [];
  if (id3) parts.push(Uint8Array.from([0x49, 0x44, 0x33, 3, 0, 0, 0, 0, 0, 10, ...new Array(10).fill(0)]));
  for (const g of gains) parts.push(frame(g));
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

test('lê o ganho de cada granule: 2 por frame, ~76,6 pontos por segundo, e a duração', () => {
  const gains = Array.from({ length: 40 }, (_, i) => (i < 20 ? 150 : 190));
  const e = m.mp3Envelope(mp3(gains));
  assert.ok(e);
  assert.equal(e.env.length, 80);
  assert.equal(Math.round(e.rate * 10) / 10, 76.6);
  assert.equal(Math.round(e.duration * 100) / 100, 1.04);
  // +40 no ganho são +60 dB (2^(40/4) = 1024 vezes mais).
  assert.equal(Math.round(e.env[60] / e.env[10]), 1024);
});

test('sem ID3, com lixo pelo meio; e o que não é MP3 dá null', () => {
  const ok = mp3([170, 170, 170, 170, 170, 170, 170, 170], false);
  const junk = new Uint8Array(ok.length + 30);
  junk.set(ok.slice(0, 417 * 4), 0);
  junk.set(new Uint8Array(30).fill(7), 417 * 4);
  junk.set(ok.slice(417 * 4), 417 * 4 + 30);
  assert.equal(m.mp3Envelope(junk).env.length, 16);
  assert.equal(m.looksLikeMp3(ok), true);
  assert.equal(m.mp3Envelope(new Uint8Array(5000).fill(3)), null);
  assert.equal(m.looksLikeMp3(Uint8Array.from([0x66, 0x74, 0x79, 0x70, 1, 2, 3, 4])), false);
});
