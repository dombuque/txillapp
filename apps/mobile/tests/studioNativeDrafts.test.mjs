// Estúdio nativo: os rascunhos em ficheiros (draft.json + os ficheiros dos clipes copiados), com a loja de sempre.
// Correr em apps/mobile:  node --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mod = (x) => import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'studio', x)).href);
const n = await mod('nativeDraftFiles.ts');
const d = await mod('drafts.ts');
const p = await mod('project.ts');

const ROOTDIR = 'doc://estudio';
const store = (fs) => d.createDraftStore(n.fileDraftBackend(fs, ROOTDIR), { readMedia: async (u) => u, toUrl: (v) => String(v) });
const ids = () => { let k = 0; return () => `c${++k}`; };

test('guarda o projeto e copia cada ficheiro uma vez; ao abrir, os clipes apontam para as cópias', async () => {
  const fs = n.memoryFs({ 'file:///cam/a.mp4': 'VIDEO', 'file:///cam/b.jpg': 'FOTO', 'file:///tmp/voz.m4a': 'VOZ' });
  const s = store(fs);
  const g = ids();
  const v = p.makeClip({ uri: 'file:///cam/a.mp4', video: true, mime: 'video/mp4', durationMs: 6000 }, g);
  const f = p.makeClip({ uri: 'file:///cam/b.jpg', video: false, mime: 'image/jpeg' }, g);
  const dup = { ...v, key: 'c9' }; // uma cópia do mesmo ficheiro
  await s.save({ id: 'st-1', clips: [v, f, dup], extra: [{ key: 'voz', uri: 'file:///tmp/voz.m4a', mime: 'audio/mp4' }], settings: { coverAt: 1 }, seconds: 9 });
  assert.equal(fs.copies, 3);
  await s.save({ id: 'st-1', clips: [v, f, dup], settings: { coverAt: 2 }, seconds: 9 });
  assert.equal(fs.copies, 3, 'os ficheiros já guardados não se copiam outra vez');
  assert.equal(fs.files.has('doc://estudio/st-1/m-voz.m4a'), false, 'a voz-off que saiu do projeto sai da pasta');
  const back = await s.load('st-1');
  assert.equal(back.clips.length, 3);
  assert.equal(back.clips[0].uri, 'doc://estudio/st-1/m-c1.mp4');
  assert.equal(back.clips[1].uri, 'doc://estudio/st-1/m-c2.jpg');
  assert.equal(back.draft.settings.coverAt, 2);
  // A lista mostra a foto copiada como miniatura.
  const list = await s.list();
  assert.equal(list[0].poster, 'doc://estudio/st-1/m-c2.jpg');
});

test('um rascunho reaberto guarda-se sem copiar os ficheiros para cima deles próprios', async () => {
  const fs = n.memoryFs({ 'file:///a.jpg': 'A' });
  const s = store(fs);
  const c = p.makeClip({ uri: 'file:///a.jpg', video: false, mime: 'image/jpeg' }, ids());
  await s.save({ id: 'r', clips: [c] });
  const s2 = store(fs); // outra sessão da app
  const back = await s2.load('r');
  await s2.save({ id: 'r', clips: back.clips, seconds: 3 });
  assert.equal(fs.copies, 1);
  assert.equal(fs.files.get('doc://estudio/r/m-c1.jpg'), 'A');
});

test('apagar tira a pasta toda; um ficheiro que desapareceu não volta como clipe; json estragado não rebenta', async () => {
  const fs = n.memoryFs({ 'file:///a.jpg': 'A', 'file:///b.jpg': 'B' });
  const s = store(fs);
  const g = ids();
  const a = p.makeClip({ uri: 'file:///a.jpg', video: false, mime: 'image/jpeg' }, g);
  const b = p.makeClip({ uri: 'file:///b.jpg', video: false, mime: 'image/jpeg' }, g);
  await s.save({ id: 'x', clips: [a, b] });
  fs.files.delete('doc://estudio/x/m-c2.jpg');
  const back = await s.load('x');
  assert.equal(back.clips.length, 1);
  await s.remove('x');
  assert.equal([...fs.files.keys()].some((k) => k.startsWith('doc://estudio/x')), false);
  fs.files.set('doc://estudio/lixo/draft.json', '{nada');
  assert.deepEqual(await s.list(), []);
});

test('no máximo 10 rascunhos (os mais antigos saem) e os nomes dos ficheiros são seguros', async () => {
  const fs = n.memoryFs({ 'file:///a.jpg': 'A' });
  const s = store(fs);
  for (let i = 0; i < 12; i++) await s.save({ id: `d${i}`, clips: [p.makeClip({ uri: 'file:///a.jpg', video: false, mime: 'image/jpeg' }, ids())], now: 1000 + i });
  const list = await s.list();
  assert.equal(list.length, 10);
  assert.equal(list.at(-1).id, 'd2');
  assert.equal(n.safeName('../x y/z'), '___x_y_z');
  assert.equal(n.extOf('file:///a/b.MOV'), 'mov');
  assert.equal(n.extOf('content://media/123', 'video/mp4'), 'mp4');
});
