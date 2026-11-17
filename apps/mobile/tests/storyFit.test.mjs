// A foto de um mimo enche o cartão 9:16 quando tem a forma dele; de outra forma aparece inteira, com o fundo desfocado.
// Antes enchia o ecrã todo e cortava até um quarto dos lados: o canto da assinatura «txillapp @…» ia com o corte.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import './aliasHooks.mjs';

const { mimoFit, storyFrame } = await import(new URL('../src/lib/storyFrame.ts', import.meta.url).href);

test('mimo: foto com a forma do cartão enche-o; foto de outra forma aparece inteira', () => {
  const { cardW, cardH } = storyFrame({ w: 390, h: 844, top: 47, bottom: 34 });
  assert.equal(mimoFit(9 / 16, cardW, cardH), 'cover');
  assert.equal(mimoFit(390 / 844, cardW, cardH), 'contain');
  assert.equal(mimoFit(3 / 4, cardW, cardH), 'contain');
  assert.equal(mimoFit(1, cardW, cardH), 'contain');
  assert.equal(mimoFit(16 / 9, cardW, cardH), 'contain');
  assert.equal(mimoFit(null, cardW, cardH), 'contain');
  const src = readFileSync(new URL('../src/app/stories/[username].tsx', import.meta.url), 'utf8');
  assert.match(src, /contentFit=\{mimoFit\(/);
  assert.doesNotMatch(src, /storyFit/);
});
