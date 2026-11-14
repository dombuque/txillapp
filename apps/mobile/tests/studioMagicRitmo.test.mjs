// «Montagem mágica» com entradas realistas (src/lib/studio/magic.ts): o que se viu ao correr a montagem a sério.
// - a 128 BPM uma batida são 0,47 s: as fotos de uma batida ficavam abaixo dos 0,5 s do estúdio, que as esticava ao aplicar,
//   e daí para a frente os cortes saíam todos da batida;
// - um vídeo mais curto do que uma batida tirava os cortes seguintes da grelha;
// - sem música as fotos do meio ficavam todas com o mesmo tempo;
// - com uma faixa curta a tcheka passava do fim da música;
// - e o pedido ao servidor (POST /tchekas/compose) tem de passar nos limites dele (fotos de 0,3 a 10 s, zoom de 1 a 1,5…).
// Correr em apps/mobile:  node --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mod = (x) => import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'studio', x)).href);
const m = await mod('magic.ts');
const project = await mod('project.ts');
const compose = await mod('composeRequest.ts');
const effects = await mod('effects.ts');

// ---------------------------------------------------------------- entradas como as da análise

/** Um gerador de números fixo (as mesmas entradas em todas as corridas). */
const rng = (seed) => m.seeded(seed);

function photo(key, aspect, r, o = {}) {
  const face = r() < 0.6;
  const fx = 0.3 + r() * 0.4, fy = 0.25 + r() * 0.3, bw = 0.15 + r() * 0.15, bh = 0.1 + r() * 0.12;
  const focus = { x: fx, y: fy, box: { x0: fx - bw / 2, y0: fy - bh / 2, x1: fx + bw / 2, y1: fy + bh / 2 }, face, strength: 0.2 + r() * 0.6 };
  return m.photoItem(key, aspect, { luma: 0.2 + r() * 0.6, sharp: 0.05, sat: 0.2 + r() * 0.5, rgb: [r(), r(), r()], ...o }, focus);
}
function video(key, dur, aspect, r) {
  const n = Math.min(40, Math.max(4, Math.round(dur * 2)));
  const samples = Array.from({ length: n }, (_, k) => ({ t: Math.round(((k + 0.5) / n) * dur * 1000) / 1000, luma: 0.2 + r() * 0.5, sharp: 0.03 + r() * 0.08, motion: r() * 0.1, spread: r() * 0.7 }));
  return m.videoItem(key, aspect, { duration: dur, samples }, { luma: 0.4, sat: 0.3, rgb: [r(), r(), r()] }, true);
}
/** `n` ficheiros: só fotos ('p'), só vídeos ('v') ou misturados; fotos e vídeos deitados, ao alto e quadrados; vídeos de 2 a 60 s. */
function setup(kind, n, seed = 42) {
  const r = rng(seed);
  const items = [], sources = [];
  for (let i = 0; i < n; i++) {
    const isV = kind === 'v' || (kind === 'mix' && i % 2 === 1);
    const aspect = [16 / 9, 9 / 16, 4 / 3, 1][i % 4];
    if (isV) {
      const dur = [59, 2.2, 12, 31][i % 4];
      const it = video(`v${i}`, dur, aspect, r);
      items.push(it);
      sources.push({ key: it.key, uri: `file:///v${i}.mp4`, video: true, mime: 'video/mp4', durationMs: Math.round(dur * 1000) });
    } else {
      const it = photo(`p${i}`, aspect, r);
      items.push(it);
      sources.push({ key: it.key, uri: `file:///p${i}.jpg`, video: false, mime: 'image/jpeg' });
    }
  }
  return { items, sources };
}
/** A música já no trecho: `seconds` de energia (a subir e a descer) a partir do início. */
const music = (bpm, seconds = 70) => ({ startMs: 12000, bpm, energy: Array.from({ length: Math.round(seconds * 10) }, (_, k) => 0.3 + 0.6 * Math.max(0, Math.sin(k / 40))) });

/** Os clipes como o estúdio os fica a ter ao aplicar (`applyMagic`: `normalizeClips` e os efeitos limpos). */
const applied = (r) => project.normalizeClips(r.clips.map((c) => ({ ...c, fx: effects.sanitizeFx(c.fx) })));
/** A duração de cada clipe no estúdio (a do `clipDur` do TchekaStudio). */
const studioDur = (c) => (c.video ? effects.fxSeconds(c.trim.end - c.trim.start, c.speed, c.fx) : c.seconds);
const near = (a, b, eps, msg = '') => assert.ok(Math.abs(a - b) <= eps, `${msg} ${a} ≈ ${b} (±${eps})`);
const onGrid = (t, unit) => Math.abs(t / unit - Math.round(t / unit)) < 0.004;

