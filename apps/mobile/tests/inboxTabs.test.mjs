// Testes dos separadores da lista de Mensagens (src/lib/inboxTabs.ts): o que vai para "Conversas", "TxillGroups" e
// "Pedidos", a pesquisa (procura em tudo) e as contagens de por ler.
// Correr em apps/mobile:  node --experimental-strip-types --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const t = await import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'inboxTabs.ts')).href);

const row = (key, o = {}) => ({ key, group: false, request: false, unread: 0, name: key, sub: '', at: '2026-11-01T10:00:00Z', ...o });
const keys = (l) => l.map((r) => r.key);

const rows = [
  row('ana', { at: '2026-11-10T09:00:00Z', unread: 2, sub: 'Bora à praia?' }),
  row('rui', { at: '2026-11-08T09:00:00Z' }),
  row('estranho', { request: true, at: '2026-11-10T11:00:00Z', unread: 1, sub: 'Olá' }),
  row('tofo', { group: true, name: 'Fim do ano no Tofo', at: '2026-11-10T10:00:00Z', unread: 5, sub: 'Jefferson: Na boa?' }),
  row('praia', { group: true, name: 'Praia de domingo', at: '2026-11-07T10:00:00Z' }),
];

test('parseInboxTab: só "groups" abre nos TxillGroups; o resto (nada, lixo, "requests") abre nas Conversas', () => {
  assert.equal(t.parseInboxTab('groups'), 'groups');
  assert.equal(t.parseInboxTab('chats'), 'chats');
  for (const v of [null, undefined, '', 'all', 'requests', 'GROUPS']) assert.equal(t.parseInboxTab(v), 'chats');
  assert.match(t.INBOX_TAB_KEY, /^[A-Za-z0-9._-]+$/); // o cofre do telemóvel só aceita estas letras
});

test('viewOf: grupo vai para TxillGroups, pedido para Pedidos, o resto para Conversas', () => {
  assert.equal(t.viewOf(row('a')), 'chats');
  assert.equal(t.viewOf(row('a', { request: true })), 'requests');
  assert.equal(t.viewOf(row('a', { group: true })), 'groups');
  assert.equal(t.viewOf(row('a', { group: true, request: true })), 'groups');
});

test('inboxRows sem pesquisa: Conversas só diretas (sem pedidos), TxillGroups só grupos, Pedidos só pedidos; mais recentes primeiro', () => {
  assert.deepEqual(keys(t.inboxRows(rows, 'chats', '')), ['ana', 'rui']);
  assert.deepEqual(keys(t.inboxRows(rows, 'groups', '')), ['tofo', 'praia']);
  assert.deepEqual(keys(t.inboxRows(rows, 'requests', '')), ['estranho']);
  assert.deepEqual(keys(t.inboxRows([], 'groups', '')), []);
});

test('inboxRows a pesquisar: procura em conversas e TxillGroups juntos, seja qual for o separador; nunca nos pedidos', () => {
  for (const view of ['chats', 'groups']) {
    assert.deepEqual(keys(t.inboxRows(rows, view, 'praia')), ['ana', 'praia'], view); // "Bora à praia?" e "Praia de domingo"
    assert.deepEqual(keys(t.inboxRows(rows, view, 'TOFO')), ['tofo'], view);
    assert.deepEqual(keys(t.inboxRows(rows, view, 'olá')), [], view);
  }
  assert.deepEqual(keys(t.inboxRows(rows, 'chats', '@rui')), ['rui']);
  assert.deepEqual(keys(t.inboxRows(rows, 'chats', '   ')), ['ana', 'rui']); // só espaços não é pesquisa
});

test('inboxRows nos Pedidos: a pesquisa fica só nos pedidos', () => {
  assert.deepEqual(keys(t.inboxRows(rows, 'requests', 'olá')), ['estranho']);
  assert.deepEqual(keys(t.inboxRows(rows, 'requests', 'tofo')), []);
});

test('inboxRows não muda a lista que recebe', () => {
  const copy = rows.map((r) => ({ ...r }));
  t.inboxRows(rows, 'chats', '');
  assert.deepEqual(rows, copy);
});

test('inboxCounts: conversas e TxillGroups por ler (quantas, não quantas mensagens); pedidos contam todos', () => {
  assert.deepEqual(t.inboxCounts(rows), { chats: 1, groups: 1, requests: 1 });
  assert.deepEqual(t.inboxCounts([]), { chats: 0, groups: 0, requests: 0 });
  const more = [...rows, row('ze', { unread: 1 }), row('festa', { group: true, unread: 3 }), row('outro', { request: true })];
  assert.deepEqual(t.inboxCounts(more), { chats: 2, groups: 2, requests: 2 });
});

test('badgeText e tabLabel: número discreto (até "9+") e o que o leitor de ecrã diz', () => {
  assert.equal(t.badgeText(0), '');
  assert.equal(t.badgeText(-1), '');
  assert.equal(t.badgeText(3), '3');
  assert.equal(t.badgeText(9), '9');
  assert.equal(t.badgeText(10), '9+');
  assert.equal(t.tabLabel('Conversas', 0), 'Conversas');
  assert.equal(t.tabLabel('Conversas', 2), 'Conversas, 2 por ler');
  assert.equal(t.tabLabel('Pedidos', 1, 'à espera'), 'Pedidos, 1 à espera');
});
