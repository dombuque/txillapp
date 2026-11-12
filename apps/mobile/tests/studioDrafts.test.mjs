// Estúdio das tchekas: rascunhos automáticos (o projeto sem os URLs, cada ficheiro uma vez como Blob, os que já não se usam
// saem, no máximo 10 rascunhos), o debounce, os textos da lista e a ligação no estúdio e no ecrã de criar.
// Correr em apps/mobile:  node --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const d = await import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'studio', 'drafts.ts')).href);
const p = await import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'studio', 'project.ts')).href);
const read = (...x) => readFileSync(path.join(ROOT, 'src', ...x), 'utf8').replace(/\r\n/g, '\n');

const counter = () => { let n = 0; return () => `k${++n}`; };
function project() {
  const ids = counter();
  const a = p.makeClip({ uri: 'blob:a', video: false, mime: 'image/jpeg' }, ids);
  const b = { ...p.makeClip({ uri: 'blob:b', video: true, mime: 'video/mp4', durationMs: 8000 }, ids), fx: { f: 1 } };
  const split = p.splitAt([a, b], 5, { ids }).clips; // b fica em dois (o mesmo ficheiro)
  return { clips: split, ids };
}
function store(opts = {}) {
  const backend = d.memoryBackend();
  const reads = [];
  const s = d.createDraftStore(backend, {
    readMedia: async (uri) => { reads.push(uri); if (opts.fail === uri) throw new Error('não li'); return `BLOB(${uri})`; },
    toUrl: (v) => `url:${v}`,
  });
  return { s, backend, reads };
}

test('o rascunho leva os clipes sem os URLs e um ficheiro por media', () => {
  const { clips } = project();
  const { draft, uris } = d.draftFromProject({ id: 'r1', clips, settings: { look: 2 }, context: { soundId: 's9' }, now: 1000, seconds: 11 });
  assert.equal(draft.clips.length, 3);
  assert.equal('uri' in draft.clips[0], false);
  assert.deepEqual(draft.media.map((m) => m.key), [clips[0].media, clips[1].media], 'as duas metades partilham o ficheiro');
  assert.equal(uris.get(clips[1].media), 'blob:b');
  assert.deepEqual(draft.settings, { look: 2 });
  assert.deepEqual(draft.context, { soundId: 's9' });
  assert.equal(draft.savedAt, 1000);
  assert.deepEqual(draft.clips[1].fx, { f: 1 }, 'o fx vai no rascunho');
});

test('guardar e abrir: os clipes voltam com URLs novos, pela mesma ordem e com o mesmo corte', async () => {
  const { clips } = project();
  const { s, reads } = store();
  await s.save({ id: 'r1', clips, settings: { title: 'Olá' } });
  assert.deepEqual(reads, ['blob:a', 'blob:b'], 'cada ficheiro lê-se uma vez');
  const back = await s.load('r1');
  assert.equal(back.clips.length, 3);
  assert.equal(back.clips[0].uri, 'url:BLOB(blob:a)');
  assert.equal(back.clips[2].uri, back.clips[1].uri);
  assert.deepEqual(back.clips.map((c) => c.trim), clips.map((c) => c.trim));
  assert.deepEqual(back.clips.map((c) => c.key), clips.map((c) => c.key));
  assert.deepEqual(back.draft.settings, { title: 'Olá' });
  assert.deepEqual(p.normalizeClips(back.clips).map((c) => c.key), clips.map((c) => c.key));
});

test('guardar outra vez não volta a ler os ficheiros; os que saem da sequência apagam-se', async () => {
  const { clips, ids } = project();
  const { s, reads, backend } = store();
  await s.save({ id: 'r1', clips });
  await s.save({ id: 'r1', clips: p.trimEdge(clips, clips[1].key, 'end', -0.5).clips });
  assert.equal(reads.length, 2, 'só se leram na primeira vez');
  const swapped = p.replaceMedia(clips, clips[0].key, { uri: 'blob:z', video: false, mime: 'image/jpeg' }, { ids });
  await s.save({ id: 'r1', clips: swapped });
  assert.deepEqual(reads.slice(2), ['blob:z']);
  assert.equal(backend.size(), 2, 'a foto substituída saiu');
  await s.save({ id: 'r1', clips: [] });
  assert.equal(backend.size(), 0);
});

