import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../src/components/PostCard.tsx', import.meta.url), 'utf8');

test('brindar no visor da publicação aberta: lê a publicação atual e guarda o próprio estado', () => {
  assert.match(src, /post=\{livePost\(post, viewer\.of\)\}/);
  assert.match(src, /export function livePost\(current: Post, opened: Post\): Post/);
  assert.match(src, /const \[mine2, setMine2\] = useState\(\{ cheered: post\.cheered, cheers: post\.cheers \}\)/);
  assert.match(src, /<B icon="cheers" n=\{mine2\.cheers\} on=\{mine2\.cheered\}/);
  assert.match(src, /if \(busy\.current\) return;/);
});
