// As conversas usam uma lista invertida (a mensagem mais recente em baixo). O estado vazio ("Ainda não há mensagens")
// vem invertido com ela e tem de desfazer a MESMA inversão que o React Native aplica: no Android é `scale: -1` (os dois
// eixos), no iPhone/site `scaleY: -1`. Desfazer só o Y deixava o texto ao espelho no Android.
// Correr em apps/mobile:  node --experimental-strip-types --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('o vazio da conversa desfaz a inversão que o React Native usa em cada plataforma', () => {
  const chat = readFileSync(path.join(ROOT, 'src/components/ChatList.tsx'), 'utf8');
  assert.match(chat, /const UNFLIP = Platform\.OS === 'android' \? \[\{ scale: -1 \}\] : \[\{ scaleY: -1 \}\]/);
  assert.match(chat, /empty: \{[^}]*transform: UNFLIP/);
  const vl = path.join(ROOT, 'node_modules/@react-native/virtualized-lists/Lists/VirtualizedList.js');
  if (existsSync(vl)) {
    const src = readFileSync(vl, 'utf8');
    const block = src.slice(src.indexOf('verticallyInverted:'), src.indexOf('horizontallyInverted:'));
    assert.match(block, /android'\s*\?\s*\{transform: \[\{scale: -1\}\]\}/, 'o React Native mudou a inversão no Android: rever o UNFLIP');
    assert.match(block, /:\s*\{transform: \[\{scaleY: -1\}\]\}/, 'o React Native mudou a inversão no iPhone/site: rever o UNFLIP');
  }
});
