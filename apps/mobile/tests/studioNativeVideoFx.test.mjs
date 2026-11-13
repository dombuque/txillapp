// Estúdio nativo: o filtro completo na pré-visualização (o shader da Skia, igual ao do site) e o ritmo do vídeo da Skia.
// Correr em apps/mobile:  node --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mod = (x) => import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'studio', x)).href);
const V = await mod('nativeVideoFx.ts');
const fx = await mod('effects.ts');
const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);

test('as constantes do shader são as do site e do servidor', () => {
  assert.equal(V.FX_CONST.SHARPEN_K, fx.SHARPEN_K);
  assert.equal(V.FX_CONST.VIGNETTE_ANGLE, fx.VIGNETTE_ANGLE);
  assert.equal(V.FX_CONST.GRAIN_AMP, fx.GRAIN_AMP);
  assert.equal(V.FX_CONST.FRAME_W, fx.FRAME.w);
  assert.equal(V.FX_CONST.FPS, fx.FRAME.fps);
});

test('o shader faz o mesmo que o pixel de referência (matriz, vinheta e grão) em vários filtros', () => {
  const W = 360, H = 640;
  for (const id of ['costa-do-sol', 'noite-de-maputo', 'capulana', 'vintage', 'pb', 'limpopo']) {
    const p = fx.resolveFx({ filter: { id, amount: 1 }, adjust: { grain: 0.3 } });
    const u = V.fxUniforms(p, W, H, 5);
    for (const [rgb, x, y, noise] of [[[0.2, 0.5, 0.8], 180, 320, 0], [[0.9, 0.4, 0.1], 10, 30, 0.3], [[0.5, 0.5, 0.5], 300, 600, -0.4]]) {
      const got = V.shaderPixel(u, rgb, [x, y], undefined, noise);
      const want = fx.applyFxPixel(p, rgb, x / W, y / H, noise, W, H);
      for (let i = 0; i < 3; i++) near(got[i], want[i], 1e-9);
    }
  }
});

test('a nitidez é o núcleo 3×3 do site (num píxel de 1080 medido no palco)', () => {
  const p = { ...fx.NO_FX, sharpen: 1 };
  const u = V.fxUniforms(p, 360, 640);
  near(u.px, 360 / 1080);
  near(u.sharp, fx.SHARPEN_K);
  // Uma zona lisa fica igual; um ponto mais claro que os vizinhos fica mais claro.
  const flat = V.shaderPixel(u, [0.5, 0.5, 0.5], [180, 320], [2, 2, 2]);
  flat.forEach((c) => near(c, 0.5));
  const peak = V.shaderPixel(u, [0.6, 0.6, 0.6], [180, 320], [2, 2, 2]);
  assert.ok(peak[0] > 0.6);
});

test('o SkSL tem as partes todas e os nomes dos números', () => {
  for (const k of ['uniform shader image', 'uniform float2 size', 'uniform float px', 'r0', 'r1', 'r2', 'sharp', 'vig', 'grain', 'seed', 'hash(', 'cos(vig * d)']) assert.ok(V.FX_SKSL.includes(k), k);
  const u = V.fxUniforms(fx.NO_FX, 100, 200);
  assert.deepEqual(Object.keys(u).sort(), ['grain', 'px', 'r0', 'r1', 'r2', 'seed', 'sharp', 'size', 'vig']);
  // O mesmo hash do shader do site.
  const gl = readFileSync(path.join(ROOT, 'src', 'lib', 'studio', 'renderGL.ts'), 'utf8');
  assert.ok(gl.includes('fract(sin(dot(p, vec2(12.9898, 78.233)) + u_seed) * 43758.5453)'));
  assert.ok(V.FX_SKSL.includes('fract(sin(dot(p, float2(12.9898, 78.233)) + seed) * 43758.5453)'));
});

test('a semente do grão muda a cada frame do vídeo final', () => {
  assert.equal(V.grainSeed(0), 0);
  assert.equal(V.grainSeed(34), 1);
  assert.equal(V.grainSeed(1000), 30);
  assert.ok(V.grainSeed(1e6) < 97);
});

