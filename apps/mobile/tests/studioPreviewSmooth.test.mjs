// Estúdio nativo: a pré-visualização lisa (o relógio no fio da interface, as transições, o ritmo dos vídeos da Skia).
// Correr em apps/mobile:  node --test tests/*.test.mjs
import { test } from 'node:test';
import './fixtures/alias.mjs'; // o alias @/ (os módulos usam t() de @/lib/i18n)
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const imp = (...p) => import(pathToFileURL(path.join(ROOT, 'src', ...p)).href);
const C = await imp('lib', 'studio', 'previewClock.ts');
const V = await imp('lib', 'studio', 'nativeVideoFx.ts');
const E = await imp('lib', 'studio', 'effects.ts');
const read = (...p) => fs.readFileSync(path.join(ROOT, 'src', ...p), 'utf8');

test('o relógio no fio da interface: a tocar anda pelo relógio de parede, parado fica, nunca passa do fim', () => {
  const a = { playing: true, base: 2, wall: 10_000, total: 5 };
  assert.equal(C.clockAt(a, 10_000), 2);
  assert.equal(C.clockAt(a, 11_500), 3.5);
  assert.equal(C.clockAt(a, 99_000), 5);
  assert.equal(C.clockAt({ ...a, playing: false }, 99_000), 2);
});

test('smoothNow: os passos certos do vsync, sem o ruído do Date.now(); um salto grande volta ao relógio de parede', () => {
  let s = 0;
  const out = [];
  for (let k = 0; k < 120; k++) {
    const ts = 1000 + k * (1000 / 60);
    s = C.smoothNow(s, k ? 1000 / 60 : 0, Math.floor(ts + ((k * 7919) % 5)));
    out.push(s);
  }
  const steps = out.slice(1).map((x, i) => x - out[i]);
  assert.ok(steps.slice(10).every((d) => Math.abs(d - 1000 / 60) < 0.3), `passos regulares: ${steps.slice(10, 20).map((d) => d.toFixed(2))}`);
  assert.ok(Math.abs(out.at(-1) - (1000 + 119 * (1000 / 60))) < 5, 'não se afasta do relógio de parede');
  assert.equal(C.smoothNow(5000, 400, 9000), 9000, 'o fio esteve parado: volta ao relógio');
  assert.equal(C.smoothNow(5000, 16, 5100), 5100, 'longe demais: volta ao relógio');
});

test('easeInOut (worklet) é a mesma curva de effects.easeInOutCubic', () => {
  for (let p = -0.2; p <= 1.2; p += 0.05) assert.ok(Math.abs(C.easeInOut(p) - E.easeInOutCubic(p)) < 1e-12);
});

test('transitionLook: o que a pré-visualização fazia, agora calculado no fio da interface', () => {
  const W = 400, H = 700;
  const mid = C.transitionLook('deslizar-esquerda', 0.5, W, H);
  assert.equal(mid.prev.translateX, -0.5 * W);
  assert.equal(mid.cur.translateX, 0.5 * W);
  const f = C.transitionLook('fundido', 0.25, W, H);
  assert.ok(Math.abs(f.prev.opacity - (1 - E.easeInOutCubic(0.25))) < 1e-12);
  assert.equal(f.cur.opacity, 1);
  assert.ok(C.transitionLook('flash', 0.5, W, H).flash > 0.99);
  assert.ok(Math.abs(C.transitionLook('brilho', 0.5, W, H).flash - 0.25) < 1e-12);
  assert.equal(C.transitionLook('capulana-vento', 0, W, H).pano, -0.7);
  assert.ok(Math.abs(C.transitionLook('capulana-vento', 1, W, H).pano - 1) < 1e-12);
  assert.ok(Math.abs(C.transitionLook('zoom', 1, W, H).cur.scale - 1) < 1e-12);
  assert.equal(C.transitionLook('girar', 0.25, W, H).prev.scale, 1.8);
  assert.equal(C.transitionProgress(10.25, 10, 0.5), 0.5);
  assert.equal(C.transitionProgress(9, 10, 0.5), 0);
  assert.equal(C.transitionProgress(12, 10, 0.5), 1);
});

