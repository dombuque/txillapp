// Testes da lógica de quem vê e quem entra num TxillGroup (src/lib/groupAccess.ts).
// Correr em apps/mobile:  node --experimental-strip-types --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ga = await import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'groupAccess.ts')).href);

test('accessOf: sem campos é privado; showOnMap é "no mapa"; public ganha a tudo', () => {
  assert.equal(ga.accessOf(undefined), 'private');
  assert.equal(ga.accessOf({}), 'private');
  assert.equal(ga.accessOf({ visibility: 'private', showOnMap: false }), 'private');
  assert.equal(ga.accessOf({ visibility: 'private', showOnMap: true }), 'map');
  assert.equal(ga.accessOf({ showOnMap: true }), 'map');
  assert.equal(ga.accessOf({ visibility: 'public', showOnMap: false }), 'public');
  assert.equal(ga.accessOf({ visibility: 'public' }), 'public');
});

test('accessBody: cada modo dá o PATCH certo e volta ao mesmo modo', () => {
  assert.deepEqual(ga.accessBody('private'), { visibility: 'private', showOnMap: false });
  assert.deepEqual(ga.accessBody('map'), { visibility: 'private', showOnMap: true });
  assert.deepEqual(ga.accessBody('public'), { visibility: 'public', showOnMap: true });
  for (const a of ['private', 'map', 'public']) assert.equal(ga.accessOf(ga.accessBody(a)), a);
  assert.deepEqual(ga.ACCESS_OPTIONS.map((o) => o.id), ['private', 'map', 'public']);
});

test('joinModeOf: o servidor manda; sem joinMode deduz-se da visibilidade', () => {
  assert.equal(ga.joinModeOf({ joinMode: 'open', visibility: 'private' }), 'open');
  assert.equal(ga.joinModeOf({ joinMode: 'request' }), 'request');
  assert.equal(ga.joinModeOf({ visibility: 'public' }), 'open');
  assert.equal(ga.joinModeOf({ visibility: 'private' }), 'request');
  assert.equal(ga.joinModeOf(undefined), 'request');
});

test('joinButton: membro abre a conversa, pedido pendente cancela, senão entra ou pede', () => {
  assert.deepEqual(ga.joinButton('open', 'member'), { action: 'open', label: 'Abrir conversa' });
  assert.deepEqual(ga.joinButton('request', 'member'), { action: 'open', label: 'Abrir conversa' });
  assert.deepEqual(ga.joinButton('request', 'pending'), { action: 'cancel', label: 'Pedido enviado · Cancelar' });
  assert.deepEqual(ga.joinButton('open', 'none'), { action: 'join', label: 'Entrar no grupo' });
  assert.deepEqual(ga.joinButton('request', 'none'), { action: 'request', label: 'Pedir para entrar' });
});

test('mapWarning: só avisa quando o grupo está no mapa e o Plano (já carregado) não tem local', () => {
  assert.equal(ga.mapWarning('private', false), null);
  assert.equal(ga.mapWarning('map', true), null);
  assert.equal(ga.mapWarning('public', null), null); // o Plano ainda não chegou
  assert.match(ga.mapWarning('map', false), /local/);
  assert.match(ga.mapWarning('public', false), /À tua volta/);
});

test('showRequests: no mapa a pedido, ou enquanto houver pedidos por responder', () => {
  assert.equal(ga.showRequests('map', 0), true);
  assert.equal(ga.showRequests('private', 0), false);
  assert.equal(ga.showRequests('public', undefined), false);
  assert.equal(ga.showRequests('private', 2), true);
  assert.equal(ga.showRequests('public', 1), true);
});

test('notifGroup / notifGroupTarget: o grupo em data ou ao nível de cima; pedido abre os detalhes', () => {
  assert.deepEqual(ga.notifGroup({ data: { groupId: 'g1', groupName: 'Praia 2026' } }), { id: 'g1', name: 'Praia 2026' });
  assert.deepEqual(ga.notifGroup({ data: {}, groupId: 'g2', groupName: 'Tofo' }), { id: 'g2', name: 'Tofo' });
  assert.deepEqual(ga.notifGroup({ data: {} }), { id: null, name: 'um TxillGroup' });
  assert.equal(ga.notifGroupTarget('group_join_request', 'g1'), '/messages/g/g1?info=1');
  assert.equal(ga.notifGroupTarget('group_join_accepted', 'g1'), '/messages/g/g1');
  assert.equal(ga.notifGroupTarget('group_member_joined', 'g1'), '/messages/g/g1');
  assert.equal(ga.notifGroupTarget('group_join_request', null), null);
});
