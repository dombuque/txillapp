// Estúdio das tchekas, efeitos: matrizes dos filtros e dos ajustes, o pixel de referência e a LUT do ffmpeg, as rampas de
// velocidade, inverter e congelar, as transições, o tempo das animações do texto e dos stickers, a zona segura, a serialização
// do contrato (docs/estudio-efeitos.md) e a ligação no estúdio.
// Correr em apps/mobile:  node --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const m = await import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'studio', 'effects.ts')).href);
const read = (...p) => readFileSync(path.join(ROOT, 'src', ...p), 'utf8').replace(/\r\n/g, '\n');
const near = (a, b, eps, msg = '') => assert.ok(Math.abs(a - b) <= eps, `${msg} ${a} ≈ ${b} (±${eps})`);
const nearArr = (a, b, eps, msg = '') => a.forEach((v, i) => near(v, b[i], eps, `${msg}[${i}]`));

// ---------------------------------------------------------------- cor

test('matrizes: identidade, composição e mistura (intensidade)', () => {
  const I = m.IDENTITY;
  assert.deepEqual(m.multiply(I, I), I);
  const c = m.opMatrix(['contrast', 1.3]);
  assert.deepEqual(m.multiply(I, c), c);
  assert.deepEqual(m.multiply(c, I), c);
  assert.ok(m.isIdentity(m.mixMatrix(c, 0)), 'intensidade 0 = sem efeito');
  nearArr(m.mixMatrix(c, 1), c, 1e-12, 'intensidade 1 = inteiro');
  // A ordem conta: primeiro b, depois a.
  const b = m.opMatrix(['brightness', 1.5]);
  const ab = m.multiply(c, b);
  const px = [0.4, 0.5, 0.6];
  nearArr(m.applyMatrix(ab, px), m.applyMatrix(c, m.applyMatrix(b, px)), 1e-9, 'a∘b = a(b(x))');
  assert.deepEqual(m.applyMatrix(m.opMatrix(['brightness', 3]), [0.9, 0.5, 0.1]), [1, 1, 0.30000000000000004].map((v) => Math.min(1, v)), 'corta a 0..1');
});

test('operações de cor: as fórmulas do CSS/SVG', () => {
  const grey = m.applyMatrix(m.opMatrix(['saturate', 0]), [1, 0, 0]);
  near(grey[0], grey[1], 1e-9); near(grey[1], grey[2], 1e-9); near(grey[0], 0.213, 1e-9, 'saturate(0): luminância do vermelho');
  nearArr(m.opMatrix(['hue', 360]), m.IDENTITY, 1e-9, 'uma volta inteira de matiz');
  nearArr(m.opMatrix(['hue', 0]), m.IDENTITY, 1e-12);
  const g = m.applyMatrix(m.opMatrix(['grayscale', 1]), [0.2, 0.6, 0.9]);
  near(g[0], 0.2126 * 0.2 + 0.7152 * 0.6 + 0.0722 * 0.9, 1e-9, 'cinzento = luminância');
  nearArr(m.applyMatrix(m.opMatrix(['contrast', 2]), [0.5, 0.25, 0.75]), [0.5, 0, 1], 1e-9, 'contraste à volta do meio');
  const warm = m.applyMatrix(m.opMatrix(['temperature', 1]), [0.5, 0.5, 0.5]);
  assert.ok(warm[0] > 0.5 && warm[2] < 0.5, 'quente: mais vermelho, menos azul');
  const f = m.applyMatrix(m.opMatrix(['fade', 1]), [0, 0, 0]);
  near(f[0], 0.1, 1e-9, 'fade levanta os pretos');
  nearArr(m.applyMatrix(m.opMatrix(['colorize', 255, 0, 0, 1]), [0.3, 0.3, 0.3]), [1, 0, 0], 1e-9);
  nearArr(m.applyMatrix(m.opMatrix(['lift', 0.1, 0, 0]), [1, 1, 1]), [1, 1, 1], 1e-9, 'lift não mexe nos brancos');
});

