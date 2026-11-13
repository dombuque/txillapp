// Estúdio das tchekas, o projeto da linha do tempo: clipes com corte (início e fim), duração das fotos, velocidade e ordem;
// cortar pelas pontas, dividir no cursor, duplicar, apagar, mover, substituir; o total contra as regras (máximo 60 s);
// e o `fx` dos efeitos preservado em todas as operações.
// Correr em apps/mobile:  node --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const p = await import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'studio', 'project.ts')).href);
const r = await import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'tchekaRules.ts')).href);
const near = (a, b, eps = 1e-3, msg = '') => assert.ok(Math.abs(a - b) <= eps, `${msg} ${a} ≈ ${b}`);

const counter = () => { let n = 0; return () => `k${++n}`; };
const FX = { filter: 'quente', text: [{ s: 'olá' }] };
/** Quatro clipes: foto 3 s, vídeo de 10 s (corte 2–8, 1×), foto 3 s, vídeo de 6 s a 2× (todo). */
function four() {
  const ids = counter();
  const a = p.makeClip({ uri: 'blob:a', video: false, mime: 'image/jpeg' }, ids);
  const b = { ...p.makeClip({ uri: 'blob:b', video: true, mime: 'video/mp4', durationMs: 10000 }, ids), trim: { start: 2, end: 8 }, fx: FX };
  const c = p.makeClip({ uri: 'blob:c', video: false, mime: 'image/png' }, ids);
  const d = p.makeClip({ uri: 'blob:d', video: true, mime: 'video/webm', durationMs: 6000, speed: 2 }, ids);
  return { clips: [a, b, c, d], ids };
}

test('o máximo do projeto é o das regras', () => {
  assert.equal(p.PROJECT_MAX_S, r.TCHEKA_MAX_S);
});

test('clipes novos: foto de 3 s e 2 batidas; vídeo inteiro à velocidade da gravação', () => {
  const { clips } = four();
  assert.equal(clips[0].seconds, 3);
  assert.equal(clips[0].beats, 2);
  assert.deepEqual(clips[3].trim, { start: 0, end: 6 });
  assert.equal(clips[3].speed, 2);
  assert.equal(clips[0].media, clips[0].key, 'cada ficheiro novo tem o seu media');
  assert.deepEqual(p.baseDurations(clips), [3, 6, 3, 3]);
  assert.equal(p.totalOf(p.baseDurations(clips)), 15);
  assert.deepEqual(p.startsOf([3, 6, 3, 3]), [0, 3, 9, 12]);
});

test('onde está o cursor: numa junção conta o clipe seguinte; depois do fim, o último', () => {
  assert.deepEqual(p.locate([3, 6, 3], 0), { index: 0, local: 0 });
  assert.deepEqual(p.locate([3, 6, 3], 3), { index: 1, local: 0 });
  assert.deepEqual(p.locate([3, 6, 3], 4.5), { index: 1, local: 1.5 });
  assert.deepEqual(p.locate([3, 6, 3], 99), { index: 2, local: 3 });
  assert.deepEqual(p.locate([], 1), { index: -1, local: 0 });
});

test('cortar um vídeo pelas pontas mexe no bocado do ficheiro, à velocidade', () => {
  const { clips } = four();
  // Ponta do fim do vídeo de 2–8 s, 1 s para a esquerda: fica 2–7.
  let t = p.trimEdge(clips, 'k2', 'end', -1);
  assert.deepEqual(t.clips[1].trim, { start: 2, end: 7 });
  assert.equal(t.hit, null);
  assert.equal(t.clips[1].fx, FX, 'o fx fica');
  // Ponta do início 1 s para a esquerda: começa no 1.
  t = p.trimEdge(clips, 'k2', 'start', -1);
  assert.deepEqual(t.clips[1].trim, { start: 1, end: 8 });
  // Não passa do início do ficheiro nem do fim.
  t = p.trimEdge(clips, 'k2', 'start', -5);
  assert.equal(t.clips[1].trim.start, 0);
  assert.equal(t.hit, 'max');
  t = p.trimEdge(clips, 'k2', 'end', 5);
  assert.equal(t.clips[1].trim.end, 10);
  assert.equal(t.hit, 'max');
  // A 2×, 1 s na sequência são 2 s do ficheiro.
  t = p.trimEdge(clips, 'k4', 'end', -1);
  assert.deepEqual(t.clips[3].trim, { start: 0, end: 4 });
  near(p.clipDuration(t.clips[3]), 2);
});

