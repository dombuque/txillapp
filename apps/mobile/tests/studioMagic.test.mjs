// «Montagem mágica» (src/lib/studio/magic.ts): os melhores momentos dos vídeos, o enquadramento das fotos, a ordem com
// história, o encaixe no ritmo, as ondas, a semente (a mesma dá o mesmo, outra dá outra versão) e os clipes trancados.
// Correr em apps/mobile:  node --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const lib = (...p) => path.join(ROOT, 'src', 'lib', ...p);
const m = await import(pathToFileURL(lib('studio', 'magic.ts')).href);
const rules = await import(pathToFileURL(lib('tchekaRules.ts')).href);
const near = (a, b, eps, msg = '') => assert.ok(Math.abs(a - b) <= eps, `${msg} ${a} ≈ ${b} (±${eps})`);
const { w: W, h: H } = m.ANALYSIS;

/** Um frame de 32×56 pintado por uma função (x, y) → [r, g, b]. */
function frame(fn) {
  const px = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const [r, g, b] = fn(x, y); px.set([r, g, b, 255], (y * W + x) * 4); }
  return px;
}
const checker = (size, lo, hi, dx = 0) => frame((x, y) => { const v = (Math.floor((x + dx) / size) + Math.floor(y / size)) % 2 ? hi : lo; return [v, v, v]; });

// ---------------------------------------------------------------- frames

test('frames: luz, nitidez, cor e movimento', () => {
  const flat = frame(() => [128, 128, 128]);
  const sharp = checker(2, 40, 220);
  const a = m.frameStats(flat, W, H), b = m.frameStats(sharp, W, H);
  near(a.luma, 0.5, 0.01, 'luz do cinzento');
  assert.equal(a.sharp, 0, 'um frame liso não tem nitidez');
  assert.ok(b.sharp > 0.3, `o xadrez é nítido (${b.sharp})`);
  assert.equal(a.sat, 0);
  const red = m.frameStats(frame(() => [220, 30, 30]), W, H);
  assert.ok(red.sat > 0.8 && red.rgb[0] > red.rgb[1]);
  // Parado: zero. Uma mancha que anda: pouco movimento, em poucos blocos. O quadro todo a mudar: muito, em todos.
  const g0 = m.grayOf(sharp, W, H);
  assert.deepEqual(m.frameMotion(g0, g0, W, H), { motion: 0, spread: 0 });
  const blob = (cx) => frame((x, y) => (Math.hypot(x - cx, y - 28) < 5 ? [240, 240, 240] : [60, 60, 60]));
  const local = m.frameMotion(m.grayOf(blob(10), W, H), m.grayOf(blob(14), W, H), W, H);
  assert.ok(local.motion > 0 && local.spread < 0.5, `mancha: ${JSON.stringify(local)}`);
  const all = m.frameMotion(g0, m.grayOf(checker(2, 40, 220, 2), W, H), W, H);
  assert.ok(all.spread >= 0.9 && all.motion > 0.3, `tudo a mexer: ${JSON.stringify(all)}`);
});

// ---------------------------------------------------------------- momentos

/** Um vídeo de 12 s: escuro no início, tremido aos 4–6 s, vivo e nítido aos 8–10 s, parado no resto. */
function track12() {
  const samples = [];
  for (let t = 0; t <= 12; t += 0.5) {
    let s = { t, luma: 0.45, sharp: 0.08, motion: 0.01, spread: 0.1, audio: 0.2 };
    if (t < 2) s = { ...s, luma: 0.03, motion: 0.05 };
    else if (t >= 4 && t <= 6) s = { ...s, motion: 0.3, spread: 1, sharp: 0.02, audio: 0.6 };
    else if (t >= 8 && t <= 10) s = { ...s, motion: 0.07, spread: 0.4, sharp: 0.1, audio: 0.9 };
    samples.push(s);
  }
  return { duration: 12, samples };
}

test('momentos: escolhe o trecho mais vivo e foge do escuro e do tremido', () => {
  const tr = track12();
  const sc = m.sampleScores(tr);
  const at = (t) => sc[tr.samples.findIndex((s) => s.t === t)];
  assert.ok(at(9) > at(5) * 2, `vivo (${at(9)}) muito acima do tremido (${at(5)})`);
  assert.ok(at(9) > at(1) * 4, `vivo (${at(9)}) muito acima do escuro (${at(1)})`);
  assert.ok(at(9) > at(11), 'vivo acima do parado');
  const [best, second] = m.bestMoments(tr, 2, 3);
  assert.ok(best.start >= 7.5 && best.end <= 10.5, `o melhor trecho é o vivo: ${JSON.stringify(best)}`);
  assert.ok(best.peak >= 8 && best.peak <= 10);
  near(best.end - best.start, 2, 1e-9);
  assert.ok(second && Math.min(best.end, second.end) - Math.max(best.start, second.start) < 1, 'o segundo não repete o primeiro');
  assert.ok(best.score >= second.score);
  // Nenhum dos escolhidos cai no escuro.
  for (const mo of m.bestMoments(tr, 2, 3)) assert.ok(mo.start >= 1.5, `fora do escuro: ${mo.start}`);
});

