// "Ver uma vez" aberta (src/lib/onceView.ts e components/OnceViewer): antes tudo o que tinha endereço era mostrado como
// imagem, e o vídeo e a voz de ver uma vez abriam um ecrã preto (e a mensagem já ficava dada por vista).
// Correr em apps/mobile:  node --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const o = await import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'onceView.ts')).href);
const read = (f) => readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');

test('cada tipo no seu visor', () => {
  assert.equal(o.onceView({ kind: 'image', url: 'https://x/a.jpg', body: '' }), 'image');
  assert.equal(o.onceView({ kind: 'video', url: 'https://x/a.mp4', body: '' }), 'video');
  assert.equal(o.onceView({ kind: 'voice', url: 'https://x/a.m4a', body: '' }), 'voice');
  assert.equal(o.onceView({ kind: 'text', url: null, body: 'segredo' }), 'text');
  assert.equal(o.onceView({ kind: 'video', url: null, body: '' }), 'text', 'sem endereço não há o que tocar');
});

test('as duas conversas usam o visor com o tipo que o servidor devolve', () => {
  for (const f of ['src/app/messages/[username].tsx', 'src/app/messages/g/[id].tsx']) {
    const s = read(f);
    assert.match(s, /setViewing\(\{ kind: r\.kind, url: abs\(r\.mediaUrl\) \?\? null, body: r\.body \}\)/, f);
    assert.match(s, /<OnceViewer content=\{viewing\} onClose=\{\(\) => setViewing\(null\)\} \/>/, f);
  }
  const v = read('src/components/OnceViewer.tsx');
  assert.match(v, /<ChatVideoPlayer url=\{content\.url!\} autoPlay inModal \/>/);
  assert.match(v, /onRequestClose=\{onClose\}/, 'o botão de voltar do Android fecha');
});
