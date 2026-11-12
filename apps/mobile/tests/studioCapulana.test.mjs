// «Capulana» (src/lib/studio/capulana*.ts): os panos gerados por código (8 padrões × 6 paletas, com semente), os mesmos
// pixels para as mesmas entradas, o azulejo sem costura, as miniaturas, a geometria das transições, a moldura, os stickers
// e o desenho num canvas falso (as mesmas chamadas, pela mesma ordem).
// Correr em apps/mobile:  node --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const lib = (...p) => path.join(ROOT, 'src', 'lib', 'studio', ...p);
// O capulanaRender.ts importa os vizinhos sem extensão (como o Metro quer): aqui resolve-se para o .ts.
registerHooks({
  resolve(spec, ctx, next) {
    if (spec.startsWith('./') && !path.extname(spec) && ctx.parentURL?.includes('/src/lib/studio/')) return next(`${spec}.ts`, ctx);
    return next(spec, ctx);
  },
});
const c = await import(pathToFileURL(lib('capulana.ts')).href);
const s = await import(pathToFileURL(lib('capulanaShapes.ts')).href);
const r = await import(pathToFileURL(lib('capulanaRender.ts')).href);
const near = (a, b, eps, msg = '') => assert.ok(Math.abs(a - b) <= eps, `${msg} ${a} ≈ ${b} (±${eps})`);
const spec = (pattern, palette = 'coral', seed = 1) => ({ pattern, palette, seed });

// ---------------------------------------------------------------- os panos