test('lista (mais recentes primeiro), apagar e no máximo 10', async () => {
  const { clips } = project();
  const { s, backend } = store();
  for (let i = 0; i < 12; i++) await s.save({ id: `r${i}`, clips, now: 1000 + i });
  const l = await s.list();
  assert.equal(l.length, d.MAX_DRAFTS);
  assert.equal(l[0].id, 'r11');
  assert.equal(l.some((x) => x.id === 'r0' || x.id === 'r1'), false, 'os mais antigos saíram');
  assert.equal(await backend.getMedia('r0', clips[0].media), null, 'com os ficheiros');
  await s.remove('r11');
  assert.equal((await s.list())[0].id, 'r10');
  assert.equal((await backend.mediaKeys('r11')).length, 0);
  assert.equal(await s.load('r11'), null);
});

test('as gravações seguem uma atrás da outra', async () => {
  const { clips } = project();
  const { s } = store();
  await Promise.all([s.save({ id: 'r1', clips, now: 1 }), s.save({ id: 'r1', clips: clips.slice(0, 1), now: 2 })]);
  const back = await s.load('r1');
  assert.equal(back.clips.length, 1, 'fica a última');
});

test('um ficheiro que não se lê não estraga o resto (a gravação falha e a seguinte tenta outra vez)', async () => {
  const { clips } = project();
  const { s } = store({ fail: 'blob:b' });
  await assert.rejects(s.save({ id: 'r1', clips }));
  await s.save({ id: 'r2', clips: clips.slice(0, 1) });
  assert.equal((await s.load('r2')).clips.length, 1);
});

test('textos da lista', () => {
  assert.equal(d.draftLabel({ clips: [1, 2, 3, 4], seconds: 12.4 }), '4 clipes · 12 s');
  assert.equal(d.draftLabel({ clips: [1] }), '1 clipe');
  const now = 10_000_000;
  assert.equal(d.agoLabel(now - 10_000, now), 'agora mesmo');
  assert.equal(d.agoLabel(now - 5 * 60_000, now), 'há 5 min');
  assert.equal(d.agoLabel(now - 2 * 3600_000, now), 'há 2 h');
  assert.equal(d.agoLabel(now - 26 * 3600_000, now), 'ontem');
  assert.equal(d.agoLabel(now - 3 * 86400_000, now), 'há 3 dias');
  assert.deepEqual(d.overflowDrafts([{ id: 'a', savedAt: 1 }, { id: 'b', savedAt: 3 }, { id: 'c', savedAt: 2 }], 2), ['a']);
});

test('debounce: só guarda depois de parar; flush guarda já; cancel esquece', () => {
  const pending = new Map();
  let n = 0;
  const timers = { set: (f) => { const id = ++n; pending.set(id, f); return id; }, clear: (id) => pending.delete(id) };
  const calls = [];
  const save = d.debounce((x) => calls.push(x), 700, timers);
  save(1); save(2); save(3);
  assert.equal(pending.size, 1, 'um só temporizador');
  [...pending.values()][0]();
  assert.deepEqual(calls, [3]);
  save(4);
  save.flush();
  assert.deepEqual(calls, [3, 4]);
  save(5);
  save.cancel();
  assert.equal(save.pending(), false);
  assert.deepEqual(calls, [3, 4]);
});

test('ligação: o estúdio guarda a cada mudança; criar oferece «Continuar o rascunho?» e apaga-o depois de publicar', () => {
  const studio = read('components', 'TchekaStudio.tsx');
  assert.match(studio, /studioDrafts\(\)\.save\(/);
  assert.match(studio, /debounce\(/);
  const nw = read('app', '(tabs)', 'new.tsx');
  assert.match(nw, /Continuar o rascunho\?/);
  assert.match(nw, /studioDrafts\(\)\.remove\(/);
  assert.match(nw, /Rascunhos/);
  const sheet = read('components', 'studio', 'StudioDrafts.tsx');
  assert.match(sheet, /Apagar o rascunho/);
});