test('cortar não deixa o clipe mais curto do que o mínimo (e avisa para o toque leve)', () => {
  const { clips } = four();
  const t = p.trimEdge(clips, 'k2', 'start', 50);
  near(t.clips[1].trim.end - t.clips[1].trim.start, p.MIN_CLIP_S);
  assert.equal(t.hit, 'min');
  const ph = p.trimEdge(clips, 'k1', 'end', -10);
  assert.equal(ph.clips[0].seconds, p.MIN_PHOTO_S);
  assert.equal(ph.hit, 'min');
  const ok = p.trimEdge(clips, 'k1', 'end', -1);
  assert.equal(ok.hit, null);
  assert.equal(ok.clips[0].seconds, 2);
});

test('cortar uma foto muda a duração; pela ponta do início também', () => {
  const { clips } = four();
  assert.equal(p.trimEdge(clips, 'k1', 'end', 2).clips[0].seconds, 5);
  assert.equal(p.trimEdge(clips, 'k1', 'start', 1).clips[0].seconds, 2, 'puxar o início para a direita encurta');
  // Ao ritmo, a duração vai para as batidas.
  const beat = p.trimEdge(clips, 'k1', 'end', 1, { beatPeriod: 0.5 });
  assert.equal(beat.clips[0].beats, 8);
});

test('cortar não deixa passar dos 60 s', () => {
  const ids = counter();
  const long = { ...p.makeClip({ uri: 'blob:v', video: true, mime: 'video/mp4', durationMs: 120000 }, ids), trim: { start: 0, end: 50 } };
  const ph = p.makeClip({ uri: 'blob:p', video: false, mime: 'image/jpeg' }, ids);
  const t = p.trimEdge([long, ph], long.key, 'end', 30);
  near(t.clips[0].trim.end, 57, 1e-6, 'cabem 57 s com a foto de 3 s');
  assert.equal(t.hit, 'max');
  near(p.totalOf(p.baseDurations(t.clips)), 60);
  const f = p.trimEdge([long, ph], ph.key, 'end', 30);
  near(f.clips[1].seconds, 10);
});

test('nada muda: devolve a mesma lista', () => {
  const { clips } = four();
  assert.equal(p.trimEdge(clips, 'nada', 'end', 1).clips, clips);
  assert.equal(p.trimEdge(clips, 'k2', 'end', 0).clips, clips);
  assert.equal(p.setSpeed(clips, 'k1', 2), clips, 'as fotos não têm velocidade');
  assert.equal(p.moveClip(clips, 1, 1), clips);
  assert.equal(p.removeClip(clips, 'nada'), clips);
});

test('dividir no cursor: dois clipes do mesmo ficheiro, com o fx, sem mudar o tempo', () => {
  const { clips, ids } = four();
  // Aos 5 s está o vídeo (começa aos 3), 2 s para dentro do corte 2–8: divide no segundo 4 do ficheiro.
  const s = p.splitAt(clips, 5, { ids });
  assert.ok(s);
  assert.equal(s.clips.length, 5);
  assert.deepEqual(s.clips[1].trim, { start: 2, end: 4 });
  assert.deepEqual(s.clips[2].trim, { start: 4, end: 8 });
  assert.equal(s.clips[1].key, 'k2');
  assert.equal(s.clips[2].key, s.right);
  assert.equal(s.clips[2].media, s.clips[1].media, 'o mesmo ficheiro');
  assert.equal(s.clips[2].fx, FX);
  assert.equal(s.clips[1].fx, FX);
  near(p.totalOf(p.baseDurations(s.clips)), 15, 1e-6, 'o total fica');
  // A 2×: o vídeo d começa aos 12; aos 13 s, 1 s para dentro = 2 s do ficheiro.
  const s2 = p.splitAt(clips, 13, { ids });
  assert.deepEqual(s2.clips[3].trim, { start: 0, end: 2 });
  assert.deepEqual(s2.clips[4].trim, { start: 2, end: 6 });
  // Uma foto divide a duração (e as batidas).
  const s3 = p.splitAt(clips, 1, { ids });
  assert.equal(s3.clips[0].seconds, 1);
  assert.equal(s3.clips[1].seconds, 2);
  assert.equal(s3.clips[0].beats + s3.clips[1].beats, 2);
});

