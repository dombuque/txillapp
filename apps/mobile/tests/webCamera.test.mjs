// Testes das contas da câmara do site (src/lib/webCamera.ts): restrições e plano B, erros e permissões por browser,
// formato e qualidade da gravação, o recorte WYSIWYG (cover + zoom + espelho), o toque → ponto de foco, a foto do
// ImageCapture mapeada e verificada contra o visor, o zoom (aparelho ou digital) e as capacidades.
// Correr em apps/mobile:  node --experimental-strip-types --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const C = await import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'webCamera.ts')).href);
const SRC = readFileSync(path.join(ROOT, 'src', 'components', 'TxCamera.tsx'), 'utf8');

test('formato do sensor: 4:5 pede 3:4 inteiro; 9:16 pede 16:9', () => {
  assert.equal(C.sensorRatioFor(4 / 5), '3:4');
  assert.equal(C.sensorRatioFor(1), '3:4');
  assert.equal(C.sensorRatioFor(9 / 16), '16:9');
});

test('plano B: do melhor ao mais simples, sempre com a câmara certa, e por fim qualquer câmara', () => {
  const l = C.fallbackConstraints('user', '16:9');
  assert.equal(l.at(-1), true);
  for (const c of l.slice(0, -1)) assert.deepEqual(c.facingMode, { ideal: 'user' });
  assert.equal(l[0].width.ideal, 1280);
  assert.equal(l[0].aspectRatio.ideal, 16 / 9);
  // Nada de "exact"/"min": é isso que faz o OverconstrainedError.
  assert.ok(!JSON.stringify(l).includes('exact') && !JSON.stringify(l).includes('"min"'));
  const p = C.fallbackConstraints('environment', '3:4');
  assert.equal(p[0].aspectRatio.ideal, 3 / 4);
  assert.ok(p[0].height.ideal > p[0].width.ideal);
});

test('foto 3:4: sobe para o maior da escada (até 2160×2880) só se o sensor der e ainda não estiver lá', () => {
  const caps = { width: { min: 1, max: 4032 }, height: { min: 1, max: 3024 } };
  assert.deepEqual(C.photoUpgrade(caps, { width: 1080, height: 1440 }, '3:4'), { width: { ideal: 2160 }, height: { ideal: 2880 }, aspectRatio: { ideal: 3 / 4 } });
  // Já com o tamanho de antes (1440×1920): sobe na mesma (é aqui que a foto do iPhone ficava presa).
  assert.equal(C.photoUpgrade(caps, { width: 1440, height: 1920 }, '3:4').height.ideal, 2880);
  assert.equal(C.photoUpgrade(caps, { width: 2160, height: 2880 }, '3:4'), null);
  // Uma câmara que só vai a 1920×1440 (muitas frontais): fica no tamanho de antes.
  assert.deepEqual(C.photoUpgrade({ width: { max: 1920 }, height: { max: 1440 } }, { width: 1080, height: 1440 }, '3:4'), C.PHOTO_SAFE);
  assert.equal(C.photoUpgrade({ width: { max: 1920 }, height: { max: 1440 } }, { width: 1440, height: 1920 }, '3:4'), null);
  assert.equal(C.photoUpgrade(caps, { width: 1080, height: 1920 }, '16:9'), null);
  assert.equal(C.photoUpgrade({ width: { max: 1920 }, height: { max: 1080 } }, { width: 1080, height: 1440 }, '3:4'), null);
  assert.equal(C.photoUpgrade(undefined, { width: 1080, height: 1440 }, '3:4'), null);
});

test('erros: permissão, ocupada, sem câmara, restrições, ligação insegura', () => {
  assert.equal(C.classifyCameraError({ name: 'NotAllowedError' }), 'denied');
  assert.equal(C.classifyCameraError({ name: 'PermissionDeniedError' }), 'denied');
  assert.equal(C.classifyCameraError({ name: 'NotReadableError' }), 'busy');
  assert.equal(C.classifyCameraError({ name: 'TrackStartError' }), 'busy');
  assert.equal(C.classifyCameraError({ name: 'NotFoundError' }), 'nocamera');
  assert.equal(C.classifyCameraError({ name: 'OverconstrainedError' }), 'constraint');
  assert.equal(C.classifyCameraError({ name: 'Qualquer' }), 'failed');
  assert.equal(C.classifyCameraError(null), 'failed');
  assert.equal(C.classifyCameraError({ name: 'NotAllowedError' }, false), 'insecure');
  assert.equal(C.retryWithFallback('constraint'), true);
  assert.equal(C.retryWithFallback('busy'), true);
  assert.equal(C.retryWithFallback('denied'), false);
  assert.equal(C.retryWithFallback('nocamera'), false);
});