test('o zoom das fotos é um worklet (corre no fio da interface) e já não passa pelo estado do React', () => {
  const z = C.photoZoom(1.5, 3, null);
  assert.ok(Math.abs(z.scale - 1.035) < 1e-12);
  const stage = read('components', 'studio', 'native', 'NativeStage.tsx');
  assert.ok(!/setZ\(/.test(stage), 'sem setState do zoom a cada tique');
  assert.ok(!/transformOrigin: `\$\{Math\.round/.test(stage), 'sem a origem arredondada a %');
  assert.match(stage, /useAnimatedStyle\(\(\) => \{\s*const z = photoZoom/);
  assert.match(stage, /transitionLook\(tr\.type, transitionProgress\(t\.value/);
  // O estúdio e a linha do tempo já não redesenham tudo a tocar só por causa do tempo escrito.
  assert.ok(!/setPlayT/.test(read('components', 'TchekaStudio.native.tsx')));
  assert.ok(!/setNow\(/.test(read('components', 'studio', 'native', 'NativeTimeline.tsx')));
});

/**
 * Simula o vídeo da Skia no Android: 30 fps num ecrã de `hz`, com o Date.now() (ms inteiros e até 4 ms de atraso) e, no
 * modo antigo, um alvo novo do JS a cada 120 ms. Conta os intervalos entre frames mostrados que fogem do de 33 ms e os
 * frames saltados.
 */
function simulate(hz, mode) {
  let r = 7;
  const rnd = () => ((r = (r * 1103515245 + 12345) % 2147483648) / 2147483648);
  const vs = 1000 / hz, frameMs = 1000 / 30;
  let cur = 0, last = -1, lastChange = 0, sm = 0, src = 0, stamp = 1000;
  const L = { src: 0, rate: 1, at: 1000 };
  const gaps = [];
  let skips = 0;
  for (let k = 0; k < hz * 10; k++) {
    const ts = 1000 + k * vs;
    const wall = Math.floor(ts + rnd() * 4);
    const now = mode === 'novo' ? (sm = C.smoothNow(sm, k ? vs : 0, wall)) : wall;
    if (k % Math.max(1, Math.round(120 / vs)) === 0) {
      const js = ts + rnd() * 6;
      const want = (js - 1000) / 1000;
      const at = Math.floor(js + rnd());
      if (mode === 'antigo' || V.retarget(L, want, at)) { src = want; stamp = at; L.src = want; L.at = at; }
    }
    const pace = mode === 'antigo'
      ? ((p) => { const behind = p.want - p.cur; return behind <= frameMs / 2 ? 0 : Math.min(4, Math.ceil(behind / frameMs)); })
      : ((p) => V.androidPace({ ...p, now: 99_999, lastSeekAt: 0, lastSeekTo: -1e9 }).advance);
    const n = pace({ want: V.wantMs({ src, rate: 1, playing: true, stamp, end: 999 }, now), cur, frameMs });
    if (n > 0) { cur += n * frameMs; if (n > 1) skips++; }
    if (cur !== last) { if (last >= 0) gaps.push(ts - lastChange); lastChange = ts; last = cur; }
  }
  const off = gaps.filter((g) => Math.abs(g - frameMs) > vs * 0.6).length;
  return { offPct: (100 * off) / gaps.length, skips };
}

test('o ritmo dos vídeos da Skia: com o relógio liso e sem alvos novos a cada 120 ms, um frame a cada 33 ms', () => {
  for (const hz of [60, 120]) {
    const before = simulate(hz, 'antigo');
    const after = simulate(hz, 'novo');
    assert.ok(before.offPct > 15, `${hz} Hz: o antigo estremecia (${before.offPct.toFixed(1)} % fora do ritmo)`);
    assert.ok(after.offPct < 1, `${hz} Hz: o novo fica certo (${after.offPct.toFixed(1)} %)`);
    assert.equal(after.skips, 0);
  }
  assert.equal(V.retarget({ src: 1, rate: 1, at: 0 }, 1.5, 500), false, 'no sítio previsto: não se manda alvo novo');
  assert.equal(V.retarget({ src: 1, rate: 1, at: 0 }, 3, 500), true, 'um salto: manda-se');
  assert.equal(V.retarget({ src: 1, rate: 2, at: 0 }, 2, 500), false, 'à velocidade dele');
});

test('containTransform: o frame inteiro contido (o «Inteiro» dos vídeos)', () => {
  const t = V.containTransform(1920, 1080, 0, 400, 700);
  assert.deepEqual(t[3], { scale: 400 / 1920 });
  const r = V.containTransform(1920, 1080, 90, 400, 700);
  assert.deepEqual(r[3], { scale: Math.min(400 / 1080, 700 / 1920) });
});