test('momentos: vídeos curtos, sem amostras e sem som', () => {
  assert.deepEqual(m.bestMoments({ duration: 1.5, samples: [] }, 3), [{ start: 0, end: 1.5, score: 0, peak: 0.75 }]);
  const tr = { duration: 4, samples: [0, 1, 2, 3, 4].map((t) => ({ t, luma: 0.5, sharp: 0.05 + t * 0.01, motion: t === 3 ? 0.08 : 0.01, spread: 0.2 })) };
  const [b] = m.bestMoments(tr, 10);
  assert.deepEqual([b.start, b.end], [0, 4], 'pedir mais do que há dá o vídeo todo');
  const [c] = m.bestMoments(tr, 1.5);
  assert.ok(c.start <= 3 && c.end >= 3, `sem som, manda o movimento: ${JSON.stringify(c)}`);
});

// ---------------------------------------------------------------- fotos

const SKIN = [150, 95, 70]; // um tom de pele escuro
const SKIN_LIGHT = [225, 172, 140];

test('pele: tons claros e escuros contam, céu, relva e paredes não', () => {
  assert.ok(m.isSkin(...SKIN) && m.isSkin(...SKIN_LIGHT) && m.isSkin(96, 60, 46));
  for (const c of [[90, 150, 230], [60, 140, 60], [240, 240, 240], [20, 20, 20], [250, 220, 40]]) assert.ok(!m.isSkin(...c), `não é pele: ${c}`);
});

test('fotos: o ponto de interesse vai para a cara e o enquadramento nunca a corta', () => {
  // Uma cara em cima à direita, num fundo de céu liso.
  const px = frame((x, y) => (Math.hypot((x - 24) / 4, (y - 14) / 6) < 1 ? SKIN : [90, 150, 230]));
  const f = m.photoFocus(px, W, H);
  assert.ok(f.face, 'há uma cara');
  near(f.x, 24.5 / W, 0.05, 'x da cara');
  near(f.y, 14.5 / H, 0.05, 'y da cara');
  assert.ok(f.box.x0 < 21 / W && f.box.x1 > 28 / W && f.box.y0 < 9 / H && f.box.y1 > 20 / H, `a caixa cobre a cara: ${JSON.stringify(f.box)}`);

  // Numa foto deitada 4:3 (4000×3000), a parte à vista é 42 % da largura: aponta à cara, sem a cortar, do início ao fim do zoom.
  const fr = m.framingFor(f, 4 / 3, { zoom: 0.12 });
  assert.equal(fr.mode, 'cover');
  assert.ok(fr.to >= 1 && fr.to <= 1.12);
  for (const u of [0, 0.5, 1]) {
    const r = m.coverRect(4000, 3000, fr, u);
    near(r.sw / r.sh, 1080 / 1920, 0.001, 'o corte é 9:16');
    assert.ok(r.sx >= 0 && r.sy >= 0 && r.sx + r.sw <= 4000.01 && r.sy + r.sh <= 3000.01, 'dentro da foto');
    assert.ok(r.sx <= f.box.x0 * 4000 + 1 && r.sx + r.sw >= f.box.x1 * 4000 - 1, `a cara cabe na largura (u=${u}): ${JSON.stringify(r)}`);
    assert.ok(r.sy <= f.box.y0 * 3000 + 1 && r.sy + r.sh >= f.box.y1 * 3000 - 1, `a cara cabe na altura (u=${u})`);
  }
  // O corte ao centro (o de sempre) cortava-a: a cara está à direita do meio.
  assert.ok(m.coverRect(4000, 3000, { x: 0.5, y: 0.5, from: 1, to: 1 }, 0).sx + 1687.5 < f.box.x1 * 4000, 'ao centro a cara ficava cortada');
});