test('dividir em cima de uma ponta não faz nada', () => {
  const { clips } = four();
  assert.equal(p.splitAt(clips, 3), null, 'na junção');
  assert.equal(p.splitAt(clips, 3.1), null, 'perto demais do início');
  assert.equal(p.splitAt(clips, 8.9), null, 'perto demais do fim');
  assert.equal(p.splitAt([], 1), null);
});

test('dividir respeita as durações ao ritmo', () => {
  const { clips, ids } = four();
  const durations = [2, 6, 1, 3]; // as fotos ao ritmo
  const s = p.splitAt(clips, 2.5, { durations, ids });
  assert.deepEqual(s.clips[1].trim, { start: 2, end: 2.5 }, 'aos 2,5 s já é o vídeo (a foto acaba aos 2)');
});

test('duplicar põe a cópia a seguir, com chave nova e o fx; não passa dos 60 s', () => {
  const { clips, ids } = four();
  const d = p.duplicateClip(clips, 'k2', { ids });
  assert.equal(d.clips.length, 5);
  assert.equal(d.clips[2].key, d.key);
  assert.notEqual(d.key, 'k2');
  assert.deepEqual(d.clips[2].trim, clips[1].trim);
  assert.equal(d.clips[2].fx, FX);
  assert.equal(d.clips[2].media, clips[1].media);
  const big = { ...clips[1], trim: { start: 0, end: 10 } };
  const many = [big, { ...big, key: 'x2' }, { ...big, key: 'x3' }, { ...big, key: 'x4' }, { ...big, key: 'x5' }, { ...big, key: 'x6' }];
  assert.equal(p.duplicateClip(many, 'x2', { ids }), null, '60 s + 10 s não cabe');
});

test('apagar e mover', () => {
  const { clips } = four();
  assert.deepEqual(p.removeClip(clips, 'k2').map((c) => c.key), ['k1', 'k3', 'k4']);
  assert.deepEqual(p.moveClip(clips, 0, 3).map((c) => c.key), ['k2', 'k3', 'k4', 'k1']);
  assert.deepEqual(p.moveClip(clips, 3, 0).map((c) => c.key), ['k4', 'k1', 'k2', 'k3']);
  assert.deepEqual(p.moveClip(clips, 1, 99).map((c) => c.key), ['k1', 'k3', 'k4', 'k2'], 'fora dos limites vai para a ponta');
  assert.equal(p.moveClip(clips, 1, 2)[2].fx, FX);
});

test('velocidade e duração das fotos', () => {
  const { clips } = four();
  const s = p.setSpeed(clips, 'k2', 0.5);
  assert.equal(s[1].speed, 0.5);
  near(p.clipDuration(s[1]), 12);
  assert.equal(s[1].fx, FX);
  const ph = p.setPhoto(clips, 'k1', { seconds: 5 });
  assert.equal(ph[0].seconds, 5);
  assert.equal(p.setPhoto(clips, 'k1', { seconds: 0.1 })[0].seconds, p.MIN_PHOTO_S);
  assert.equal(p.setPhoto(clips, 'k1', { beats: 4 })[0].beats, 4);
  assert.equal(p.setPhoto(clips, 'k2', { seconds: 5 }), clips, 'vídeos não');
});

