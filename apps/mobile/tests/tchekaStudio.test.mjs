// Estúdio de tchekas ao nível do TikTok: regras mínimas para publicar (3 fotos, ou 3 s de vídeo, ou 5 s misturados;
// som obrigatório; só fotos pede música; até 60 s), a dica do botão, a deteção das batidas (onda sintética), a montagem
// ao ritmo, a barra segmentada da gravação, as velocidades, o corte dos clipes, o tempo do texto e a ligação no estúdio.
// Correr em apps/mobile:  node --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const r = await import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'tchekaRules.ts')).href);
const read = (...p) => readFileSync(path.join(ROOT, 'src', ...p), 'utf8');
const near = (a, b, eps, msg = '') => assert.ok(Math.abs(a - b) <= eps, `${msg} ${a} ≈ ${b} (±${eps})`);

const photo = (seconds = 3) => ({ video: false, seconds });
const video = (seconds, hasAudio) => ({ video: true, seconds, hasAudio });

test('regras: só com fotos, pelo menos 3, e a música é obrigatória', () => {
  const one = r.checkTcheka({ clips: [photo()], music: true });
  assert.equal(one.ok, false);
  assert.equal(one.hint, 'Junta mais 2 fotos', 'uma foto de 3 s já não monta (era o problema)');
  assert.equal(r.checkTcheka({ clips: [photo(), photo()], music: true }).hint, 'Junta mais 1 foto');
  assert.equal(r.checkTcheka({ clips: [photo(5), photo(5)], music: true }).ok, false, 'duas fotos longas não chegam: são precisas 3');
  const three = r.checkTcheka({ clips: [photo(), photo(), photo()], music: false });
  assert.equal(three.ok, false);
  assert.equal(three.problem, 'som');
  assert.equal(three.hint, 'Escolhe uma música');
  const ok = r.checkTcheka({ clips: [photo(), photo(), photo()], music: true });
  assert.equal(ok.ok, true);
  assert.equal(ok.hint, null);
  assert.equal(ok.sound, 'music');
  assert.equal(ok.total, 9);
});

test('regras: vídeo de 3 s ou mais (os clipes gravados somam), ou 5 s misturados', () => {
  assert.equal(r.checkTcheka({ clips: [video(3)], music: false }).ok, true, 'um vídeo de 3 s com o som dele chega');
  assert.equal(r.checkTcheka({ clips: [video(3)], music: false }).sound, 'original');
  const short = r.checkTcheka({ clips: [video(1.2)], music: true });
  assert.equal(short.ok, false);
  assert.equal(short.hint, 'Grava mais 2 s');
  assert.equal(r.checkTcheka({ clips: [video(1.5), video(1.5)], music: false }).ok, true, 'dois clipes de 1,5 s contam como 3 s');
  // Misturado: 1 foto de 3 s + 2 s de vídeo = 5 s.
  assert.equal(r.checkTcheka({ clips: [photo(3), video(2)], music: true }).ok, true);
  const mix = r.checkTcheka({ clips: [photo(2), video(1)], music: true });
  assert.equal(mix.ok, false);
  assert.equal(mix.hint, 'Junta mais 2 fotos ou 2 s de vídeo');
  assert.equal(r.checkTcheka({ clips: [], music: true }).hint, 'Junta 3 fotos ou grava 3 s');
});

test('regras: o som tem de vir de algum lado', () => {
  const mute = r.checkTcheka({ clips: [video(8, false)], music: false });
  assert.equal(mute.ok, false);
  assert.equal(mute.hint, 'Os vídeos não têm som: escolhe uma música ou um som');
  assert.equal(r.checkTcheka({ clips: [video(8, false)], music: true }).ok, true, 'com um som de outra tcheka (ou música) já vale');
  const zero = r.checkTcheka({ clips: [video(8, true)], music: false, originalVolume: 0 });
  assert.equal(zero.hint, 'Sobe o som original ou escolhe uma música', 'o som original a 0 não conta');
  assert.equal(r.checkTcheka({ clips: [video(8)], music: false }).ok, true, 'sem saber ainda se tem som, conta como tendo');
});