test('fotos: caras que não cabem vão para a moldura; sem cara aponta ao contraste', () => {
  // Um grupo de pessoas de lado a lado numa panorâmica: nenhum corte 9:16 as apanha todas.
  const group = frame((x, y) => (y > 18 && y < 40 && x > 2 && x < 30 ? SKIN_LIGHT : [40, 90, 40]));
  const f = m.photoFocus(group, W, H);
  assert.ok(f.face);
  assert.equal(m.framingFor(f, 16 / 9, { zoom: 0.1 }).mode, 'frame', 'não corta caras ao meio: moldura');
  // Com molduras ligadas, uma foto muito deitada vai sempre inteira; uma ao alto enche o quadro.
  const plain = m.photoFocus(frame((x, y) => (Math.hypot(x - 8, y - 40) < 5 ? [255, 220, 0] : [30, 40, 90])), W, H);
  assert.ok(!plain.face);
  near(plain.x, 8.5 / W, 0.08, 'aponta ao objeto');
  near(plain.y, 40.5 / H, 0.08);
  assert.equal(m.framingFor(plain, 16 / 9, { frames: true }).mode, 'frame');
  assert.equal(m.framingFor(plain, 16 / 9, { frames: false }).mode, 'cover');
  assert.equal(m.framingFor(plain, 3 / 4, { frames: true }).mode, 'cover');
  const out = m.framingFor(plain, 9 / 16, { zoom: 0.1, out: true });
  assert.deepEqual([out.from, out.to], [1.1, 1], 'zoom para fora');
  // Uma foto lisa não rebenta.
  const flat = m.photoFocus(frame(() => [128, 128, 128]), W, H);
  assert.ok(Number.isFinite(flat.x) && Number.isFinite(flat.y) && !flat.face);
});

// ---------------------------------------------------------------- história

const item = (key, video, o = {}) => ({ key, video, aspect: 9 / 16, duration: video ? 10 : 0, luma: 0.5, sat: 0.4, rgb: [0.5, 0.5, 0.5], strength: 0.5, calm: 0.5, energy: 0.5, ...o });
const WARM = { rgb: [0.8, 0.5, 0.3], luma: 0.6 }, COLD = { rgb: [0.2, 0.4, 0.8], luma: 0.35 };

test('história: abre com o mais forte, fecha no mais calmo, alterna e junta cores parecidas', () => {
  const items = [
    item('f-quente-1', false, { ...WARM }), item('f-fria-1', false, { ...COLD }), item('f-calma', false, { ...COLD, calm: 0.95, strength: 0.2 }),
    item('v-forte', true, { ...WARM, strength: 0.95 }), item('v-quente', true, { ...WARM }), item('v-frio', true, { ...COLD }), item('f-quente-2', false, { ...WARM }),
  ];
  for (const seed of [1, 2, 3, 4, 5]) {
    const order = m.orderStory(items, m.seeded(seed));
    assert.equal(order.length, items.length);
    assert.equal(new Set(order).size, items.length, 'cada plano entra uma vez');
    assert.equal(order[0], 'v-forte', 'abre com o mais forte');
    assert.equal(order.at(-1), 'f-calma', 'fecha no mais calmo');
    const by = new Map(items.map((i) => [i.key, i]));
    const mid = order.slice(0, -1).map((k) => by.get(k));
    let same = 0, jumps = 0;
    for (let i = 1; i < mid.length; i++) { if (mid[i].video === mid[i - 1].video) same++; if (m.lookDistance(mid[i], mid[i - 1]) > 0.2) jumps++; }
    assert.ok(same <= 1, `alterna fotos e vídeos (seguidos do mesmo tipo: ${same}) ${order}`);
    assert.ok(jumps <= 1, `as cores quentes ficam juntas e as frias também (saltos: ${jumps}) ${order}`);
  }
});

test('história: posições trancadas e listas pequenas', () => {
  const items = [item('a', false, { strength: 0.9 }), item('b', true), item('c', false, { calm: 0.9 }), item('d', true)];
  const o = m.orderStory(items, m.seeded(1), { 0: 'd', 2: 'a' });
  assert.equal(o[0], 'd');
  assert.equal(o[2], 'a');
  assert.equal(new Set(o).size, 4);
  assert.deepEqual(m.orderStory([], m.seeded(1)), []);
  assert.deepEqual(m.orderStory([item('x', false)], m.seeded(1)), ['x']);
  assert.equal(m.orderStory([item('x', false), item('y', true, { strength: 0.9 })], m.seeded(1))[0], 'y');
  assert.ok(m.lookDistance(item('a', false, WARM), item('b', false, WARM)) < 1e-9);
  assert.ok(m.lookDistance(item('a', false, WARM), item('b', false, COLD)) > 0.3);
});

// ---------------------------------------------------------------- música