test('substituir o ficheiro fica com o lugar, a duração, a velocidade e o fx', () => {
  const { clips, ids } = four();
  const v = p.replaceMedia(clips, 'k2', { uri: 'blob:novo', video: true, mime: 'video/mp4', durationMs: 20000 }, { ids });
  assert.equal(v[1].key, 'k2');
  assert.equal(v[1].uri, 'blob:novo');
  assert.notEqual(v[1].media, clips[1].media);
  assert.deepEqual(v[1].trim, { start: 0, end: 6 }, 'os mesmos 6 s');
  assert.equal(v[1].fx, FX);
  assert.equal(v[1].hasAudio, undefined, 'o som volta a ler-se');
  const curto = p.replaceMedia(clips, 'k2', { uri: 'blob:curto', video: true, mime: 'video/mp4', durationMs: 2000 }, { ids });
  assert.deepEqual(curto[1].trim, { start: 0, end: 2 }, 'se o novo for mais curto, fica todo');
  const f = p.replaceMedia(clips, 'k2', { uri: 'blob:foto', video: false, mime: 'image/jpeg' }, { ids });
  assert.equal(f[1].video, false);
  assert.equal(f[1].seconds, 6);
  assert.equal(f[1].fx, FX);
  const semFx = p.replaceMedia(clips, 'k1', { uri: 'blob:x', video: false, mime: 'image/jpeg' }, { ids });
  assert.equal('fx' in semFx[0], false, 'quem não tinha fx continua sem');
});

test('o total vai às regras: até 60 s; as durações ao ritmo contam', () => {
  const { clips } = four();
  const rc = p.ruleClips(clips);
  assert.deepEqual(rc.map((c) => c.seconds), [3, 6, 3, 3]);
  assert.equal(r.checkTcheka({ clips: rc, music: true }).ok, true);
  const big = p.setSpeed(clips, 'k2', 0.25); // 6 s → 24 s
  const big2 = p.setPhoto(p.setSpeed(big, 'k4', 0.25), 'k1', { seconds: 10 }); // 3 s → 24 s e a foto com 10 s: 61 s
  const res = r.checkTcheka({ clips: p.ruleClips(big2), music: true });
  assert.equal(res.ok, false);
  assert.equal(res.problem, 'longo');
  assert.equal(p.roomLeft(p.baseDurations(big2)) < 0, true);
  assert.deepEqual(p.ruleClips(clips, [1, 6, 1, 3]).map((c) => c.seconds), [1, 6, 1, 3]);
});

test('o fx sobrevive a uma cadeia de operações', () => {
  const { clips, ids } = four();
  let l = p.splitAt(clips, 5, { ids }).clips;
  l = p.duplicateClip(l, l[2].key, { ids }).clips;
  l = p.moveClip(l, 3, 0);
  l = p.trimEdge(l, l[0].key, 'end', -0.5).clips;
  l = p.setSpeed(l, l[0].key, 2);
  assert.equal(l.filter((c) => c.fx === FX).length, 3, 'as duas metades e a cópia de uma delas');
});

test('rascunhos: os clipes reparam-se ao ler (números inválidos, cortes fora, chaves repetidas)', () => {
  const ids = counter();
  const out = p.normalizeClips([
    { key: 'a', media: 'm1', uri: 'blob:1', video: true, mime: 'video/mp4', length: 5, trim: { start: -2, end: 99 }, speed: 0, seconds: 3, beats: 2, fx: { y: 1 } },
    { key: 'a', uri: 'blob:2', video: false, seconds: Number.NaN, beats: 100 },
    { nada: true },
    null,
  ], ids);
  assert.equal(out.length, 2);
  assert.deepEqual(out[0].trim, { start: 0, end: 5 });
  assert.equal(out[0].speed, 1);
  assert.deepEqual(out[0].fx, { y: 1 });
  assert.notEqual(out[1].key, 'a', 'a chave repetida muda');
  assert.equal(out[1].seconds, 3);
  assert.equal(out[1].beats, p.MAX_BEATS);
  assert.equal(out[1].media, out[1].key);
  assert.deepEqual(p.normalizeClips('lixo'), []);
});
