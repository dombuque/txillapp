import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8').replace(/\r/g, '');

test('partilhar uma publicação no mimo também deixa escolher música', () => {
  const sheet = read('components/ShareSheet.tsx');
  assert.match(sheet, /accessibilityLabel=\{music \? 'Mudar a música' : 'Adicionar música'\}/);
  assert.match(sheet, /<MusicPicker hint=\{caption \|\| post\.body\} allowLocal/);
  assert.match(sheet, /extraApi\.shareToStory\(post\.id, preview, caption\.trim\(\), stickers, music\)/);
  const api = read('lib/api.extra.ts');
  assert.match(api, /post\(\{ postId, audience, caption, stickers, music: musicPayload\(music\) \}\)/);
});

test('o mudo da música dos mimos usa muted (o volume não muda no Safari do iPhone)', () => {
  const v = read('app/stories/[username].tsx');
  assert.match(v, /player\.muted = muted; player\.volume = 1;/);
  assert.doesNotMatch(v, /player\.volume = muted \? 0 : 1/);
});