test('música: energia em blocos e o trecho escolhido', () => {
  const rate = 1000;
  const s = new Float32Array(rate * 60);
  // Calmo até aos 30 s, forte dos 30 aos 45 s, médio no resto.
  for (let i = 0; i < s.length; i++) { const t = i / rate; s[i] = (t < 30 ? 0.1 : t < 45 ? 0.9 : 0.4) * (i % 2 ? 1 : -1); }
  const e = m.energyBlocks(s, rate);
  assert.equal(e.length, 600);
  near(e[350], 1, 1e-6, 'o bloco mais forte vale 1');
  near(e[100], 0.1111, 0.001);
  near(m.pickMusicStart(e, 15, 'forte'), 30, 0.25, 'forte: a janela com mais energia');
  near(m.pickMusicStart(e, 15, 'subida'), 24, 0.25, 'subida: a entrada a 40 % da janela');
  assert.ok(m.pickMusicStart(e, 15, 'calmo') < 15.01, 'calmo: a parte tranquila');
  assert.equal(m.pickMusicStart(e, 80), 0, 'música mais curta do que a janela: do início');
  assert.deepEqual(m.energyBlocks(new Float32Array(0), rate), []);
  near(m.beatUnit(120), 0.5, 1e-9);
  near(m.beatUnit(170), 60 / 170 * 2, 1e-9, 'músicas muito rápidas: conta de duas em duas');
  near(m.beatUnit(null), 0.5, 1e-9, 'sem ritmo claro: 120');
});

// ---------------------------------------------------------------- a montagem

const source = (key, video, durS) => ({ key, uri: `blob:${key}`, video, mime: video ? 'video/mp4' : 'image/jpeg', ...(video ? { durationMs: durS * 1000 } : {}) });
/** Um vídeo com o instante mais vivo em `peak`. */
function vtrack(dur, peak) {
  const samples = [];
  for (let t = 0; t <= dur; t += 0.25) { const hot = Math.abs(t - peak) < 0.3; samples.push({ t, luma: 0.5, sharp: hot ? 0.1 : 0.06, motion: hot ? 0.09 : 0.012, spread: hot ? 0.5 : 0.15, audio: hot ? 1 : 0.15 }); }
  return { duration: dur, samples };
}
/** 3 fotos + 2 vídeos e uma música a 120 BPM, calma até aos 3 s e forte daí em diante. */
function scene() {
  const sources = [source('f1', false), source('f2', false), source('f3', false), source('v1', true, 12), source('v2', true, 9)];
  const focus = { x: 0.5, y: 0.4, box: { x0: 0.35, y0: 0.25, x1: 0.65, y1: 0.55 }, face: true, strength: 0.5 };
  const items = [
    m.photoItem('f1', 3 / 4, { luma: 0.6, sharp: 0.08, sat: 0.5, rgb: [0.8, 0.5, 0.3] }, focus),
    m.photoItem('f2', 16 / 9, { luma: 0.35, sharp: 0.05, sat: 0.3, rgb: [0.2, 0.4, 0.8] }, { ...focus, strength: 0.2 }),
    m.photoItem('f3', 9 / 16, { luma: 0.5, sharp: 0.04, sat: 0.1, rgb: [0.5, 0.5, 0.5] }, { ...focus, face: false, strength: 0.05 }),
    m.videoItem('v1', 9 / 16, vtrack(12, 7), { luma: 0.55, sat: 0.5, rgb: [0.7, 0.5, 0.3] }, true),
    m.videoItem('v2', 9 / 16, vtrack(9, 2.5), { luma: 0.4, sat: 0.4, rgb: [0.3, 0.4, 0.7] }, true),
  ];
  const energy = Array.from({ length: 600 }, (_, i) => (i < 30 ? 0.25 : 0.9));
  return { sources, items, music: { startMs: 12000, bpm: 120, energy } };
}
const build = (o = {}) => m.buildMontage({ ...scene(), wave: 'malta', seed: 1, ...o });