const UA = {
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  iphoneChrome: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0 Mobile/15E148 Safari/604.1',
  ipadMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
  android: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36',
  samsung: 'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0 Mobile Safari/537.36',
  win: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
  ff: 'Mozilla/5.0 (Windows NT 10.0; rv:130.0) Gecko/20100101 Firefox/130.0',
};
test('browser: Safari do iPhone, PWA, Chrome do iPhone, iPad como Mac, Android, Samsung, PC, Firefox', () => {
  assert.equal(C.browserKind(UA.iphone), 'ios-safari');
  assert.equal(C.browserKind(UA.iphone, true), 'ios-pwa');
  assert.equal(C.browserKind(UA.iphoneChrome), 'ios-other');
  assert.equal(C.browserKind(UA.ipadMac, false, true), 'ios-safari');
  assert.equal(C.browserKind(UA.ipadMac), 'desktop-safari');
  assert.equal(C.browserKind(UA.android), 'android-chrome');
  assert.equal(C.browserKind(UA.samsung), 'android-other');
  assert.equal(C.browserKind(UA.win), 'desktop-chrome');
  assert.equal(C.browserKind(UA.ff), 'firefox');
});

test('permissão: passos certos no cadeado do Safari, do Chrome e no PWA do iPhone', () => {
  assert.match(C.permissionSteps('ios-safari').join(' '), /aA.*Definições do site.*Câmara.*Permitir/s);
  assert.match(C.permissionSteps('ios-pwa').join(' '), /Definições do iPhone.*Safari.*Câmara/s);
  assert.match(C.permissionSteps('android-chrome').join(' '), /cadeado.*Permissões.*Câmara/s);
  assert.match(C.permissionSteps('desktop-chrome').join(' '), /endereço.*Permitir/s);
  for (const k of ['ios-safari', 'ios-pwa', 'ios-other', 'android-chrome', 'android-other', 'desktop-chrome', 'desktop-safari', 'firefox', 'other']) assert.ok(C.permissionSteps(k).length >= 2, k);
});

test('gravação: no iPhone MP4/H.264 (nunca WebM); no Chrome MP4 se der, senão WebM/VP9', () => {
  const safari = (t) => t === 'video/mp4' || t === 'video/mp4;codecs=avc1,mp4a' || t.startsWith('video/webm');
  assert.equal(C.pickRecorderType(safari, true), 'video/mp4;codecs=avc1,mp4a');
  const safariPlain = (t) => t === 'video/mp4' || t.startsWith('video/webm');
  assert.equal(C.pickRecorderType(safariPlain, true), 'video/mp4');
  const chromeOld = (t) => t.startsWith('video/webm');
  assert.equal(C.pickRecorderType(chromeOld, false), 'video/webm;codecs=vp9,opus');
  const chromeNew = (t) => t.startsWith('video/webm') || t === 'video/mp4;codecs=avc1.640028,mp4a.40.2' || t === 'video/mp4';
  assert.equal(C.pickRecorderType(chromeNew, false), 'video/mp4;codecs=avc1.640028,mp4a.40.2');
  assert.equal(C.pickRecorderType(() => { throw new Error('x'); }, false), '');
  assert.deepEqual(C.recorderFile('video/mp4;codecs=avc1,mp4a'), { type: 'video/mp4', ext: 'mp4' });
  assert.deepEqual(C.recorderFile('video/webm;codecs=vp9,opus'), { type: 'video/webm', ext: 'webm' });
  assert.deepEqual(C.recorderFile(''), { type: 'video/mp4', ext: 'mp4' });
});

test('bitrate: ~8 Mb/s em 1080p30, limites de 2,5 e 10 Mb/s (60 s cabem nos 100 MB do servidor)', () => {
  const b = C.videoBitrate(1920, 1080, 30);
  assert.ok(b > 7_500_000 && b < 8_500_000, String(b));
  assert.equal(C.videoBitrate(320, 240, 30), 2_500_000);
  assert.equal(C.videoBitrate(3840, 2160, 60), 10_000_000);
  assert.ok((C.videoBitrate(3840, 2160, 60) + 128_000) * 60 / 8 < 100 * 1024 * 1024);
  assert.ok(C.videoBitrate(undefined, undefined, undefined) >= 2_500_000);
  assert.equal(C.clock(7), '0:07');
  assert.equal(C.clock(60), '1:00');
});

test('recorte WYSIWYG: moldura igual ao visor → o vídeo inteiro, à resolução do vídeo (não do ecrã)', () => {
  // Visor 390×693 (9:16 no ecrã), vídeo 1080×1920: a moldura é o visor todo → a foto é 1080×1920.
  const v = { x: 0, y: 75, w: 390, h: 693.33 };
  const r = C.coverCrop(1080, 1920, v, v);
  assert.equal(r.x, 0);
  assert.equal(r.w, 1080);
  assert.ok(Math.abs(r.h - 1920) <= 1, String(r.h));
  // Publicação 4:5 num vídeo 3:4 (1080×1440): sai 1080×1350, o centro.
  const p = { x: 0, y: 100, w: 390, h: 487.5 };
  const q = C.coverCrop(1080, 1440, p, p);
  assert.deepEqual([q.w, q.h, q.x, q.y], [1080, 1350, 0, 45]);
});