test('panos: 8 padrões × 6 paletas, com nomes, e paletas de 5 cores', () => {
  assert.deepEqual(c.CAPULANA_PATTERNS.map((p) => p.id), ['losangos', 'ziguezague', 'circulos', 'flores', 'faixas', 'escamas', 'sol', 'degraus']);
  assert.deepEqual(c.CAPULANA_PALETTES.map((p) => p.id), ['coral', 'marginal', 'indico', 'machamba', 'mafalala', 'neon']);
  for (const p of c.CAPULANA_PATTERNS) assert.ok(p.name && p.mood);
  for (const p of c.CAPULANA_PALETTES) { assert.equal(p.colors.length, 5); for (const h of p.colors) assert.match(h, /^#[0-9a-f]{6}$/); assert.equal(new Set(p.colors).size, 5); }
  assert.ok(c.CAPULANA_PALETTES[0].colors.includes('#d6334f'), 'a primeira paleta tem o coral do Txillapp');
  assert.deepEqual(c.hexRgb('#d6334f'), [214, 51, 79]);
  assert.equal(c.paletteById('nao-existe').id, 'coral');
  assert.equal(c.patternById('nao-existe').id, 'losangos');
});

test('panos: as mesmas entradas dão os mesmos pixels; outra semente, outro padrão ou outra paleta dão outros', () => {
  const hashes = new Set();
  for (const pat of c.CAPULANA_PATTERNS) {
    for (const pal of c.CAPULANA_PALETTES) {
      const a = c.capulanaTile(spec(pat.id, pal.id, 3), 48, 2), b = c.capulanaTile(spec(pat.id, pal.id, 3), 48, 2);
      assert.equal(a.length, 48 * 48 * 4);
      assert.deepEqual(a, b, `${pat.id}/${pal.id}: determinístico`);
      for (let i = 3; i < a.length; i += 4) if (a[i] !== 255) assert.fail('o pano é opaco');
      hashes.add(c.pixelsHash(a));
    }
  }
  assert.equal(hashes.size, 48, 'os 48 panos são todos diferentes');
  for (const pat of c.CAPULANA_PATTERNS) {
    const seeds = new Set();
    for (let seed = 0; seed < 24; seed++) seeds.add(c.pixelsHash(c.capulanaTile(spec(pat.id, 'indico', seed), 32, 1)));
    assert.ok(seeds.size >= 6, `${pat.id}: a semente dá variações (${seeds.size})`);
  }
});

test('panos: impressões digitais de referência (o servidor tem de dar as mesmas)', () => {
  // Se alguma destas mudar, o desenho mudou: as tchekas já publicadas com pano ficavam diferentes na montagem do servidor.
  const got = Object.fromEntries(c.CAPULANA_PATTERNS.map((p) => [p.id, c.pixelsHash(c.capulanaTile(spec(p.id, 'coral', 1), 64, 2))]));
  const ref = JSON.parse(readFileSync(path.join(ROOT, 'tests', 'fixtures', 'capulana-hashes.json'), 'utf8'));
  assert.deepEqual(got, ref.coral_seed1_64_ss2);
});

test('panos: o azulejo não tem costura e usa as cores todas da paleta dele', () => {
  for (const pat of c.CAPULANA_PATTERNS) {
    for (const seed of [0, 1, 2, 5, 9]) {
      const p = c.capulanaParams(pat.id, seed);
      assert.ok(Number.isInteger(p.n) && p.n >= 1 && p.n <= 4);
      assert.deepEqual([p.a, p.b, p.c].sort(), [1, 2, 3], 'as três cores do motivo são as 1, 2 e 3, baralhadas');
      const used = new Set();
      for (let i = 0; i < 40; i++) {
        for (let j = 0; j < 40; j++) {
          const u = (i + 0.37) / 40, v = (j + 0.61) / 40;
          const k = c.capulanaIndex(pat.id, p, u, v);
          used.add(k);
          assert.ok(Number.isInteger(k) && k >= 0 && k <= 4);
          // Repete-se de 1 em 1 (para os dois lados): é isso que o deixa repetir sem costura.
          assert.equal(c.capulanaIndex(pat.id, p, u + 1, v), k, `${pat.id} seed ${seed}: periódico em u`);
          assert.equal(c.capulanaIndex(pat.id, p, u, v + 1), k, `${pat.id} seed ${seed}: periódico em v`);
          assert.equal(c.capulanaIndex(pat.id, p, u - 1, v - 1), k);
        }
      }
      assert.ok(used.size >= 4, `${pat.id} seed ${seed}: usa pelo menos 4 das 5 cores (${[...used]})`);
    }
  }
});

test('panos: miniaturas em BMP (sem canvas), semente seguinte e ler de um rascunho', () => {
  const bmp = c.bmpBytes(new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 9, 9, 9, 255]), 2, 2);
  assert.equal(bmp.length, 54 + 16);
  assert.deepEqual([...bmp.slice(0, 2)], [0x42, 0x4d]);
  // As linhas vão de baixo para cima e em BGR: a primeira guardada é a de baixo (azul, cinzento).
  assert.deepEqual([...bmp.slice(54, 60)], [255, 0, 0, 9, 9, 9]);
  assert.deepEqual([...bmp.slice(62, 68)], [0, 0, 255, 0, 255, 0]);
  assert.equal(c.base64(new Uint8Array([77, 97, 110])), 'TWFu');
  assert.equal(c.base64(new Uint8Array([77, 97])), 'TWE=');
  assert.equal(c.base64(new Uint8Array([77])), 'TQ==');
  const uri = c.capulanaDataUri(spec('flores'), 24);
  assert.ok(uri.startsWith('data:image/bmp;base64,Qk'));
  assert.equal(c.capulanaDataUri(spec('flores'), 24), uri, 'vem da cache');
  assert.equal(Buffer.from(uri.split(',')[1], 'base64').length, 54 + 24 * 24 * 3);
  assert.equal(c.nextSeed(4), 5);
  assert.equal(c.nextSeed(999999), 0);
  assert.deepEqual(c.sanitizeCapulana({ pattern: 'sol', palette: 'neon', seed: 12.7, lixo: 1 }), { pattern: 'sol', palette: 'neon', seed: 12 });
  assert.equal(c.sanitizeCapulana({ pattern: 'sol', palette: 'roxo', seed: 1 }), undefined);
  assert.equal(c.sanitizeCapulana(null), undefined);
  const rnd = c.mulberry32(5), rnd2 = c.mulberry32(5);
  assert.deepEqual(c.randomCapulana(rnd), c.randomCapulana(rnd2));
  assert.equal(c.randomCapulana(c.mulberry32(1), 'neon').palette, 'neon');
  // O gerador é o mesmo da montagem mágica.
  near(c.mulberry32(1)(), 0.6270739405881613, 1e-12, 'mulberry32(1)');
});

// ---------------------------------------------------------------- transições

