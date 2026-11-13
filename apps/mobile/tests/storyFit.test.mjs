// A foto de um mimo enche o ecrã quando tem quase a forma dele (sem margens laterais com o fundo desfocado).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const { storyFit } = await import(new URL('../src/lib/storyLink.ts', import.meta.url).href);

test('mimo: foto com a forma do ecrã enche-o; foto muito diferente aparece inteira', () => {
  const iphone = 390 / 844;
  assert.equal(storyFit(9 / 16, iphone), 'cover');
  assert.equal(storyFit(iphone, iphone), 'cover');
  assert.equal(storyFit(3 / 4, iphone), 'contain');
  assert.equal(storyFit(1, iphone), 'contain');
  assert.equal(storyFit(16 / 9, iphone), 'contain');
  assert.equal(storyFit(null, iphone), 'contain');
  assert.equal(storyFit(3 / 4, 768 / 1024), 'cover');
  const src = readFileSync(new URL('../src/app/stories/[username].tsx', import.meta.url), 'utf8');
  assert.match(src, /contentFit=\{storyFit\(/);
});
