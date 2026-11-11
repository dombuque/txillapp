// Testes da lógica pura da câmara nativa (src/lib/cameraControls.ts): lentes e zoom, foco, exposição, flash,
// formato e as mensagens de permissões e problemas.
// Correr em apps/mobile:  node --experimental-strip-types --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const c = await import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'cameraControls.ts')).href);

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);

// iPhone 13 Pro: câmara tripla (0,5× · 1× · 3×); no aparelho 1 = ultra grande angular, troca a 2 e a 6.
const triple = { platform: 'ios', minZoom: 1, maxZoom: 123, switchFactors: [2, 6], hasUltraWide: true, back: true };
// iPhone 11: dupla grande angular (0,5× · 1×).
const dualWide = { platform: 'ios', minZoom: 1, maxZoom: 32, switchFactors: [2], hasUltraWide: true, back: true };
// iPhone XS: dupla (1× · 2× tele), sem ultra grande angular.
const dualTele = { platform: 'ios', minZoom: 1, maxZoom: 16, switchFactors: [2], hasUltraWide: false, back: true };
// iPhone SE: só uma lente.
const single = { platform: 'ios', minZoom: 1, maxZoom: 5, switchFactors: [], hasUltraWide: false, back: true };
// Android com ultra grande angular na câmara lógica do CameraX (zoom mínimo 0,6).
const android = { platform: 'android', minZoom: 0.6, maxZoom: 8, switchFactors: [], hasUltraWide: true, back: true, ctrlRatio: 1 };

test('displayMultiplier: no iPhone com ultra grande angular, 1× mostrado = o primeiro fator de troca', () => {
  near(c.displayMultiplier(triple), 0.5);
  near(c.displayMultiplier(dualWide), 0.5);
  near(c.displayMultiplier(dualTele), 1);
  near(c.displayMultiplier(single), 1);
});

test('displayMultiplier: no Android usa o rácio do controlador só se for razoável', () => {
  near(c.displayMultiplier(android), 1);
  near(c.displayMultiplier({ ...android, ctrlRatio: 0.6 }), 0.6);
  near(c.displayMultiplier({ ...android, ctrlRatio: 0 }), 1);
  near(c.displayMultiplier({ ...android, ctrlRatio: Number.NaN }), 1);
  near(c.displayMultiplier({ ...android, ctrlRatio: 40 }), 1);
  near(c.displayMultiplier({ ...android, ctrlRatio: undefined }), 1);
});

test('zoomStops: as pílulas que cada telemóvel mostra', () => {
  assert.deepEqual(c.zoomStops(triple, 0.5), [0.5, 1, 3]);
  assert.deepEqual(c.zoomStops(dualWide, 0.5), [0.5, 1, 2]); // 2× digital
  assert.deepEqual(c.zoomStops(dualTele, 1), [1, 2]); // a tele é o 2×
  assert.deepEqual(c.zoomStops(single, 1), [1, 2]);
  assert.deepEqual(c.zoomStops(android, 1), [0.6, 1, 2]);
  // iPhone 15 Pro Max: tele 5× (troca a 10 no aparelho).
  assert.deepEqual(c.zoomStops({ ...triple, switchFactors: [2, 10] }, 0.5), [0.5, 1, 5]);
});

test('zoomStops: a câmara da frente não tem pílulas e nada passa do máximo', () => {
  assert.deepEqual(c.zoomStops({ ...single, back: false }, 1), [1]);
  assert.deepEqual(c.zoomStops({ ...single, maxZoom: 1.5 }, 1), [1]); // não chega aos 2×
});

test('maxDisplayZoom: 10×, ou o dobro da maior tele, sem passar o que o aparelho deixa', () => {
  near(c.maxDisplayZoom(triple, 0.5), 10);
  near(c.maxDisplayZoom({ ...triple, switchFactors: [2, 12] }, 0.5), 12);
  near(c.maxDisplayZoom(single, 1), 5);
  near(c.maxDisplayZoom({ ...single, maxZoom: 0.5 }, 1), 1);
});

