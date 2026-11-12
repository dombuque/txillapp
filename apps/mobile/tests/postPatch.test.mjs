import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mergePost } from '../src/lib/postPatch.ts';

const P = (id, extra = {}) => ({ id, author: { username: 'a' }, media: [], saved: false, ...extra });

test('guardar ou brindar atualiza a publicação em qualquer lista: paginada, simples, página, repost', () => {
  const pages = { pages: [{ items: [P('1'), P('2')], nextCursor: null }], pageParams: [null] };
  const out = mergePost(pages, '2', { saved: true });
  assert.equal(out.pages[0].items[1].saved, true);
  assert.equal(out.pages[0].items[0], pages.pages[0].items[0]); // os outros ficam iguais
  assert.equal(mergePost([P('1')], '1', { saved: true })[0].saved, true);
  assert.equal(mergePost(P('9'), '9', { cheered: true }).cheered, true);
  const rep = { items: [P('r', { repostOf: P('o') })] };
  assert.equal(mergePost(rep, 'o', { saved: true }).items[0].repostOf.saved, true);
  assert.equal(mergePost({ posts: [P('x')] }, 'x', { saved: true }).posts[0].saved, true);
});

test('sem a publicação, devolve o mesmo objeto (não acorda as listas)', () => {
  const pages = { pages: [{ items: [P('1')] }] };
  assert.equal(mergePost(pages, 'zz', { saved: true }), pages);
  const other = { count: 3, items: [{ id: 'u1', username: 'x' }] };
  assert.equal(mergePost(other, 'zz', { saved: true }), other);
  assert.equal(mergePost(null, '1', {}), null);
});

test('o PostCard atualiza todas as listas em memória, também as hashtags', () => {
  const src = readFileSync(new URL('../src/components/PostCard.tsx', import.meta.url), 'utf8');
  assert.match(src, /for \(const q of qc\.getQueryCache\(\)\.getAll\(\)\)/);
  assert.match(src, /mergePost\(d, id, p as Record<string, unknown>\)/);
});