test('montagem: um projeto válido, com todos os ficheiros, dentro das regras', () => {
  for (const wave of m.WAVES) {
    const r = build({ wave: wave.id });
    assert.equal(r.clips.length, 5, wave.id);
    assert.equal(new Set(r.clips.map((c) => c.key)).size, 5);
    assert.deepEqual(r.left, []);
    near(r.total, r.durations.reduce((a, b) => a + b, 0), 0.01);
    assert.ok(r.total >= m.MAGIC_MIN_S && r.total <= m.MAGIC_MAX_S, `${wave.id}: ${r.total} s`);
    r.clips.forEach((c, i) => {
      const sp = c.speed, avg = c.fx?.ramp ? m.rampIntegral(m.RAMP_POINTS[c.fx.ramp], 1) : 1;
      if (c.video) {
        assert.ok(c.trim.start >= 0 && c.trim.end <= c.length + 1e-6 && c.trim.end > c.trim.start, `corte dentro do ficheiro: ${JSON.stringify(c.trim)}`);
        near((c.trim.end - c.trim.start) / sp / avg, r.durations[i], 0.005, 'a duração do vídeo é a do corte (com a rampa)');
      } else {
        near(c.seconds, r.durations[i], 1e-6);
        assert.ok(c.fx.focus && c.fx.focus.to >= 1 && c.fx.focus.from >= 1, 'as fotos levam o ponto de interesse');
      }
      assert.equal(c.fx.filter.id, wave.filter.id, 'o filtro da onda');
      if (i > 0) assert.ok(c.fx.transition, 'todos os clipes menos o primeiro têm transição');
      else assert.equal(c.fx.transition, undefined);
    });
    const check = rules.checkTcheka({ clips: r.clips.map((c, i) => ({ video: c.video, seconds: r.durations[i], hasAudio: c.hasAudio })), music: true });
    assert.ok(check.ok, `${wave.id}: ${check.hint}`);
    assert.equal(r.overlays.length, 1);
    assert.ok(wave.openers.includes(r.overlays[0].text));
    assert.ok(r.overlays[0].start >= 0 && r.overlays[0].end <= r.total);
    assert.equal(r.music.startMs, 12000);
    for (const s of r.sfx) assert.ok(s.at >= 0 && s.at <= r.total, `efeito sonoro dentro da tcheka: ${JSON.stringify(s)}`);
  }
});

test('ritmo: todos os cortes caem em batidas', () => {
  for (const bpm of [120, 96, 172, null]) {
    for (const wave of m.WAVES) {
      const r = build({ wave: wave.id, music: { ...scene().music, bpm } });
      const unit = m.beatUnit(bpm);
      near(r.music.beat, unit, 1e-4);
      for (const t of m.magicCuts(r)) { const k = t / unit; near(k, Math.round(k), 0.02, `${wave.id} a ${bpm} BPM: corte aos ${t} s fora da batida`); }
      assert.equal(m.magicCuts(r).length, r.clips.length - 1);
      r.clips.forEach((c, i) => { if (!c.video) near(c.seconds, c.beats * unit, 0.002, 'as fotos duram as batidas delas'); assert.ok(c.beats >= 1 && c.beats <= 16, `batidas: ${c.beats} (${i})`); });
      // E a conta do estúdio («ao ritmo») dá as mesmas durações para as fotos.
      const grid = rules.beatGrid(bpm ?? 120, 0, 90).filter((_, i) => i % Math.round(unit / (60 / (bpm ?? 120))) === 0);
      const dur = rules.rhythmDurations(r.clips.map((c, i) => ({ video: c.video, seconds: r.durations[i], beats: c.beats })), grid);
      dur.forEach((d, i) => near(d, r.durations[i], 0.01, `rhythmDurations do estúdio (${wave.id}, ${bpm})`));
    }
  }
});

