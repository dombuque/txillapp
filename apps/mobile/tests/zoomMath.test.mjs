// Foto de perfil em grande (toque longo no avatar do perfil): saía desfocada (vinha a de 256) e não deixava ampliar.
// Agora pede a de 1080 (?w=1080) e abre em components/ZoomableImage: dois dedos (1× a 5×), arrastar ampliada sem sair dos
// limites, duplo toque 1× ↔ 2,5× no ponto tocado, um toque a 1× fecha. Aqui: as contas (src/lib/zoomMath.ts) e a ligação.
// Correr em apps/mobile:  node --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const m = await import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'zoomMath.ts')).href);
const a = await import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'avatarSrc.ts')).href);
const read = (...p) => readFileSync(path.join(ROOT, 'src', ...p), 'utf8');

// Telemóvel de 390×844 com o círculo de 312 (80% da largura).
const BOX = { base: 312, w: 390, h: 844 };
const near = (x, y, msg) => assert.ok(Math.abs(x - y) < 1e-9, `${msg ?? ''} ${x} ≈ ${y}`);

test('limites da escala: o aperto fica entre 0,6× e 5×; ao largar fica entre 1× e 5×', () => {
  assert.equal(m.ZOOM_MIN, 1);
  assert.equal(m.ZOOM_MAX, 5);
  const z = m.pinchStep(m.REST, 20, { x: 0, y: 0 }, { x: 0, y: 0 });
  assert.equal(z.scale, 5, 'não passa de 5×');
  const small = m.pinchStep(m.REST, 0.1, { x: 0, y: 0 }, { x: 0, y: 0 });
  assert.equal(small.scale, m.ZOOM_PINCH_MIN, 'pode encolher um pouco a apertar');
  assert.deepEqual(m.settle(small, BOX), { scale: 1, x: 0, y: 0 }, 'abaixo de 1× volta a 1×, centrada');
  assert.deepEqual(m.settle({ scale: 0.95, x: 30, y: -12 }, BOX), m.REST);
  assert.equal(m.settle({ scale: 7, x: 0, y: 0 }, BOX).scale, 5);
  assert.equal(m.pinchStep(m.REST, Number.NaN, { x: 0, y: 0 }, { x: 0, y: 0 }).scale, 1, 'fator inválido não estraga nada');
});

test('limites do arrastar: só o que sobra fora do visor', () => {
  assert.deepEqual(m.panLimit(1, BOX), { x: 0, y: 0 }, 'a 1× não se arrasta');
  const l = m.panLimit(2, BOX); // 624 de lado: sobra 117 de cada lado na largura, nada na altura (844)
  near(l.x, 117);
  assert.equal(l.y, 0);
  const l5 = m.panLimit(5, BOX); // 1560
  near(l5.x, 585);
  near(l5.y, 358);
  assert.deepEqual(m.clampPan({ scale: 2, x: 500, y: -90 }, BOX), { scale: 2, x: 117, y: 0 });
  assert.deepEqual(m.clampPan({ scale: 2, x: -500, y: 0 }, BOX), { scale: 2, x: -117, y: 0 });
  assert.deepEqual(m.settle({ scale: 3, x: 9999, y: -9999 }, BOX), m.clampPan({ scale: 3, x: 9999, y: -9999 }, BOX));
});

test('arrastar: dentro dos limites anda tudo, para lá deles custa mais (elástico)', () => {
  const z = { scale: 2, x: 0, y: 0 };
  assert.deepEqual(m.panStep(z, 50, 0, BOX), { scale: 2, x: 50, y: 0 });
  const edge = { scale: 2, x: 117, y: 0 };
  near(m.panStep(edge, 20, 0, BOX).x, 117 + 20 * m.PAN_RESIST, 'para fora: só uma fração');
  assert.equal(m.panStep(edge, -20, 0, BOX).x, 97, 'para dentro: normal');
  near(m.panStep(z, 0, 30, BOX).y, 30 * m.PAN_RESIST, 'na altura não há folga a 2×');
});

test('zoom à volta de um ponto: o ponto debaixo dos dedos fica no mesmo sítio', () => {
  const z = { scale: 1.5, x: 10, y: -20 };
  const f = { x: 80, y: 40 };
  const p = { x: (f.x - z.x) / z.scale, y: (f.y - z.y) / z.scale }; // ponto da foto debaixo de f
  const n = m.zoomAt(z, 3, f.x, f.y);
  near(n.x + n.scale * p.x, f.x);
  near(n.y + n.scale * p.y, f.y);
  // Os dedos andam juntos: a foto vai atrás.
  const s = m.pinchStep(z, 1, { x: 100, y: 60 }, f);
  near(s.x, z.x + 20);
  near(s.y, z.y + 20);
});

test('duplo toque: 1× → 2,5× centrado no ponto tocado (dentro dos limites); ampliada → 1×', () => {
  assert.equal(m.ZOOM_DOUBLE, 2.5);
  const c = m.doubleTapTarget(m.REST, 0, 0, BOX);
  assert.deepEqual(c, { scale: 2.5, x: 0, y: 0 }, 'no centro');
  const t = m.doubleTapTarget(m.REST, 40, 30, BOX);
  assert.equal(t.scale, 2.5);
  near(t.x, -60, 'o ponto tocado fica onde estava: x = 40 − 2,5·40');
  assert.equal(t.y, 0, 'na altura não há folga (780 < 844)');
  const far = m.doubleTapTarget(m.REST, 180, 0, BOX);
  near(far.x, -m.panLimit(2.5, BOX).x, 'perto da borda: preso ao limite');
  assert.deepEqual(m.doubleTapTarget({ scale: 2.5, x: -60, y: 0 }, 10, 10, BOX), m.REST);
  assert.deepEqual(m.doubleTapTarget({ scale: 1.3, x: 0, y: 0 }, 10, 10, BOX), m.REST);
});

