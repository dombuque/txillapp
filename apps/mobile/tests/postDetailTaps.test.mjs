import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../src/components/PostCard.tsx', import.meta.url), 'utf8');

test('na página da publicação, tocar no nome ou na foto do autor abre o perfil', () => {
  // O cartão não fica `disabled` na página da publicação: no web isso desligava também os toques lá dentro
  // (pointer-events herdado). O toque no próprio cartão é que não faz nada ali.
  assert.doesNotMatch(src, /disabled=\{detail\}/);
  assert.match(src, /const goPost = \(\) => \{ if \(!detail\)/);
  assert.match(src, /<Pressable onPress=\{post\.venue \? goVenue : goAuthor\} style=\{styles\.nameRow\}/);
});
