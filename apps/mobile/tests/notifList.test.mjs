// A lista das Notificações (src/lib/notifList.ts e src/app/notifications.tsx).
// - «Ver mais» parecia não fazer nada: a página seguinte juntava-se à última linha (os seguidores do mesmo dia são uma linha
//   só) ou ficava fora do filtro. Agora, uma página sem linhas novas pede logo a seguinte (no máximo 5 seguidas).
// - A lista carrega sozinha ao chegar ao fim (onEndReached + LoadMore), com o botão de reserva.
// Correr em apps/mobile:  node --test tests/notifList.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const x = await import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'notifList.ts')).href);
const screen = readFileSync(path.join(ROOT, 'src', 'app', 'notifications.tsx'), 'utf8').replace(/\r\n/g, '\n');

const at = (min) => new Date(Date.UTC(2026, 10, 17, 12, 0) - min * 60_000).toISOString();
const n = (id, kind, min, o = {}) => ({ id, kind, createdAt: at(min), data: {}, actor: { username: `u${id}` }, ...o });

test('seguidores do mesmo dia juntam-se numa linha; outro tipo pelo meio parte a linha', () => {
  const g = x.groupAll([n('1', 'follow', 1), n('2', 'follow', 2), n('3', 'gift', 3), n('4', 'follow', 4)], null);
  assert.deepEqual(g.map((r) => r.items.length), [2, 1, 1]);
  assert.deepEqual(g[0].actors.map((a) => a.username), ['u1', 'u2']);
});

test('comentários juntam-se por publicação; mais de 24 h depois da primeira começa outra linha', () => {
  const c = (id, post, min) => n(id, 'comment', min, { data: { postId: post } });
  const g = x.groupAll([c('1', 'p1', 0), c('2', 'p1', 60), c('3', 'p2', 61), c('4', 'p2', 26 * 60)], null);
  assert.deepEqual(g.map((r) => r.items.map((i) => i.id)), [['1', '2'], ['3'], ['4']]);
});

test('a mesma notificação duas vezes (página repetida) só conta uma vez', () => {
  const g = x.groupAll([n('1', 'gift', 1), n('1', 'gift', 1), n('2', 'gift', 2)], null);
  assert.equal(g.length, 2);
  assert.equal(new Set(g.map((r) => r.id)).size, 2);
});

test('as novas (por ler quando abri) não se juntam às anteriores', () => {
  const g = x.groupAll([n('1', 'follow', 1), n('2', 'follow', 2)], new Set(['1']));
  assert.deepEqual(g.map((r) => r.fresh), [true, false]);
});

test('uma página que não trouxe linhas novas pede a seguinte, até 5 seguidas', () => {
  let s = { pages: 0, rows: 0, chain: 0 };
  let r = x.chainMore(s, { pages: 1, rows: 3, hasNext: true, fetching: false });
  assert.equal(r.fetch, false, 'a primeira página nunca pede sozinha');
  s = r.state;
  for (let i = 2; i <= 6; i++) {
    r = x.chainMore(s, { pages: i, rows: 3, hasNext: true, fetching: false });
    assert.equal(r.fetch, true, `página ${i}`);
    s = r.state;
  }
  r = x.chainMore(s, { pages: 7, rows: 3, hasNext: true, fetching: false });
  assert.equal(r.fetch, false, 'depois de 5 fica o botão');
  // Apareceu uma linha nova: a corrente volta a zero.
  r = x.chainMore(r.state, { pages: 8, rows: 4, hasNext: true, fetching: false });
  assert.equal(r.fetch, false);
  assert.equal(r.state.chain, 0);
});

test('filtro sem nada à vista e ainda há mais: pede; a carregar ou sem mais, não', () => {
  const s = { pages: 1, rows: 5, chain: 0 };
  assert.equal(x.chainMore(s, { pages: 1, rows: 0, hasNext: true, fetching: false }).fetch, true);
  assert.equal(x.chainMore(s, { pages: 1, rows: 0, hasNext: true, fetching: true }).fetch, false);
  assert.equal(x.chainMore(s, { pages: 1, rows: 0, hasNext: false, fetching: false }).fetch, false);
  assert.equal(x.chainMore(s, { pages: 1, rows: 2, hasNext: true, fetching: false }).fetch, false);
});

test('o ecrã carrega sozinho ao chegar ao fim e usa a corrente', () => {
  assert.match(screen, /onEndReached=\{loadMore\}/);
  assert.match(screen, /<LoadMore onLoad=\{loadMore\} loading=\{q\.isFetchingNextPage\}/);
  assert.match(screen, /const r = chainMore\(chain\.current, \{ pages, rows: groups\.length/);
  assert.match(screen, /if \(r\.fetch\) void q\.fetchNextPage\(\);/);
  assert.doesNotMatch(screen, /'Ver mais'/);
});
