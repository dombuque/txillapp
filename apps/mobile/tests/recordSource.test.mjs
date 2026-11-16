// Mimos em vídeo deitados: no PWA do iPhone (iOS 26) a faixa da câmara diz-se 1920×1080 enquanto o <video> mostra a imagem
// ao alto (1080×1920), e o MediaRecorder gravava o frame do sensor deitado, sem rotação no ficheiro (WebKit bug 323550).
// Quando as duas medidas não têm a mesma forma, a TxCamera grava o que o <video> mostra, por um canvas
// (src/lib/webCamera.ts recordSource e src/components/TxCamera.tsx canvasCameraStream).
// Correr em apps/mobile:  node --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const w = await import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'webCamera.ts')).href);
const cam = readFileSync(path.join(ROOT, 'src', 'components', 'TxCamera.tsx'), 'utf8');

test('recordSource: faixa deitada e visor ao alto (iPhone iOS 26): grava-se o canvas ao alto', () => {
  assert.deepEqual(w.recordSource({ w: 1080, h: 1920 }, { width: 1920, height: 1080 }), { kind: 'canvas', w: 1080, h: 1920 });
  // e o contrário (faixa ao alto, visor deitado): também o que se vê
  assert.deepEqual(w.recordSource({ w: 1920, h: 1080 }, { width: 1080, height: 1920 }), { kind: 'canvas', w: 1920, h: 1080 });
});

test('recordSource: as duas medidas com a mesma forma: a faixa da câmara (melhor qualidade), como antes', () => {
  assert.deepEqual(w.recordSource({ w: 1080, h: 1920 }, { width: 1080, height: 1920 }), { kind: 'track' });
  assert.deepEqual(w.recordSource({ w: 1280, h: 720 }, { width: 1920, height: 1080 }), { kind: 'track' }, 'webcam do computador');
  assert.deepEqual(w.recordSource({ w: 480, h: 640 }, { width: 480, height: 640 }), { kind: 'track' });
});

test('recordSource: sem medidas, quadradas ou estranhas: fica a faixa (gravar nunca pode falhar por isto)', () => {
  assert.deepEqual(w.recordSource({ w: 0, h: 0 }, { width: 1920, height: 1080 }), { kind: 'track' }, 'o <video> ainda sem frame');
  assert.deepEqual(w.recordSource({ w: 1080, h: 1920 }, {}), { kind: 'track' });
  assert.deepEqual(w.recordSource({ w: 1080, h: 1920 }, null), { kind: 'track' });
  assert.deepEqual(w.recordSource({ w: 1080, h: 1080 }, { width: 1920, height: 1080 }), { kind: 'track' });
  assert.deepEqual(w.recordSource({ w: NaN, h: 1920 }, { width: 1920, height: 1080 }), { kind: 'track' });
});

test('recordSource: o canvas nunca passa de 1920 no lado maior e fica em números pares (H.264)', () => {
  assert.deepEqual(w.recordSource({ w: 2160, h: 3840 }, { width: 3840, height: 2160 }), { kind: 'canvas', w: 1080, h: 1920 });
  assert.deepEqual(w.recordSource({ w: 1440, h: 1920 }, { width: 1920, height: 1440 }), { kind: 'canvas', w: 1440, h: 1920 });
  const odd = w.recordSource({ w: 721, h: 1281 }, { width: 1281, height: 721 });
  assert.equal(odd.kind, 'canvas');
  assert.equal(odd.w % 2, 0);
  assert.equal(odd.h % 2, 0);
  assert.ok(odd.h > odd.w, 'continua ao alto');
  assert.equal(w.CANVAS_REC_LONG, 1920);
});

test('TxCamera: o gravador usa o canvas quando recordSource o pede e pára o desenho ao parar e ao sair', () => {
  const rec = cam.slice(cam.indexOf('async function record()'), cam.indexOf('const [vkey, setVkey]'));
  assert.match(rec, /recordSource\(\{ w: v\.videoWidth, h: v\.videoHeight \}, vs\)/, 'compara o <video> com a faixa');
  assert.match(rec, /canvasCameraStream\(v, src\.w, src\.h, facing === 'user'/, 'a frontal espelhada, como no visor e nas fotos');
  assert.match(rec, /new MediaRecorder\(recStream, o\)/, 'grava o stream escolhido');
  assert.match(rec, /r\.onstop = \(\) => \{\s*viaCanvas\?\.stop\(\);/, 'pára o canvas quando a gravação acaba');
  assert.match(cam, /recorder\.current\.onstop = null; recorder\.current\.stop\(\); \}\s*recCanvas\.current\?\.\(\);/, 'e ao sair a meio da gravação');
  const fn = cam.slice(cam.indexOf('function canvasCameraStream('), cam.indexOf('function countFrames('));
  assert.match(fn, /g\.drawImage\(v, 0, 0, w, h\)/, 'desenha o frame inteiro, como o browser o mostra');
  assert.match(fn, /audio\.forEach\(\(t\) => stream\.addTrack\(t\)\)/, 'com o som da câmara');
  assert.match(fn, /stream\.getVideoTracks\(\)\.forEach\(\(t\) => t\.stop\(\)\)/, 'pára só a faixa do canvas (o microfone é da câmara)');
});