test('regras: até 60 s', () => {
  const long = r.checkTcheka({ clips: [video(45), video(20)], music: false });
  assert.equal(long.ok, false);
  assert.equal(long.problem, 'longo');
  assert.equal(long.hint, 'Tira 5 s (máximo 60 s)');
  assert.equal(r.checkTcheka({ clips: [video(40), video(20)], music: false }).ok, true);
});

/** Onda sintética: um «bombo» (seno de 80 Hz a decair em 60 ms) em cada batida, com ruído baixinho por baixo. */
function drums(bpm, seconds, rate = 22050, first = 0.1) {
  const n = Math.round(seconds * rate);
  const out = new Float32Array(n);
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648) * 2 - 1;
  for (let i = 0; i < n; i++) out[i] = rnd() * 0.02;
  const period = 60 / bpm;
  const beats = [];
  for (let t = first; t < seconds; t += period) {
    beats.push(t);
    const s0 = Math.round(t * rate);
    for (let i = 0; i < rate * 0.12 && s0 + i < n; i++) out[s0 + i] += Math.sin((2 * Math.PI * 80 * i) / rate) * Math.exp(-i / (rate * 0.06)) * 0.9;
  }
  return { out, beats, rate };
}

test('batidas: numa onda sintética a 120 BPM acha o andamento e as batidas', () => {
  const { out, beats, rate } = drums(120, 12);
  const info = r.detectBeats(out, rate);
  assert.ok(info.bpm, 'há andamento');
  near(info.bpm, 120, 2, 'andamento');
  // Cada batida verdadeira tem um início detetado a menos de 30 ms.
  const hits = beats.filter((b) => info.onsets.some((o) => Math.abs(o - b) < 0.03)).length;
  assert.ok(hits >= beats.length - 1, `${hits} de ${beats.length} batidas detetadas`);
  assert.ok(info.onsets.length <= beats.length + 2, `sem inícios a mais (${info.onsets.length})`);
  // A grelha cai em cima das batidas.
  const grid = r.beatGrid(info.bpm, info.offset, 12);
  const off = grid.slice(0, 20).map((g) => Math.min(...beats.map((b) => Math.abs(b - g))));
  assert.ok(Math.max(...off) < 0.04, `a grelha afasta-se no máximo ${Math.max(...off).toFixed(3)} s`);
});

test('batidas: noutros andamentos (90 e 150 BPM) e no silêncio', () => {
  for (const bpm of [90, 150]) {
    const { out, rate } = drums(bpm, 12, 22050, 0.23);
    near(r.detectBeats(out, rate).bpm, bpm, 3, `${bpm} BPM`);
  }
  const silence = r.detectBeats(new Float32Array(22050 * 3), 22050);
  assert.equal(silence.bpm, null);
  assert.deepEqual(silence.onsets, []);
  assert.equal(r.detectBeats(new Float32Array(10), 22050).bpm, null, 'curto demais');
});

test('grelha do ritmo: sem andamento usa o ritmo fixo (120 BPM)', () => {
  assert.equal(r.FALLBACK_BPM, 120);
  assert.deepEqual(r.beatGrid(null, 0, 2), [0, 0.5, 1, 1.5, 2]);
  assert.deepEqual(r.beatGrid(100, 0.1, 1.5), [0.1, 0.7, 1.3]);
});

