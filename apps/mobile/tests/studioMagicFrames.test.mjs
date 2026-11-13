// «Montagem mágica» na app: os frames dos vídeos e o som (src/lib/studio/magic.ts, secção 4b, e src/lib/studio/magicFrames.ts).
// Os instantes a ver (~2 por segundo, no máximo 40, do geral para o pormenor), as amostras e a luz (as mesmas contas do
// site), o som do servidor a 4 Hz, o ponto de interesse dos vídeos, a grelha escondida, os lotes no tempo e as fases.
// Correr em apps/mobile:  node --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const lib = (...p) => pathToFileURL(path.join(ROOT, 'src', 'lib', ...p)).href;
const m = await import(lib('studio', 'magic.ts'));
const f = await import(lib('studio', 'magicFrames.ts'));
const { w: W, h: H } = m.ANALYSIS;

function frame(fn) {
  const px = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const [r, g, b] = fn(x, y); px.set([r, g, b, 255], (y * W + x) * 4); }
  return px;
}
/** Uma mancha clara a andar para a direita (`cx`) num fundo com alguma textura. */
const blob = (cx, lum = 60) => frame((x, y) => (Math.hypot(x - cx, y - 28) < 5 ? [240, 230, 220] : [lum + ((x + y) % 2) * 20, lum, lum]));

// ---------------------------------------------------------------- os instantes

test('instantes: ~2 por segundo, no máximo 40, numa grelha, do geral para o pormenor', () => {
  const t10 = m.videoSampleTimes(10);
  assert.equal(t10.length, 20);
  assert.equal(new Set(t10).size, 20, 'sem repetir');
  const sorted = [...t10].sort((a, b) => a - b);
  for (let i = 1; i < sorted.length; i++) assert.ok(Math.abs(sorted[i] - sorted[i - 1] - 0.5) < 0.002, `grelha regular: ${sorted[i - 1]} → ${sorted[i]}`);
  assert.ok(Math.abs(t10[0] - 5) <= 0.5, `o primeiro é o meio: ${t10[0]}`);
  // Os primeiros 4 já cobrem o vídeo todo (um em cada quarto).
  const q = new Set(t10.slice(0, 4).map((t) => Math.floor(t / 2.5)));
  assert.equal(q.size, 4, `um por quarto: ${t10.slice(0, 4)}`);
  assert.equal(m.videoSampleTimes(60).length, 40, 'no máximo 40');
  assert.equal(m.videoSampleTimes(1).length, 4, 'pelo menos 4');
  for (const t of m.videoSampleTimes(60)) assert.ok(t >= 0 && t <= 59.95);
  assert.deepEqual(m.videoSampleTimes(0), []);
  assert.equal(m.videoSampleTimes(30, 8).length, 8);
});

// ---------------------------------------------------------------- as amostras (iguais às do site)

/** A conta que o site fazia dentro do magicAnalyze.ts (antes de passar para o magic.ts), para comparar. */
function oldSiteSamples(got, audio) {
  return got.map((x, i) => {
    const mo = i > 0 ? m.frameMotion(got[i - 1].gray, x.gray, W, H) : got.length > 1 ? m.frameMotion(x.gray, got[1].gray, W, H) : { motion: 0, spread: 0 };
    const a = audio ? Math.max(audio[Math.floor(x.t * 10)] ?? 0, audio[Math.floor(x.t * 10) + 1] ?? 0, audio[Math.max(0, Math.floor(x.t * 10) - 1)] ?? 0) : undefined;
    return { t: Math.round(x.t * 1000) / 1000, luma: x.st.luma, sharp: x.st.sharp, motion: mo.motion, spread: mo.spread, ...(a != null ? { audio: a } : {}) };
  });
}

test('amostras: as mesmas contas que o site fazia (movimento, luz, nitidez e som a 10 Hz)', () => {
  const got = [0.4, 1.3, 2.25, 3.1, 4.05].map((t, i) => m.videoFrame(t, blob(6 + i * 4, 50 + i * 10)));
  const audio = Array.from({ length: 50 }, (_, i) => Math.round(Math.abs(Math.sin(i / 3)) * 1000) / 1000);
  assert.deepEqual(m.videoSamples(got, { energy: audio, rate: 10 }), oldSiteSamples(got, audio));
  assert.deepEqual(m.videoSamples(got, null), oldSiteSamples(got, null));
  const one = [m.videoFrame(1, blob(10))];
  assert.deepEqual(m.videoSamples(one), oldSiteSamples(one, null));
  // A luz é a média dos frames; o item é o do videoItem (com os frames por qualquer ordem).
  const look = m.videoLook(got);
  const avg = got.reduce((s, x) => s + x.st.luma, 0) / got.length;
  assert.ok(Math.abs(look.luma - avg) < 1e-12);
  const a = m.videoItemFromFrames('v', 9 / 16, 5, [...got].reverse(), { energy: audio, rate: 10 }, true);
  const b = m.videoItem('v', 9 / 16, { duration: 5, samples: oldSiteSamples(got, audio) }, look, true);
  assert.deepEqual(a, b);
  assert.ok(a.track.samples.every((s, i, l) => i === 0 || s.t > l[i - 1].t), 'por ordem do tempo');
});