test('recorte com zoom: 2× → metade do lado, ao centro; nunca sai do sensor', () => {
  const v = { x: 0, y: 0, w: 400, h: 500 };
  const r = C.coverCrop(1080, 1350, v, v, 2);
  assert.deepEqual(r, { x: 270, y: 338, w: 540, h: 675 });
  const big = C.coverCrop(1080, 1350, v, { x: -50, y: -50, w: 600, h: 700 });
  assert.ok(big.x >= 0 && big.y >= 0 && big.x + big.w <= 1080 && big.y + big.h <= 1350);
});

test('recorte de uma célula (layout) e espelho da câmara da frente', () => {
  const v = { x: 0, y: 0, w: 400, h: 500 };
  const left = { x: 0, y: 0, w: 200, h: 500 };
  const a = C.coverCrop(1080, 1350, v, left);
  assert.deepEqual([a.x, a.w], [0, 540]);
  // Espelhado: a metade esquerda do visor é a metade direita do sensor.
  const m = C.coverCrop(1080, 1350, v, left, 1, true);
  assert.deepEqual([m.x, m.w], [540, 540]);
});

test('toque → ponto de foco: centro é o centro; com cover e zoom, o canto do visor não é o canto do sensor', () => {
  assert.deepEqual(C.tapToPoint(200, 250, 400, 500, 1080, 1350), { x: 0.5, y: 0.5 });
  // Visor 400×800 e vídeo 1080×1350: o vídeo é cortado dos lados; o canto esquerdo do visor fica longe do 0.
  const p = C.tapToPoint(0, 400, 400, 800, 1080, 1350);
  assert.ok(p.x > 0.15 && p.x < 0.25, String(p.x));
  const z = C.tapToPoint(0, 0, 400, 500, 1080, 1350, 2);
  assert.deepEqual(z, { x: 0.25, y: 0.25 });
  assert.deepEqual(C.tapToPoint(0, 0, 400, 500, 1080, 1350, 2, true), { x: 0.75, y: 0.25 });
});

test('foto do ImageCapture: o vídeo 16:9 é o centro da foto 4:3; o recorte passa para a resolução da foto', () => {
  // Vídeo 1920×1080, foto 4000×3000 (k = 2,083): o vídeo ocupa 4000×2250 a meio.
  const r = C.videoCropToPhoto({ x: 0, y: 0, w: 1920, h: 1080 }, 1920, 1080, 4000, 3000);
  assert.deepEqual(r, { x: 0, y: 375, w: 4000, h: 2250 });
  const s = C.videoCropToPhoto({ x: 480, y: 270, w: 960, h: 540 }, 1920, 1080, 4000, 3000);
  assert.deepEqual(s, { x: 1000, y: 938, w: 2000, h: 1125 });
});

test('verificação da foto: correlação reconhece a mesma cena e rejeita outra ou uma imagem lisa', () => {
  const a = Array.from({ length: 64 }, (_, i) => (i % 8) * 30 + Math.floor(i / 8) * 3);
  const brighter = a.map((v) => v * 0.8 + 40); // flash: mais luz, a mesma cena
  const rotated = Array.from({ length: 64 }, (_, i) => a[63 - i]);
  assert.ok(C.ncc(a, brighter) > 0.99);
  assert.ok(C.ncc(a, rotated) < 0.6);
  assert.equal(C.ncc(a, new Array(64).fill(128)), 0);
  assert.equal(C.bestMatch([0.2, 0.95, 0.4, 0.7]), 1);
  assert.equal(C.bestMatch([0.2, 0.5, 0.4]), -1);
  assert.equal(C.bestMatch([]), -1);
});

