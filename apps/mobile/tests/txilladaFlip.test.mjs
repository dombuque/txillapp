// Android: virar a câmara na Txillada (restartTrack) deixava o próprio ecrã preto (o RTCView preso à faixa antiga),
// enquanto quem vê já recebia a câmara nova. O vídeo nativo monta-se de novo a cada «restarted».
// Correr em apps/mobile:  node --test tests/txilladaFlip.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(path.join(ROOT, 'src', 'components', 'txillada', 'TxilladaVideo.tsx'), 'utf8').replace(/\r\n/g, '\n');

test('cada «restarted» da faixa monta o vídeo nativo de novo (chave nova)', () => {
  assert.match(src, /t\.on\('restarted', bump\)/);
  assert.match(src, /return \(\) => t\.off\?\.\('restarted', bump\)/);
  assert.match(src, /<Native key=\{key\} videoTrack=\{track\}/);
  assert.match(src, /<Native key=\{`b\$\{key\}`\} videoTrack=\{track\}/);
});