test('o frame rodado cobre o palco ao centro', () => {
  const apply = (tf, x, y) => {
    // O primeiro é o de fora: aplica-se do último para o primeiro.
    for (const t of [...tf].reverse()) {
      if ('translateX' in t) x += t.translateX;
      else if ('translateY' in t) y += t.translateY;
      else if ('scale' in t) { x *= t.scale; y *= t.scale; }
      else if ('rotate' in t) { const c = Math.cos(t.rotate), s = Math.sin(t.rotate); [x, y] = [x * c - y * s, x * s + y * c]; }
    }
    return [x, y];
  };
  // Vídeo ao alto gravado deitado (1920×1080 com 90°) num palco 9:16: cobre à justa.
  const tf = V.coverTransform(1920, 1080, 90, 360, 640);
  const c = apply(tf, 960, 540);
  near(c[0], 180, 1e-6); near(c[1], 320, 1e-6);
  const a = apply(tf, 0, 0), b = apply(tf, 1920, 1080);
  near(Math.min(a[0], b[0]), 0, 1e-6); near(Math.max(a[0], b[0]), 360, 1e-6);
  near(Math.min(a[1], b[1]), 0, 1e-6); near(Math.max(a[1], b[1]), 640, 1e-6);
  // Sem rotação, um vídeo deitado num palco ao alto: a altura cobre e os lados saem.
  const t2 = V.coverTransform(1920, 1080, 0, 360, 640);
  const l = apply(t2, 0, 0), r = apply(t2, 1920, 1080);
  near(l[1], 0, 1e-6); near(r[1], 640, 1e-6);
  assert.ok(l[0] < 0 && r[0] > 360);
});

test('onde o vídeo deve estar: o alvo andado à velocidade, sem passar do fim', () => {
  assert.equal(V.wantMs({ src: 2, rate: 1, playing: false, stamp: 0, end: 5 }, 9999), 2000);
  assert.equal(V.wantMs({ src: 2, rate: 2, playing: true, stamp: 1000, end: 5 }, 1500), 3000);
  assert.equal(V.wantMs({ src: 4.9, rate: 1, playing: true, stamp: 0, end: 5 }, 1000), 5000);
});

test('Android: avança só os frames que faltam, salta para trás e não salta outra vez enquanto apanha', () => {
  const base = { frameMs: 33.3, now: 10_000, lastSeekAt: 0, lastSeekTo: -1e9 };
  assert.deepEqual(V.androidPace({ ...base, want: 1000, cur: 1000 }), { seek: null, advance: 0 });
  assert.deepEqual(V.androidPace({ ...base, want: 1040, cur: 1000 }), { seek: null, advance: 2 });
  assert.equal(V.androidPace({ ...base, want: 2000, cur: 1000 }).advance, 4);
  // Para trás: salta.
  assert.deepEqual(V.androidPace({ ...base, want: 500, cur: 1000 }), { seek: 500, advance: 0 });
  // Muito à frente: salta; depois do salto cai no keyframe (cur atrás) e descodifica para a frente, sem saltar de novo.
  assert.deepEqual(V.androidPace({ ...base, want: 9000, cur: 1000 }), { seek: 9000, advance: 0 });
  const after = V.androidPace({ ...base, now: 10_400, lastSeekAt: 10_000, lastSeekTo: 9000, want: 9010, cur: 7000 });
  assert.equal(after.seek, null);
  assert.ok(after.advance > 0);
  // Logo a seguir ao salto (o frame ainda não chegou): não salta outra vez.
  assert.equal(V.androidPace({ ...base, now: 10_100, lastSeekAt: 10_000, lastSeekTo: 500, want: 500, cur: 1000 }).seek, null);
});

test('iPhone: toca a 1× e corrige com saltos; parado, salta para o frame', () => {
  const base = { frameMs: 33.3, now: 10_000, lastSeekAt: 0, lastSeekTo: -1e9 };
  assert.deepEqual(V.applePace({ ...base, want: 1000, cur: 0, playing: true, isPlaying: false }), { seek: 1000, play: true });
  assert.deepEqual(V.applePace({ ...base, want: 1000, cur: 980, playing: true, isPlaying: true }), { seek: null, play: null });
  assert.equal(V.applePace({ ...base, want: 1000, cur: 500, playing: true, isPlaying: true }).seek, 1000);
  assert.deepEqual(V.applePace({ ...base, want: 1000, cur: 1000, playing: false, isPlaying: true }), { seek: null, play: false });
  assert.equal(V.applePace({ ...base, want: 1200, cur: 1000, playing: false, isPlaying: false }).seek, 1200);
});

test('que clipes vão pela Skia', () => {
  assert.equal(V.skiaVideoOk({ os: 'android', version: 33, speed: 2, ramp: 'heroi' }), true);
  assert.equal(V.skiaVideoOk({ os: 'android', version: 25, speed: 1 }), false);
  assert.equal(V.skiaVideoOk({ os: 'android', version: 33, speed: 1, reverse: true }), false);
  assert.equal(V.skiaVideoOk({ os: 'ios', version: '17.0', speed: 1 }), true);
  assert.equal(V.skiaVideoOk({ os: 'ios', version: '17.0', speed: 2 }), false);
  assert.equal(V.skiaVideoOk({ os: 'ios', version: '17.0', speed: 1, ramp: 'bala' }), false);
  assert.equal(V.skiaVideoOk({ os: 'web', version: 0, speed: 1 }), false);
});
