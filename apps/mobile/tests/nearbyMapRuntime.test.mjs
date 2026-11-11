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
