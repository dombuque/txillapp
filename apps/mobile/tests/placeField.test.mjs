// Testes do campo "Onde fica?" (src/lib/placeField.ts): quando procurar, o estado da lista, a morada, o que vai para o
// servidor e o aviso de "ainda não está no mapa".
// Correr em apps/mobile:  node --experimental-strip-types --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const p = await import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'placeField.ts')).href);

/** Temporizadores à mão: `tick(ms)` avança o relógio e corre o que vencer. */
function fakeTimers() {
  let now = 0;
  let id = 0;
  const due = new Map();
  return {
    set: (f, ms) => { due.set(++id, { at: now + ms, f }); return id; },
    clear: (h) => { due.delete(h); },
    tick(ms) {
      now += ms;
      for (const [k, t] of [...due]) if (t.at <= now) { due.delete(k); t.f(); }
    },
    get size() { return due.size; },
  };
}

test('searchQuery: só procura com 2 letras ou mais, aparado e com os espaços juntos', () => {
  assert.equal(p.SEARCH_MIN_CHARS, 2);
  assert.equal(p.SEARCH_DELAY_MS, 350);
  assert.equal(p.searchQuery(''), '');
  assert.equal(p.searchQuery(' a '), '');
  assert.equal(p.searchQuery('ab'), 'ab');
  assert.equal(p.searchQuery('  Bar   do  Ponto '), 'Bar do Ponto');
  assert.equal(p.searchQuery(null), '');
  assert.equal(p.searchQuery(undefined), '');
});

test('createDebounce: só dispara depois da pausa e com o último texto', () => {
  const t = fakeTimers();
  const got = [];
  const d = p.createDebounce((v) => got.push(v), 350, t);
  d.push('B');
  t.tick(200);
  d.push('Ba');
  t.tick(200);
  d.push('Bar');
  assert.deepEqual(got, []);
  assert.equal(d.pending, true);
  t.tick(349);
  assert.deepEqual(got, []);
  t.tick(1);
  assert.deepEqual(got, ['Bar']);
  assert.equal(d.pending, false);
  assert.equal(t.size, 0);
});

test('createDebounce: cancel() esquece o que estava à espera', () => {
  const t = fakeTimers();
  const got = [];
  const d = p.createDebounce((v) => got.push(v), 350, t);
  d.push('Costa');
  d.cancel();
  t.tick(1000);
  assert.deepEqual(got, []);
  assert.equal(d.pending, false);
});

test('searchStatus: idle, waiting, loading, error, empty e results', () => {
  const base = { text: '', debounced: '', loading: false, error: false, count: 0 };
  assert.equal(p.searchStatus(base), 'idle');
  assert.equal(p.searchStatus({ ...base, text: 'a' }), 'idle');
  // A escrever (a pausa ainda não acabou).
  assert.equal(p.searchStatus({ ...base, text: 'Bar', debounced: 'Ba' }), 'waiting');
  // A escrever com sugestões antigas à vista: ficam até chegarem as novas.
  assert.equal(p.searchStatus({ ...base, text: 'Bar', debounced: 'Ba', count: 3 }), 'results');
  assert.equal(p.searchStatus({ ...base, text: 'Bar', debounced: 'Bar', loading: true }), 'loading');
  assert.equal(p.searchStatus({ ...base, text: 'Bar', debounced: 'Bar', error: true }), 'error');
  assert.equal(p.searchStatus({ ...base, text: 'Bar', debounced: 'Bar' }), 'empty');
  assert.equal(p.searchStatus({ ...base, text: 'Bar', debounced: 'Bar', count: 2 }), 'results');
  // Espaços a mais não contam como texto novo.
  assert.equal(p.searchStatus({ ...base, text: ' Bar ', debounced: 'Bar', count: 0 }), 'empty');
});

test('validPoint: números a sério, dentro do mundo e sem o 0,0', () => {
  assert.equal(p.validPoint(-25.97, 32.57), true);
  assert.equal(p.validPoint(0, 0), false);
  assert.equal(p.validPoint(null, 32), false);
  assert.equal(p.validPoint(undefined, undefined), false);
  assert.equal(p.validPoint('-25', '32'), false);
  assert.equal(p.validPoint(Number.NaN, 32), false);
  assert.equal(p.validPoint(91, 32), false);
  assert.equal(p.validPoint(-25, 181), false);
});