test('activeStop: a pílula acesa é a maior lente já alcançada', () => {
  const s = [0.5, 1, 3];
  assert.equal(c.activeStop(s, 0.5), 0.5);
  assert.equal(c.activeStop(s, 0.8), 0.5);
  assert.equal(c.activeStop(s, 0.96), 1);
  assert.equal(c.activeStop(s, 2.9), 1);
  assert.equal(c.activeStop(s, 3), 3);
  assert.equal(c.activeStop(s, 7), 3);
  assert.equal(c.activeStop([], 2), 1);
});

test('formatZoom e formatStop: "1,6×", "2×", "0,5×", "12×"', () => {
  assert.equal(c.formatZoom(1.6), '1,6×');
  assert.equal(c.formatZoom(1.64), '1,6×');
  assert.equal(c.formatZoom(2), '2×');
  assert.equal(c.formatZoom(1.97), '2×');
  assert.equal(c.formatZoom(0.5), '0,5×');
  assert.equal(c.formatZoom(0.6), '0,6×');
  assert.equal(c.formatZoom(9.94), '9,9×');
  assert.equal(c.formatZoom(12.4), '12×');
  assert.equal(c.formatZoom(1.6, '.'), '1.6×');
  assert.equal(c.formatZoom(Number.NaN), '1×');
  assert.equal(c.formatStop(0.5), '0,5');
  assert.equal(c.formatStop(3), '3');
  assert.equal(c.zoomA11y(1.6), 'Zoom 1,6 vezes');
  assert.equal(c.zoomA11y(2), 'Zoom 2 vezes');
});

test('pinchZoom: proporcional à escala e dentro dos limites', () => {
  near(c.pinchZoom(2, 1.5, 1, 20), 3);
  near(c.pinchZoom(2, 0.25, 1, 20), 1);
  near(c.pinchZoom(10, 4, 1, 20), 20);
  near(c.pinchZoom(2, 0, 1, 20), 2);
  near(c.pinchZoom(2, Number.NaN, 1, 20), 2);
});

test('slideZoom: 120 pt para cima duplicam, para baixo reduzem', () => {
  near(c.slideZoom(1, 120, 1, 10), 2);
  near(c.slideZoom(1, 240, 1, 10), 4);
  near(c.slideZoom(2, -120, 1, 10), 1);
  near(c.slideZoom(2, -1000, 1, 10), 1);
  near(c.slideZoom(2, 60, 1, 10, 60), 4);
});

test('crossedStop: avisa ao passar ou chegar a uma lente, não ao sair dela', () => {
  const s = [0.5, 1, 3];
  assert.equal(c.crossedStop(0.9, 1.1, s), 1);
  assert.equal(c.crossedStop(1.1, 0.9, s), 1);
  assert.equal(c.crossedStop(0.9, 1, s), 1);
  assert.equal(c.crossedStop(1, 1.2, s), null);
  assert.equal(c.crossedStop(1.2, 1.4, s), null);
  assert.equal(c.crossedStop(1, 1, s), null);
});

test('zoomAnimationArg: duração em ms no Android, duplicações por segundo no iPhone', () => {
  assert.equal(c.zoomAnimationArg('android', 1, 2), 260);
  assert.equal(c.zoomAnimationArg('android', 1, 2, 300), 300);
  near(c.zoomAnimationArg('ios', 2, 4, 250), 4); // 1 duplicação em 0,25 s
  near(c.zoomAnimationArg('ios', 1, 6, 500), Math.log2(6) / 0.5);
  near(c.zoomAnimationArg('ios', 2, 2.01), 1); // mínimo 1
  assert.equal(c.zoomAnimationArg('ios', 0, 2), 8);
});

test('previewPoint: soma o que a vista da câmara tem fora do visor, e não sai dele', () => {
  // Visor 360×600, vista da câmara 9:16 a cobrir: 360×640 → 20 pt fora em cima e em baixo.
  assert.deepEqual(c.previewPoint(180, 300, { w: 360, h: 600 }, { w: 360, h: 640 }), { x: 180, y: 320 });
  assert.deepEqual(c.previewPoint(0, 0, { w: 360, h: 600 }, { w: 360, h: 640 }), { x: 0, y: 20 });
  // Visor mais largo: a câmara sai dos lados.
  assert.deepEqual(c.previewPoint(10, 10, { w: 400, h: 600 }, { w: 400 * 1.2, h: 600 * 1.2 }), { x: 50, y: 70 });
  // Toque fora (a deslizar) fica na borda.
  assert.deepEqual(c.previewPoint(-50, 900, { w: 360, h: 600 }, { w: 360, h: 640 }), { x: 0, y: 620 });
});