test('filtros: 16, com nome moçambicano, P&B e Vintage, e todos diferentes', () => {
  assert.ok(m.FILTERS.length >= 12 && m.FILTERS.length <= 16, `${m.FILTERS.length} filtros`);
  assert.equal(m.FILTERS[0].id, 'normal');
  const ids = new Set(m.FILTERS.map((f) => f.id));
  assert.equal(ids.size, m.FILTERS.length, 'ids únicos');
  for (const id of ['matapa', 'costa-do-sol', 'xima', 'noite-de-maputo', 'pb', 'vintage']) assert.ok(ids.has(id), id);
  assert.equal(m.filterById('pb').name, 'P&B');
  const sigs = new Set();
  for (const f of m.FILTERS) {
    assert.ok(f.name && f.mood && /^#[0-9a-f]{6}$/i.test(f.swatch), f.id);
    const p = m.resolveFx({ filter: { id: f.id, amount: 1 } });
    assert.ok(p.matrix.every(Number.isFinite), `${f.id}: matriz finita`);
    sigs.add(p.matrix.map((v) => v.toFixed(3)).join(',') + p.vignette + p.grain);
    if (f.id !== 'normal') assert.ok(!m.fxIsNone(p), `${f.id} muda a imagem`);
  }
  assert.equal(sigs.size, m.FILTERS.length, 'cada filtro dá um resultado diferente');
  // P&B: sem cor.
  const bw = m.applyMatrix(m.resolveFx({ filter: { id: 'pb', amount: 1 } }).matrix, [0.8, 0.2, 0.4]);
  near(bw[0], bw[1], 1e-9); near(bw[1], bw[2], 1e-9);
});

test('intensidade e ajustes: mistura proporcional, ajustes por cima do filtro', () => {
  const full = m.resolveFx({ filter: { id: 'noite-de-maputo', amount: 1 } });
  const half = m.resolveFx({ filter: { id: 'noite-de-maputo', amount: 0.5 } });
  nearArr(half.matrix, full.matrix.map((v, i) => m.IDENTITY[i] + (v - m.IDENTITY[i]) * 0.5), 1e-12, 'metade da intensidade');
  near(half.vignette, full.vignette / 2, 1e-12, 'os extras do filtro também');
  assert.ok(m.fxIsNone(m.resolveFx({ filter: { id: 'vintage', amount: 0 } })), 'intensidade 0');
  assert.ok(m.fxIsNone(m.resolveFx(undefined)));
  assert.ok(m.fxIsNone(m.resolveFx({ filter: { id: 'normal', amount: 1 }, adjust: {} })));
  // Primeiro o filtro, depois os ajustes.
  const fx = { filter: { id: 'pb', amount: 1 }, adjust: { temperature: 1 } };
  const p = m.resolveFx(fx);
  const expected = m.multiply(m.opsMatrix([['temperature', 1]]), m.opsMatrix(m.filterById('pb').ops));
  nearArr(p.matrix, expected, 1e-12, 'ajustes ∘ filtro');
  const tinted = m.applyMatrix(p.matrix, [0.5, 0.5, 0.5]);
  assert.ok(tinted[0] > tinted[2], 'P&B aquecido depois fica quente (não cinzento)');
  assert.equal(m.ADJUSTS.length, 8);
  assert.deepEqual(m.ADJUSTS.map((a) => a.id), ['brightness', 'contrast', 'saturation', 'temperature', 'hue', 'sharpen', 'vignette', 'grain']);
  const extra = m.resolveFx({ filter: { id: 'vintage', amount: 1 }, adjust: { grain: 0.9, vignette: 0.2, sharpen: 0.4 } });
  assert.equal(extra.grain, 1, 'nunca passa de 1');
  near(extra.vignette, 0.55, 1e-12);
  near(extra.sharpen, 0.4, 1e-12);
  const b = m.applyMatrix(m.resolveFx({ adjust: { brightness: -1 } }).matrix, [1, 1, 1]);
  near(b[0], 0.55, 1e-9, 'brilho -100');
});

test('pixel de referência: vinheta cos⁴ como o ffmpeg e grão centrado', () => {
  const p = { matrix: m.IDENTITY, sharpen: 0, vignette: 1, grain: 0 };
  nearArr(m.applyFxPixel(p, [0.5, 0.5, 0.5], 0.5, 0.5), [0.5, 0.5, 0.5], 1e-12, 'no centro não escurece');
  const corner = m.applyFxPixel(p, [1, 1, 1], 0, 0);
  near(corner[0], Math.pow(Math.cos(m.VIGNETTE_ANGLE), 4), 1e-9, 'no canto: cos(ângulo)⁴');
  near(m.vignetteDistance(0, 0), 1, 1e-12);
  near(m.vignetteDistance(0, 0.5), 540 / Math.hypot(540, 960), 1e-12, 'distância em px (aspect=1 do ffmpeg)');
  assert.equal(m.vignetteFactor(0, 1), 1);
  const g = { matrix: m.IDENTITY, sharpen: 0, vignette: 0, grain: 1 };
  near(m.applyFxPixel(g, [0.5, 0.5, 0.5], 0.5, 0.5, 0.5)[0], 0.5 + 0.5 * m.GRAIN_AMP, 1e-12);
  near(m.applyFxPixel(g, [0.5, 0.5, 0.5], 0.5, 0.5, 0)[0], 0.5, 1e-12, 'ruído 0 = igual');
});

test('ffmpeg da cor: LUT 3D com a matriz e a cadeia de filtros', () => {
  const fx = { filter: { id: 'costa-do-sol', amount: 0.8 }, adjust: { sharpen: 0.5, grain: 0.3 } };
  const p = m.resolveFx(fx);
  const n = 5;
  const lut = m.cubeLut(p.matrix, n).trim().split('\n');
  assert.equal(lut[1], `LUT_3D_SIZE ${n}`);
  const rows = lut.slice(4);
  assert.equal(rows.length, n ** 3);
  // Ordem do .cube: o vermelho muda mais depressa.
  const at = (r, g, b) => rows[r + g * n + b * n * n].split(' ').map(Number);
  for (const [r, g, b] of [[0, 0, 0], [4, 4, 4], [1, 3, 2], [4, 0, 1]]) nearArr(at(r, g, b), m.applyMatrix(p.matrix, [r / 4, g / 4, b / 4]), 1e-6, `ponto ${r},${g},${b}`);
  const chain = m.ffmpegFxChain(fx, 'c1.cube');
  assert.match(chain, /^format=gbrp,/);
  assert.match(chain, /convolution='0 -30 0 -30 220 -30 0 -30 0:/, 'nitidez 0,5 → a = 0,3');
  assert.match(chain, /lut3d=file='c1\.cube':interp=tetrahedral/);
  assert.match(chain, /vignette=angle=0\.\d+:dither=0/);
  assert.match(chain, /format=yuv420p,noise=c0s=\d+:c0f=t\+u$/);
  assert.ok(chain.indexOf('convolution') < chain.indexOf('lut3d') && chain.indexOf('lut3d') < chain.indexOf('vignette'), 'nitidez → cor → vinheta → grão');
  assert.equal(m.ffmpegFxChain(undefined), '');
  assert.equal(m.ffmpegFxChain({ transition: { type: 'zoom', dur: 0.5 } }), '', 'sem efeitos de cor: nada');
});

// ---------------------------------------------------------------- velocidade

test('rampas: Montaria, Herói, Bala e Flash, com a duração e o ponto da fonte certos', () => {
  assert.deepEqual(m.RAMPS.map((r) => r.id), ['montaria', 'heroi', 'bala', 'flash']);
  assert.deepEqual(m.RAMPS.map((r) => r.name), ['Montaria', 'Herói', 'Bala', 'Flash']);
  for (const r of m.RAMPS) {
    const avg = m.rampAverage(r.points);
    assert.ok(avg > 0.1 && avg < 5, `${r.id}: média ${avg}`);
    near(m.rampIntegral(r.points, 1), avg, 1e-12);
    near(m.rampIntegral(r.points, 0), 0, 1e-12);
    const L = 6, sp = 1.5, fx = { ramp: r.id };
    const D = m.fxSeconds(L, sp, fx);
    near(D, L / sp / avg, 1e-9, `${r.id}: duração`);
    near(m.sourceOffset(0, D, L, sp, fx), 0, 1e-9);
    near(m.sourceOffset(D, D, L, sp, fx), L, 1e-9, `${r.id}: acaba no fim do corte`);
    // Sempre a andar para a frente, e a velocidade de leitura é a derivada.
    let prev = -1;
    for (let k = 0; k <= 40; k++) { const o = m.sourceOffset((D * k) / 40, D, L, sp, fx); assert.ok(o >= prev - 1e-9); prev = o; }
    for (const u of [0.1, 0.35, 0.5, 0.8]) {
      const t = u * D, h = 1e-4;
      const deriv = (m.sourceOffset(t + h, D, L, sp, fx) - m.sourceOffset(t - h, D, L, sp, fx)) / (2 * h);
      near(m.playbackRateAt(t, D, sp, fx), deriv, 1e-3, `${r.id}: velocidade em u=${u}`);
    }
  }
  // Herói: câmara lenta a meio (0,25×) e normal nas pontas.
  const heroi = m.rampById('heroi');
  near(m.rampSpeedAt(heroi.points, 0.5), 0.25, 1e-12);
  near(m.rampSpeedAt(heroi.points, 0.1), 1, 1e-12);
  // Sem rampa: igual ao clipSeconds de sempre.
  near(m.fxSeconds(6, 2, undefined), 3, 1e-12);
  near(m.sourceOffset(1, 3, 6, 2, undefined), 2, 1e-12);
  near(m.playbackRateAt(1, 3, 2, {}), 2, 1e-12);
});

test('rampas para o ffmpeg: bocados de velocidade constante que cobrem o corte todo', () => {
  const pieces = m.rampPieces(4, 1, { ramp: 'bala' }, 0.1);
  const D = m.fxSeconds(4, 1, { ramp: 'bala' });
  near(pieces[pieces.length - 1].out1, D, 1e-3);
  near(pieces[0].src0, 0, 1e-9);
  near(pieces[pieces.length - 1].src1, 4, 1e-3);
  for (let i = 1; i < pieces.length; i++) { near(pieces[i].out0, pieces[i - 1].out1, 1e-3); near(pieces[i].src0, pieces[i - 1].src1, 1e-3); }
  for (const p of pieces) assert.ok(p.speed > 0.1 && p.speed <= 3.0001, `velocidade ${p.speed}`);
  assert.equal(m.rampPieces(2, 1, undefined, 0.5).length, 4, 'sem rampa: bocados iguais a 1×');
});

test('inverter e congelar', () => {
  const fx = { reverse: true };
  near(m.sourceOffset(0, 4, 4, 1, fx), 4, 1e-12, 'ao contrário começa no fim');
  near(m.sourceOffset(4, 4, 4, 1, fx), 0, 1e-12);
  near(m.sourceOffset(1, 4, 4, 1, fx), 3, 1e-12);
  assert.equal(m.reverseFrameCount(2), 2 * m.REVERSE_FPS);
  assert.equal(m.reverseFrameCount(m.REVERSE_MAX_S + 1), 0, 'comprido demais');
  assert.equal(m.reverseFrameIndex(0, 48), 0);
  assert.equal(m.reverseFrameIndex(1.999, 48), 47);
  assert.equal(m.reverseFrameIndex(5, 48), 47, 'nunca passa do último');
  assert.deepEqual(m.freezeSplit({ start: 1, end: 6 }, 3.25), { before: { start: 1, end: 3.25 }, after: { start: 3.25, end: 6 } });
  assert.equal(m.freezeSplit({ start: 1, end: 6 }, 1.1), null, 'no princípio: a foto entra a seguir');
  assert.equal(m.freezeSplit({ start: 1, end: 6 }, 5.9), null, 'no fim também');
});

// ---------------------------------------------------------------- transições

test('transições: 12 tipos, por junção, com duração e o ffmpeg', () => {
  const ids = m.TRANSITIONS.map((t) => t.id);
  for (const id of ['corte', 'fundido', 'deslizar-esquerda', 'deslizar-direita', 'deslizar-cima', 'deslizar-baixo', 'zoom', 'desfoque', 'girar', 'flash', 'brilho', 'glitch']) assert.ok(ids.includes(id), id);
  assert.equal(m.transitionFor({ transition: { type: 'zoom', dur: 1 } }, 0, 5), null, 'o primeiro clipe não tem');
  assert.deepEqual(m.transitionFor(undefined, 1, 5), { type: 'fundido', dur: 0.5 }, 'por omissão: fundido de 0,5 s (como antes)');
  assert.equal(m.transitionFor({ transition: { type: 'corte', dur: 1 } }, 2, 5), null);
  assert.deepEqual(m.transitionFor({ transition: { type: 'glitch', dur: 1.4 } }, 1, 1), { type: 'glitch', dur: 0.8 }, 'nunca mais de 80 % do clipe');
  assert.deepEqual(m.transitionFor({ transition: { type: 'flash', dur: 9 } }, 1, 10), { type: 'flash', dur: m.TRANSITION_MAX_S });
  assert.equal(m.ffmpegTransition({ type: 'deslizar-esquerda', dur: 0.6 }, 4.25), 'xfade=transition=slideleft:duration=0.6:offset=4.25');
  assert.equal(m.ffmpegTransition(null, 3), '');
  assert.equal(m.ffmpegTransition({ type: 'corte', dur: 0.5 }, 3), '');
  for (const t of m.TRANSITIONS) if (t.id !== 'corte') assert.ok(t.ffmpeg, `${t.id} tem xfade`);
  assert.ok(m.easeInOutCubic(0) === 0 && m.easeInOutCubic(1) === 1);
  near(m.easeInOutCubic(0.5), 0.5, 1e-12);
});

// ---------------------------------------------------------------- camadas

test('animações: antes e depois não se vê; no meio está inteira', () => {
  const o = { start: 2, end: 6, anim: { in: 'pop', out: 'aparecer', loop: 'nenhuma', inDur: 0.5, outDur: 0.4 } };
  assert.equal(m.animState(o, 1.9).visible, false);
  assert.equal(m.animState(o, 6.1).visible, false);
  const mid = m.animState(o, 4);
  assert.equal(mid.visible, true);
  assert.equal(mid.alpha, 1); assert.equal(mid.scale, 1); assert.equal(mid.chars, 1);
  assert.equal(m.animState({ ...o, end: 2 }, 2).visible, false, 'sem duração não aparece');
  // Pop: passa de 1 a meio da entrada e assenta em 1.
  const scales = Array.from({ length: 50 }, (_, k) => m.animState(o, 2 + (k / 49) * 0.5).scale);
  assert.ok(Math.max(...scales) > 1.02, 'o pop passa do tamanho');
  near(scales[scales.length - 1], 1, 1e-9);
  assert.ok(m.animState(o, 5.8).alpha < 1 && m.animState(o, 5.8).alpha > 0, 'a sair');
  const r = m.restingTime(o);
  assert.ok(r > 2.5 && r < 5.6);
  assert.equal(m.animState(o, r).alpha, 1);
});

test('animações: máquina de escrever, subir, brilho, ondulação e os ciclos', () => {
  const base = { start: 0, end: 4, anim: { in: 'maquina', out: 'subir', loop: 'nenhuma', inDur: 1, outDur: 0.5 } };
  near(m.animState(base, 0.25).chars, 0.25, 1e-9);
  assert.equal(m.visibleChars(10, 0.25), 2);
  assert.equal(m.visibleChars(10, 1), 10);
  assert.equal(m.visibleChars(10, 0), 0);
  assert.ok(m.animState(base, 3.9).dy < 0, 'a sair com «Subir» vai para cima');
  assert.ok(m.animState({ ...base, anim: { ...base.anim, in: 'subir' } }, 0.1).dy > 0, 'a entrar com «Subir» vem de baixo');
  const glow = m.animState({ ...base, anim: { ...base.anim, in: 'brilho' } }, 0.2);
  assert.ok(glow.glow > 0.5);
  const wave = m.animState({ ...base, anim: { ...base.anim, in: 'ondulacao' } }, 0.2);
  assert.ok(wave.wave > 0);
  assert.equal(m.waveOffset(3, 1, 0, 80), 0, 'sem ondulação as letras não mexem');
  assert.ok(Math.abs(m.waveOffset(3, 1, 1, 80)) <= 80 * 0.35 + 1e-9);
  const pulse = { start: 0, end: 10, anim: { in: 'nenhuma', out: 'nenhuma', loop: 'pulsar', inDur: 0.3, outDur: 0.3 } };
  const ss = Array.from({ length: 60 }, (_, k) => m.animState(pulse, k / 10).scale);
  assert.ok(Math.max(...ss) <= 1.07 + 1e-9 && Math.min(...ss) >= 0.93 - 1e-9 && Math.max(...ss) > 1.05, 'pulsar ±7 %');
  const swing = { ...pulse, anim: { ...pulse.anim, loop: 'balancar' } };
  const rs = Array.from({ length: 60 }, (_, k) => m.animState(swing, k / 10).rot);
  assert.ok(Math.max(...rs) <= 8 + 1e-9 && Math.min(...rs) >= -8 - 1e-9 && Math.max(...rs) > 6, 'balançar ±8°');
  // A entrada e a saída cabem na camada (cada uma até metade).
  assert.deepEqual(m.animDurations({ start: 0, end: 0.6, anim: { in: 'pop', out: 'pop', loop: 'nenhuma', inDur: 2, outDur: 2 } }), { inDur: 0.3, outDur: 0.3 });
  assert.deepEqual(m.animDurations({ start: 0, end: 4, anim: { in: 'nenhuma', out: 'nenhuma', loop: 'nenhuma', inDur: 1, outDur: 1 } }), { inDur: 0, outDur: 0 });
});

test('texto: 8 a 10 fontes, cores, e um texto novo no tempo certo', () => {
  assert.ok(m.FONTS.length >= 8 && m.FONTS.length <= 10);
  for (const f of m.FONTS) assert.match(f.file, /^\/fonts\/estudio\/[a-z]+\.woff2$/, f.id);
  assert.match(m.fontCss('cartaz', 100), /^400 125px TxBebas, /, 'com o acerto de tamanho da fonte');
  assert.match(m.fontCss('elegante', 80), /^italic 700 84px TxPlayfair/);
  assert.equal(m.fontById('nao-existe').id, 'classica');
  const t = m.newText(3, 5, 'Olá');
  assert.equal(t.start, 3); assert.equal(t.end, 5, 'nunca passa do fim');
  assert.equal(t.kind, 'text');
  const t2 = m.newText(9, 5);
  assert.ok(t2.start <= 4.5, 'perto do fim, recua');
  assert.equal(m.contrastOn('#ffffff'), '#111111');
  assert.equal(m.contrastOn('#111111'), '#ffffff');
  assert.equal(m.contrastOn('#d6334f'), '#ffffff');
  assert.equal(m.contrastOn('#ffd60a'), '#111111');
});

test('stickers: hora de Moçambique, e cada um novo vai a tcheka toda', () => {
  const at = Date.UTC(2026, 10, 12, 20, 41); // 20:41 UTC = 22:41 em Maputo
  assert.deepEqual(m.timeLabel('hora', at), ['22:41']);
  assert.deepEqual(m.timeLabel('data', at), ['Qui, 12 nov.']);
  assert.deepEqual(m.timeLabel('hora-data', Date.UTC(2026, 0, 3, 23, 5)), ['01:05', 'Dom, 4 jan.'], 'já é o dia seguinte em Maputo');
  const s = m.newSticker({ type: 'emoji', emoji: '🔥' }, 0, 12);
  assert.equal(s.start, 0); assert.equal(s.end, 12);
  assert.equal(s.anim.loop, 'pulsar', 'os emojis pulsam por omissão');
  assert.equal(m.newSticker({ type: 'mention', username: 'ana' }, 0, 8).anim.loop, 'nenhuma');
});

test('zona segura e guias: cola ao meio e às margens, a rotação aos ângulos retos', () => {
  const s = m.snapMove(0.505, 0.3, { hw: 0.1, hh: 0.05 });
  assert.equal(s.x, 0.5); assert.equal(s.vx, 0.5);
  assert.equal(s.hy, null);
  const left = m.snapMove(m.SAFE.left + 0.1 + 0.01, 0.4, { hw: 0.1, hh: 0.05 });
  near(left.x, m.SAFE.left + 0.1, 1e-12, 'encosta à margem esquerda da zona segura');
  assert.equal(left.vx, m.SAFE.left);
  const free = m.snapMove(0.3, 0.33, { hw: 0.05, hh: 0.05 });
  assert.equal(free.vx, null); assert.equal(free.x, 0.3);
  assert.ok(m.insideSafe({ x: 0.45, y: 0.45, hw: 0.2, hh: 0.1 }));
  assert.equal(m.insideSafe({ x: 0.9, y: 0.45, hw: 0.1, hh: 0.1 }), false, 'por baixo dos botões da direita');
  assert.equal(m.insideSafe({ x: 0.5, y: 0.9, hw: 0.1, hh: 0.05 }), false, 'por baixo da legenda');
  assert.equal(m.snapAngle(2.5), 0);
  assert.equal(m.snapAngle(88), 90);
  assert.equal(m.snapAngle(-178), 180);
  assert.equal(m.snapAngle(30), 30);
  assert.equal(m.snapAngle(370), 10);
});

// ---------------------------------------------------------------- contrato

const sampleOverlays = () => [
  { ...m.newText(0.5, 12, 'Bom dia, Maputo!'), id: 't1', neon: true, font: 'futuro', color: '#FF4FD8' },
  { ...m.newSticker({ type: 'location', name: 'Costa do Sol' }, 0, 12), id: 's1', variant: 'coral' },
  { ...m.newSticker({ type: 'gif', id: 'abcd1234', url: 'https://media1.giphy.com/media/abcd1234/giphy.webp', w: 480, h: 270 }, 0, 12), id: 's2' },
  { ...m.newSticker({ type: 'time', format: 'hora', at: 1763000000000 }, 0, 12), id: 's3' },
];

test('contrato: serializa, lê e volta a dar o mesmo (estável)', () => {
  const clips = [
    { id: 'c1', fx: { filter: { id: 'costa-do-sol', amount: 0.8 }, adjust: { contrast: 0.2, vignette: 0.3, grain: 0 } } },
    { id: 'c2', fx: { transition: { type: 'zoom', dur: 0.6 }, ramp: 'heroi', reverse: true } },
    { id: 'c3', fx: { transition: { type: 'corte', dur: 0.5 }, freeze: { from: 'c2', at: 3.2 } } },
    { id: 'c4' },
  ];
  const c = m.fxContract(clips, sampleOverlays());
  assert.equal(c.v, m.FX_VERSION);
  assert.deepEqual(c.frame, { w: 1080, h: 1920, fps: 30 });
  assert.deepEqual(c.clips[0].fx.adjust, { contrast: 0.2, vignette: 0.3 }, 'os ajustes a 0 não se guardam');
  assert.equal(c.clips[3].fx, undefined, 'sem efeitos, sem fx');
  assert.equal(c.overlays[0].color, '#ff4fd8', 'cor em minúsculas');
  const json = m.stringifyFxContract(c);
  const back = m.parseFxContract(json);
  assert.deepEqual(back, c, 'ida e volta');
  assert.equal(m.stringifyFxContract(back), json, 'o mesmo texto');
  // As chaves saem por ordem: o mesmo objeto com as chaves trocadas dá o mesmo texto.
  const shuffled = JSON.parse(json, (k, v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).reverse()) : v));
  assert.equal(m.stringifyFxContract(m.parseFxContract(shuffled)), json);
  assert.ok(json.indexOf('"clips"') < json.indexOf('"frame"') && json.indexOf('"frame"') < json.indexOf('"overlays"'));
});

