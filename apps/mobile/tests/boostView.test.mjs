// Testes do Bombar na app (src/lib/boostView.ts): onde entra cada destaque no feed, a posição que vai para o servidor,
// a etiqueta para o leitor de ecrã, preços, devolução ao parar, relatório e o realce no mapa.
// Correr em apps/mobile:  node --experimental-strip-types --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const b = await import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'boostView.ts')).href);
const CITIES = [{ name: 'Maputo', lat: -25.97, lng: 32.57 }, { name: 'Beira', lat: -19.84, lng: 34.84 }];

test('os destaques ficam presos à publicação depois da qual entram, sem repetir campanhas entre páginas', () => {
  const m = b.slotsByAnchor([
    { sponsored: [{ campaignId: 'c1', afterId: 'p4' }] },
    { sponsored: [{ campaignId: 'c1', afterId: 'p15' }, { campaignId: 'c2', afterId: 'p15' }] },
    {},
    { sponsored: [{ campaignId: 'c3', afterId: null }] },
  ]);
  assert.deepEqual(m.get('p4').map((s) => s.campaignId), ['c1']);
  assert.deepEqual(m.get('p15').map((s) => s.campaignId), ['c2']);
  assert.deepEqual(m.get(null).map((s) => s.campaignId), ['c3']);
  assert.equal(b.slotsByAnchor([]).size, 0);
});

test('a posição do feed: a cidade escolhida ou o GPS (só com autorização), sempre com 2 casas decimais', () => {
  assert.deepEqual(b.feedNear('Beira', CITIES, null), { lat: -19.84, lng: 34.84 });
  assert.deepEqual(b.feedNear('gps', CITIES, { lat: -25.965432, lng: 32.578901 }), { lat: -25.97, lng: 32.58 });
  assert.equal(b.feedNear('gps', CITIES, null), null); // sem autorização: sem destaques, nunca se pergunta
  assert.equal(b.feedNear(null, CITIES, { lat: 1, lng: 2 }), null); // nunca abriu o À tua volta
  assert.equal(b.feedNear('Lisboa', CITIES, null), null);
});

test('a etiqueta "Patrocinado" é o que o leitor de ecrã diz primeiro, com quem paga', () => {
  assert.equal(b.SPONSORED_LABEL, 'Bombado · Patrocinado');
  const t = b.sponsoredA11y('Bar da Marginal');
  assert.match(t, /^Bombado, Patrocinado\./);
  assert.match(t, /Publicidade de Bar da Marginal/);
});

test('preços da tabela do servidor e texto dos Txills', () => {
  const pk = [{ id: '1d', prices: { 1: 1500, 3: 1500, 10: 2550 } }, { id: '7d', prices: { '3': 8000 } }];
  assert.equal(b.priceFor(pk, '1d', 10), 2550);
  assert.equal(b.priceFor(pk, '7d', 3), 8000);
  assert.equal(b.priceFor(pk, '3d', 3), null);
  assert.match(b.txills(1500), /^1\s?500 Txills$/);
});

test('devolução ao parar: tudo antes de começar, os dias inteiros que faltam, nada no último dia', () => {
  const t0 = new Date('2026-11-11T12:00:00Z');
  const c = { price: 4000, days: 3, startsAt: t0.toISOString(), endsAt: new Date(t0.getTime() + 3 * 86_400_000).toISOString() };
  assert.equal(b.refundPreview(c, new Date(t0.getTime() - 1)), 4000);
  assert.equal(b.refundPreview(c, new Date(t0.getTime() + 60_000)), Math.floor((4000 * 2) / 3));
  assert.equal(b.refundPreview(c, new Date(t0.getTime() + 2.5 * 86_400_000)), 0);
  assert.equal(b.refundPreview(c, new Date(t0.getTime() + 4 * 86_400_000)), 0);
});

test('relatório: só totais, com interesse para eventos e brindes para publicações', () => {
  const base = { impressions: 10, people: 7, taps: 2, checkins: 3, checkinsAfterSeeing: 1 };
  const ev = b.reportLines({ ...base, interested: 4, cheers: null }).map((l) => l.label);
  assert.ok(ev.includes('"Tenho interesse"') && !ev.includes('Brindes'));
  const po = b.reportLines({ ...base, interested: null, cheers: 5 }).map((l) => l.label);
  assert.ok(po.includes('Brindes') && !po.includes('"Tenho interesse"'));
  assert.deepEqual(Object.keys(b.STATE_LABEL).sort(), ['active', 'ended', 'pending', 'scheduled', 'stopped', 'suspended']);
});

test('no mapa, os destaques vão para o topo e o resto fica por distância', () => {
  const xs = b.boostedFirst([{ id: 'a', distanceKm: 1 }, { id: 'b', distanceKm: 5, boosted: true }, { id: 'c', distanceKm: 0.5 }, { id: 'd', distanceKm: 3, boosted: true }]);
  assert.deepEqual(xs.map((x) => x.id), ['d', 'b', 'c', 'a']);
});

test('o pino realçado leva a etiqueta "Patrocinado" e o mapa da app foi gerado de novo com ela', () => {
  const rt = readFileSync(path.join(ROOT, 'src', 'components', 'nearby', 'mapRuntime.ts'), 'utf8');
  const inline = readFileSync(path.join(ROOT, 'src', 'components', 'nearby', 'leafletInline.ts'), 'utf8');
  assert.match(rt, /Patrocinado/);
  assert.match(inline, /Patrocinado/);
  assert.match(inline, /m\.boosted/);
});