test('focusBoxOrigin e exposureBarOrigin: o quadrado e o sol ficam dentro do visor', () => {
  const v = { w: 360, h: 600 };
  assert.deepEqual(c.focusBoxOrigin(180, 300, 80, v), { left: 140, top: 260 });
  assert.deepEqual(c.focusBoxOrigin(5, 5, 80, v), { left: 0, top: 0 });
  assert.deepEqual(c.focusBoxOrigin(359, 599, 80, v), { left: 280, top: 520 });
  // À direita quando cabe…
  assert.deepEqual(c.exposureBarOrigin(140, 260, 80, 44, 160, v), { left: 226, top: 220 });
  // …à esquerda quando não.
  assert.deepEqual(c.exposureBarOrigin(280, 260, 80, 44, 160, v), { left: 230, top: 220 });
  // Perto do topo, a barra não sobe para fora.
  assert.equal(c.exposureBarOrigin(140, 0, 80, 44, 160, v).top, 8);
});

test('meteringModes: só os modos que a câmara aceita', () => {
  assert.deepEqual(c.meteringModes({ af: true, ae: true, awb: true }), ['AE', 'AF', 'AWB']);
  assert.deepEqual(c.meteringModes({ af: true, ae: false, awb: false }), ['AF']);
  assert.deepEqual(c.meteringModes({ af: false, ae: false, awb: false }), []);
});

test('exposureRange: ±2 EV no iPhone, índices inteiros no Android, nada se não houver', () => {
  assert.deepEqual(c.exposureRange('ios', -8, 8), { min: -2, max: 2, integer: false });
  assert.deepEqual(c.exposureRange('ios', -1, 1), { min: -1, max: 1, integer: false });
  assert.deepEqual(c.exposureRange('android', -12, 12), { min: -12, max: 12, integer: true });
  assert.equal(c.exposureRange('android', 0, 0), null);
  assert.equal(c.exposureRange('ios', Number.NaN, 2), null);
});

test('exposureFromDrag: para cima clareia, com degraus inteiros no Android', () => {
  const ios = { min: -2, max: 2, integer: false };
  const and = { min: -12, max: 12, integer: true };
  near(c.exposureFromDrag(0, 80, ios, 160), 2);
  near(c.exposureFromDrag(0, 40, ios, 160), 1);
  near(c.exposureFromDrag(0, -400, ios, 160), -2);
  assert.equal(c.exposureFromDrag(0, 13, and, 240), 1); // 13/240×24 = 1,3 → 1
  assert.equal(c.exposureFromDrag(3, -10, and, 240), 2);
  assert.ok(Number.isInteger(c.exposureFromDrag(0, 7.7, and, 240)));
  near(c.exposureStep(ios), 0.4);
  assert.equal(c.exposureStep(and), 1);
});

test('sunOffset e crossedZero', () => {
  const r = { min: -2, max: 2, integer: false };
  assert.equal(c.sunOffset(2, r, 160, 28), 0);
  assert.equal(c.sunOffset(-2, r, 160, 28), 132);
  assert.equal(c.sunOffset(0, r, 160, 28), 66);
  assert.equal(c.sunOffset(0, null, 160, 28), 66);
  assert.ok(c.crossedZero(-0.2, 0.1));
  assert.ok(c.crossedZero(0.3, 0));
  assert.ok(!c.crossedZero(0, 0.3));
  assert.ok(!c.crossedZero(0.2, 0.4));
});