test('ritmo: o instante mais vivo do vídeo cai na parte forte da música', () => {
  // A música é calma até aos 3 s e forte depois; o vídeo mais vivo vai para a parte forte.
  const sc = scene();
  sc.sources.push(source('v3', true, 10), source('f4', false), source('f5', false));
  const calmTrack = { duration: 10, samples: vtrack(10, 5).samples.map((s) => ({ ...s, motion: 0.004, audio: 0.05, sharp: 0.05, spread: 0.05 })) };
  sc.items.push(m.videoItem('v3', 9 / 16, calmTrack, { luma: 0.5, sat: 0.3, rgb: [0.5, 0.5, 0.5] }, true));
  const f = { x: 0.5, y: 0.4, box: { x0: 0.4, y0: 0.3, x1: 0.6, y1: 0.5 }, face: false, strength: 0.2 };
  sc.items.push(m.photoItem('f4', 9 / 16, { luma: 0.5, sharp: 0.05, sat: 0.3, rgb: [0.6, 0.5, 0.4] }, f), m.photoItem('f5', 9 / 16, { luma: 0.5, sharp: 0.05, sat: 0.3, rgb: [0.4, 0.5, 0.6] }, f));
  let checked = 0;
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    const r = m.buildMontage({ ...sc, wave: 'tofo', seed });
    const by = new Map(sc.items.map((i) => [i.key, i]));
    const mids = r.clips.map((c, i) => ({ c, i })).filter(({ c, i }) => c.video && i > 0 && i < r.clips.length - 1);
    const e = (i) => { const a = Math.floor(r.starts[i] * 10), b = Math.ceil((r.starts[i] + r.durations[i]) * 10); return sc.music.energy.slice(a, b).reduce((x, y) => x + y, 0) / (b - a); };
    for (const a of mids) for (const b of mids) if (e(a.i) > e(b.i) + 0.05) { assert.ok(by.get(a.c.key).energy >= by.get(b.c.key).energy, `seed ${seed}: o vídeo mais vivo fica onde a música é mais forte`); checked++; }
    // O pico (aos 7 s do v1, aos 2,5 s do v2) fica dentro do corte.
    for (const [key, peak] of [['v1', 7], ['v2', 2.5]]) { const c = r.clips.find((x) => x.key === key); assert.ok(c.trim.start <= peak + 0.3 && c.trim.end >= peak - 0.3, `seed ${seed}: o corte do ${key} apanha o pico (${JSON.stringify(c.trim)})`); }
  }
  assert.ok(checked > 0, 'houve casos com vídeos em partes de energia diferente');

  // Sem rampa: o pico do vídeo cai em cima da batida mais forte da música dentro do clipe.
  const energy = Array.from({ length: 600 }, (_, i) => (i >= 20 && i < 25 ? 1 : 0.3));
  const one = m.buildMontage({ sources: [source('v1', true, 12)], items: [{ ...sc.items[3], energy: 0.4 }], music: { startMs: 0, bpm: 120, energy }, wave: 'noite', seed: 3 });
  const c = one.clips[0];
  assert.equal(c.fx.ramp, undefined);
  near(c.trim.start + 2.0, 7, 0.3, `o pico (7 s do ficheiro) cai aos 2 s da tcheka, onde a música bate mais forte: ${JSON.stringify(c.trim)}`);
});

test('rampas: só nos vídeos vivos, com o momento a cair no abrandamento', () => {
  let ramps = 0;
  for (const seed of [1, 2, 3, 4]) {
    for (const wave of m.WAVES) {
      const r = build({ wave: wave.id, seed });
      const used = r.clips.filter((c) => c.fx?.ramp);
      assert.ok(used.length <= wave.rampMax, `${wave.id}: no máximo ${wave.rampMax} rampas`);
      for (const c of used) {
        ramps++;
        assert.equal(c.fx.ramp, wave.ramp);
        assert.ok(c.video);
        const i = r.clips.indexOf(c);
        assert.ok(r.durations[i] >= 2 - 1e-6, 'uma rampa precisa de 2 s para se notar');
      }
    }
  }
  assert.ok(ramps > 0, 'alguma onda usou a rampa dela');
  near(m.rampIntegral(m.RAMP_POINTS.heroi, 1), 0.3 + 0.12 * 0.625 + 0.28 * 0.25 + 0.12 * 0.625 + 0.18, 1e-9, 'a média do Herói');
});

test('semente: a mesma dá a mesma montagem, outra dá outra versão', () => {
  const a = build({ seed: 7 }), b = build({ seed: 7 });
  assert.deepEqual(a, b, 'determinística');
  assert.equal(JSON.stringify(a), JSON.stringify(b));
  const sigs = new Set();
  for (let seed = 1; seed <= 12; seed++) sigs.add(m.magicSignature(build({ seed })));
  assert.ok(sigs.size >= 6, `12 sementes dão pelo menos 6 montagens diferentes (${sigs.size})`);
  assert.notEqual(m.magicSignature(build({ seed: 1 })), m.magicSignature(build({ seed: 1, wave: 'casamento' })), 'outra onda, outra montagem');
  assert.equal(m.nextMagicSeed(41), 42);
  assert.notEqual(m.nextMagicSeed(999999), 999999);
});

test('«Outra versão»: os clipes trancados ficam no lugar e como estavam', () => {
  const first = build({ seed: 1 });
  const lockA = first.clips[1], lockB = first.clips[3];
  let changed = 0;
  for (let seed = 2; seed <= 9; seed++) {
    const next = build({ seed, keep: { result: first, locked: [lockA.key, lockB.key] } });
    assert.deepEqual(next.clips[1], lockA, `seed ${seed}: o trancado fica na posição 1, igual`);
    assert.deepEqual(next.clips[3], lockB);
    assert.equal(new Set(next.clips.map((c) => c.key)).size, 5);
    assert.equal(next.story[1].why, 'Trancado: ficou como estava');
    for (const t of m.magicCuts(next)) near(t / 0.5, Math.round(t / 0.5), 0.02, 'continua ao ritmo');
    if (m.magicSignature(next) !== m.magicSignature(first)) changed++;
  }
  assert.ok(changed >= 4, `o resto muda de versão para versão (${changed}/8)`);
  // Trancar tudo: fica igual.
  const all = build({ seed: 5, keep: { result: first, locked: first.clips.map((c) => c.key) } });
  assert.deepEqual(all.clips, first.clips);
});

