// Virar a câmara no Android (Txillada e videochamadas): o `_switchCamera` do @livekit/react-native-webrtc muda a câmara por
// restrições, que o Android ignora (só virava o espelho da imagem). Agora reabre-se a câmara com a outra direção.
// Correr em apps/mobile:  node --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p) => readFileSync(path.join(ROOT, 'src', ...p), 'utf8').replace(/\r\n/g, '\n');
const code = (s) => s.split('\n').filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l)).join('\n');

test('Txillada: virar a câmara reabre a faixa com a outra direção (sem _switchCamera)', () => {
  const live = code(read('lib', 'txilladaLive.ts'));
  assert.doesNotMatch(live, /_switchCamera\(\)/);
  assert.match(live, /await track\.restartTrack\(\{ facingMode: front \? 'user' : 'environment', resolution: captureResolution \}\);/);
});

test('Chamadas: virar a câmara abre a outra e troca a faixa enviada (replaceTrack), sem _switchCamera', () => {
  const rtc = code(read('lib', 'calls', 'webrtc.ts'));
  assert.doesNotMatch(rtc, /_switchCamera\(\)/);
  assert.match(rtc, /getUserMedia\(\{ audio: false, video: videoConstraints\(!front\) \}\)/);
  assert.match(rtc, /await sender\.replaceTrack\(track\)/);
});