test('transições de capulana: 5, começam no clipe anterior, acabam no seguinte e o pano tapa a meio', () => {
  assert.ok(s.CAPULANA_TRANSITIONS.length >= 4);
  assert.deepEqual(s.CAPULANA_TRANSITIONS.map((t) => t.id), ['capulana-deslizar', 'capulana-desenrolar', 'capulana-rasgar', 'capulana-losango', 'capulana-vento']);
  for (const t of s.CAPULANA_TRANSITIONS) {
    assert.ok(t.name && t.mood && t.ffmpeg);
    assert.ok(s.isCapulanaTransition(t.id));
    const a = s.panoCoverage(t.id, 0), z = s.panoCoverage(t.id, 1);
    assert.deepEqual(a, { prev: 1, cloth: 0, cur: 0 }, `${t.id}: em 0 só o anterior`);
    assert.deepEqual(z, { prev: 0, cloth: 0, cur: 1 }, `${t.id}: em 1 só o seguinte`);
    let peak = 0, lastCur = 0, lastPrev = 1;
    for (let i = 0; i <= 40; i++) {
      const cov = s.panoCoverage(t.id, i / 40);
      near(cov.prev + cov.cloth + cov.cur, 1, 1e-9);
      peak = Math.max(peak, cov.cloth);
      assert.ok(cov.cur >= lastCur - 0.02, `${t.id}: o seguinte só cresce (p=${i / 40})`);
      assert.ok(cov.prev <= lastPrev + 0.02, `${t.id}: o anterior só encolhe (p=${i / 40})`);
      lastCur = cov.cur; lastPrev = cov.prev;
    }
    assert.ok(peak >= 0.5, `${t.id}: a meio o pano tapa pelo menos metade (${peak})`);
    assert.deepEqual(s.panoShape(t.id, 0.4, 1080, 1920), s.panoShape(t.id, 0.4, 1080, 1920), 'determinística');
    // Noutro tamanho de quadro, a mesma forma à escala.
    near(s.panoCoverage(t.id, 0.4, 540, 960).cloth, s.panoCoverage(t.id, 0.4).cloth, 0.03, `${t.id}: à escala`);
  }
  assert.ok(!s.isCapulanaTransition('fundido'));
  // O «Rasgar» fecha por completo antes de trocar o clipe por baixo.
  near(s.panoCoverage('capulana-rasgar', 0.5).cloth, 1, 1e-9);
  assert.equal(s.panoShape('capulana-rasgar', 0.49, 1080, 1920).base, 'prev');
  assert.equal(s.panoShape('capulana-rasgar', 0.51, 1080, 1920).base, 'cur');
  // O «Desenrolar» tem os dois rolos; os outros não.
  assert.equal(s.panoShape('capulana-desenrolar', 0.5, 1080, 1920).rolls.length, 2);
  assert.equal(s.panoShape('capulana-vento', 0.5, 1080, 1920).rolls.length, 0);
  near(s.ease(0.5), 0.5, 1e-12);
  assert.deepEqual([s.ease(-1), s.ease(2)], [0, 1]);
});

test('polígonos: dentro e fora (regra evenodd, com buracos)', () => {
  const sq = [[0, 0], [10, 0], [10, 10], [0, 10]], hole = [[4, 4], [6, 4], [6, 6], [4, 6]];
  assert.ok(s.insidePolys([sq], 5, 5) && !s.insidePolys([sq], 11, 5));
  assert.ok(!s.insidePolys([sq, hole], 5, 5) && s.insidePolys([sq, hole], 2, 2));
});

// ---------------------------------------------------------------- moldura e stickers

test('moldura: só as fotos mais largas do que 9:16, inteiras, centradas e dentro do quadro', () => {
  assert.ok(!s.needsFrame(1080, 1920) && !s.needsFrame(1080, 1350 * 1.3) && !s.needsFrame(900, 2000));
  assert.ok(s.needsFrame(1080, 1080) && s.needsFrame(4000, 3000) && s.needsFrame(1920, 1080));
  assert.ok(!s.needsFrame(0, 0));
  for (const [iw, ih] of [[4000, 3000], [1080, 1080], [1920, 1080], [3000, 1000], [1080, 1350]]) {
    const { photo, border, line, radius } = s.frameLayout(iw, ih);
    near(photo.w / photo.h, iw / ih, 0.002, 'a foto não se deforma');
    near(photo.x + photo.w / 2, 540, 0.1, 'centrada');
    assert.ok(photo.w <= 1080 * 0.86 + 0.1 && photo.h <= 1920 * 0.62 + 0.1);
    assert.ok(photo.x - border - line >= 0 && photo.y - border - line >= 1920 * 0.1, 'a moldura cabe, abaixo da barra de cima');
    assert.ok(photo.y + photo.h + border <= 1920 * 0.8, 'e acima dos botões do feed');
    assert.ok(border >= 12 && line >= 4 && radius >= 8);
  }
  const small = s.frameLayout(4000, 3000, 540, 960);
  near(small.photo.w * 2, s.frameLayout(4000, 3000).photo.w, 0.3, 'à escala do quadro');
});

