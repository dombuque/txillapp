// Testes da folha "Enviar localização" do chat (src/lib/sendLocation.ts), como no WhatsApp: a precisão, as distâncias,
// o botão principal (a minha posição ou o pino), a partilha em direto, a permissão, os "Sítios perto", a pesquisa,
// a mensagem que vai para o servidor e o que a bolha mostra.
// Correr em apps/mobile:  node --experimental-strip-types --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const L = await import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'sendLocation.ts')).href);

const MAPUTO = { lat: -25.9692, lng: 32.5732 };
const fix = (accuracy = 12, at = MAPUTO) => ({ ...at, accuracy });

test('precisão em texto: "Precisão de 12 m", km com vírgula, desconhecida sem número', () => {
  assert.equal(L.accuracyText(12.4), 'Precisão de 12 m');
  assert.equal(L.accuracyText(0), 'Precisão desconhecida');
  assert.equal(L.accuracyText(0.6), 'Precisão de 1 m');
  assert.equal(L.accuracyText(1530), 'Precisão de 1,5 km');
  assert.equal(L.accuracyText(null), 'Precisão desconhecida');
  assert.equal(L.accuracyText(Number.NaN), 'Precisão desconhecida');
  assert.equal(L.accuracyValue(65), '65 m');
  assert.equal(L.weakAccuracy(150), true);
  assert.equal(L.weakAccuracy(20), false);
  assert.equal(L.weakAccuracy(null), false);
});

test('distâncias: metros, dezenas, km com uma casa e km inteiros', () => {
  assert.equal(L.distanceText(7.2), '7 m');
  assert.equal(L.distanceText(0.2), '1 m');
  assert.equal(L.distanceText(123), '120 m');
  assert.equal(L.distanceText(994), '990 m');
  assert.equal(L.distanceText(996), '1,0 km');
  assert.equal(L.distanceText(1249), '1,2 km');
  assert.equal(L.distanceText(15_400), '15 km');
  assert.equal(L.distanceText(null), '');
  assert.equal(L.distanceText(-3), '');
  // ~111 m por milésimo de grau de latitude
  const d = L.distanceM(MAPUTO, { lat: MAPUTO.lat + 0.001, lng: MAPUTO.lng });
  assert.ok(d > 110 && d < 112, String(d));
  assert.equal(L.movedAway(MAPUTO, { lat: MAPUTO.lat + 0.00003, lng: MAPUTO.lng }), false); // ~3 m: arredondamentos do mapa
  assert.equal(L.movedAway(MAPUTO, { lat: MAPUTO.lat + 0.0002, lng: MAPUTO.lng }), true); // ~22 m
  assert.equal(L.movedAway(null, MAPUTO), false);
});

test('botão principal: a minha posição com a precisão; arrastar → "Enviar esta localização"; sem posição, desligado', () => {
  const center = { lat: -25.96, lng: 32.58 };
  assert.deepEqual(L.mainButton({ permission: 'granted', fix: fix(12), dragged: false, center: null }), { action: 'current', label: 'Enviar a tua localização atual', sub: 'Precisão de 12 m' });
  assert.equal(L.mainButton({ permission: 'granted', fix: fix(12), dragged: true, center }).action, 'pin');
  assert.equal(L.mainButton({ permission: 'granted', fix: fix(12), dragged: true, center }).label, 'Enviar esta localização');
  // Sem permissão também se pode arrastar o mapa e enviar o pino (não é a posição atual).
  assert.equal(L.mainButton({ permission: 'denied', fix: null, dragged: true, center }).action, 'pin');
  // Sem permissão, a posição atual não se envia.
  const off = L.mainButton({ permission: 'denied', fix: null, dragged: false, center: null });
  assert.equal(off.action, null);
  assert.match(off.sub, /Sem acesso/);
  // Com permissão mas ainda sem posição: espera.
  assert.deepEqual(L.mainButton({ permission: 'granted', fix: null, dragged: false, center: null }), { action: null, label: 'Enviar a tua localização atual', sub: 'A procurar a tua posição…' });
  assert.equal(L.mainButton({ permission: 'checking', fix: null, dragged: false, center: null }).action, null);
  // Arrastado sem centro conhecido ainda: fica no da posição.
  assert.equal(L.mainButton({ permission: 'granted', fix: fix(), dragged: true, center: null }).action, 'current');
  assert.equal(L.currentA11y(fix(12)), 'Enviar a tua localização atual (precisão de 12 m)');
  assert.equal(L.currentA11y(null), 'Enviar a tua localização atual');
});