test('suggestionToValue: com coordenadas vira sítio; sem elas (servidor antigo) é null', () => {
  assert.deepEqual(
    p.suggestionToValue({ name: 'Bar do Ponto', sub: 'Polana, Maputo', kind: 'bar', lat: -25.96, lng: 32.6, address: 'Av. Marginal 141', city: 'Maputo' }),
    { name: 'Bar do Ponto', address: 'Av. Marginal 141', city: 'Maputo', lat: -25.96, lng: 32.6 },
  );
  // Sem morada própria: o "sub" serve de morada.
  assert.deepEqual(
    p.suggestionToValue({ name: 'Costa do Sol', sub: 'Av. Marginal', kind: 'praia', lat: -25.92, lng: 32.63, city: 'Maputo' }),
    { name: 'Costa do Sol', address: 'Av. Marginal', city: 'Maputo', lat: -25.92, lng: 32.63 },
  );
  // O "sub" que é só a cidade não fica como morada.
  assert.equal(p.suggestionToValue({ name: 'Tofo', sub: 'Inhambane', kind: 'praia', lat: -23.85, lng: 35.54, city: 'Inhambane' }).address, null);
  assert.equal(p.suggestionToValue({ name: 'Bar do Ponto', sub: 'Maputo', kind: 'bar' }), null);
  assert.equal(p.suggestionToValue({ name: 'X', sub: '', kind: 'local', lat: 0, lng: 0 }), null);
});

test('applyReverse: o ponto novo traz morada e cidade; o nome fica; sem resposta só muda o ponto', () => {
  const prev = { name: 'Bar do Ponto', address: 'Rua antiga', city: 'Maputo', lat: -25.96, lng: 32.6 };
  const at = { lat: -25.961, lng: 32.601 };
  assert.deepEqual(p.applyReverse(prev, at, { name: 'x', address: 'Av. Marginal 141', city: 'Maputo' }), { name: 'Bar do Ponto', address: 'Av. Marginal 141', city: 'Maputo', lat: -25.961, lng: 32.601 });
  // Sem cidade na resposta, fica a que havia (a morada é a do ponto novo).
  assert.deepEqual(p.applyReverse(prev, at, { name: null, address: 'Rua 2', city: null }), { ...prev, address: 'Rua 2', ...at });
  // O serviço falhou (tudo a null): o pino muda e a morada que havia fica, para corrigir à mão.
  assert.deepEqual(p.applyReverse(prev, at, { name: null, address: null, city: null }), { ...prev, ...at });
  assert.deepEqual(p.applyReverse(prev, at, null), { ...prev, ...at });
});

test('reverseEmpty: tudo a null (ou só espaços) é "não soube"', () => {
  assert.equal(p.reverseEmpty(null), true);
  assert.equal(p.reverseEmpty({ name: null, address: null, city: null }), true);
  assert.equal(p.reverseEmpty({ name: 'X', address: '  ', city: null }), true);
  assert.equal(p.reverseEmpty({ name: null, address: null, city: 'Maputo' }), false);
  assert.equal(p.reverseEmpty({ name: null, address: 'Rua 1', city: null }), false);
});

test('movedValue: perto mantém o nome e a morada; longe já é outro sítio', () => {
  const prev = { name: 'Bar do Ponto', address: 'Av. Marginal 141', city: 'Maputo', lat: -25.96, lng: 32.6 };
  const near = p.movedValue(prev, { lat: -25.9605, lng: 32.6005 });
  assert.equal(near.name, 'Bar do Ponto');
  assert.equal(near.address, 'Av. Marginal 141');
  const far = p.movedValue(prev, { lat: -25.9, lng: 32.6 });
  assert.equal(far.name, null);
  assert.equal(far.address, null);
  assert.equal(far.city, 'Maputo');
  assert.deepEqual(p.movedValue(null, { lat: 1, lng: 2 }), { name: null, address: null, city: null, lat: 1, lng: 2 });
});

