// Testes do mapa do "À tua volta" (src/components/nearby/mapRuntime.ts) com um Leaflet de mentira: enquadrar acima da
// folha da lista, o item escolhido nunca fica tapado, marcadores no mesmo sítio ficam agrupados, o ponto azul só com GPS
// e o botão "Voltar ao centro".
// Correr em apps/mobile:  node --experimental-strip-types --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ---------- Um "document" e um Leaflet mínimos ----------
globalThis.document = {
  ids: new Set(),
  getElementById(id) { return this.ids.has(id) ? {} : null; },
  createElement() { return { set id(v) { globalThis.document.ids.add(v); }, textContent: '' }; },
  head: { appendChild() {} },
};
const { createNearbyMap } = await import(pathToFileURL(path.join(ROOT, 'src', 'components', 'nearby', 'mapRuntime.ts')).href);

const M_PER_DEG = 111_320;
const ll = (lat, lng) => ({ lat, lng, distanceTo: (o) => Math.hypot((o.lat - lat) * M_PER_DEG, (o.lng - lng) * M_PER_DEG) });
const pt = (x, y) => ({ x, y, distanceTo: (o) => Math.hypot(o.x - x, o.y - y) });
const asLL = (a) => (Array.isArray(a) ? ll(a[0], a[1]) : ll(a.lat, a.lng));

function fakeLeaflet(size = { x: 400, y: 800 }) {
  const map = {
    size, center: ll(0, 0), zoom: 0, layers: new Set(), handlers: {}, fits: [], pans: [], views: [],
    on(e, f) { (this.handlers[e] ??= []).push(f); return this; },
    fire(e) { for (const f of this.handlers[e] ?? []) f(); },
    getZoom() { return this.zoom; },
    getSize() { return pt(this.size.x, this.size.y); },
    getCenter() { return this.center; },
    scale() { return 2 ** this.zoom / 100; }, // píxeis por grau (fictício, mas consistente)
    setView(c, z) { this.center = asLL(c); this.zoom = z; this.views.push({ c, z }); this.fire('zoomend'); this.fire('moveend'); return this; },
    fitBounds(b, o) {
      this.fits.push(o);
      const [[a, bb], [c, d]] = b;
      this.center = ll((a + c) / 2, (bb + d) / 2);
      this.zoom = 13;
      this.fire('zoomend');
      this.fire('moveend');
      return this;
    },
    latLngToContainerPoint(p) {
      const q = asLL(p);
      const k = this.scale();
      return pt(this.size.x / 2 + (q.lng - this.center.lng) * k, this.size.y / 2 - (q.lat - this.center.lat) * k);
    },
    project(p, z) { const q = asLL(p); const k = 2 ** z / 100; return pt(q.lng * k, -q.lat * k); },
    panBy([dx, dy]) {
      this.pans.push([dx, dy]);
      const k = this.scale();
      this.center = ll(this.center.lat - dy / k, this.center.lng + dx / k);
      this.fire('moveend');
    },
    hasLayer(l) { return this.layers.has(l); },
    invalidateSize() {},
    remove() {},
    attributionControl: { setPrefix() {} },
  };
  const layer = (extra = {}) => ({
    addTo(t) { if (t === map) map.layers.add(this); else t.items.push(this); this.fire?.('add'); return this; },
    remove() { map.layers.delete(this); },
    setLatLng(p) { this.at = p; return this; },
    setRadius() { return this; },
    ...extra,
  });
  const el = (cls) => ({
    cls: new Set(cls.split(' ')), attrs: {}, listeners: {},
    classList: { toggle(c, on) { on ? this.owner.cls.add(c) : this.owner.cls.delete(c); }, contains(c) { return this.owner.cls.has(c); } },
    setAttribute(k, v) { this.attrs[k] = v; },
  });
  const L = {
    map: () => map,
    control: { zoom: () => ({ addTo() {} }) },
    tileLayer: () => layer(),
    circle: (at, opts) => layer({ at, opts, kind: 'circle' }),
    polygon: (pts, opts) => layer({ pts, opts, kind: 'polygon', setLatLngs(p) { this.pts = p; return this; } }),
    layerGroup: () => ({ items: [], addTo(t) { map.layers.add(this); return this; }, clearLayers() { this.items = []; } }),
    divIcon: (o) => o,
    marker: (at, opts) => {
      const h = {};
      return layer({ at, opts, kind: 'marker', on(e, f) { h[e] = f; return this; }, fire(e) { h[e]?.(); }, click() { h.click?.(); }, getElement: () => null });
    },
    latLngBounds(arr) {
      const lats = arr.map((a) => a[0]);
      const lngs = arr.map((a) => a[1]);
      const ne = ll(Math.max(...lats), Math.max(...lngs));
      const sw = ll(Math.min(...lats), Math.min(...lngs));
      return { getCenter: () => ll((ne.lat + sw.lat) / 2, (ne.lng + sw.lng) / 2), getNorthEast: () => ne, getSouthWest: () => sw, pad() { return this; } };
    },
    Control: {
      extend(props) {
        return class {
          constructor(o) { this.options = o; }
          addTo(m) { this.el = props.onAdd.call(this, m); L.controls.push(this.el); return this; }
        };
      },
    },
    controls: [],
    DomUtil: { create(tag, cls) { const e = el(cls); e.classList.owner = e; return e; } },
    DomEvent: { disableClickPropagation() {}, on(e, ev, f) { e.listeners[ev] = f; }, preventDefault() {} },
  };
  return { L, map };
}