test('contrato: o que não vale cai; versões novas dão erro', () => {
  assert.equal(m.sanitizeFx({ filter: { id: 'nao-existe', amount: 1 } }), undefined);
  assert.equal(m.sanitizeFx({ filter: { id: 'normal', amount: 1 } }), undefined, 'normal não se guarda');
  assert.deepEqual(m.sanitizeFx({ filter: { id: 'pb', amount: 7 } }), { filter: { id: 'pb', amount: 1 } }, 'intensidade até 1');
  assert.deepEqual(m.sanitizeFx({ adjust: { hue: -3, grain: -1, foo: 1 } }), { adjust: { hue: -1 } });
  assert.deepEqual(m.sanitizeFx({ transition: { type: 'flash', dur: 0.01 } }), { transition: { type: 'flash', dur: m.TRANSITION_MIN_S } });
  assert.equal(m.sanitizeFx({ transition: { type: 'explosao', dur: 1 } }), undefined);
  assert.equal(m.sanitizeFx({ ramp: 'turbo', reverse: 'sim' }), undefined);
  assert.equal(m.sanitizeFx(null), undefined);
  const ov = sampleOverlays()[0];
  assert.equal(m.sanitizeOverlay({ ...ov, text: '   ' }), null, 'texto vazio');
  assert.equal(m.sanitizeOverlay({ ...ov, end: ov.start }), null, 'sem duração');
  assert.equal(m.sanitizeOverlay({ ...ov, kind: 'video' }), null);
  assert.equal(m.sanitizeOverlay({ ...ov, font: 'comic' }).font, 'classica');
  assert.equal(m.sanitizeOverlay({ ...ov, color: 'red' }).color, '#ffffff');
  assert.equal(m.sanitizeOverlay({ ...ov, scale: 99 }).scale, 8);
  const gif = sampleOverlays()[2];
  assert.ok(m.sanitizeOverlay(gif));
  assert.equal(m.sanitizeOverlay({ ...gif, sticker: { ...gif.sticker, url: 'https://evil.example/x.gif' } }), null, 'só GIFs do GIPHY');
  assert.equal(m.sanitizeOverlay({ ...gif, sticker: { type: 'mention', username: 'a b' } }), null);
  assert.deepEqual(m.sanitizeOverlay({ ...gif, sticker: { type: 'mention', username: '@ana.m' } }).sticker, { type: 'mention', username: 'ana.m' });
  assert.throws(() => m.parseFxContract({ v: m.FX_VERSION + 1, clips: [], overlays: [] }), /mais nova/);
  const many = Array.from({ length: 30 }, (_, k) => ({ ...ov, id: `t${k}` }));
  assert.equal(m.fxContract([], many).overlays.length, m.MAX_OVERLAYS);
});