test('montagem ao ritmo: os cortes das fotos caem nas batidas', () => {
  const grid = r.beatGrid(120, 0.2, 30); // 0,2 · 0,7 · 1,2 · …
  const d = r.rhythmDurations([{ video: false, seconds: 3, beats: 2 }, { video: false, seconds: 3, beats: 2 }, { video: false, seconds: 3, beats: 4 }], grid);
  const cuts = r.cutTimes(d);
  for (const c of cuts) assert.ok(grid.some((g) => Math.abs(g - c) < 1e-6), `o corte ${c} está numa batida`);
  near(d[0], 1.2, 1e-6, 'a 1.ª foto salta a batida dos 0,2 s (perto demais) e acaba duas batidas depois');
  near(d[1], 1, 1e-6, 'duas batidas');
  near(d[2], 2, 1e-6, 'quatro batidas');
  // Com um vídeo pelo meio: o vídeo não muda e a foto seguinte volta a acabar numa batida.
  const m = r.rhythmDurations([{ video: false, seconds: 3, beats: 1 }, { video: true, seconds: 1.33 }, { video: false, seconds: 3, beats: 2 }], grid);
  near(m[1], 1.33, 1e-9, 'o vídeo fica como está');
  const end = m[0] + m[1] + m[2];
  assert.ok(grid.some((g) => Math.abs(g - end) < 1e-6), `o fim da foto depois do vídeo (${end}) está numa batida`);
  assert.ok(m[2] >= 0.25, 'nenhuma foto fica menos de 0,25 s');
  assert.deepEqual(r.rhythmDurations([{ video: false, seconds: 3 }], []), [3], 'sem grelha, fica a duração manual');
});

test('gravação por clipes: barra segmentada até 60 s, desfazer e velocidades', () => {
  assert.deepEqual([...r.SPEEDS], [0.5, 1, 2, 3]);
  assert.equal(r.finalMs(3000, 2), 1500, 'a 2× fica com metade');
  assert.equal(r.finalMs(3000, 0.5), 6000, 'a 0,5× fica com o dobro');
  assert.equal(r.finalMs(3000, 3), 1000);
  assert.equal(r.musicRateWhileRecording(3), 1 / 3, 'a 3× a música toca devagar enquanto se grava');
  assert.equal(r.musicRateWhileRecording(0.5), 2);
  assert.equal(r.speedLabel(0.5), '0,5×');
  assert.equal(r.recordableMs(54_000, 2), 12_000, 'faltam 6 s finais: a 2× dá para gravar 12 s');
  const bar = r.segmentBar([15_000, 30_000], 6_000);
  assert.deepEqual(bar.segments, [{ start: 0, width: 0.25 }, { start: 0.25, width: 0.5 }]);
  assert.deepEqual(bar.live, { start: 0.75, width: 0.1 });
  near(bar.used, 0.85, 1e-9);
  const over = r.segmentBar([50_000, 20_000]);
  assert.equal(over.segments.length, 2);
  near(over.segments[1].width, 10 / 60, 1e-9, 'o que passa dos 60 s fica cortado');
  assert.equal(over.used, 1);
  // Desfazer o último = tirar o último segmento.
  const undo = r.segmentBar([15_000, 30_000].slice(0, -1));
  assert.deepEqual(undo.segments, [{ start: 0, width: 0.25 }]);
});

test('corte dos clipes e tempo do texto', () => {
  assert.deepEqual(r.clampTrim({ start: -1, end: 20 }, 8), { start: 0, end: 8 });
  assert.deepEqual(r.clampTrim({ start: 7.9, end: 7.95 }, 8), { start: 7.5, end: 8 }, 'pelo menos 0,5 s');
  assert.deepEqual(r.clampTrim({ start: 2, end: 2.1 }, 8), { start: 2, end: 2.5 });
  assert.equal(r.clipSeconds({ start: 1, end: 7 }, 2), 3);
  assert.equal(r.textAlpha(0.5, 1, 4), 0, 'antes de entrar não se vê');
  assert.equal(r.textAlpha(2.5, 1, 4), 1, 'no meio está inteiro');
  assert.equal(r.textAlpha(4.5, 1, 4), 0, 'depois de sair não se vê');
  assert.ok(r.textAlpha(1.1, 1, 4) > 0 && r.textAlpha(1.1, 1, 4) < 1, 'a entrar');
  assert.ok(r.textAlpha(3.9, 1, 4) < 0.5, 'a sair');
  assert.equal(r.fmtS(1.5), '1,5');
  assert.notEqual(r.studioSignature({ a: 1 }), r.studioSignature({ a: 2 }));
  assert.equal(r.studioSignature({ a: [1, 2] }), r.studioSignature({ a: [1, 2] }));
});

