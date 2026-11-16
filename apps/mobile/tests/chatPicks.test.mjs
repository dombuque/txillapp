// Enviar várias fotos e vídeos de uma vez nas conversas (src/lib/chatPicks.ts, ChatComposer e GroupComposer).
// Correr em apps/mobile:  node --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const c = await import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'chatPicks.ts')).href);
const read = (...p) => readFileSync(path.join(ROOT, 'src', ...p), 'utf8');

test('os escolhidos: pela ordem, foto ou vídeo, com tipo por omissão e no máximo 10', () => {
  const got = c.chatPicks([
    { uri: 'a', type: 'image', mimeType: 'image/png' },
    { uri: 'b', type: 'video' },
    { uri: '', type: 'image' },
    null,
    { uri: 'd', type: 'image' },
    { uri: 'e', mimeType: 'video/quicktime' },
  ]);
  assert.deepEqual(got, [
    { uri: 'a', mime: 'image/png', video: false },
    { uri: 'b', mime: 'video/mp4', video: true },
    { uri: 'd', mime: 'image/jpeg', video: false },
    { uri: 'e', mime: 'video/quicktime', video: true },
  ]);
  const many = Array.from({ length: 14 }, (_, i) => ({ uri: `u${i}`, type: 'image' }));
  assert.equal(c.chatPicks(many).length, c.CHAT_PICK_MAX);
  assert.equal(c.CHAT_PICK_MAX, 10);
  assert.deepEqual(c.chatPicks(undefined), []);
});

test('os avisos: «A enviar 2 de 5…» e o que falhou', () => {
  assert.equal(c.sendingLabel(0, 1), 'A enviar…');
  assert.equal(c.sendingLabel(1, 5), 'A enviar 2 de 5…');
  assert.equal(c.sendingLabel(9, 5), 'A enviar 5 de 5…');
  assert.equal(c.failedLabel(0, 5), '');
  assert.equal(c.failedLabel(1, 5), 'Não consegui enviar 1 de 5');
  assert.equal(c.failedLabel(3, 5), 'Não consegui enviar 3 de 5');
  assert.equal(c.failedLabel(5, 5), 'Não consegui enviar nenhum');
});

test('conversas e grupos: a galeria deixa escolher vários e envia um a um', () => {
  for (const f of ['ChatComposer.tsx', 'GroupComposer.tsx']) {
    const s = read('components', f);
    assert.match(s, /allowsMultipleSelection: true, selectionLimit: CHAT_PICK_MAX, orderedSelection: true/, f);
    assert.match(s, /async function sendMany\(picks: ChatPick\[\]\)/, f);
    assert.match(s, /body: i === 0 \? caption : undefined/, f);
    assert.match(s, /sendingLabel\(progress\.done, progress\.total\)/, f);
    // A câmara continua a ser uma foto ou um vídeo de cada vez.
    assert.match(s, /launchCameraAsync\(\{ mediaTypes: \['images', 'videos'\], quality: 0\.8, videoMaxDuration: 30 \}\)/, f);
  }
});
