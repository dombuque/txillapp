// Visor de foto e vídeo da conversa: arrastar para baixo fecha (como nos visores dos mimos e das publicações).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('o visor do chat fecha ao arrastar para baixo', () => {
  const s = readFileSync(new URL('../src/components/ChatBubbles.tsx', import.meta.url), 'utf8');
  assert.match(s, /export const shouldCloseDrag = \(dy: number, vy: number\): boolean => dy > 120 \|\| \(dy > 40 && vy > 0\.8\);/);
  assert.match(s, /onMoveShouldSetPanResponderCapture: \(_e, g\) => g\.dy > 10 && Math\.abs\(g\.dy\) > Math\.abs\(g\.dx\) \* 1\.5/);
  assert.match(s, /<Animated\.View \{\.\.\.pan\.panHandlers\} style=\{\{ transform: \[\{ translateY: dy \}\] \}\}>/);
});