const markersIn = (map) => [...map.layers].filter((l) => l.items).flatMap((g) => g.items).filter((x) => x.kind === 'marker');
const circlesIn = (map) => [...map.layers].filter((l) => l.items).flatMap((g) => g.items).filter((x) => x.kind === 'circle');
const meMarker = (map) => [...map.layers].find((l) => l.kind === 'marker' && l.opts?.zIndexOffset === 5000);

test('enquadra o raio acima da folha da lista (a parte tapada nunca passa de 60% do mapa)', () => {
  const { L, map } = fakeLeaflet();
  const h = createNearbyMap(L, {}, () => {}, { zoomControl: false });
  h.update({ center: { lat: -25.97, lng: 32.57 }, radiusKm: 10, markers: [], coverBottom: 180 });
  assert.deepEqual(map.fits.at(-1).paddingBottomRight, [12, 192]);
  // Mudar só a folha não volta a enquadrar (o mapa não salta).
  h.update({ center: { lat: -25.97, lng: 32.57 }, radiusKm: 10, markers: [], coverBottom: 400 });
  assert.equal(map.fits.length, 1);
  h.update({ center: { lat: -25.97, lng: 32.57 }, radiusKm: 20, markers: [], coverBottom: 790 });
  assert.deepEqual(map.fits.at(-1).paddingBottomRight, [12, 12 + 800 * 0.6]);
});

test('o ponto azul "estou aqui" só aparece com a localização do telemóvel', () => {
  const { L, map } = fakeLeaflet();
  const h = createNearbyMap(L, {}, () => {}, { zoomControl: false });
  const s = { center: { lat: -25.97, lng: 32.57 }, radiusKm: 10, markers: [] };
  h.update({ ...s, showMe: false });
  assert.equal(meMarker(map), undefined);
  h.update({ ...s, showMe: true });
  assert.ok(meMarker(map));
  h.update(s); // por omissão aparece (quem ainda não passa a propriedade)
  assert.ok(meMarker(map));
});

test('marcadores no mesmo sítio ficam num grupo mesmo com o mapa todo aproximado; um só halo por quadrícula', () => {
  const { L, map } = fakeLeaflet();
  const pressed = [];
  const h = createNearbyMap(L, {}, (id) => pressed.push(id), { zoomControl: false });
  const people = [
    { id: 'u:ana', kind: 'person', lat: -25.9725, lng: 32.5725, title: 'Ana' },
    { id: 'u:beto', kind: 'person', lat: -25.9725, lng: 32.5725, title: 'Beto' },
  ];
  h.update({ center: { lat: -25.97, lng: 32.57 }, radiusKm: 5, markers: people });
  map.zoom = 18.5;
  map.fire('zoomend');
  const mks = markersIn(map);
  assert.equal(mks.length, 1, 'um grupo, não dois marcadores empilhados');
  assert.equal(mks[0].opts.title, '2 sítios');
  assert.equal(circlesIn(map).length, 1, 'um só halo para a mesma quadrícula');
  mks[0].click();
  assert.deepEqual(pressed, ['u:ana']);
});