test('distanceM: uns valores conhecidos', () => {
  assert.equal(Math.round(p.distanceM({ lat: 0, lng: 0 }, { lat: 0, lng: 0 })), 0);
  // 0,01° de latitude ≈ 1112 m.
  const d = p.distanceM({ lat: -25.96, lng: 32.6 }, { lat: -25.95, lng: 32.6 });
  assert.ok(d > 1100 && d < 1125, String(d));
});

test('formatAddress: morada e cidade sem repetir a cidade', () => {
  assert.equal(p.formatAddress({ address: 'Av. Marginal 141', city: 'Maputo' }), 'Av. Marginal 141, Maputo');
  assert.equal(p.formatAddress({ address: 'Av. Marginal 141, Maputo', city: 'Maputo' }), 'Av. Marginal 141, Maputo');
  assert.equal(p.formatAddress({ address: 'Rua 1, Matola', city: 'MATOLA' }), 'Rua 1, Matola');
  assert.equal(p.formatAddress({ address: 'Rua do Sol', city: null }), 'Rua do Sol');
  assert.equal(p.formatAddress({ address: '  ', city: 'Beira' }), 'Beira');
  assert.equal(p.formatAddress({ address: null, city: null }), '');
  assert.equal(p.formatAddress(null), '');
  // Sem acentos também é a mesma cidade.
  assert.equal(p.formatAddress({ address: 'Bairro Central, Xai Xai', city: 'Xai Xai' }), 'Bairro Central, Xai Xai');
});

test('placeTitle, placeSubtitle e placeA11y', () => {
  const full = { name: 'Bar do Ponto', address: 'Av. Marginal 141', city: 'Maputo', lat: 1, lng: 2 };
  assert.equal(p.placeTitle(full), 'Bar do Ponto');
  assert.equal(p.placeSubtitle(full), 'Av. Marginal 141, Maputo');
  assert.equal(p.placeA11y(full), 'Sítio escolhido: Bar do Ponto, Av. Marginal 141, Maputo.');
  const noName = { name: null, address: 'Av. Marginal 141', city: 'Maputo', lat: 1, lng: 2 };
  assert.equal(p.placeTitle(noName), 'Av. Marginal 141');
  assert.equal(p.placeSubtitle(noName), 'Maputo');
  const bare = { name: null, address: null, city: null, lat: 1, lng: 2 };
  assert.equal(p.placeTitle(bare), 'Ponto marcado no mapa');
  assert.equal(p.placeSubtitle(bare), '');
  assert.equal(p.placeA11y(bare), 'Sítio escolhido: Ponto marcado no mapa.');
});

test('venuePlace e needsMapPin: o local com ou sem ponto no mapa', () => {
  assert.deepEqual(p.venuePlace({ lat: -25.96, lng: 32.6, address: 'Av. Marginal', city: 'Maputo' }), { name: null, address: 'Av. Marginal', city: 'Maputo', lat: -25.96, lng: 32.6 });
  assert.equal(p.venuePlace({ lat: null, lng: null, address: 'Av. Marginal', city: 'Maputo' }), null);
  assert.equal(p.venuePlace(null), null);
  assert.equal(p.needsMapPin({ lat: null, lng: null }), true);
  assert.equal(p.needsMapPin({}), true);
  assert.equal(p.needsMapPin({ lat: -25.96, lng: 32.6 }), false);
  // Ainda sem local carregado: não avisa.
  assert.equal(p.needsMapPin(null), false);
  assert.equal(p.needsMapPin(undefined), false);
});

test('showsOnMap: por omissão sim; só false esconde', () => {
  assert.equal(p.showsOnMap({}), true);
  assert.equal(p.showsOnMap({ showOnMap: true }), true);
  assert.equal(p.showsOnMap({ showOnMap: null }), true);
  assert.equal(p.showsOnMap({ showOnMap: false }), false);
  assert.equal(p.showsOnMap(null), true);
});