test('partilha em direto: só as durações do servidor (15, 60, 480) e uma confirmação que diz quem vê e que se pode parar', () => {
  assert.deepEqual(L.LIVE_DURATIONS.map((d) => d.minutes), [15, 60, 480]);
  // As mesmas que a API aceita.
  const ctl = readFileSync(path.join(ROOT, '..', 'api', 'src', 'chat', 'chat.controller.ts'), 'utf8');
  assert.match(ctl, /liveMinutes: z\.union\(\[z\.literal\(15\), z\.literal\(60\), z\.literal\(480\)\]\)/);
  assert.equal(L.liveLabel(60), '1 hora');
  assert.equal(L.liveLabel(480), '8 horas');
  assert.equal(L.liveMinutes(15), 15);
  assert.equal(L.liveMinutes(7), 60);
  assert.equal(L.liveMinutes('480'), 60);
  const t = L.liveConfirmText(15, 'Ana');
  assert.match(t, /^Ana vai ver a tua posição em tempo real durante 15 minutos\./);
  assert.match(t, /Podes parar quando quiseres/);
  assert.match(t, /aberto/);
  assert.match(L.liveConfirmText(60), /^A outra pessoa vai ver/);
});

test('permissão: explica antes de pedir; recusada/bloqueada → "Abrir definições" na app; no site, o cadeado', () => {
  assert.equal(L.permissionNotice('granted', false), null);
  assert.equal(L.permissionNotice('checking', true), null);
  const ask = L.permissionNotice('ask', false);
  assert.equal(ask.action, 'ask');
  assert.equal(ask.actionLabel, 'Continuar');
  assert.match(ask.text, /Só é enviada quando tocares em Enviar/);
  assert.equal(L.permissionNotice('ask', true).action, 'ask');
  for (const p of ['denied', 'blocked']) {
    const app = L.permissionNotice(p, false);
    assert.equal(app.action, 'settings');
    assert.equal(app.actionLabel, 'Abrir definições');
    const site = L.permissionNotice(p, true);
    assert.equal(site.action, null);
    assert.match(site.text, /cadeado/);
    assert.match(site.text, /procurar um sítio/);
  }
});

test('"Sítios perto": com nome e ponto, sem repetidos, distância a mim (não ao ponto arredondado do servidor), do mais perto', () => {
  const me = MAPUTO;
  const rows = L.nearbyRows([
    { name: 'Café Longe', kind: 'bar', distanceM: 10, lat: me.lat + 0.004, lng: me.lng },
    { name: 'Padaria Perto', kind: 'restaurante', distanceM: 300, lat: me.lat + 0.0005, lng: me.lng },
    { name: 'padaria  perto', kind: 'restaurante', distanceM: 300, lat: me.lat + 0.0005001, lng: me.lng }, // repetido
    { name: '', kind: 'bar', distanceM: 1, lat: me.lat, lng: me.lng },
    { name: 'Sem ponto', kind: 'bar', distanceM: 1, lat: 0, lng: 0 },
  ], me, 'Polana');
  assert.deepEqual(rows.map((r) => r.name), ['Padaria Perto', 'Café Longe']);
  assert.equal(rows[0].sub, '60 m');
  assert.equal(rows[1].sub, '440 m'); // 0,004° ≈ 445 m
  assert.equal(rows[0].address, 'Polana');
  assert.ok(rows[0].key.startsWith('n:'));
  // Sem a minha posição, fica a distância do servidor.
  assert.equal(L.nearbyRows([{ name: 'X', kind: 'bar', distanceM: 1200, lat: 1, lng: 1 }], null)[0].sub, '1,2 km');
  assert.deepEqual(L.nearbyRows(null, me), []);
});

test('pesquisa: só resultados com ponto, a morada com a cidade (sem a repetir) e a distância', () => {
  const rows = L.searchRows([
    { name: 'Mercado do Peixe', sub: 'Av. Marginal', city: 'Maputo', kind: 'restaurante', lat: -25.95, lng: 32.6 },
    { name: 'Sem coordenadas', sub: 'Algures' },
    { name: 'Costa do Sol', address: 'Av. Marginal, Maputo', city: 'Maputo', lat: -25.92, lng: 32.63 },
    { name: 'Mercado do Peixe', sub: 'Av. Marginal', city: 'Maputo', kind: 'restaurante', lat: -25.95, lng: 32.6 }, // repetido
  ], MAPUTO);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].address, 'Av. Marginal, Maputo');
  assert.equal(rows[1].address, 'Av. Marginal, Maputo');
  assert.match(rows[0].sub, /^\d,\d km · Av\. Marginal, Maputo$/);
  assert.equal(L.searchRows([{ name: 'A', lat: 1, lng: 1 }], null)[0].sub, '');
  assert.equal(L.hitAddress({ name: 'x', city: 'Beira' }), 'Beira');
  assert.equal(L.hitAddress({ name: 'x' }), null);
});

