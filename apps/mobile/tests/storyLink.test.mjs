import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { startIndex, storyHref, storyMediaId } from '../src/lib/storyLink.ts';

const A = '0193a1b2-0000-7000-8000-00000000000a';
const B = '0193a1b2-0000-7000-8000-00000000000b';

test('a resposta ao mimo abre o visor nesse mimo, e não no primeiro', () => {
  assert.equal(storyMediaId(`/api/v1/media/${A}?w=320`), A);
  assert.equal(storyMediaId(null), null);
  assert.equal(storyHref('dombuque', `/api/v1/media/${B}`), `/stories/dombuque?m=${B}`);
  assert.equal(storyHref('dombuque', null), '/stories/dombuque');
  const list = [{ mediaUrl: `/api/v1/media/${A}` }, { mediaUrl: `/api/v1/media/${B}` }];
  assert.equal(startIndex(list, B, 0), 1);
  assert.equal(startIndex(list, B.toUpperCase(), 0), 1);
  assert.equal(startIndex(list, '0193a1b2-0000-7000-8000-00000000000c', 0), 0);
  assert.equal(startIndex(list, undefined, 1), 1);
});

test('a bolha e o visor usam o mimo pedido', () => {
  const bubbles = readFileSync(new URL('../src/components/ChatBubbles.tsx', import.meta.url), 'utf8');
  assert.match(bubbles, /router\.push\(storyHref\(o, m\.storyUrl\) as never\)/);
  const viewer = readFileSync(new URL('../src/app/stories/[username].tsx', import.meta.url), 'utf8');
  assert.match(viewer, /setI\(startIndex\(stories, wantedMedia, firstToWatch\(stories, mine, ownSeen\)\)\)/);
});

test('o visor dos mimos escolhe onde começar só com a lista fresca do servidor', async () => {
  const { freshEnough } = await import('../src/lib/storyLink.ts');
  assert.equal(freshEnough(100, 200, true), false); // lista antiga e há pedido a correr: espera
  assert.equal(freshEnough(250, 200, true), true); // lista nova
  assert.equal(freshEnough(100, 200, false), true); // sem pedido (sem rede): usa a que houver
  const viewer = readFileSync(new URL('../src/app/stories/[username].tsx', import.meta.url), 'utf8');
  assert.match(viewer, /if \(!freshEnough\(q\.dataUpdatedAt, openedAt\.current, q\.isFetching\)\) return;/);
});
