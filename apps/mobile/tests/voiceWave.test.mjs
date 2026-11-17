// A mensagem de voz nas conversas (src/lib/voiceWave.ts e components/ChatBubbles «VoiceMessage»): a onda tem as barras
// que cabem na largura dela (antes transbordava por baixo da duração), e a duração e a velocidade ficam numa linha
// própria por baixo da onda (antes o «0:05» ficava por cima do fim da onda e o «1×» por cima da duração).
// Correr em apps/mobile:  node --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const v = await import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'voiceWave.ts')).href);
const read = (f) => readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');

test('as barras cabem sempre na largura da onda', () => {
  for (const w of [96, 120, 140, 166, 180, 210, 260]) {
    const n = v.voiceBarCount(w);
    const need = n * v.BAR_W + (n - 1) * v.BAR_GAP;
    if (n > v.BARS_MIN) assert.ok(need <= w, w + ' px: ' + n + ' barras precisam de ' + need + ' px');
  }
  assert.equal(v.voiceBarCount(0), v.BARS_DEFAULT, 'antes de medir');
  assert.equal(v.voiceBarCount(20), v.BARS_MIN);
  assert.equal(v.voiceBarCount(5000), v.BARS_MAX);
});

test('a onda: as alturas entre 0 e 1, tantas quantas as barras, da gravação ou estáveis pelo id', () => {
  const wf = '0123456789'.repeat(7);
  for (const n of [12, 28, 48]) {
    const h = v.waveHeights('m1', wf, n);
    assert.equal(h.length, n);
    assert.ok(h.every((x) => x > 0 && x <= 1));
  }
  assert.deepEqual(v.waveHeights('m1', null, 20), v.waveHeights('m1', null, 20), 'a mesma mensagem tem sempre a mesma onda');
  assert.equal(v.waveHeights('m1', 'abc', 20).length, 20, 'onda curta demais: a do id');
});

test('o chip da velocidade só aparece a tocar ou parado a meio; «1,5×» com vírgula', () => {
  assert.equal(v.showSpeed(false, 0), false);
  assert.equal(v.showSpeed(true, 0), true);
  assert.equal(v.showSpeed(false, 1200), true);
  assert.equal(v.speedLabel(1), '1×');
  assert.equal(v.speedLabel(1.5), '1,5×');
});

test('VoiceMessage: a duração e a velocidade numa linha própria por baixo da onda, sem largura fixa ao lado', () => {
  const s = read('src/components/ChatBubbles.tsx');
  const i = s.indexOf('function VoiceMessage(');
  const body = s.slice(i, s.indexOf('\n}\n', i));
  assert.match(body, /<View style=\{st\.voiceMain\}>\s*<Pressable[\s\S]*?style=\{st\.wave\}/);
  assert.match(body, /<View style=\{st\.voiceMeta\}>\s*<Text style=\{\[st\.voiceTime/);
  assert.match(body, /const bars = voiceBarCount\(w\);/);
  assert.match(body, /showSpeed\(playing, at\)/);
  assert.doesNotMatch(body, /width: 44/, 'a coluna de 44 px ao lado da onda saiu');
  assert.doesNotMatch(body, /minWidth: 2, maxWidth: 4/, 'as barras já não têm largura mínima que transborde');
  assert.match(s, /wave: \{[^}]*overflow: 'hidden'/);
  assert.match(s, /voiceMain: \{ flex: 1, minWidth: 0 \}/);
});