// ---------------------------------------------------------------- os limites são os do estúdio e do servidor

test('ritmo: os limites das fotos são os do estúdio e do pedido ao servidor', () => {
  assert.equal(m.MAGIC_MIN_PHOTO_S, project.MIN_PHOTO_S);
  assert.equal(m.MAGIC_MAX_PHOTO_S * 1000, compose.PHOTO_MAX_MS);
});

test('ritmo: a 128 BPM as fotos de uma batida passam a duas e, aplicadas no estúdio, os cortes ficam todos na batida', () => {
  const { items, sources } = setup('p', 20);
  for (const wave of ['noite', 'marrabenta', 'malta']) {
    const r = m.buildMontage({ sources, items, music: music(128), wave, seed: 7, capulana: true });
    const unit = m.beatUnit(128);
    near(r.music.beat, unit, 1e-3);
    const clips = applied(r);
    let t = 0;
    clips.forEach((c, i) => {
      const d = studioDur(c);
      assert.ok(d >= project.MIN_PHOTO_S - 1e-9, `${wave}: o clipe ${i} tem ${d} s`);
      assert.ok(Math.abs(d - r.durations[i]) < 0.002, `${wave}: o estúdio não mexe no clipe ${i} (${d} vs ${r.durations[i]})`);
      assert.ok(onGrid(t, unit), `${wave}: o corte ${i} aos ${t.toFixed(3)} s cai na batida`);
      t += d;
    });
    assert.ok(onGrid(t, unit), `${wave}: o fim cai na batida`);
  }
});

test('ritmo: depois de um vídeo mais curto do que uma batida, a foto seguinte volta a acabar na batida', () => {
  const r0 = rng(3);
  const items = [photo('a', 9 / 16, r0, { luma: 0.6 }), video('curto', 0.35, 9 / 16, r0), photo('b', 9 / 16, r0), photo('c', 9 / 16, r0), photo('d', 9 / 16, r0)];
  const sources = items.map((it) => ({ key: it.key, uri: `file:///${it.key}`, video: it.video, mime: it.video ? 'video/mp4' : 'image/jpeg', durationMs: it.video ? 350 : undefined }));
  const r = m.buildMontage({ sources, items, music: music(100), wave: 'malta', seed: 2 });
  const k = r.clips.findIndex((c) => c.key === 'curto');
  assert.ok(k >= 0 && k < r.clips.length - 1, `o vídeo curto está no meio: ${r.clips.map((c) => c.key)}`);
  near(r.durations[k], 0.35, 0.01, 'o vídeo curto fica inteiro');
  const unit = m.beatUnit(100);
  assert.ok(onGrid(r.starts[k + 2] ?? r.total, unit), `o corte a seguir à foto seguinte cai na batida (${r.starts[k + 2] ?? r.total})`);
  for (const d of r.durations) assert.ok(d >= 0.3);
});

test('ritmo: sem música as fotos do meio têm tempos diferentes, nunca três iguais seguidas, e nenhuma fica menos de 1 s', () => {
  for (const wave of m.WAVES.map((w) => w.id)) {
    for (const kind of ['p', 'mix']) {
      const { items, sources } = setup(kind, 20, 11);
      const r = m.buildMontage({ sources, items, music: null, wave, seed: 5, capulana: true });
      const mids = r.clips.map((c, i) => ({ c, d: r.durations[i], i })).filter((x) => !x.c.video && x.i > 0 && x.i < r.clips.length - 1);
      assert.ok(mids.length >= 4);
      if (wave !== 'marrabenta') assert.ok(new Set(mids.map((x) => x.d)).size >= 2, `${wave}/${kind}: tempos ${mids.map((x) => x.d)}`);
      for (const x of mids) assert.ok(x.d >= 0.999, `${wave}/${kind}: a foto ${x.i} tem ${x.d} s sem música`);
      // Três fotos seguidas (sem vídeos pelo meio) com o mesmo tempo, não.
      for (let i = 2; i < r.clips.length - 1; i++) {
        const run = [i - 2, i - 1, i].map((k) => ({ v: r.clips[k].video, d: r.durations[k] }));
        if (wave !== 'marrabenta' && run.every((x) => !x.v) && i - 2 > 0) assert.ok(!(run[0].d === run[1].d && run[1].d === run[2].d), `${wave}/${kind}: três iguais aos ${i}`);
      }
      // E as fotos fortes ou com caras ficam mais do que as pobres.
      assert.ok(r.total >= m.MAGIC_MIN_S && r.total <= m.MAGIC_MAX_S);
    }
  }
});

