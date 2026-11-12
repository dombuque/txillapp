// Testes da assinatura que não vai duas vezes (src/lib/signedMedia.ts e os caminhos da câmara):
// - a TxillCam (TxCamera no site), o editor de fotos do telemóvel (PhotoEditor) e o estúdio de tchekas já gravam o logótipo
//   e o @ no ficheiro; ao «Guardar» um mimo o servidor voltava a assiná-lo, com outra letra e outra sombra, e o @ ficava
//   desfocado, como se estivesse a dobrar. Agora esses ficheiros vão com `signed: true` no pedido de envio;
// - fotos e vídeos da galeria não vão marcados (o servidor assina-os ao guardar, como antes);
// - num tcheka, as fotos da câmara entram no estúdio sem assinatura (`clean`): o estúdio assina o vídeo inteiro.
// Correr em apps/mobile:  node --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const m = await import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'signedMedia.ts')).href);
const read = (...p) => readFileSync(path.join(ROOT, 'src', ...p), 'utf8').replace(/\r\n/g, '\n');
/** O texto de uma função (do nome até à linha que a fecha, ao mesmo recuo). */
function fn(src, name) {
  const at = src.search(new RegExp(`\\n( *)(?:async )?function ${name}\\(`));
  assert.ok(at >= 0, `função ${name} não encontrada`);
  const indent = src.slice(at + 1).match(/^ */)[0];
  const end = src.indexOf(`\n${indent}}\n`, at + 1);
  return src.slice(at, end + indent.length + 2);
}

test('uploadRequest: `signed` só vai quando é verdade (sem ele o pedido fica como antes)', () => {
  assert.deepEqual(m.uploadRequest('image/jpeg', 10, 'public', true), { mime: 'image/jpeg', size: 10, purpose: 'public', signed: true });
  assert.deepEqual(m.uploadRequest('image/jpeg', 10, 'public'), { mime: 'image/jpeg', size: 10, purpose: 'public' });
  assert.deepEqual(m.uploadRequest('video/mp4', 99, 'chat', false), { mime: 'video/mp4', size: 99, purpose: 'chat' });
  assert.equal('signed' in m.uploadRequest('image/png', 1, 'public', undefined), false);
});

test('editedPhoto: a foto do editor do telemóvel vai sempre assinada', () => {
  assert.deepEqual(m.editedPhoto('file:///cache/txillapp-1.jpg'), { uri: 'file:///cache/txillapp-1.jpg', video: false, mime: 'image/jpeg', signed: true });
});

test('mimoParams / mimoFromParams: a câmara do "+" passa ao editor do mimo se a foto já vem assinada', () => {
  const cam = { uri: 'blob:x', video: false, mime: 'image/jpeg', signed: true };
  assert.deepEqual(m.mimoParams(cam), { uri: 'blob:x', video: '0', mime: 'image/jpeg', signed: '1' });
  assert.deepEqual(m.mimoFromParams(m.mimoParams(cam)), cam);
  // Da galeria: sem `signed`, nem na rota nem no editor.
  const gal = { uri: 'blob:y', video: true, mime: 'video/mp4' };
  assert.deepEqual(m.mimoParams(gal), { uri: 'blob:y', video: '1', mime: 'video/mp4' });
  assert.deepEqual(m.mimoFromParams(m.mimoParams(gal)), gal);
  // Rotas antigas (sem mime) e sem foto.
  assert.deepEqual(m.mimoFromParams({ uri: 'blob:z', video: '1' }), { uri: 'blob:z', video: true, mime: 'video/mp4' });
  assert.equal(m.mimoFromParams({}), null);
});

test('envio: uploadMedia e a fila de publicação mandam `signed` pelo uploadRequest', () => {
  const api = read('lib', 'api.ts');
  assert.match(api, /export async function uploadMedia\(uri: string, mime: string, purpose: 'public' \| 'chat' = 'chat', onWait\?: \(\) => void, signed\?: boolean\)/);
  assert.match(api, /post\(uploadRequest\(mime, blob\.size, purpose, signed\)\)/);
  const q = read('lib', 'publishQueue.ts');
  assert.match(q, /export interface PublishAsset \{ uri: string; mime: string; video: boolean; signed\?: boolean \}/);
  assert.match(q, /JSON\.stringify\(uploadRequest\(mime, blob\.size, 'public', a\.signed\)\)/);
});