test('flash: ordem do botão, modo pedido, flash de ecrã e lanterna', () => {
  assert.equal(c.nextFlash('off'), 'auto');
  assert.equal(c.nextFlash('auto'), 'on');
  assert.equal(c.nextFlash('on'), 'off');
  assert.equal(c.photoFlashMode('on', true), 'on');
  assert.equal(c.photoFlashMode('auto', true), 'auto');
  assert.equal(c.photoFlashMode('on', false), 'off');
  // Frontal sem flash: ecrã branco com o flash ligado, ou automático com pouca luz.
  assert.equal(c.needsScreenFlash('on', false, true, false), true);
  assert.equal(c.needsScreenFlash('auto', false, true, true), true);
  assert.equal(c.needsScreenFlash('auto', false, true, false), false);
  assert.equal(c.needsScreenFlash('off', false, true, true), false);
  assert.equal(c.needsScreenFlash('on', true, true, false), false); // tem flash a sério
  assert.equal(c.needsScreenFlash('on', false, false, false), false); // de trás nunca
  // Lanterna só a gravar.
  assert.equal(c.torchFor('on', true, true, false), 'on');
  assert.equal(c.torchFor('on', false, true, false), 'off');
  assert.equal(c.torchFor('auto', true, true, true), 'on');
  assert.equal(c.torchFor('auto', true, true, false), 'off');
  assert.equal(c.torchFor('on', true, false, false), 'off');
  assert.equal(c.flashA11y('auto', false), 'Flash: automático');
  assert.equal(c.flashA11y('on', true), 'Flash de ecrã: ligado');
});

test('isLowLight: ISO alto ou exposição longa; sem dados (Android) nunca', () => {
  assert.equal(c.isLowLight({ iso: 0, exposureDuration: 0 }), false);
  assert.equal(c.isLowLight({}), false);
  assert.equal(c.isLowLight({ iso: 100, exposureDuration: 1 / 120 }), false);
  assert.equal(c.isLowLight({ iso: 1600, exposureDuration: 1 / 60 }), true);
  assert.equal(c.isLowLight({ iso: 400, exposureDuration: 1 / 15 }), true);
});

test('formato: estabilização, fotogramas e prioridade da foto', () => {
  const all = () => true;
  const none = () => false;
  assert.equal(c.pickStabilization('ios', all), 'cinematic');
  assert.equal(c.pickStabilization('ios', (m) => m === 'standard'), 'standard');
  assert.equal(c.pickStabilization('android', all), 'standard');
  assert.equal(c.pickStabilization('android', none), 'auto');
  assert.equal(c.pickStabilization('ios', () => { throw new Error('x'); }), 'auto');
  assert.equal(c.pickVideoFps((f) => f === 30), 30);
  assert.equal(c.pickVideoFps(none), null);
  assert.equal(c.pickVideoFps(() => { throw new Error('x'); }), null);
  assert.equal(c.photoPriority('ios'), 'balanced');
  assert.equal(c.photoPriority('android'), 'balanced');
});

test('permissionView: pedir, abrir definições ou bloqueada', () => {
  assert.equal(c.permissionView('not-determined').action, 'request');
  assert.equal(c.permissionView('not-determined', true).action, 'settings');
  assert.equal(c.permissionView('denied').action, 'settings');
  assert.equal(c.permissionView('denied').label, 'Abrir definições');
  assert.equal(c.permissionView('restricted').action, 'none');
});

test('cameraProblem: câmara ocupada, quente, microfone e erro genérico', () => {
  assert.equal(c.cameraProblem('interruption', { reason: 'video-device-in-use-by-another-client' }).title, 'A câmara está ocupada');
  assert.equal(c.cameraProblem('interruption', { usedByAnotherApp: true }).retry, false);
  assert.equal(c.cameraProblem('error', { message: 'Camera device is already in use!' }).title, 'A câmara está ocupada');
  assert.equal(c.cameraProblem('error', { message: 'Camera device is already in use!' }).retry, true);
  assert.equal(c.cameraProblem('interruption', { reason: 'video-device-not-available-due-to-system-pressure' }).title, 'O telemóvel está quente');
  assert.equal(c.cameraProblem('interruption', { reason: 'audio-device-in-use-by-another-client' }).title, 'Microfone ocupado');
  assert.equal(c.cameraProblem('error', { message: 'Camera is disabled, probably due to a device policy!' }).retry, false);
  assert.equal(c.cameraProblem('interruption', { reason: 'unknown' }).retry, false);
  assert.equal(c.cameraProblem('error', { message: 'boom' }).retry, true);
});