test('limites: muitos ficheiros cabem em 58 s, poucos chegam aos 6 s', () => {
  const sources = [], items = [];
  const f = { x: 0.5, y: 0.4, box: { x0: 0.4, y0: 0.3, x1: 0.6, y1: 0.5 }, face: false, strength: 0.3 };
  for (let i = 0; i < 40; i++) {
    const video = i % 4 === 0;
    sources.push(source(`k${i}`, video, 20));
    items.push(video ? m.videoItem(`k${i}`, 9 / 16, vtrack(20, 5 + (i % 7)), { luma: 0.5, sat: 0.4, rgb: [0.5, 0.4, 0.3] }, true) : m.photoItem(`k${i}`, 3 / 4, { luma: 0.4 + (i % 5) / 10, sharp: 0.05, sat: 0.4, rgb: [(i % 3) / 3, 0.5, 0.5] }, f));
  }
  for (const wave of m.WAVES) {
    const r = m.buildMontage({ sources, items, music: { startMs: 0, bpm: 100, energy: [] }, wave: wave.id, seed: 2 });
    assert.ok(r.total <= m.MAGIC_MAX_S + 0.01, `${wave.id}: ${r.total} s`);
    assert.equal(r.clips.length + r.left.length, 40, 'os que não cabem ficam em `left`');
    assert.ok(r.clips.length >= 20, `${wave.id}: cabem pelo menos 20 (${r.clips.length})`);
  }
  const few = m.buildMontage({ sources: sources.slice(1, 4), items: items.slice(1, 4), music: { startMs: 0, bpm: 180, energy: [] }, wave: 'marrabenta', seed: 1 });
  assert.ok(few.total >= m.MAGIC_MIN_S, `3 fotos numa música rápida chegam aos 6 s (${few.total})`);
  const empty = m.buildMontage({ sources: [], items: [], music: null, wave: 'malta', seed: 1 });
  assert.deepEqual([empty.clips, empty.total, empty.overlays, empty.music], [[], 0, [], null]);
  // Sem música: monta a 120 BPM. Sem análise (um vídeo que não abriu): usa o início.
  const blind = m.buildMontage({ sources: [source('v', true, 8)], items: [m.videoItem('v', 9 / 16, { duration: 8, samples: [] }, { luma: 0.5, sat: 0.3, rgb: [0.5, 0.5, 0.5] })], music: null, wave: 'tofo', seed: 1 });
  assert.equal(blind.clips[0].trim.start, 0);
  assert.ok(blind.clips[0].trim.end > 2);
  // Um título próprio, ou nenhum.
  assert.equal(build({ title: 'Domingo na Costa do Sol' }).overlays[0].text, 'Domingo na Costa do Sol');
  assert.deepEqual(build({ title: '' }).overlays, []);
});

test('capulana: desligada só usa ids do effects.ts; ligada põe pano, molduras e letras', () => {
  const STD = new Set(['corte', 'fundido', 'deslizar-esquerda', 'deslizar-direita', 'deslizar-cima', 'deslizar-baixo', 'zoom', 'desfoque', 'girar', 'flash', 'brilho', 'glitch']);
  let panos = 0, frames = 0;
  for (const wave of m.WAVES) {
    for (const seed of [1, 2, 3]) {
      const off = build({ wave: wave.id, seed });
      for (const c of off.clips) { if (c.fx?.transition) assert.ok(STD.has(c.fx.transition.type), `${c.fx.transition.type}`); assert.equal(c.fx?.moldura, undefined); assert.equal(c.fx?.transition?.pano, undefined); }
      assert.equal(off.overlays[0].pano, undefined);
      const on = build({ wave: wave.id, seed, capulana: true });
      let last = -9;
      on.clips.forEach((c, i) => {
        const t = c.fx?.transition;
        if (t?.type.startsWith('capulana-')) { panos++; assert.equal(t.type, wave.panoTransition); assert.deepEqual(t.pano, on.pano); assert.ok(i - last >= 2, 'nunca dois panos seguidos'); last = i; }
        if (c.fx?.moldura) { frames++; assert.ok(!c.video); assert.deepEqual(c.fx.moldura, on.pano); }
      });
      assert.equal(on.pano.pattern, wave.pano.pattern);
      assert.equal(on.clips.find((c) => c.key === 'f2').fx.moldura?.palette, wave.pano.palette, 'a foto deitada (16:9) vai na moldura');
    }
  }
  assert.ok(panos >= 12 && frames >= 18, `panos: ${panos}, molduras: ${frames}`);
});