test('TxCamera (site): a foto aceite sai com signed: true; o vídeo gravado (sem assinatura) não', () => {
  const cam = read('components', 'TxCamera.tsx');
  assert.match(cam, /export interface Shot \{[^}]*signed\?: boolean; clean\?: string \}/);
  const accept = fn(cam, 'acceptReview');
  assert.match(accept, /onShot\(blob \? \{ uri: URL\.createObjectURL\(blob\), video: false, mime: 'image\/jpeg', signed: true,/);
  // Num tcheka (keepClean) também a cópia sem assinatura, desenhada com sign = false.
  assert.match(accept, /renderEdit\(src, e, sign\)/);
  assert.match(accept, /blob && keepClean \? await jpeg\(false\) : null/);
  // O vídeo segue tal como foi gravado (`r`), sem `signed`.
  assert.match(accept, /setReview\(null\); setTool\(null\); onShot\(r\);/);
});

test('telemóvel: as fotos do editor (PhotoEditor) vão assinadas; os vídeos e a galeria não', () => {
  const nc = read('components', 'NativeCamera.tsx');
  const edited = nc.match(/onShot\(editedPhoto\(file\)\)/g) ?? [];
  assert.equal(edited.length, 2, 'os dois editores da câmara nativa');
  assert.doesNotMatch(nc, /onShot\(\{ uri: file, video: false, mime: 'image\/jpeg' \}\)/);
  assert.match(fn(nc, 'picked'), /if \(s\.video\) onShot\(s\);/);
  assert.doesNotMatch(nc, /signed: true/);
  // O editor desenha sempre a assinatura na foto final.
  const pe = read('components', 'PhotoEditor.tsx');
  assert.match(fn(pe, 'drawEdit'), /drawSign\(canvas, W, H, font, username\);/);
});

test('estúdio de tchekas: o vídeo sai assinado e as fotos da câmara entram sem a assinatura delas', () => {
  const studio = read('components', 'TchekaStudio.tsx');
  assert.match(studio, /stampTxillapp\(g, W, H, username\);/);
  assert.match(studio, /onDone\(\{ uri: URL\.createObjectURL\(blob\), video: true, mime: blob\.type \|\| 'video\/mp4', durationMs: [^}]*, signed: true \}, music\)/);
  const nw = read('app', '(tabs)', 'new.tsx');
  assert.match(nw, /clips=\{assets\.map\(\(a\) => \(\{ uri: a\.clean \?\? a\.uri,/);
  assert.match(nw, /keepClean=\{kindSel === 'tcheka'\}/);
  assert.match(nw, /onDone=\{\(s, m\) => \{ setAssets\(\[\{ uri: s\.uri, video: true, mime: s\.mime, durationMs: s\.durationMs, tags: \[\], signed: s\.signed \}\]\)/);
});

test('nova publicação: a câmara passa `signed` até ao envio e ao mimo; a galeria não o põe', () => {
  const nw = read('app', '(tabs)', 'new.tsx');
  const shot = fn(nw, 'shot');
  assert.match(shot, /signed: s\.signed \}/); // vídeo
  assert.match(shot, /signed: s\.signed, clean: s\.clean \}/); // foto
  assert.match(fn(nw, 'routeByKind'), /params: mimoParams\(s\)/);
  assert.match(fn(nw, 'submit'), /assets: assets\.map\(\(a\) => \(\{ uri: a\.uri, mime: a\.mime, video: a\.video, signed: a\.signed \}\)\)/);
  assert.match(nw, /shot\(editedPhoto\(file\)\)/);
  for (const name of ['addFiles', 'pickMany', 'add']) assert.doesNotMatch(fn(nw, name), /signed/, `${name} é da galeria`);
  // Cortada para o carrossel, deixa de contar como assinada.
  assert.match(fn(nw, 'fitCarousel'), /ratio: target, signed: undefined \}/);
});

test('editor do mimo: câmara do site e do "+" com signed; galeria e câmara do sistema sem; o envio leva-o', () => {
  const st = read('app', 'stories', 'new.tsx');
  assert.match(st, /useState<Asset \| null>\(\(\) => mimoFromParams\(given\)\)/);
  assert.match(st, /onShot=\{\(s: Shot\) => setAsset\(\{ uri: s\.uri, video: s\.video, mime: s\.mime, signed: s\.signed \}\)\}/);
  assert.match(st, /uploadMedia\(src, mime, 'public', \(\) => stage\('prepare'\), a\.signed\)/);
  assert.doesNotMatch(fn(st, 'pick'), /signed/);
  const fromFiles = st.slice(st.indexOf('const fromFiles'), st.indexOf('};', st.indexOf('const fromFiles')));
  assert.doesNotMatch(fromFiles, /signed/);
});