test('um toque só fecha em repouso (1×)', () => {
  assert.equal(m.atRest(1), true);
  assert.equal(m.atRest(1.005), true);
  assert.equal(m.atRest(1.2), false);
  assert.equal(m.isTap(3, 4, 120), true);
  assert.equal(m.isTap(12, 0, 120), false, 'andou: é arrastar');
  assert.equal(m.isTap(0, 0, 600), false, 'demorou: não é toque');
  const first = { t: 1000, x: 100, y: 100 };
  assert.equal(m.isDoubleTap(first, { t: 1200, x: 110, y: 95 }), true);
  assert.equal(m.isDoubleTap(first, { t: 1400, x: 100, y: 100 }), false, 'tarde demais');
  assert.equal(m.isDoubleTap(first, { t: 1100, x: 200, y: 100 }), false, 'longe demais');
  assert.equal(m.isDoubleTap(null, first), false);
});

test('roda do rato e trackpad: para cima amplia, para baixo reduz, nunca abaixo de 1×', () => {
  assert.ok(m.wheelFactor(-100, 0, false) > 1);
  assert.ok(m.wheelFactor(100, 0, false) < 1);
  assert.ok(m.wheelFactor(-10, 0, true) > m.wheelFactor(-10, 0, false), 'o aperto do trackpad (ctrlKey) é mais rápido');
  near(m.wheelFactor(-5000, 0, false), m.wheelFactor(-100, 0, false), 'um salto enorme conta como 100 px');
  let z = m.REST;
  for (let i = 0; i < 50; i++) z = m.wheelStep(z, 1.3, 50, 50, BOX);
  assert.equal(z.scale, 5);
  for (let i = 0; i < 50; i++) z = m.wheelStep(z, 0.7, 50, 50, BOX);
  assert.deepEqual(z, m.REST);
});

test('o anel branco desaparece ao ampliar', () => {
  assert.equal(m.ringOpacity(1), 1);
  assert.equal(m.ringOpacity(0.7), 1);
  assert.equal(m.ringOpacity(1.4), 0);
  assert.equal(m.ringOpacity(3), 0);
});

test('as contas podem correr no UI thread (worklet) as que o telemóvel usa nos gestos', () => {
  const s = read('lib', 'zoomMath.ts');
  for (const fn of ['clamp', 'atRest', 'panLimit', 'clampPan', 'zoomAt', 'pinchStep', 'panStep', 'settle', 'doubleTapTarget', 'ringOpacity']) {
    assert.match(s, new RegExp(`export function ${fn}\\([^]*?\\{\\s*'worklet';`), fn);
  }
});

test('a foto em grande pede a de 1080 (?w=1080), com a pequena por baixo', () => {
  assert.equal(a.AVATAR_BIG_W, 1080);
  assert.equal(a.avatarPath('ana', { w: a.AVATAR_BIG_W }), '/api/v1/avatars/ana?w=1080');
  assert.equal(a.avatarPath('ana', { v: 2, w: 1080 }), '/api/v1/avatars/ana?v=2&w=1080');
  assert.equal(a.avatarPath('ana'), '/api/v1/avatars/ana', 'a bolinha continua a de 256');
  assert.equal(a.avatarPath('a b'), '/api/v1/avatars/a%20b');
  const s = read('components', 'ProfileStoryAvatar.tsx');
  assert.match(s, /<ZoomableImage[^>]*uri=\{avatarUri\(username, avatarV, AVATAR_BIG_W\)\}/s);
  assert.match(s, /placeholderUri=\{avatarUri\(username, avatarV\)\}/);
  assert.doesNotMatch(s, /api\/v1\/avatars/, 'o endereço faz-se num sítio só (Avatar / lib/avatarSrc)');
  assert.match(read('components', 'Avatar.tsx'), /source=\{\{ uri: avatarUri\(username, v\) \}\}/, 'a bolinha usa o mesmo endereço (a pequena já está na cache)');
});

test('ZoomableImage: telemóvel com gesture-handler dentro de GestureHandlerRootView; web com pointer events', () => {
  const n = read('components', 'ZoomableImage.tsx');
  assert.match(n, /<GestureHandlerRootView/);
  assert.match(n, /usePinchGesture/);
  assert.match(n, /usePanGesture/);
  assert.match(n, /useTapGesture\(\{\s*numberOfTaps: 2/);
  assert.match(n, /requireToFail: doubleTap/);
  assert.ok(existsSync(path.join(ROOT, 'src', 'components', 'ZoomableImage.web.tsx')));
  const w = read('components', 'ZoomableImage.web.tsx');
  assert.match(w, /touchAction = 'none'/);
  assert.match(w, /addEventListener\('gesturestart'/);
  assert.match(w, /addEventListener\('gesturechange'/);
  assert.match(w, /addEventListener\('wheel', wheel, opts\)/);
  assert.match(w, /passive: false/);
  // O Modal da app (com o «voltar» do browser), não o do React Native.
  assert.match(read('components', 'ProfileStoryAvatar.tsx'), /import \{ Modal \} from '@\/components\/Modal'/);
});
