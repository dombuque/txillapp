import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../src/components/ChatBubbles.tsx', import.meta.url), 'utf8');

test('publicação partilhada no chat: só um vídeo é tcheka, e abre exatamente o que foi partilhado', () => {
  assert.match(src, /const tcheka = isTcheka\(shown\);/);
  assert.match(src, /\{tcheka \? 'TCHEKA' : 'Publicação'\} de/);
  assert.match(src, /return isTcheka\(p\) \? `\/r\/\$\{key\}` : `\/p\/\$\{key\}`;/);
  assert.doesNotMatch(src, /\/reels\?start=/);
});