test('venuePlaceBody: com sítio manda morada, cidade e ponto; sem sítio só o showOnMap', () => {
  assert.deepEqual(p.venuePlaceBody(null, true), { showOnMap: true });
  assert.deepEqual(p.venuePlaceBody(null, false), { showOnMap: false });
  // Sem showOnMap (editor, ou só o sítio a partir do evento): não vai o campo.
  assert.deepEqual(p.venuePlaceBody(null), {});
  assert.deepEqual(p.venuePlaceBody({ name: null, address: 'Rua 1', city: 'Beira', lat: -19.84, lng: 34.84 }), { address: 'Rua 1', city: 'Beira', lat: -19.84, lng: 34.84 });
  // lat e lng vão sempre juntos e nunca o 0,0 (o servidor dá 400).
  assert.deepEqual(p.venuePlaceBody({ name: null, address: 'Rua 1', city: null, lat: 0, lng: 0 }, true), { showOnMap: true });
  assert.deepEqual(p.venuePlaceBody({ name: null, address: 'Rua 1', city: null, lat: Number.NaN, lng: 32 }, true), { showOnMap: true });
  assert.deepEqual(
    p.venuePlaceBody({ name: 'Bar', address: '  Av.  Marginal 141 ', city: '', lat: -25.123456789, lng: 32.987654321 }, true),
    { address: 'Av. Marginal 141', city: null, lat: -25.123457, lng: 32.987654, showOnMap: true },
  );
  // Morada comprida demais é cortada ao máximo do servidor.
  assert.equal(p.venuePlaceBody({ address: 'x'.repeat(400), city: 'Maputo', lat: 1, lng: 2 }, true).address.length, p.ADDRESS_MAX);
});

test('round2 e round6', () => {
  assert.equal(p.round2(-25.96789), -25.97);
  assert.equal(p.round6(32.1234567), 32.123457);
});

test('createPlaceWarning: avisa sem sítio (e diz para escolher se escreveu), nada com sítio e no mapa', () => {
  const v = { name: 'Bar', address: null, city: 'Maputo', lat: 1, lng: 2 };
  assert.equal(p.createPlaceWarning(v, '', true), null);
  assert.match(p.createPlaceWarning(v, '', false), /fora do mapa/);
  assert.match(p.createPlaceWarning(null, '', true), /não aparece no mapa/);
  assert.match(p.createPlaceWarning(null, 'Bar do', true), /^Escolhe uma sugestão ou marca no mapa/);
  assert.match(p.createPlaceWarning(null, 'B', true), /^Ainda não disseste onde fica/);
});

test('placeKindIcon: um ícone por tipo e o alfinete para o resto', () => {
  assert.equal(p.placeKindIcon('praia'), 'waves');
  assert.equal(p.placeKindIcon('bar'), 'cheers');
  assert.equal(p.placeKindIcon('restaurante'), 'utensils');
  assert.equal(p.placeKindIcon('lazer'), 'trees');
  assert.equal(p.placeKindIcon('turismo'), 'camera');
  assert.equal(p.placeKindIcon('local'), 'map-pin');
  assert.equal(p.placeKindIcon('qualquer'), 'map-pin');
  assert.equal(p.placeKindIcon(null), 'map-pin');
});

test('canSetShowOnMap: só o dono e os administradores', () => {
  assert.equal(p.canSetShowOnMap('owner'), true);
  assert.equal(p.canSetShowOnMap('admin'), true);
  assert.equal(p.canSetShowOnMap('editor'), false);
  assert.equal(p.canSetShowOnMap(null), false);
  assert.equal(p.canSetShowOnMap(undefined), false);
});

test('directionsByAddress: "Como chegar" pela morada em texto (Apple Maps no iPhone, Google Maps no resto)', () => {
  assert.equal(p.directionsByAddress('Av. Marginal 141, Maputo', false), 'https://www.google.com/maps/dir/?api=1&destination=Av.%20Marginal%20141%2C%20Maputo');
  assert.equal(p.directionsByAddress('Av. Marginal 141, Maputo', true), 'https://maps.apple.com/?daddr=Av.%20Marginal%20141%2C%20Maputo');
});