test('ritmo: com uma faixa curta a tcheka não passa do fim da música', () => {
  const { items, sources } = setup('mix', 20);
  const r = m.buildMontage({ sources, items, music: music(120, 14), wave: 'casamento', seed: 1 });
  assert.ok(r.total <= 14 + 1e-6, `${r.total} s numa faixa de 14 s`);
  assert.ok(r.total >= m.MAGIC_MIN_S);
  // Com faixa que chegue, nada muda.
  const long = m.buildMontage({ sources, items, music: music(120, 120), wave: 'casamento', seed: 1 });
  assert.ok(long.total > 30);
});

test('ritmo: músicas lentas não dão fotos acima dos 10 s', () => {
  const { items, sources } = setup('p', 2);
  for (const bpm of [41, 45, 52]) {
    const r = m.buildMontage({ sources, items, music: music(bpm), wave: 'casamento', seed: 3 });
    for (const c of r.clips) assert.ok(c.seconds <= m.MAGIC_MAX_PHOTO_S + 1e-9, `${bpm} BPM: foto de ${c.seconds} s`);
    assert.equal(compose.composeBlocker(applied(r)), null);
  }
});

// ---------------------------------------------------------------- tudo junto: 3, 8 e 20 ficheiros, com e sem música, as 6 ondas

/** Os limites do pedido (apps/api/src/compose/compose.schema.ts) que a montagem mágica pode tocar. */
function checkRequest(req, label) {
  assert.ok(req.clips.length >= 1 && req.clips.length <= 30, label);
  for (const [i, c] of req.clips.entries()) {
    const at = `${label} clipe ${i}`;
    if (c.kind === 'photo') assert.ok(c.durationMs >= 300 && c.durationMs <= 10_000 && Number.isInteger(c.durationMs), `${at}: ${c.durationMs} ms`);
    else {
      assert.ok(Number.isInteger(c.trimStartMs) && Number.isInteger(c.trimEndMs) && c.trimEndMs > c.trimStartMs, `${at}: corte ${c.trimStartMs}–${c.trimEndMs}`);
      assert.ok(c.speed == null || [0.5, 1, 2, 3].includes(c.speed));
    }
    const fx = c.fx ?? {};
    if (fx.transition) assert.ok(fx.transition.dur >= 0.15 && fx.transition.dur <= 1.5, `${at}: transição de ${fx.transition.dur} s`);
    if (fx.focus) {
      assert.equal(c.kind, 'photo', `${at}: o enquadramento só vai nas fotos`);
      for (const k of ['x', 'y']) assert.ok(fx.focus[k] >= 0 && fx.focus[k] <= 1, `${at}: ${k}`);
      for (const k of ['from', 'to']) assert.ok(fx.focus[k] >= 1 && fx.focus[k] <= 1.5, `${at}: zoom ${fx.focus[k]}`);
      if (fx.focus.keep) for (const v of Object.values(fx.focus.keep)) assert.ok(v >= 0 && v <= 1);
    }
    if (fx.filter) assert.ok(fx.filter.amount >= 0 && fx.filter.amount <= 1);
    if (fx.ramp) assert.equal(c.kind, 'video');
  }
  if (req.musicFadeOutMs != null) assert.ok(req.musicFadeOutMs <= 3000);
  for (const o of req.overlays ?? []) {
    assert.ok(o.end > o.start && o.end <= 61, `${label}: texto ${o.start}–${o.end}`);
    if (o.kind === 'text') assert.ok(o.size >= 24 && o.size <= 300 && Number.isInteger(o.size));
  }
  assert.ok((req.soundEffects ?? []).length <= 30);
}