test('isMinorCameraError: zoom, exposição, lanterna e foco não são falhas da câmara', () => {
  assert.ok(c.isMinorCameraError('`zoom` is not within the device\'s `minZoom` and `maxZoom` range!'));
  assert.ok(c.isMinorCameraError('Cannot set exposure bias'));
  assert.ok(c.isMinorCameraError('Cannot enable torch'));
  assert.ok(c.isMinorCameraError('The Zoom animation was canceled!'));
  assert.ok(c.isMinorCameraError('Camera is not yet ready!'));
  assert.ok(!c.isMinorCameraError('Camera device is already in use!'));
  assert.ok(!c.isMinorCameraError('Encountered a fatal Camera error!'));
  assert.ok(!c.isMinorCameraError(undefined));
});

test('recTime e createValueStore', () => {
  assert.equal(c.recTime(0), '0:00');
  assert.equal(c.recTime(7400), '0:07');
  assert.equal(c.recTime(60000), '1:00');
  assert.equal(c.recTime(-5), '0:00');
  const s = c.createValueStore(1);
  let n = 0;
  const off = s.subscribe(() => { n += 1; });
  s.set(2);
  s.set(2); // igual: não avisa
  assert.equal(s.get(), 2);
  assert.equal(n, 1);
  off();
  s.set(3);
  assert.equal(n, 1);
});

test('isMinorCameraError: "Camera is not active" (CameraX com a câmara parada) não é avaria; as avarias a sério são', () => {
  // O que o CameraX responde ao zoom/exposição/lanterna com a câmara parada (editor por cima, a arrancar, a trocar de modo).
  assert.ok(c.isMinorCameraError('Camera is not active.'));
  assert.ok(c.isMinorCameraError('Camera is closed'));
  assert.ok(c.isMinorCameraError('No flash unit'));
  assert.ok(c.isMinorCameraError('Cancelled by another startFocusAndMetering()'));
  // As mensagens das avarias do CameraX (StateError+reason.kt da VisionCamera) continuam a contar.
  for (const m of [
    'Failed to apply the stream configuration for the given outputs!',
    'Camera device is already in use!',
    'Camera is disabled, probably due to a device policy!',
    'Camera has been removed!',
    'Encountered a fatal Camera error!',
    'The maximum number of open cameras has been reached, and more cameras cannot be opened until other instances are closed!',
    'Camera cannot be opened while Do-Not-Disturb mode is enabled!',
  ]) assert.ok(!c.isMinorCameraError(m), m);
});

test('zoomBounds: limites 0 ou estranhos (Android sem estado do zoom) passam a 1…1, nunca máximo abaixo do mínimo', () => {
  assert.deepEqual(c.zoomBounds(0, 0), { min: 1, max: 1 });
  assert.deepEqual(c.zoomBounds(undefined, undefined), { min: 1, max: 1 });
  assert.deepEqual(c.zoomBounds(NaN, Infinity), { min: 1, max: 1 });
  assert.deepEqual(c.zoomBounds(0.6, 10), { min: 0.6, max: 10 });
  assert.deepEqual(c.zoomBounds(1, 0), { min: 1, max: 1 });
  assert.deepEqual(c.zoomBounds(2, 1), { min: 2, max: 2 });
  // Com os limites de 0, o zoom neutro e as pílulas continuam válidos (antes: zoom 0, recusado pela câmara).
  const b = c.zoomBounds(0, 0);
  const info = { platform: 'android', minZoom: b.min, maxZoom: b.max, switchFactors: [], hasUltraWide: false, back: true };
  assert.deepEqual(c.zoomStops(info, 1), [1]);
  assert.equal(c.pinchZoom(1, 3, b.min, b.max), 1);
});

test('quiet: nem exceções síncronas nem promessas rejeitadas escapam', async () => {
  // O CameraRef da VisionCamera atira logo ("Camera is not yet ready!") antes de haver controlador.
  assert.doesNotThrow(() => c.quiet(() => { throw new Error('Camera is not yet ready!'); }));
  assert.doesNotThrow(() => c.quiet(() => undefined));
  assert.doesNotThrow(() => c.quiet(() => null));
  let unhandled = 0;
  const onUnhandled = () => { unhandled += 1; };
  process.on('unhandledRejection', onUnhandled);
  try {
    c.quiet(() => Promise.reject(new Error('`zoom` is out of range!')));
    let ran = false;
    c.quiet(() => Promise.resolve().then(() => { ran = true; }));
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(unhandled, 0);
    assert.ok(ran);
  } finally {
    process.off('unhandledRejection', onUnhandled);
  }
});
