// Testes da lógica de quem vê e quem entra num TxillGroup (src/lib/groupAccess.ts).
// Correr em apps/mobile:  node --experimental-strip-types --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ga = await import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'groupAccess.ts')).href);
const cities = await import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'cities.ts')).href);

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

// ----- onde é o grupo (o sítio no mapa) -----
const point = { kind: 'point', lat: -25.9531234, lng: 32.6019876, label: 'Costa do Sol' };
const venue = { kind: 'venue', slug: 'mar-e-sol', name: 'Mar e Sol' };

test('mapReadyOf: o servidor manda; sem mapReady conta o ponto marcado ou o local do Plano', () => {
  assert.equal(ga.mapReadyOf({ mapReady: false, mapPlace: { lat: 1, lng: 2 } }, true), false);
  assert.equal(ga.mapReadyOf({ mapReady: true }, false), true);
  assert.equal(ga.mapReadyOf({ mapPlace: { lat: 1, lng: 2, label: null } }, null), true);
  assert.equal(ga.mapReadyOf({}, true), true);
  assert.equal(ga.mapReadyOf({}, null), false);
  assert.equal(ga.mapReadyOf(undefined, false), false);
});

test('needsPlace: só nos modos do mapa, sem sítio gravado e sem sítio escolhido', () => {
  assert.equal(ga.needsPlace('private', false, null), false);
  assert.equal(ga.needsPlace('map', false, null), true);
  assert.equal(ga.needsPlace('public', false, undefined), true);
  assert.equal(ga.needsPlace('map', true, null), false);
  assert.equal(ga.needsPlace('public', false, point), false);
  assert.equal(ga.needsPlace('map', false, venue), false);
});

test('canSave: Guardar só com alguma coisa para gravar e, no mapa, com sítio', () => {
  assert.equal(ga.canSave('private', 'map', false, null), false); // falta o sítio
  assert.equal(ga.canSave('private', 'map', false, point), true);
  assert.equal(ga.canSave('private', 'public', true, null), true); // já tinha sítio
  assert.equal(ga.canSave('map', 'private', false, null), true); // privado não precisa de sítio
  assert.equal(ga.canSave('map', 'map', true, null), false); // nada mudou
  assert.equal(ga.canSave('map', 'map', true, point), true); // só mudou o sítio
  assert.equal(ga.canSave('map', 'map', false, point), true); // grupo antigo no mapa sem sítio
  assert.equal(ga.canSave('private', 'private', false, point), false); // o sítio não conta no privado
});

test('saveBody: o mapPlace vai no mesmo PATCH, arredondado e sem label vazio; o local do Plano apaga o ponto', () => {
  assert.deepEqual(ga.saveBody('map', point), { visibility: 'private', showOnMap: true, mapPlace: { lat: -25.953, lng: 32.602, label: 'Costa do Sol' } });
  assert.deepEqual(ga.saveBody('public', { ...point, label: '   ' }), { visibility: 'public', showOnMap: true, mapPlace: { lat: -25.953, lng: 32.602 } });
  assert.deepEqual(ga.saveBody('public', venue), { visibility: 'public', showOnMap: true, mapPlace: null });
  assert.deepEqual(ga.saveBody('map', null), { visibility: 'private', showOnMap: true });
  assert.deepEqual(ga.saveBody('private', point), { visibility: 'private', showOnMap: false });
});

test('cleanPlaceLabel / placeName / placeLine: até 80, o escolhido ganha ao gravado, ponto sem nome', () => {
  assert.equal(ga.cleanPlaceLabel('  Costa   do  Sol '), 'Costa do Sol');
  assert.equal(ga.cleanPlaceLabel('x'.repeat(120)).length, 80);
  assert.equal(ga.placeName(point, { mapPlace: { lat: 0, lng: 0, label: 'Velho' } }), 'Costa do Sol');
  assert.equal(ga.placeName(venue, {}), 'Mar e Sol');
  assert.equal(ga.placeName({ ...point, label: null }, { venueName: 'Mar e Sol' }), null);
  assert.equal(ga.placeName(null, { mapPlace: { lat: 0, lng: 0, label: 'Bilene' }, venueName: 'Mar e Sol' }), 'Bilene');
  assert.equal(ga.placeName(null, { mapPlace: null, venueName: 'Mar e Sol' }), 'Mar e Sol');
  assert.equal(ga.placeName(null, {}), null);
  assert.equal(ga.placeLine('Costa do Sol'), 'Aparece em À tua volta em Costa do Sol.');
  assert.equal(ga.placeLine(null), 'Aparece em À tua volta na zona que marcaste no mapa.');
  assert.match(ga.PRIVACY_NOTE, /cerca de 1,5 km/);
});

test('accessChange com sítio: a confirmação diz onde aparece; mudar só o sítio também pede confirmação', () => {
  const toMap = ga.accessChange('private', 'map', 0, { label: 'Costa do Sol', changed: true });
  assert.equal(toMap.lines[0], 'Aparece em À tua volta em Costa do Sol.');
  assert.match(toMap.summary, /em Costa do Sol.$/);
  assert.equal(ga.accessChange('private', 'public', 0, { label: 'Tofo' }).lines[0], 'Aparece em À tua volta em Tofo.');
  // Para privado o sítio não entra.
  assert.deepEqual(ga.accessChange('map', 'private', 0, { label: 'Tofo' }), ga.accessChange('map', 'private', 0));
  // Sem sítio fica igual ao de antes.
  assert.deepEqual(ga.accessChange('private', 'map', 0, null), ga.accessChange('private', 'map', 0));
  const only = ga.accessChange('map', 'map', 0, { label: 'Bilene', changed: true });
  assert.equal(only.title, 'Mudar o sítio do grupo?');
  assert.deepEqual(only.lines, ['Aparece em À tua volta em Bilene.', ga.PRIVACY_NOTE]);
  assert.equal(ga.accessChange('map', 'map', 0, { label: 'Bilene' }), null);
  assert.equal(ga.accessChange('private', 'private', 0, { label: 'Bilene', changed: true }), null);
});

test('isNeedPlaceError: o 400 do servidor por faltar o sítio', () => {
  assert.equal(ga.isNeedPlaceError({ status: 400, message: 'Escolhe onde é o grupo para aparecer em À tua volta' }), true);
  assert.equal(ga.isNeedPlaceError({ status: 400, message: 'Nome demasiado longo' }), false);
  assert.equal(ga.isNeedPlaceError({ status: 403, message: 'Escolhe onde é o grupo' }), false);
  assert.equal(ga.isNeedPlaceError(null), false);
});

test('startCity: a cidade de À tua volta, a do perfil, senão Maputo', () => {
  assert.equal(cities.startCity('gps', 'Beira').name, 'Beira');
  assert.equal(cities.startCity('Tofo', 'Beira').name, 'Tofo');
  assert.equal(cities.startCity(null, 'xai-xai, Gaza').name, 'Xai-Xai');
  assert.equal(cities.startCity(null, 'Lisboa').name, 'Maputo');
  assert.equal(cities.startCity().name, 'Maputo');
});