test('som: a 4 Hz (do servidor) entra depois sem mudar o resto, e um vídeo sem som não conta som', () => {
  assert.equal(m.audioAt({ energy: [0, 0.2, 1, 0.1], rate: 4 }, 0.3), 1, 'o bloco e os vizinhos');
  assert.equal(m.audioAt({ energy: [0.5], rate: 4 }, 9), 0, 'fora do fim: 0');
  const got = [0.5, 1.5, 2.5, 3.5].map((t, i) => m.videoFrame(t, blob(6 + i * 5)));
  const sound = { energy: [0.1, 0.1, 0.1, 0.1, 0.2, 0.2, 0.2, 0.2, 1, 1, 0.9, 0.8, 0.1, 0.1, 0.1, 0.1], rate: 4 };
  const plain = m.videoItemFromFrames('v', 9 / 16, 4, got, null, undefined);
  const later = m.withVideoSound(plain, sound, true);
  const once = m.videoItemFromFrames('v', 9 / 16, 4, got, sound, true);
  assert.deepEqual(later, once, 'juntar o som depois dá o mesmo que tê-lo logo');
  assert.ok(later.track.samples[2].audio >= 0.9, 'o estalo aos 2,5 s');
  assert.equal(later.hasAudio, true);
  const silent = m.withVideoSound(later, null, false);
  assert.equal(silent.hasAudio, false);
  assert.ok(silent.track.samples.every((s) => s.audio === undefined), 'sem som, as notas não contam som');
  assert.deepEqual(silent.track.samples, plain.track.samples);
  // Um vídeo neutro (sem frames) só fica a saber se tem som.
  const flat = m.neutralItem({ key: 'n', uri: 'x', video: true, mime: 'video/mp4', durationMs: 4000 });
  assert.deepEqual(m.withVideoSound(flat, sound, false), { ...flat, hasAudio: false });
  assert.equal(flat.duration, 4);
  assert.equal(flat.aspect, 9 / 16);
});

test('ponto de interesse de um vídeo: a mediana dos frames, com cara só se a maioria tiver', () => {
  const face = (x, y) => ({ x, y, box: { x0: x - 0.1, y0: y - 0.1, x1: x + 0.1, y1: y + 0.1 }, face: true, strength: 0.5 });
  const plain = (x, y) => ({ x, y, box: { x0: 0.3, y0: 0.3, x1: 0.7, y1: 0.7 }, face: false, strength: 0.2 });
  const v = m.videoFocus([face(0.3, 0.4), face(0.32, 0.42), face(0.9, 0.9), plain(0.5, 0.5)]);
  assert.equal(v.face, true);
  assert.ok(v.x > 0.29 && v.x < 0.4, `a mediana foge do frame estranho: ${v.x}`);
  assert.equal(m.videoFocus([plain(0.5, 0.5), face(0.2, 0.2), plain(0.6, 0.4)]).face, false);
  assert.equal(m.videoFocus([]), undefined);
});

test('montagem: o ponto de interesse dos vídeos não vai para o fx (o servidor só enquadra fotos), a não ser que se peça', () => {
  const focus = { x: 0.2, y: 0.4, box: { x0: 0.1, y0: 0.3, x1: 0.3, y1: 0.5 }, face: true, strength: 0.5 };
  const got = [0.5, 1.5, 2.5, 3.5, 4.5].map((t, i) => m.videoFrame(t, blob(6 + i * 4)));
  const items = [
    m.videoItemFromFrames('v1', 16 / 9, 5, got, null, true, focus),
    m.videoItemFromFrames('v2', 16 / 9, 5, got, null, false, focus),
    m.photoItem('f1', 3 / 4, { luma: 0.6, sharp: 0.08, sat: 0.5, rgb: [0.8, 0.5, 0.3] }, focus),
  ];
  const sources = [
    { key: 'v1', uri: 'a.mp4', video: true, mime: 'video/mp4', durationMs: 5000 },
    { key: 'v2', uri: 'b.mp4', video: true, mime: 'video/mp4', durationMs: 5000 },
    { key: 'f1', uri: 'c.jpg', video: false, mime: 'image/jpeg' },
  ];
  const r = m.buildMontage({ sources, items, music: null, wave: 'malta', seed: 3 });
  for (const c of r.clips.filter((c) => c.video)) assert.equal(c.fx?.focus, undefined, 'vídeos sem fx.focus');
  assert.equal(r.clips.find((c) => c.key === 'v2').hasAudio, false, 'o «tem som?» vai para o clipe');
  const withFocus = m.buildMontage({ sources, items, music: null, wave: 'malta', seed: 3, videoFocus: true });
  assert.ok(withFocus.clips.filter((c) => c.video).every((c) => c.fx?.focus), 'com videoFocus, os vídeos deitados levam o ponto');
});

// ---------------------------------------------------------------- a grelha e os píxeis