test('a mensagem: só o que se escolheu; sítio com nome e morada; direto só nas conversas; nada sem ponto válido', () => {
  assert.deepEqual(L.buildLocationMessage({ type: 'current', fix: fix(12, { lat: -25.96543219, lng: 32.58123456 }) }), { kind: 'location', lat: -25.965432, lng: 32.581235 });
  assert.deepEqual(L.buildLocationMessage({ type: 'pin', at: { lat: -25.9, lng: 32.6 }, address: '  Rua  da Sé, Maputo ' }), { kind: 'location', lat: -25.9, lng: 32.6, address: 'Rua da Sé, Maputo' });
  assert.deepEqual(L.buildLocationMessage({ type: 'pin', at: { lat: -25.9, lng: 32.6 }, address: null }), { kind: 'location', lat: -25.9, lng: 32.6 });
  assert.deepEqual(
    L.buildLocationMessage({ type: 'place', place: { name: 'Café Acácia', address: 'Av. Julius Nyerere 123', lat: -25.96, lng: 32.58 } }),
    { kind: 'location', lat: -25.96, lng: 32.58, name: 'Café Acácia', address: 'Av. Julius Nyerere 123' },
  );
  // Os limites do servidor (80 e 160).
  const long = L.buildLocationMessage({ type: 'place', place: { name: 'n'.repeat(120), address: 'a'.repeat(300), lat: 1, lng: 1 } });
  assert.equal(long.name.length, 80);
  assert.equal(long.address.length, 160);
  assert.deepEqual(L.buildLocationMessage({ type: 'live', fix: fix(), minutes: 480 }), { kind: 'location', lat: MAPUTO.lat, lng: MAPUTO.lng, liveMinutes: 480 });
  assert.equal(L.buildLocationMessage({ type: 'live', fix: fix(), minutes: 7 }).liveMinutes, 60);
  assert.equal(L.buildLocationMessage({ type: 'live', fix: fix(), minutes: 60 }, { allowLive: false }), null); // grupos
  assert.equal(L.buildLocationMessage({ type: 'current', fix: { lat: 0, lng: 0, accuracy: 5 } }), null);
  assert.equal(L.buildLocationMessage({ type: 'pin', at: { lat: 99, lng: 0 } }), null);
});

test('a bolha: nome e morada do sítio; sem eles, o texto antigo, "Localização em direto" ou "Localização"', () => {
  assert.deepEqual(L.bubbleLines({ body: 'Café', placeName: 'Café Acácia', placeAddress: 'Av. Julius Nyerere 123' }), { title: 'Café Acácia', sub: 'Av. Julius Nyerere 123', named: true });
  assert.deepEqual(L.bubbleLines({ body: '', placeName: null, placeAddress: 'Rua da Sé' }), { title: 'Rua da Sé', sub: null, named: true });
  assert.deepEqual(L.bubbleLines({ body: 'Estou aqui' }), { title: 'Estou aqui', sub: null, named: false });
  assert.deepEqual(L.bubbleLines({ body: '', liveUntil: '2026-01-01T00:00:00Z' }), { title: 'Localização em direto', sub: null, named: false });
  assert.deepEqual(L.bubbleLines({}), { title: 'Localização', sub: null, named: false });
});

test('a folha nunca envia sozinha: "Localização" abre a folha nas conversas e nos grupos', () => {
  for (const f of ['ChatComposer.tsx', 'GroupComposer.tsx']) {
    const src = readFileSync(path.join(ROOT, 'src', 'components', f), 'utf8');
    assert.ok(!/getCurrentPositionAsync/.test(src), `${f} já não lê a posição diretamente`);
    assert.match(src, /<SendLocationSheet/);
  }
  const sheet = readFileSync(path.join(ROOT, 'src', 'components', 'SendLocationSheet.tsx'), 'utf8');
  // A folha só chama onSend dentro de send(), e send() só a partir de toques (onPress).
  assert.equal((sheet.match(/onSend\(/g) ?? []).length, 1);
  assert.match(sheet, /allowLive=\{false\}|allowLive: boolean/);
});