test('marcadores perto mas não no mesmo sítio separam-se com o mapa aproximado', () => {
  const { L, map } = fakeLeaflet();
  const h = createNearbyMap(L, {}, () => {}, { zoomControl: false });
  const venues = [
    { id: 'v:a', kind: 'venue', lat: -25.97, lng: 32.57, title: 'A' },
    { id: 'v:b', kind: 'venue', lat: -25.9704, lng: 32.5704, title: 'B' }, // ~60 m
  ];
  h.update({ center: { lat: -25.97, lng: 32.57 }, radiusKm: 5, markers: venues });
  map.zoom = 0; // tudo na mesma célula da grelha
  map.fire('zoomend');
  assert.equal(markersIn(map).length, 1);
  map.zoom = 18;
  map.fire('zoomend');
  assert.equal(markersIn(map).length, 2);
});

test('o item escolhido que ficava por baixo da lista vai para o meio da parte à vista', () => {
  const { L, map } = fakeLeaflet();
  const h = createNearbyMap(L, {}, () => {}, { zoomControl: false });
  const c = { lat: -25.97, lng: 32.57 };
  const low = { id: 'v:baixo', kind: 'venue', lat: c.lat - 0.3, lng: c.lng, title: 'Em baixo' };
  const s = { center: c, radiusKm: 10, markers: [low] };
  h.update({ ...s, coverBottom: 100 });
  const before = map.latLngToContainerPoint([low.lat, low.lng]);
  assert.ok(before.y > 800 - 400, 'começa na metade de baixo');
  // A lista sobe até meio (cobre 400 px) e escolhe-se o item: tem de ir para cima da folha.
  h.update({ ...s, selectedId: low.id, coverBottom: 400 });
  const after = map.latLngToContainerPoint([low.lat, low.lng]);
  assert.ok(Math.abs(after.y - 200) < 1, `fica a meio dos 400 px à vista (y=${after.y})`);
  assert.ok(Math.abs(after.x - 200) < 1);
  // Se já está à vista, não mexe.
  const pans = map.pans.length;
  h.update({ ...s, selectedId: low.id, coverBottom: 300 });
  assert.equal(map.pans.length, pans);
});

test('"Voltar ao centro" aparece quando o mapa sai do raio e volta a enquadrar', () => {
  const { L, map } = fakeLeaflet();
  const h = createNearbyMap(L, {}, () => {}, { zoomControl: false });
  const btn = L.controls[0];
  assert.equal(btn.attrs['aria-label'], 'Voltar ao centro da procura');
  h.update({ center: { lat: -25.97, lng: 32.57 }, radiusKm: 10, markers: [] });
  assert.equal(btn.cls.has('on'), false);
  map.panBy([150, 0]);
  assert.equal(btn.cls.has('on'), true);
  btn.listeners.click({});
  assert.equal(btn.cls.has('on'), false);
  assert.equal(map.fits.length, 2);
});

test('sem tamanho ainda: vista provisória e o primeiro resize enquadra; depois de mexer, o resize já não enquadra', () => {
  const { L, map } = fakeLeaflet({ x: 0, y: 0 });
  const h = createNearbyMap(L, {}, () => {}, { zoomControl: false });
  h.update({ center: { lat: -25.97, lng: 32.57 }, radiusKm: 10, markers: [] });
  assert.equal(map.fits.length, 0);
  assert.equal(map.views.length, 1);
  map.size = { x: 400, y: 800 };
  h.resize();
  assert.equal(map.fits.length, 1);
  map.panBy([200, 0]);
  h.resize();
  assert.equal(map.fits.length, 1);
});