test('grelha: células iguais, o corte 9:16 ao centro e um bloco de píxeis', () => {
  const cells = f.gridCells(10, 8, 800, 320);
  assert.equal(cells.length, 10);
  assert.deepEqual(cells[0], { x: 0, y: 0, w: 100, h: 160 });
  assert.deepEqual(cells[9], { x: 100, y: 160, w: 100, h: 160 });
  assert.deepEqual(f.gridShape(10), { cols: 8, rows: 2 });
  assert.deepEqual(f.gridShape(3), { cols: 3, rows: 1 });
  // Deitado (16:9): fica a parte do meio, com a altura toda.
  const land = f.coverCrop({ x: 0, y: 0, w: 160, h: 90 }, 9 / 16);
  assert.ok(Math.abs(land.w - 50.625) < 1e-9 && land.h === 90 && Math.abs(land.x - 54.6875) < 1e-9);
  // Em pé mais alto do que 9:16: corta em cima e em baixo.
  const tall = f.coverCrop({ x: 10, y: 0, w: 90, h: 200 }, 9 / 16);
  assert.ok(tall.w === 90 && Math.abs(tall.h - 160) < 1e-9 && Math.abs(tall.y - 20) < 1e-9 && tall.x === 10);
  assert.deepEqual(f.inset({ x: 0, y: 0, w: 10, h: 10 }), { x: 0.5, y: 0.5, w: 9, h: 9 });
  // Um bloco 2×2 a partir de (1, 1) numa imagem 3×3.
  const img = new Uint8Array(3 * 3 * 4).map((_, i) => i);
  const t = f.tileOf(img, 3, 1, 1, 2, 2);
  assert.deepEqual([...t.slice(0, 4)], [16, 17, 18, 19]);
  assert.deepEqual([...t.slice(8, 12)], [28, 29, 30, 31]);
});

// ---------------------------------------------------------------- o tempo

test('tempo: o primeiro lote vai sempre; os outros só se couberem, e cada vídeo tem a parte dele', () => {
  assert.equal(f.batchSize(20, 0, 0, 0), f.FIRST_BATCH, 'o primeiro lote mesmo sem tempo');
  assert.equal(f.batchSize(3, 1000, 0, 0), 3);
  assert.equal(f.batchSize(12, 1000, 100, 8), 10, 'o que cabe no tempo');
  assert.equal(f.batchSize(30, 5000, 50, 8), f.MAX_BATCH, 'no máximo um lote');
  assert.equal(f.batchSize(12, 150, 100, 8), 0, 'menos de 2 frames: pára (as amostras ficam mais espaçadas)');
  assert.equal(f.batchSize(0, 9999, 10, 8), 0);
  assert.equal(f.videoBudget(5000, 0, 2), 2500);
  assert.equal(f.videoBudget(5000, 0, 1), 3000, 'no máximo 3 s por vídeo');
  assert.equal(f.videoBudget(5000, 4900, 5), 700, 'pelo menos 0,7 s');
  // Com o tempo do site (5 s), 10 vídeos de 30 s: cada um fica com ~0,7 s, o primeiro lote e o que mais couber.
  let seen = 0, left = 60, ms = 0;
  const per = 60;
  const budget = f.videoBudget(5000, 0, 10) - f.GRID_RESERVE_MS;
  for (;;) { const n = f.batchSize(left, budget - ms, seen ? per : 0, seen); if (!n) break; seen += n; left -= n; ms += n * per; }
  assert.ok(seen >= f.FIRST_BATCH && ms <= Math.max(budget, f.FIRST_BATCH * per), `${seen} frames em ${ms} ms`);
});

// ---------------------------------------------------------------- o servidor

test('som do servidor: lê a resposta e desconfia do que não serve', () => {
  assert.deepEqual(f.parseSoundReply({ hasAudio: true, energy: [0, 0.5, 1.4, 'x'], rate: 4, loudestMs: 500 }), { hasAudio: true, sound: { energy: [0, 0.5, 1, 0], rate: 4 }, loudestMs: 500 });
  assert.deepEqual(f.parseSoundReply({ hasAudio: false, energy: [], rate: 4, loudestMs: null }), { hasAudio: false, sound: null, loudestMs: null });
  assert.equal(f.parseSoundReply({ energy: [1] }), null);
  assert.equal(f.parseSoundReply(null), null);
  assert.equal(f.parseSoundReply({ hasAudio: true, energy: [0.2], rate: -1 }).sound.rate, 4);
  assert.equal(f.soundDoneLabel(0, 0), 'Sem som a tempo: fica a imagem');
  assert.equal(f.soundDoneLabel(2, 0), 'Os vídeos não têm som');
  assert.equal(f.soundDoneLabel(2, 1), null);
});

test('fases: na app entra «A ouvir o som…» a seguir às fotos; no site ficam as de sempre', () => {
  assert.deepEqual(m.magicPhases(false).map((p) => p.id), m.MAGIC_PHASES.map((p) => p.id));
  assert.deepEqual(m.magicPhases(true).map((p) => p.id), ['ver', 'fotos', 'som', 'ritmo', 'historia', 'onda']);
  assert.equal(m.magicPhases(true)[0].label, 'A ver os teus vídeos…');
  assert.equal(m.magicPhases(true)[2].label, 'A ouvir o som…');
});