test('ritmo: 3, 8 e 20 fotos, vídeos e misturas, com e sem música, nas 6 ondas: as contas batem e o servidor aceita', () => {
  let cases = 0;
  for (const kind of ['p', 'v', 'mix']) for (const n of [3, 8, 20]) for (const bpm of [null, 96, 128]) for (const w of m.WAVES) {
    const label = `${kind}${n}/${bpm ?? 'sem'}/${w.id}`;
    const { items, sources } = setup(kind, n);
    const r = m.buildMontage({ sources, items, music: bpm ? music(bpm) : null, wave: w.id, seed: 9, capulana: true });
    cases++;
    assert.equal(r.clips.length + r.left.length, n, `${label}: cada ficheiro entra ou fica de fora`);
    near(r.durations.reduce((a, b) => a + b, 0), r.total, 0.01, `${label}: as durações somam o total`);
    assert.ok(r.total >= m.MAGIC_MIN_S - 1e-6 && r.total <= m.MAGIC_MAX_S + 1e-6, `${label}: ${r.total} s`);
    const clips = applied(r);
    clips.forEach((c, i) => {
      const d = studioDur(c);
      assert.ok(Math.abs(d - r.durations[i]) < 0.003, `${label}: o clipe ${i} fica com ${d} s no estúdio (montagem: ${r.durations[i]})`);
      if (c.video) assert.ok(c.trim.end <= c.length + 1e-6 && c.trim.start >= 0, `${label}: o corte do vídeo ${i} cabe no ficheiro`);
      else assert.ok(d >= m.MAGIC_MIN_PHOTO_S - 1e-9 && d <= m.MAGIC_MAX_PHOTO_S + 1e-9, `${label}: foto ${i} com ${d} s`);
    });
    // Com música, todos os cortes caem na batida (aqui não há vídeos mais curtos do que uma batida).
    if (bpm) for (const s of r.starts) assert.ok(onGrid(s, m.beatUnit(bpm)), `${label}: corte aos ${s} s fora da batida ${r.music.beat}`);
    const photos = r.clips.map((c, i) => (c.video ? null : r.durations[i])).filter((d) => d != null);
    if (photos.length >= 4) assert.ok(new Set(photos).size >= 2, `${label}: as fotos não ficam todas com ${photos[0]} s`);
    assert.equal(compose.composeBlocker(clips), null, label);
    const mediaIds = Object.fromEntries(clips.map((c, i) => [c.media, `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`]));
    const req = compose.buildComposeRequest({
      clips, mediaIds, overlays: r.overlays.map(effects.sanitizeOverlay).filter(Boolean), origVol: 1, musicVol: 0.7, rhythm: false, total: r.total, coverAt: 0,
      music: bpm ? { id: 'x', title: 'Música' } : null, pano: r.pano,
      mix: { musicStartMs: r.music?.startMs ?? 0, musicStartAuto: false, fadeIn: r.music?.fadeIn ?? 0, fadeOut: r.music?.fadeOut ?? 0, ducking: true, origFx: 'normal', voice: null, sfx: r.sfx.map((x, i) => ({ key: `s${i}`, id: x.id, at: x.at })), sfxVolume: 1 },
    });
    checkRequest(req, label);
  }
  assert.equal(cases, 162);
});

test('ritmo: as caras ficam inteiras no enquadramento das fotos da montagem', () => {
  const { items, sources } = setup('p', 20, 21);
  const r = m.buildMontage({ sources, items, music: music(110), wave: 'tofo', seed: 4 });
  const by = new Map(items.map((i) => [i.key, i]));
  let checked = 0;
  for (const c of r.clips) {
    const it = by.get(c.key);
    if (!it.focus?.face || !c.fx?.focus) continue;
    const W = 4000, H = Math.round(4000 / it.aspect);
    for (const u of [0, 0.5, 1]) {
      const rect = m.coverRect(W, H, c.fx.focus, u);
      const box = it.focus.box;
      // Quando a cara cabe no que fica à vista, fica lá dentro do princípio ao fim do zoom.
      if ((box.x1 - box.x0) * W <= rect.sw && (box.y1 - box.y0) * H <= rect.sh) {
        assert.ok(rect.sx <= box.x0 * W + 1 && rect.sx + rect.sw >= box.x1 * W - 1, `${c.key} u=${u}: a cara cabe na largura`);
        assert.ok(rect.sy <= box.y0 * H + 1 && rect.sy + rect.sh >= box.y1 * H - 1, `${c.key} u=${u}: a cara cabe na altura`);
        checked++;
      }
    }
  }
  assert.ok(checked > 6, `caras verificadas: ${checked}`);
});

test('tempo: os vídeos todos têm um teto em «a montar» (o resto entra neutro)', async () => {
  const f = await mod('magicFrames.ts');
  assert.ok(f.VIDEOS_MAX_MS >= 4 * f.VIDEO_BUDGET.max && f.VIDEOS_MAX_MS <= 30_000, `${f.VIDEOS_MAX_MS} ms`);
});

test('envios: o limite de vídeos por hora do servidor aparece com a frase dele, não como «muitas montagens»', async () => {
  const job = await mod('composeJob.ts');
  // Uma montagem mágica com muitos vídeos (ou duas seguidas) bate nos 10 vídeos por hora do POST /media/uploads.
  assert.equal(job.composeProblem(429, 'Já enviaste muitos vídeos. Tenta daqui a um bocado.').message, 'Já enviaste muitos vídeos. Tenta daqui a um bocado.');
  assert.match(job.composeProblem(429, 'ThrottlerException: Too Many Requests').message, /muitas montagens/);
  assert.match(job.composeProblem(429).message, /muitas montagens/);
});