// ---------- "Enviar localização" do chat: o mapa de marcar com o ponto azul e o aviso de arrastar ----------
test('mapa de marcar: ponto azul com o círculo da precisão (atualiza e sai); arrastar avisa, mudar o centro não', async () => {
  const { createPickMap } = await import(pathToFileURL(path.join(ROOT, 'src', 'components', 'nearby', 'mapRuntime.ts')).href);
  const { L, map } = fakeLeaflet();
  const moves = [];
  let drags = 0;
  const h = createPickMap(L, {}, (c) => moves.push(c), { zoomControl: false, zone: false }, () => drags++);
  h.setCenter({ lat: -25.97, lng: 32.57 });
  assert.equal(drags, 0, 'a app a mudar o centro não conta como arrastar');
  assert.ok(moves.length >= 1);

  h.setMe({ lat: -25.97, lng: 32.57, accuracy: 12 });
  const dot = [...map.layers].find((l) => l.kind === 'marker' && l.opts?.zIndexOffset === 5000);
  const ring = [...map.layers].find((l) => l.kind === 'circle' && l.opts?.color === '#1d9bf0');
  assert.ok(dot && ring);
  let radius = null;
  ring.setRadius = (r) => { radius = r; return ring; };
  h.setMe({ lat: -25.971, lng: 32.571, accuracy: 30 });
  assert.equal(radius, 30);
  assert.deepEqual(dot.at, [-25.971, 32.571]);
  assert.equal([...map.layers].filter((l) => l.kind === 'circle' && l.opts?.color === '#1d9bf0').length, 1, 'não duplica o ponto');
  h.setMe(null);
  assert.ok(!map.layers.has(dot) && !map.layers.has(ring));

  map.fire('dragstart');
  assert.equal(drags, 1);
});

// ---------- Desenho do mapa: véu fora do raio, a distância escrita, ícones dos locais, nome do escolhido ----------
const { readFileSync } = await import('node:fs');
const runtimeSrc = readFileSync(path.join(ROOT, 'src', 'components', 'nearby', 'mapRuntime.ts'), 'utf8');

test('os ícones dos locais no mapa são os mesmos traços dos ícones Tx (tx.ts)', () => {
  const tx = readFileSync(path.join(ROOT, 'src', 'icons', 'tx.ts'), 'utf8');
  const txPaths = (name) => JSON.parse(tx.match(new RegExp(`"${name}": (\{.*\}),?$`, 'm'))[1]).p;
  const block = runtimeSrc.slice(runtimeSrc.indexOf('const VENUE_ICON'), runtimeSrc.indexOf('};', runtimeSrc.indexOf('const VENUE_ICON')));
  const map = { bar: 'martini', restaurante: 'utensils', cafe: 'coffee', discoteca: 'music', hotel: 'key', evento: 'calendar' };
  for (const [kind, icon] of Object.entries(map)) {
    const line = block.split('\n').find((l) => l.trim().startsWith(`${kind}:`));
    assert.ok(line, kind);
    const got = [...line.matchAll(/d="([^"]+)"/g)].map((m) => m[1]);
    assert.deepEqual(got, txPaths(icon), `${kind} = ${icon}`);
  }
});

test('fora do raio fica um véu (o mundo com um buraco redondo no círculo) e a distância escrita no topo', () => {
  const { L, map } = fakeLeaflet();
  const h = createNearbyMap(L, {}, () => {}, { zoomControl: false });
  h.update({ center: { lat: -25.97, lng: 32.57 }, radiusKm: 10, markers: [] });
  const veil = [...map.layers].find((l) => l.kind === 'polygon');
  assert.ok(veil, 'há véu');
  assert.equal(veil.opts.interactive, false);
  const [outer, hole] = veil.pts;
  assert.equal(outer.length, 4);
  assert.equal(hole.length, 64);
  // Cada ponto do buraco fica a ~10 km do centro.
  for (const [lat, lng] of hole) {
    const dy = (lat + 25.97) * 111.32;
    const dx = (lng - 32.57) * 111.32 * Math.cos((-25.97 * Math.PI) / 180);
    assert.ok(Math.abs(Math.hypot(dx, dy) - 10) < 0.05);
  }
  const label = [...map.layers].find((l) => l.kind === 'marker' && l.opts?.icon?.className === 'txr');
  assert.ok(label, 'pílula da distância');
  assert.equal(label.at[0].toFixed(4), (-25.97 + 10 / 111.32).toFixed(4));
  // A fila de cima do enquadramento deixa espaço para a pílula.
  assert.deepEqual(map.fits.at(-1).paddingTopLeft, [12, 22]);
});

