// Testes de "não perder o trabalho sem aviso" (src/lib/discardGuard.ts):
// - o editor do mimo fechava com o × ou com o voltar do Android e perdia a foto, a legenda, os stickers e a música;
// - na câmara, o voltar do Android na pré-visualização de um vídeo acabado de gravar deitava-o fora logo.
// Correr em apps/mobile:  node --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const d = await import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'discardGuard.ts')).href);
const read = (...p) => readFileSync(path.join(ROOT, 'src', ...p), 'utf8');

test('mimoEdited: legenda (com texto a sério), stickers ou música contam', () => {
  assert.equal(d.mimoEdited({ caption: '', stickers: 0, music: false }), false);
  assert.equal(d.mimoEdited({ caption: '   ', stickers: 0, music: false }), false);
  assert.equal(d.mimoEdited({ caption: 'bora', stickers: 0, music: false }), true);
  assert.equal(d.mimoEdited({ caption: '', stickers: 2, music: false }), true);
  assert.equal(d.mimoEdited({ caption: '', stickers: 0, music: true }), true);
});

test('os textos da pergunta seguem o resto da app (título com "?", um botão para ficar e um para descartar)', () => {
  for (const [k, v] of [['mimo', false], ['mimo', true], ['retake', false], ['video', false]]) {
    const t = d.discardCopy(k, v);
    assert.ok(t.title.endsWith('?'), k);
    assert.ok(t.message.length > 10 && t.keep && t.discard, k);
  }
  assert.match(d.discardCopy('mimo', true).message, /vídeo/);
  assert.match(d.discardCopy('mimo', false).message, /foto/);
});

test('o editor do mimo pergunta antes de fechar (× e voltar do Android) e antes de tirar outra com coisas juntas', () => {
  const src = read('app', 'stories', 'new.tsx');
  assert.match(src, /<Pressable onPress=\{confirmClose\}[^>]*accessibilityLabel="Cancelar"/);
  assert.match(src, /BackHandler\.addEventListener\('hardwareBackPress'/);
  assert.match(src, /tool\('camera', 'Tirar outra', \(\) => confirmRetake\(/);
  assert.match(src, /style: 'destructive', onPress: onClose/);
});

test('a câmara pergunta antes de deitar fora um vídeo gravado com o voltar', () => {
  const src = read('components', 'NativeCamera.tsx');
  assert.doesNotMatch(src, /if \(review\) \{ discard\(review\.uri\); setReview\(null\); return true; \}/);
  assert.match(src, /discardCopy\('video'\)/);
});
