import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { canMarkRead } from '../src/lib/chatRead.ts';

test('só se marca como lida com a conversa à vista: ecrã à frente, app ativa e janela com foco', () => {
  const on = { focused: true, appState: 'active', web: true, hasFocus: true };
  assert.equal(canMarkRead(on), true);
  assert.equal(canMarkRead({ ...on, focused: false }), false);
  assert.equal(canMarkRead({ ...on, appState: 'background' }), false);
  assert.equal(canMarkRead({ ...on, appState: 'inactive' }), false);
  assert.equal(canMarkRead({ ...on, hasFocus: false }), false);
  assert.equal(canMarkRead({ ...on, web: false, hasFocus: false }), true);
});

test('pré-carregar a lista de conversas nunca marca como lidas, e as conversas só leem quando estão à vista', () => {
  const list = readFileSync(new URL('../src/app/(tabs)/messages.tsx', import.meta.url), 'utf8');
  assert.match(list, /prefetchInfiniteQuery.*api\.chatThread\(u, pageParam as string \| undefined, false\)/);
  const dm = readFileSync(new URL('../src/app/messages/[username].tsx', import.meta.url), 'utf8');
  assert.match(dm, /api\.chatThread\(username, pageParam, !pageParam && visible\(\)\)/);
  const grp = readFileSync(new URL('../src/app/messages/g/[id].tsx', import.meta.url), 'utf8');
  assert.match(grp, /gruposApi\.thread\(id, pageParam, !pageParam && visible\(\)\)/);
});