test('marcadores: local com o ícone do tipo, evento como folha de calendário, pessoa com anel; o escolhido mostra o nome', () => {
  const { L, map } = fakeLeaflet();
  const h = createNearbyMap(L, {}, () => {}, { zoomControl: false });
  const ms = [
    { id: 'v:a', kind: 'venue', lat: -25.9, lng: 32.5, title: 'Mundos <Bar>', category: 'bar' },
    { id: 'e:b', kind: 'event', lat: -25.95, lng: 32.6, title: 'Festa', date: '2026-11-21T20:00:00' },
    { id: 'u:c', kind: 'person', lat: -26.05, lng: 32.45, title: 'Zeca Langa' },
  ];
  h.update({ center: { lat: -25.97, lng: 32.57 }, radiusKm: 10, markers: ms, selectedId: 'v:a' });
  map.zoom = 18;
  map.fire('zoomend');
  const byTitle = (t) => markersIn(map).find((m) => m.opts.title === t);
  const venue = byTitle('Mundos <Bar>').opts.icon;
  assert.match(venue.html, /M3\.5 4\.4h17L12 13\.6Z/, 'copo do bar');
  assert.match(venue.className, /\bsel\b/);
  assert.match(venue.html, /<span class="lb">Mundos &lt;Bar&gt;<\/span>/, 'nome escapado na pílula');
  const ev = byTitle('Festa').opts.icon;
  assert.match(ev.html, /<span class="mo">NOV<\/span><span class="dy">21<\/span>/);
  assert.deepEqual(ev.iconAnchor, [20, 50], 'o bico aponta o sítio');
  const p = byTitle('Zeca Langa').opts.icon;
  assert.match(p.html, /tx-person"><div class="in"><span class="ini">ZL<\/span>/);
  assert.doesNotMatch(p.html, /class="lb"/, 'só o escolhido mostra o nome');
});

test('grupos crescem com a quantidade; o pulso do ponto azul pára para quem pede menos movimento', async () => {
  const { clusterSize } = await import(pathToFileURL(path.join(ROOT, 'src', 'components', 'nearby', 'mapRuntime.ts')).href);
  assert.deepEqual([1, 4, 5, 19, 20, 300].map(clusterSize), [36, 36, 42, 42, 48, 48]);
  assert.match(runtimeSrc, /@media \(prefers-reduced-motion:reduce\)\{\.txme \.pulse\{animation:none/);
  // A atribuição do OpenStreetMap sobe com a folha da lista (senão ficava tapada no telemóvel).
  assert.match(runtimeSrc, /\.txnb \.leaflet-bottom\{bottom:var\(--txcover,0px\)/);
  const el = { style: { props: {}, setProperty(k, v) { this.props[k] = v; } }, classList: { list: [], add(c) { this.list.push(c); } } };
  const { L } = fakeLeaflet();
  const h = createNearbyMap(L, el, () => {}, { zoomControl: false });
  assert.deepEqual(el.classList.list, ['txnb']);
  h.update({ center: { lat: -25.97, lng: 32.57 }, radiusKm: 10, markers: [], coverBottom: 250 });
  assert.equal(el.style.props['--txcover'], '250px');
  h.update({ center: { lat: -25.97, lng: 32.57 }, radiusKm: 10, markers: [], coverBottom: 790 });
  assert.equal(el.style.props['--txcover'], `${Math.round(800 * 0.6)}px`);
});

test('grupos de quadrículas vizinhas quase em cima uns dos outros juntam-se num só (nada de dois "4" sobrepostos)', () => {
  const { L, map } = fakeLeaflet();
  const h = createNearbyMap(L, {}, () => {}, { zoomControl: false });
  // Zoom 13: 81,92 px por grau no Leaflet a fingir; a fronteira de quadrícula (54 px) passa entre os dois grupos.
  const k = 2 ** 13 / 100;
  const edge = (54 * 600) / k; // longitude de uma fronteira de quadrícula
  const ms = [
    { id: 'v:1', kind: 'venue', lat: -25.97, lng: edge - 10 / k, title: 'A' },
    { id: 'v:2', kind: 'venue', lat: -25.97, lng: edge - 12 / k, title: 'B' },
    { id: 'v:3', kind: 'venue', lat: -25.97, lng: edge + 10 / k, title: 'C' },
    { id: 'v:4', kind: 'venue', lat: -25.97, lng: edge + 12 / k, title: 'D' },
    { id: 'v:far', kind: 'venue', lat: -25.97, lng: edge + 400 / k, title: 'Longe' },
  ];
  h.update({ center: { lat: -25.97, lng: edge }, radiusKm: 10, markers: ms });
  const mks = markersIn(map);
  assert.deepEqual(mks.map((m) => m.opts.title).sort(), ['4 sítios', 'Longe']);
});