test('ondas: 6, com tudo o que decidem, e as fases do ecrã «a montar»', () => {
  assert.equal(m.WAVES.length, 6);
  assert.deepEqual(m.WAVES.map((w) => w.name), ['Marginal ao pôr do sol', 'Noite de Maputo', 'Praia do Tofo', 'Casamento', 'Txiling com a malta', 'Marrabenta']);
  assert.equal(new Set(m.WAVES.map((w) => w.filter.id)).size, 6, 'cada onda tem o filtro dela');
  for (const w of m.WAVES) {
    assert.ok(w.mood && w.recipe && w.openers.length >= 3 && w.transitions.length && w.strong.length);
    assert.ok(w.filter.amount > 0 && w.filter.amount <= 1);
    assert.ok(!w.ramp || m.RAMP_POINTS[w.ramp], `rampa ${w.ramp}`);
    assert.ok(Object.keys(w.sfx).length >= 1);
    assert.equal(m.waveById(w.id), w);
  }
  assert.equal(m.waveById('nao-existe').id, 'marginal');
  assert.deepEqual(m.MAGIC_PHASES.map((p) => p.label).slice(0, 3), ['A ver os teus vídeos…', 'A enquadrar as fotos…', 'A apanhar o ritmo…']);
});

// ---------------------------------------------------------------- com os outros ramos (quando já estiverem juntos)

const fxPath = lib('studio', 'effects.ts'), projPath = lib('studio', 'project.ts'), dspPath = lib('studio', 'audioDsp.ts');

test('integração: as ondas só usam filtros, transições, rampas, letras e animações que o effects.ts tem', { skip: !existsSync(fxPath) && 'o effects.ts ainda não está neste ramo' }, async () => {
  const fx = await import(pathToFileURL(fxPath).href);
  const trans = new Set(fx.TRANSITIONS.map((t) => t.id)), fonts = new Set(fx.FONTS.map((f) => f.id)), anims = new Set(fx.ANIMS.map((a) => a.id));
  for (const w of m.WAVES) {
    assert.ok(fx.filterById(w.filter.id), `filtro ${w.filter.id}`);
    for (const t of [...w.transitions, ...w.strong]) assert.ok(trans.has(t), `transição ${t}`);
    assert.ok(fonts.has(w.font) && anims.has(w.textAnim));
  }
  for (const r of fx.RAMPS) assert.deepEqual(m.RAMP_POINTS[r.id], r.points, `rampa ${r.id} igual à do effects.ts`);
  // O que a montagem escreve passa pelo `sanitizeFx`/`sanitizeOverlay` sem perder o que o effects.ts conhece.
  const r = build({ seed: 3 });
  for (const c of r.clips) { const s = fx.sanitizeFx(c.fx); assert.deepEqual(s.filter, c.fx.filter); if (c.fx.transition) assert.deepEqual(s.transition, c.fx.transition); assert.equal(s.ramp, c.fx.ramp); }
  assert.ok(fx.sanitizeOverlay(r.overlays[0]), 'o texto de abertura é uma camada válida');
  r.clips.forEach((c, i) => { if (c.video) near(fx.fxSeconds(c.trim.end - c.trim.start, c.speed, c.fx), r.durations[i], 0.005, 'fxSeconds'); });
});

test('integração: os clipes da montagem são `ProjectClip` válidos', { skip: !existsSync(projPath) && 'o project.ts ainda não está neste ramo' }, async () => {
  const p = await import(pathToFileURL(projPath).href);
  const r = build({ seed: 3 });
  const norm = p.normalizeClips(r.clips);
  assert.deepEqual(norm, r.clips, 'o normalizeClips não muda nada');
});

test('integração: os efeitos sonoros das ondas existem no audioDsp.ts', { skip: !existsSync(dspPath) && 'o audioDsp.ts ainda não está neste ramo' }, async () => {
  const d = await import(pathToFileURL(dspPath).href);
  for (const w of m.WAVES) for (const id of Object.values(w.sfx)) assert.ok(d.isSfx(id), `efeito sonoro ${id}`);
});