test('som de outra tcheka: vira a faixa do estúdio e a publicação leva o soundId', async () => {
  const s = await import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'soundTrack.ts')).href);
  const original = { id: 'abc', kind: 'original', title: 'Som original · @ana', author: { username: 'ana', displayName: 'Ana', verified: false }, mine: false, canUse: true, cover: null, durationMs: 12000, previewUrl: '/api/v1/sounds/abc/audio', uses: 4 };
  const t = s.soundTrack(original);
  assert.equal(t.url, '/api/v1/sounds/abc/audio');
  assert.equal(t.artist, 'Ana', 'o crédito é o nome do autor (author vem como objeto de GET /sounds/:id)');
  assert.equal(t.kind, 'sound', 'um som original começa com o som dos vídeos calado no estúdio');
  assert.deepEqual(s.soundForPost(original, t), { soundId: 'abc', music: null }, 'um som original não é uma faixa: só vai o soundId');
  const other = { id: 'x', title: 'Outra', artist: '', url: '/o.mp3', landing: null, license: '', licenseUrl: null, durationMs: null, cover: null };
  assert.deepEqual(s.soundForPost(original, other), { music: other }, 'trocou de música no estúdio: o som deixa de contar');
  const track = { id: 'cc:1', title: 'Marrabenta', artist: 'Banda', url: '/m.mp3', landing: null, license: 'CC BY', licenseUrl: null, durationMs: 30000, cover: null };
  const catalog = { id: 'snd2', kind: 'catalog', title: 'Marrabenta', previewUrl: '/m.mp3', music: track, bpm: 128 };
  const ct = s.soundTrack(catalog);
  assert.equal(ct.id, 'cc:1');
  assert.equal(ct.bpm, 128, 'o BPM da faixa vai para o ritmo (no nativo, sem Web Audio)');
  assert.deepEqual(s.soundForPost(catalog, ct), { soundId: 'snd2', music: track });
  assert.deepEqual(s.soundForPost(null, track), { music: track });
});

test('ligação: estúdio, câmara, criar e /tcheka/nova', () => {
  const studio = read('components', 'TchekaStudio.tsx');
  assert.match(studio, /checkTcheka\(/, 'o estúdio usa as regras');
  assert.match(studio, /disabled=\{!rules\.ok \|\| busy\}/, 'o botão fica desligado até cumprir as regras');
  assert.match(studio, /rules\.hint/, 'com a dica');
  assert.match(studio, /detectBeats\(/, 'deteção das batidas por Web Audio');
  assert.match(studio, /rhythmDurations\(/, 'montagem ao ritmo');
  assert.match(studio, /ready\.current\.sig === fullSig/, 'a volta gravada na pré-visualização reaproveita-se');
  assert.match(studio, /posterMs: Math\.round\(coverAt \* 1000\)/, 'a capa escolhida vai com o vídeo');
  assert.match(studio, /reference/, 'preparado para o vídeo de referência (dueto)');
  const cam = read('components', 'TxCamera.tsx');
  assert.match(cam, /segmentBar\(/, 'barra segmentada na câmara');
  assert.match(cam, /onUndo/, 'desfazer o último clipe');
  assert.match(cam, /musicRateWhileRecording\(/, 'o som acompanha a velocidade');
  assert.match(cam, /recordRef\.current\(\)/, 'o temporizador começa a gravar');
  const nw = read('app', '(tabs)', 'new.tsx');
  assert.match(nw, /soundsApi\.get\(/, 'o som vem de GET /sounds/:id (lib/api.sounds.ts)');
  assert.match(nw, /soundForPost\(sound, music\)/, 'a publicação leva o soundId');
  assert.match(nw, /segmented=\{kindSel === 'tcheka'/, 'a câmara grava por clipes numa tcheka');
  assert.match(nw, /tchekaRules/, 'no telemóvel (sem estúdio) as regras ficam no Publicar');
  const nova = read('app', 'tcheka', 'nova.tsx');
  assert.match(nova, /kind: 'tcheka'/);
  assert.match(nova, /som/);
  assert.match(nova, /dueto/);
  assert.match(read('lib', 'publishQueue.ts'), /posterMs: a\.posterMs/, 'o instante da capa vai no /complete');
  assert.match(read('lib', 'api.compose.ts'), /soundId\?: string/);
});