test('zoom: com zoom do aparelho usa-o (no passo dele) e só depois o digital; sem ele, tudo digital até 5×', () => {
  assert.deepEqual(C.zoomPlan(2, null), { hw: null, digital: 2 });
  assert.deepEqual(C.zoomPlan(0.5, null), { hw: null, digital: 1 });
  const hw = { min: 1, max: 8, step: 0.1 };
  const p = C.zoomPlan(2.04, hw);
  assert.ok(Math.abs(p.hw - 2) < 1e-9 && Math.abs(p.digital - 1.02) < 0.01);
  const q = C.zoomPlan(10, { min: 1, max: 4, step: 0 });
  assert.equal(q.hw, 4);
  assert.equal(q.digital, 2.5);
  assert.deepEqual(C.zoomLimits(null), { min: 1, max: 5 });
  assert.deepEqual(C.zoomLimits({ min: 1, max: 30, step: 0.1 }), { min: 1, max: 10 });
  assert.deepEqual(C.zoomPills(null), [1, 2]);
  assert.deepEqual(C.zoomPills({ min: 0.5, max: 10, step: 0.1 }), [0.5, 1, 2]);
  assert.equal(C.zoomLabel(1), '1×');
  assert.equal(C.zoomLabel(1.44), '1,4×');
  assert.equal(C.zoomLabel(2), '2×');
  assert.equal(C.activePill(1.6, [1, 2]), 1);
  assert.equal(C.activePill(2.4, [1, 2]), 2);
  assert.equal(C.activePill(0.7, [0.5, 1, 2]), 0.5);
});

test('capacidades: só aparece o controlo que o browser dá', () => {
  // iPhone (Safari): quase nada.
  const ios = C.readCaps({ width: { min: 1, max: 1920 }, facingMode: ['environment'] }, { width: true }, null);
  assert.deepEqual(ios, { zoom: null, torch: false, focus: false, focusMode: null, exposure: null, flash: false });
  // Android (Chrome): zoom, lanterna, foco no ponto, exposição e flash.
  const and = C.readCaps(
    { zoom: { min: 1, max: 8, step: 0.1 }, torch: true, focusMode: ['manual', 'single-shot', 'continuous'], exposureCompensation: { min: -2, max: 2, step: 0.333 } },
    { pointsOfInterest: true },
    { fillLightMode: ['auto', 'off', 'flash'] },
  );
  assert.deepEqual(and.zoom, { min: 1, max: 8, step: 0.1 });
  assert.equal(and.torch, true);
  assert.equal(and.focus, true);
  assert.equal(and.focusMode, 'continuous');
  assert.deepEqual(and.exposure, { min: -2, max: 2, step: 0.333 });
  assert.equal(and.flash, true);
  // Foco sem pointsOfInterest não serve para "tocar para focar".
  assert.equal(C.readCaps({ focusMode: ['continuous'] }, {}, null).focus, false);
  // Zoom de 1 a 1 (câmara sem zoom) não conta.
  assert.equal(C.readCaps({ zoom: { min: 1, max: 1, step: 1 } }).zoom, null);
  assert.equal(C.readCaps(undefined).torch, false);
});

test('exposição: deslize -1…1 no passo da câmara; etiqueta com sinal e vírgula', () => {
  const r = { min: -2, max: 2, step: 0.333 };
  assert.equal(C.exposureValue(0, r), 0);
  assert.equal(C.exposureValue(1, r), 2);
  assert.equal(C.exposureValue(-1, r), -2);
  assert.equal(C.exposureValue(0.5, r), 1);
  assert.equal(C.exposureValue(3, { min: -3, max: 3, step: 0 }), 3);
  assert.equal(C.exposureLabel(0), '0');
  assert.equal(C.exposureLabel(0.666), '+0,7');
  assert.equal(C.exposureLabel(-1), '−1');
});

test('TxCamera: o vídeo do visor tem playsinline e muted, e usa as contas daqui', () => {
  assert.match(SRC, /playsInline: true/);
  assert.match(SRC, /muted: true/);
  assert.match(SRC, /setAttribute\('playsinline'/);
  for (const f of ['coverCrop', 'tapToPoint', 'pickRecorderType', 'videoBitrate', 'readCaps', 'classifyCameraError', 'permissionSteps', 'zoomPlan']) assert.ok(SRC.includes(f), f);
  // A foto sai à resolução do vídeo: o canvas usa videoWidth/videoHeight, não o tamanho do ecrã.
  assert.match(SRC, /videoWidth/);
  // JPEG a 92 % (webCamera.encodePhoto; 85 % só se passar do que o servidor aceita).
  assert.match(SRC, /encodePhoto\(\(q\) => new Promise<Blob \| null>\(\(res\) => c\.toBlob\(res, 'image\/jpeg', q\)\)\)/);
  assert.equal(C.JPEG_QUALITY, 0.92);
});

test('TxCamera: controlos com área de toque ≥ 44 e sem papéis que fecham a app no Android', () => {
  const st = SRC.slice(SRC.indexOf('const st = StyleSheet.create'));
  for (const k of ['round', 'tool', 'zoomBtn', 'flipBtn', 'galleryThumb', 'kindChip']) {
    const m = new RegExp(`\\b${k}: \\{[^}]*?(?:height|minHeight): (\\d+)`).exec(st);
    assert.ok(m, k);
    assert.ok(Number(m[1]) >= 44, `${k}: ${m[1]}`);
  }
});