test('o documento do contrato fala de todos os ids (docs/estudio-efeitos.md)', () => {
  const doc = readFileSync(path.join(ROOT, '..', '..', 'docs', 'estudio-efeitos.md'), 'utf8');
  const ids = [...m.FILTERS.map((f) => f.id), ...m.TRANSITIONS.map((t) => t.id), ...m.RAMPS.map((r) => r.id), ...m.FONTS.map((f) => f.id), ...m.ANIMS.map((a) => a.id), ...m.LOOPS.map((a) => a.id)];
  for (const id of ids) assert.ok(doc.includes(`\`${id}\``), `o doc fala de ${id}`);
  for (const t of m.TRANSITIONS) if (t.ffmpeg) assert.ok(doc.includes(`\`${t.ffmpeg}\``), `o doc tem o xfade ${t.ffmpeg}`);
  for (const k of ['FX_VERSION', 'SHARPEN_K', 'VIGNETTE_ANGLE', 'GRAIN_AMP', 'lut3d', 'tpad', 'rampPieces', 'SAFE']) assert.ok(doc.includes(k), k);
});

// ---------------------------------------------------------------- ligação

test('ligação: o estúdio desenha com os efeitos e grava o que se vê', () => {
  const studio = read('components', 'TchekaStudio.tsx');
  assert.match(studio, /drawClip\(g, glFx\(\), v, /, 'os vídeos com o shader dos efeitos');
  assert.match(studio, /drawTransition\(g, e\.last, cur\.c, tr\.type, tl \/ tr\.dur, W, H, scratch\)/, 'transição por junção');
  assert.match(studio, /drawOverlays\(g, cfg\.current\.overlays, t, \{ W, H, image: ovImage, scratch \}\)/, 'textos e stickers (com os canvas de trabalho das letras de capulana)');
  assert.match(studio, /stampTxillapp\(g, W, H, username, seal\);/, 'a assinatura continua por cima');
  assert.match(studio, /fxSeconds\(it\.trim\.end - it\.trim\.start, it\.speed, it\.fx\)/, 'a rampa muda a duração');
  assert.match(studio, /hasAudio: it\.fx\?\.reverse \|\| !soundOn\(it\) \? false : it\.hasAudio/, 'ao contrário (ou com o som do vídeo desligado), o som original não conta');
  assert.match(studio, /await prepareFx\(\);\n\s+const out = await run\(0, \{ record: true/, 'a montagem espera pelas fontes, frames e imagens');
  assert.match(studio, /fullSig = studioSignature\(\{ t: timelineSig, fx: items\.map\(\(it\) => it\.fx \?\? null\), ov: overlays/, 'a volta gravada só vale com os mesmos efeitos');
  assert.match(studio, /if \(nowMs - lastDraw >= 30\)/, 'desenha a 30 fps');
  const gl = read('lib', 'studio', 'renderGL.ts');
  assert.match(gl, /c = clamp\(\(u_m \* vec4\(c, 1\.0\)\)\.rgb \+ u_o\.rgb, 0\.0, 1\.0\);/, 'o shader aplica a matriz como o applyFxPixel');
  assert.match(gl, /k = cos\(u_vig \* d\);/);
  const stage = read('components', 'studio', 'FxStage.tsx');
  assert.match(stage, /snapMove\(/);
  assert.match(stage, /snapAngle\(/);
  assert.match(stage, /node\.addEventListener\('wheel', wheel, \{ passive: false \}\)/, 'com o rato: a roda escala e roda');
  assert.match(stage, /kind: 'pinch'/, 'com dois dedos: rodar e escalar');
});