test('stickers: 5 formas fechadas, centradas e dentro do raio', () => {
  assert.deepEqual(s.CAPULANA_SHAPES.map((x) => x.id).sort(), ['circulo', 'coracao', 'estrela', 'losango', 'selo']);
  for (const sh of s.CAPULANA_SHAPES) {
    const pts = s.stickerOutline(sh.id, 100);
    assert.ok(pts.length >= 4);
    for (const [x, y] of pts) assert.ok(Math.hypot(x, y) <= 104, `${sh.id}: dentro do raio (${x}, ${y})`);
    assert.ok(Math.max(...pts.map((p) => Math.hypot(p[0], p[1]))) >= 78, `${sh.id}: enche o raio`);
    assert.ok(s.insidePolys([pts], 0, 0), `${sh.id}: o centro está dentro`);
    assert.deepEqual(s.stickerOutline(sh.id, 100), pts);
    assert.ok(s.isCapulanaShape(sh.id));
  }
  assert.equal(s.stickerOutline('estrela', 50).length, 10);
});

// ---------------------------------------------------------------- o desenho (num canvas falso)

/** Um contexto 2D que só toma nota do que lhe pedem. */
function fakeCtx(log) {
  const call = (name) => (...a) => { log.push(`${name}(${a.map((v) => (typeof v === 'number' ? Math.round(v * 100) / 100 : typeof v === 'object' ? '·' : v)).join(',')})`); };
  const g = { canvas: null };
  for (const n of ['save', 'restore', 'translate', 'scale', 'rotate', 'beginPath', 'closePath', 'moveTo', 'lineTo', 'rect', 'arcTo', 'fill', 'stroke', 'fillRect', 'clearRect', 'drawImage', 'fillText', 'strokeText', 'setTransform']) g[n] = call(n);
  g.clip = (rule) => log.push(`clip(${rule ?? 'nonzero'})`);
  g.createPattern = (_img, rep) => { log.push(`createPattern(${rep})`); return { pattern: true }; };
  g.createLinearGradient = () => ({ addColorStop() {} });
  g.createRadialGradient = () => ({ addColorStop() {} });
  g.createImageData = (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) });
  g.putImageData = (img) => log.push(`putImageData(${c.pixelsHash(img.data)})`);
  g.measureText = (t) => ({ width: t.length * 40 });
  return g;
}
const tilesMade = [];
r.setCapulanaCanvasFactory((w, h) => { const log = []; tilesMade.push(log); return { width: w, height: h, getContext: () => fakeCtx(log) }; });

test('desenho: o azulejo vai para o canvas uma vez (cache) com os pixels do gerador', () => {
  tilesMade.length = 0;
  const sp = spec('sol', 'marginal', 4);
  const a = r.capulanaTileCanvas(sp), b = r.capulanaTileCanvas(sp);
  assert.equal(a, b, 'o mesmo canvas');
  assert.equal(tilesMade.length, 1);
  assert.deepEqual(tilesMade[0], [`putImageData(${c.pixelsHash(c.capulanaTile(sp))})`]);
  assert.equal(a.width, c.TILE_SIZE);
  r.capulanaTileCanvas(spec('sol', 'marginal', 5));
  assert.equal(tilesMade.length, 2, 'outra semente, outro azulejo');
  assert.equal(r.clothTile(1080), 360);
});

test('desenho: cada transição dá sempre as mesmas chamadas e respeita a ordem (base, seguinte, pano, bainha)', () => {
  const sp = spec('ziguezague', 'coral', 2);
  for (const t of s.CAPULANA_TRANSITIONS) {
    const run = (p) => { const log = []; r.drawCapulanaTransition(fakeCtx(log), 'PREV', 'CUR', t.id, p, 1080, 1920, sp); return log; };
    const a = run(0.5), b = run(0.5);
    assert.deepEqual(a, b, `${t.id}: determinístico`);
    assert.notDeepEqual(run(0.3), a, `${t.id}: muda com o p`);
    assert.equal(a.filter((x) => x === 'save()').length, a.filter((x) => x === 'restore()').length, `${t.id}: save/restore a par`);
    const base = a.findIndex((x) => x.startsWith('drawImage(')), cloth = a.indexOf('clip(evenodd)'), pat = a.indexOf('createPattern(repeat)');
    assert.ok(base >= 0 && cloth > base && pat > cloth, `${t.id}: primeiro o clipe, depois o pano recortado`);
    assert.equal(a[base], `drawImage(${s.panoShape(t.id, 0.5, 1080, 1920).base === 'prev' ? 'PREV' : 'CUR'},0,0,1080,1920)`);
    assert.ok(run(0.2).includes('drawImage(PREV,0,0,1080,1920)'), `${t.id}: no início ainda se vê o anterior`);
    assert.ok(run(0.9).includes('drawImage(CUR,0,0,1080,1920)'), `${t.id}: no fim vê-se o seguinte`);
  }
});

