// Estúdio nativo: os efeitos de voz a ouvir na pré-visualização (preparados no servidor).
// Correr em apps/mobile:  node --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const P = await import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'studio', 'voicePreview.ts')).href);
const J = await import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'studio', 'composeJob.ts')).href);

const voice = { id: 'v1', uri: 'file:///d/voz.m4a', mime: 'audio/mp4', fx: 'robo', duration: 8 };
const clip = (media, o = {}) => ({ media, uri: `file:///d/${media}.mp4`, mime: 'video/mp4', video: true, from: 0, len: 5, audible: true, ...o });

test('a voz-off com efeito vai com a chave do envio da montagem', () => {
  const t = P.previewTargets({ voice, origFx: 'normal', clips: [clip('a')] });
  assert.deepEqual(t, [{ key: 'voz:v1', uri: voice.uri, mime: 'audio/mp4', kind: 'voice', effect: 'robo' }]);
  // A mesma chave que o «Seguinte» usa: o envio aproveita-se.
  const files = J.uploadFiles([], { id: 'v1', uri: voice.uri, mime: 'audio/mp4' });
  assert.equal(files[0].key, t[0].key);
  assert.equal(files[0].kind, 'voice');
});

test('sem efeito, nada; voz sem ficheiro ou com mais de um minuto, nada', () => {
  assert.deepEqual(P.previewTargets({ voice: { ...voice, fx: 'normal' }, origFx: 'normal', clips: [clip('a')] }), []);
  assert.deepEqual(P.previewTargets({ voice: { ...voice, uri: undefined }, origFx: 'normal', clips: [] }), []);
  assert.deepEqual(P.previewTargets({ voice: { ...voice, duration: 75 }, origFx: 'normal', clips: [] }), []);
});

test('o som original: um por media, só os vídeos com som e com o corte no primeiro minuto', () => {
  const t = P.previewTargets({
    voice: null,
    origFx: 'eco',
    clips: [clip('a'), clip('a', { from: 2 }), clip('b', { audible: false }), clip('c', { from: 50, len: 15 }), { ...clip('d'), video: false }, clip('e')],
  });
  assert.deepEqual(t.map((x) => [x.key, x.kind, x.effect]), [['a', 'video', 'eco'], ['e', 'video', 'eco']]);
  // A chave é a do envio da montagem (a `media` do clipe).
  assert.equal(J.uploadFiles([{ media: 'a', uri: 'file:///d/a.mp4', mime: 'video/mp4', video: true }])[0].key, 'a');
});

test('as notas quando não dá', () => {
  assert.deepEqual(P.failNote(0), { note: 'Sem rede: ouve-se sem o efeito.', retry: true });
  assert.equal(P.failNote(undefined).retry, true);
  assert.equal(P.failNote(422, 'Este vídeo não tem som.').note, 'Este vídeo não tem som.');
  assert.equal(P.failNote(422).retry, false);
  assert.match(P.failNote(429).note, /última hora/);
  assert.match(P.failNote(500).note, /ouve-se sem ele/);
});

test('o estado do botão: a preparar enquanto falta algum; a nota do que falhou', () => {
  assert.deepEqual(P.groupState([]), { loading: false, note: null });
  assert.deepEqual(P.groupState([undefined]), { loading: true, note: null });
  assert.deepEqual(P.groupState([{ state: 'ready', file: 'x' }, { state: 'loading' }]), { loading: true, note: null });
  assert.deepEqual(P.groupState([{ state: 'ready', file: 'x' }, { state: 'failed', note: 'Sem rede: ouve-se sem o efeito.', retry: true }]), { loading: false, note: 'Sem rede: ouve-se sem o efeito.' });
});

test('o ficheiro da cache muda com o ficheiro e com o efeito', () => {
  const a = P.cacheName({ key: 'voz:v1', uri: voice.uri, effect: 'robo' });
  assert.match(a, /^txill-vfx-robo-[0-9a-f]{16}\.m4a$/);
  assert.equal(a, P.cacheName({ key: 'voz:v1', uri: voice.uri, effect: 'robo' }));
  assert.notEqual(a, P.cacheName({ key: 'voz:v1', uri: voice.uri, effect: 'eco' }));
  assert.notEqual(a, P.cacheName({ key: 'voz:v2', uri: 'file:///d/outra.m4a', effect: 'robo' }));
});