test('desenho: moldura, faixa, letras com pano e sticker', () => {
  const sp = spec('flores', 'indico', 1);
  let log = [];
  const lay = r.drawCapulanaFrame(fakeCtx(log), 'FOTO', 4000, 3000, 1080, 1920, sp, 1.05, { x: 0.7, y: 0.3 });
  assert.deepEqual(lay, s.frameLayout(4000, 3000));
  const img = log.find((x) => x.startsWith('drawImage(FOTO'));
  assert.equal(img, `drawImage(FOTO,${lay.photo.x},${lay.photo.y},${lay.photo.w},${lay.photo.h})`, 'a foto inteira, no sítio da moldura');
  assert.ok(log.indexOf('createPattern(repeat)') < log.indexOf(img), 'o pano fica por trás da foto');
  assert.ok(log.includes('scale(1.05,1.05)'), 'o zoom lento');
  assert.equal(log.filter((x) => x === 'save()').length, log.filter((x) => x === 'restore()').length);

  log = [];
  const box = r.drawCapulanaBand(fakeCtx(log), sp, 1080, { y: 1400, h: 260, text: 'Domingo no Tofo' });
  assert.deepEqual(box, { x: 0, y: 1270, w: 1080, h: 260 });
  assert.ok(log.some((x) => x.startsWith('fillText(Domingo no Tofo,540,')), 'o texto ao centro da faixa');
  log = [];
  assert.equal(r.drawCapulanaBand(fakeCtx(log), sp, 1080, { y: 1400, h: 260, text: 'x', open: 0 }).h, 0);
  assert.deepEqual(log, [], 'fechada não desenha nada');

  const main = [], scratchLog = [];
  const scratch = (name, w, h) => { scratchLog.push(`${name}:${w}x${h}`); return { c: 'SCRATCH', g: fakeCtx(main) }; };
  const tb = r.drawCapulanaText(fakeCtx(main), 'TXILL\nAPP', sp, { x: 540, y: 900, size: 200, font: '800 200px Inter', scratch });
  assert.equal(scratchLog.length, 1);
  assert.ok(scratchLog[0].startsWith('capulana-texto:'));
  near(tb.x + tb.w / 2, 540, 0.6);
  near(tb.y + tb.h / 2, 900, 0.6);
  assert.equal(main.filter((x) => x.startsWith('fillText(TXILL')).length, 1, 'as letras cheias vão para o canvas de trabalho');
  assert.equal(main.filter((x) => x.startsWith('strokeText(APP')).length, 3, 'três contornos por linha');
  assert.ok(main.includes('createPattern(repeat)') && main.some((x) => x.startsWith('drawImage(SCRATCH')));

  for (const sh of s.CAPULANA_SHAPES) {
    log = [];
    r.drawCapulanaSticker(fakeCtx(log), sh.id, sp, 300, 400, 120, -8);
    assert.ok(log.includes('translate(300,400)') && log.includes('clip(nonzero)') && log.includes('createPattern(repeat)'), sh.id);
    assert.equal(log.filter((x) => x === 'save()').length, log.filter((x) => x === 'restore()').length);
  }
});

test('integração: os ids das transições de capulana não chocam com os do effects.ts', { skip: !existsSync(lib('effects.ts')) && 'o effects.ts ainda não está neste ramo' }, async () => {
  const fx = await import(pathToFileURL(lib('effects.ts')).href);
  const mine = new Set(s.CAPULANA_TRANSITIONS.map((t) => t.id));
  const theirs = fx.TRANSITIONS.map((t) => t.id).filter((id) => !id.startsWith('capulana-'));
  for (const id of theirs) assert.ok(!mine.has(id));
  near(s.ease(0.3), fx.easeInOutCubic(0.3), 1e-12, 'a mesma curva');
});
