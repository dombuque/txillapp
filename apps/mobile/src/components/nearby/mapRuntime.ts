/**
 * O mapa do "À tua volta" (Leaflet + mosaicos do OpenStreetMap servidos pelo Txillapp, com a atribuição) e o mapa pequeno
 * de "Marcar no mapa" (createPickMap: o sítio de um TxillGroup ou de um local, e o mapa só de ver da página do local).
 * Este ficheiro corre em dois sítios e por isso NÃO importa nada (só tipos):
 *  - no site (NearbyMap.web.tsx, PlacePickMap.web.tsx) é importado como módulo normal;
 *  - na app (NearbyMap.tsx, PlacePickMap.tsx) vai como texto dentro da página da WebView. Depois de mudar este ficheiro corre
 *    `node scripts/make-leaflet-inline.mjs` para atualizar src/components/nearby/leafletInline.ts.
 */
import type * as Leaflet from 'leaflet';

/** Os mosaicos do OpenStreetMap, servidos (e guardados em cache) pelo servidor do Txillapp: o mesmo em todos os mapas. */
export const TILE_URL = 'https://txillapp.com/tiles/{z}/{x}/{y}.png';

export type MapMarkerKind = 'venue' | 'event' | 'post' | 'group' | 'person';
export interface MapMarker {
  id: string;
  kind: MapMarkerKind;
  lat: number;
  lng: number;
  title: string;
  /** Logótipo, capa, miniatura ou foto de perfil (endereço absoluto). */
  image?: string | null;
  /** Só eventos: quando começa (ISO), para o pin mostrar o dia. */
  date?: string | null;
}
export interface MapState {
  center: { lat: number; lng: number };
  radiusKm: number;
  markers: MapMarker[];
  selectedId?: string | null;
  /** Mostrar o ponto azul "estou aqui" (só com a localização do telemóvel; com uma cidade escolhida não). */
  showMe?: boolean;
  /** Píxeis do fundo do mapa tapados (a folha da lista no telemóvel): o enquadramento e o item escolhido ficam acima. */
  coverBottom?: number;
}
export interface MapHandle {
  update: (s: MapState) => void;
  resize: () => void;
  destroy: () => void;
}

export function createNearbyMap(L: typeof Leaflet, el: HTMLElement, onPress: (id: string) => void, opts: { zoomControl: boolean }): MapHandle {
  const BRAND = '#d6334f';
  const MAX = 200; // marcadores no máximo (os mais perto vêm primeiro)
  const CELL = 54; // tamanho da grelha de agrupamento, em pixels
  const MONTHS = ['JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN', 'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ'];
  const PIN = '<path d="M12 21.3s-6.9-6-6.9-11.3a6.9 6.9 0 0 1 13.8 0C18.9 15.3 12 21.3 12 21.3Z"/><path d="M9.5 9.8a2.5 2.5 0 1 0 5.0 0a2.5 2.5 0 1 0 -5.0 0"/>';
  const CAMERA = '<path d="M3.5 9a2.5 2.5 0 0 1 2.5-2.5h1.6l1.4-2.2h5.9l1.4 2.2H18A2.5 2.5 0 0 1 20.5 9v8.5A2.5 2.5 0 0 1 18 20H6a2.5 2.5 0 0 1-2.5-2.5Z"/><path d="M8.3 13a3.7 3.7 0 1 0 7.4 0a3.7 3.7 0 1 0 -7.4 0"/>';
  const USERS = '<path d="M5.7 8.2a3.3 3.3 0 1 0 6.6 0a3.3 3.3 0 1 0 -6.6 0"/><path d="M2.8 19.6c.7-3.1 3.2-5 6.2-5s5.5 1.9 6.2 5"/><path d="M16.2 5.3a3.2 3.2 0 0 1 0 5.8"/><path d="M17.8 14.9c2.2.5 3.7 2.2 4.1 4.7"/>';
  const svg = (paths: string, size: number, color: string) =>
    `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
  const esc = (s: string) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
  const initials = (s: string) =>
    String(s)
      .split(' ')
      .map((p) => p.charAt(0))
      .slice(0, 2)
      .join('')
      .toUpperCase();

  // Estilos dos marcadores (uma vez por página). Todos com a mesma borda branca e a mesma sombra; o tipo vê-se
  // pela forma e pela cor: locais = quadrado escuro, eventos = gota da marca com o dia, publicações = foto com bico,
  // TxillGroups = círculo roxo, pessoas = círculo com anel da marca. Com foto, um selo pequeno no canto diz o tipo.
  if (!document.getElementById('tx-nearby-css')) {
    const SH = '0 1px 2px rgba(0,0,0,.22),0 3px 10px rgba(0,0,0,.16)';
    const css = document.createElement('style');
    css.id = 'tx-nearby-css';
    css.textContent = [
      '.txm{background:none;border:0}',
      '.txm .b{position:relative;box-sizing:border-box;transition:transform .15s ease;transform-origin:50% 100%;cursor:pointer;-webkit-font-smoothing:antialiased}',
      '.txm.sel .b{transform:scale(1.18)}',
      '.txm img{display:block;width:100%;height:100%;object-fit:cover}',
      '.txm .ini{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font:700 13px system-ui,sans-serif;color:' + BRAND + '}',
      '.txm .kb{position:absolute;right:-6px;bottom:-6px;width:18px;height:18px;border-radius:50%;border:2px solid #fff;box-sizing:border-box;display:flex;align-items:center;justify-content:center;box-shadow:0 1px 3px rgba(0,0,0,.25)}',
      '.tx-venue{width:40px;height:40px;border-radius:12px;background:#18181b;border:3px solid #fff;box-shadow:' + SH + '}',
      '.tx-venue .in,.tx-post .in,.tx-group .in{width:100%;height:100%;border-radius:9px;overflow:hidden;display:flex;align-items:center;justify-content:center}',
      '.tx-venue .kb{background:#18181b}',
      '.tx-event{width:44px;height:52px}',
      '.tx-event .h{width:44px;height:44px;border-radius:50% 50% 50% 4px;transform:rotate(-45deg);background:' + BRAND + ';border:3px solid #fff;box-shadow:' + SH + ';box-sizing:border-box}',
      '.tx-event .t{position:absolute;left:0;top:0;width:44px;height:44px;display:flex;flex-direction:column;align-items:center;justify-content:center;color:#fff;font-family:system-ui,sans-serif;line-height:1}',
      '.tx-event .d{font-size:15px;font-weight:800}.tx-event .m{font-size:9px;font-weight:700;margin-top:1px;letter-spacing:.4px}',
      '.tx-post{width:44px;height:44px;border-radius:12px;background:#e4e4e7;border:3px solid #fff;box-shadow:' + SH + '}',
      '.tx-post:after{content:"";position:absolute;left:50%;bottom:-9px;margin-left:-6px;border:6px solid transparent;border-top-color:#fff;border-bottom:0}',
      '.tx-post .kb{background:' + BRAND + ';bottom:auto;top:-6px}',
      '.tx-group{width:40px;height:40px;border-radius:50%;background:#7c3aed;border:3px solid #fff;box-shadow:' + SH + '}',
      '.tx-group .in{border-radius:50%}',
      '.tx-group .kb{background:#7c3aed}',
      '.tx-person{width:38px;height:38px;border-radius:50%;background:#fff1f2;border:3px solid #fff;box-shadow:0 0 0 2px ' + BRAND + ',' + SH + ';overflow:hidden}',
      '.tx-person img{position:relative}',
      '.tx-cluster{width:40px;height:40px;border-radius:50%;background:#18181b;color:#fff;border:3px solid #fff;box-shadow:' + SH + ';display:flex;align-items:center;justify-content:center;font:800 14px system-ui,sans-serif}',
      // A minha posição: ponto azul por cima de tudo (pequeno, não tapa nada nem apanha toques).
      '.txme{background:none;border:0;pointer-events:none}',
      '.txme .pulse{position:absolute;left:0;top:0;width:24px;height:24px;border-radius:50%;background:rgba(29,155,240,.2)}',
      '.txme .dot{position:absolute;left:4px;top:4px;width:16px;height:16px;border-radius:50%;background:#1d9bf0;border:3px solid #fff;box-sizing:border-box;box-shadow:0 1px 4px rgba(0,0,0,.3)}',
      // "Voltar ao centro": só aparece depois de o mapa sair do enquadramento do raio.
      '.txc{display:none;width:44px;height:44px;border-radius:50%;background:#fff;border:0;padding:0;margin:0;cursor:pointer;box-shadow:0 1px 4px rgba(0,0,0,.25);align-items:center;justify-content:center;-webkit-tap-highlight-color:transparent}',
      '.txc.on{display:flex}',
      '.txc:focus-visible{outline:2px solid ' + BRAND + ';outline-offset:2px}',
      '.leaflet-container{font-family:system-ui,sans-serif;background:#f2efe9}',
      '.leaflet-control-attribution{font-size:10px}',
    ].join('\n');
    document.head.appendChild(css);
  }

  const map = L.map(el, { zoomControl: false, attributionControl: true, zoomSnap: 0.5, minZoom: 4, maxZoom: 19 });
  if (opts.zoomControl) L.control.zoom({ position: 'topright', zoomInTitle: 'Aproximar', zoomOutTitle: 'Afastar' }).addTo(map);
  map.attributionControl.setPrefix(false);
  // Mosaicos do OpenStreetMap servidos pelo próprio Txillapp (com cache), sem chave.
  L.tileLayer(TILE_URL, {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
  }).addTo(map);

  // O raio: só um contorno fino e um véu muito leve, para não competir com os marcadores.
  const ring = L.circle([0, 0], { radius: 1, color: BRAND, weight: 1, opacity: 0.35, fillColor: BRAND, fillOpacity: 0.025, interactive: false }).addTo(map);
  const halos = L.layerGroup().addTo(map);
  const layer = L.layerGroup().addTo(map);
  // Um marcador (e não um círculo no SVG) para ficar por cima dos outros: o bico de uma publicação no mesmo sítio já não o tapa.
  const me = L.marker([0, 0], {
    icon: L.divIcon({ className: 'txme', html: '<div class="pulse"></div><div class="dot"></div>', iconSize: [24, 24], iconAnchor: [12, 12] }),
    interactive: false,
    keyboard: false,
    zIndexOffset: 5000,
  }).addTo(map);

  let st: MapState | null = null;
  let fitKey = '';
  let selKey: string | null = null;
  let coverKey = 0;
  /** O enquadramento do raio (centro e zoom) depois do último fitBounds; null = ainda não houve. */
  let fitted: { c: Leaflet.LatLng; z: number } | null = null;

  /** Quanto do fundo do mapa está tapado (nunca mais de 60%, senão não sobra mapa para enquadrar). */
  const cover = () => Math.max(0, Math.min(st?.coverBottom ?? 0, map.getSize().y * 0.6));

  // "Voltar ao centro": um botão redondo no canto, só visível quando o mapa já não mostra o raio (arrastaste, aproximaste
  // ou o mapa foi até um item).
  const LOCATE = '<path d="M12 4.5v-2.5M12 22v-2.5M4.5 12H2M22 12h-2.5"/><path d="M5.5 12a6.5 6.5 0 1 0 13 0a6.5 6.5 0 1 0 -13 0"/><path d="M9.6 12a2.4 2.4 0 1 0 4.8 0a2.4 2.4 0 1 0 -4.8 0"/>';
  let recenterBtn: HTMLButtonElement | null = null;
  const Recenter = L.Control.extend({
    onAdd() {
      const b = L.DomUtil.create('button', 'txc') as HTMLButtonElement;
      b.type = 'button';
      b.title = 'Voltar ao centro';
      b.setAttribute('aria-label', 'Voltar ao centro da procura');
      b.innerHTML = svg(LOCATE, 22, BRAND);
      L.DomEvent.disableClickPropagation(b);
      L.DomEvent.on(b, 'click', (e) => {
        L.DomEvent.preventDefault(e);
        fit();
        draw();
      });
      recenterBtn = b;
      return b;
    },
  });
  new Recenter({ position: 'topright' }).addTo(map);

  /** O mapa ainda mostra o enquadramento do raio? (o mesmo zoom e o centro a menos de 40 px) */
  function onFit() {
    if (!fitted) return false;
    if (Math.abs(map.getZoom() - fitted.z) >= 0.5) return false;
    const a = map.latLngToContainerPoint(fitted.c);
    const b = map.latLngToContainerPoint(map.getCenter());
    return a.distanceTo(b) < 40;
  }
  const syncRecenter = () => recenterBtn?.classList.toggle('on', !!fitted && !onFit());

  /** Enquadra o círculo do raio (acima da parte tapada pela lista). */
  function fit() {
    if (!st) return;
    const c = st.center;
    // Caixa do círculo à mão (o getBounds do círculo precisa de o mapa já ter vista).
    const dLat = st.radiusKm / 111.32;
    const dLng = st.radiusKm / (111.32 * Math.max(0.2, Math.cos((c.lat * Math.PI) / 180)));
    const size = map.getSize();
    if (!size.x || !size.y) {
      // Ainda sem tamanho (a página está a montar): uma vista provisória; o resize volta a enquadrar.
      map.setView([c.lat, c.lng], 12, { animate: false });
      fitted = null;
      syncRecenter();
      return;
    }
    map.fitBounds(
      [
        [c.lat - dLat, c.lng - dLng],
        [c.lat + dLat, c.lng + dLng],
      ],
      { paddingTopLeft: [12, 12], paddingBottomRight: [12, 12 + cover()], animate: false },
    );
    fitted = { c: map.getCenter(), z: map.getZoom() };
    syncRecenter();
  }

  /** O item escolhido fica à vista, na parte do mapa que a lista não tapa. */
  function reveal(id: string) {
    const m = st?.markers.find((x) => x.id === id);
    if (!m) return;
    const size = map.getSize();
    const visH = size.y - cover();
    const p = map.latLngToContainerPoint([m.lat, m.lng]);
    const padX = size.x * 0.15;
    const padY = visH * 0.15;
    if (p.x >= padX && p.x <= size.x - padX && p.y >= padY && p.y <= visH - padY) return;
    map.panBy([p.x - size.x / 2, p.y - visH / 2]);
  }

  function iconFor(m: MapMarker, sel: boolean): Leaflet.DivIcon {
    const img = m.image ? `<img src="${esc(m.image)}" alt="" referrerpolicy="no-referrer">` : '';
    let html = '';
    let size: [number, number] = [40, 40];
    let anchor: [number, number] = [20, 20];
    // Selo do tipo no canto, só quando a foto esconde a cor de fundo.
    const badge = (paths: string, on: boolean) => (on ? `<span class="kb">${svg(paths, 10, '#fff')}</span>` : '');
    if (m.kind === 'venue') {
      html = `<div class="b tx-venue"><div class="in">${img || svg(PIN, 20, '#fff')}</div>${badge(PIN, !!img)}</div>`;
    } else if (m.kind === 'event') {
      const d = m.date ? new Date(m.date) : null;
      const ok = d && !isNaN(d.getTime());
      html = `<div class="b tx-event"><div class="h"></div><div class="t">${ok ? `<span class="d">${d!.getDate()}</span><span class="m">${MONTHS[d!.getMonth()]}</span>` : svg(PIN, 18, '#fff')}</div></div>`;
      size = [44, 52];
      anchor = [8, 50];
    } else if (m.kind === 'post') {
      html = `<div class="b tx-post"><div class="in">${img || svg(CAMERA, 20, '#71717a')}</div>${badge(CAMERA, !!img)}</div>`;
      size = [44, 53];
      anchor = [22, 53];
    } else if (m.kind === 'group') {
      html = `<div class="b tx-group"><div class="in">${img || svg(USERS, 20, '#fff')}</div>${badge(USERS, !!img)}</div>`;
    } else {
      html = `<div class="b tx-person"><span class="ini">${esc(initials(m.title))}</span>${img}</div>`;
      size = [38, 38];
      anchor = [19, 19];
    }
    return L.divIcon({ className: 'txm' + (sel ? ' sel' : ''), html, iconSize: size, iconAnchor: anchor });
  }

  // Foto que não carrega: some e fica o fundo (iniciais ou cor). Sem onerror no HTML (o CSP do site não deixa).
  function hideBroken(mk: Leaflet.Marker) {
    const node = mk.getElement();
    if (!node) return;
    node.querySelectorAll('img').forEach((im) => im.addEventListener('error', () => { im.style.display = 'none'; }, { once: true }));
  }

  function draw() {
    if (!st) return;
    layer.clearLayers();
    halos.clearLayers();
    const zoom = map.getZoom();
    const list = st.markers.slice(0, MAX);
    const buckets = new Map<string, MapMarker[]>();
    const singles: MapMarker[] = [];
    const haloAt = new Set<string>();
    for (const m of list) {
      // Pessoas: um círculo suave à volta (a posição é aproximada, nunca a exata). Várias pessoas na mesma quadrícula
      // têm o mesmo ponto: um só círculo (empilhados ficavam cada vez mais escuros).
      const hk = `${m.lat},${m.lng}`;
      if (m.kind === 'person' && !haloAt.has(hk)) {
        haloAt.add(hk);
        L.circle([m.lat, m.lng], { radius: 700, stroke: false, fillColor: BRAND, fillOpacity: 0.08, interactive: false }).addTo(halos);
      }
      if (m.id === st.selectedId) {
        singles.push(m);
        continue;
      }
      const p = map.project([m.lat, m.lng], zoom);
      const k = `${Math.floor(p.x / CELL)}:${Math.floor(p.y / CELL)}`;
      const b = buckets.get(k);
      if (b) b.push(m);
      else buckets.set(k, [m]);
    }
    buckets.forEach((b) => {
      const bounds = L.latLngBounds(b.map((m) => [m.lat, m.lng] as [number, number]));
      // No mesmo sítio (menos de 30 m: a mesma quadrícula da malta, o mesmo prédio): fica sempre agrupado, senão os
      // marcadores ficavam uns por cima dos outros e só o de cima se podia tocar.
      const same = bounds.getNorthEast().distanceTo(bounds.getSouthWest()) < 30;
      if (b.length === 1 || (zoom >= 18 && !same)) {
        singles.push(...b);
        return;
      }
      const c = bounds.getCenter();
      const mk = L.marker(c, {
        icon: L.divIcon({ className: 'txm', html: `<div class="b tx-cluster">${b.length > 99 ? '99+' : b.length}</div>`, iconSize: [40, 40], iconAnchor: [20, 20] }),
        keyboard: true,
        title: `${b.length} sítios`,
      });
      mk.on('click', () => {
        // No mesmo sítio não adianta aproximar: escolhe o primeiro e a lista mostra-o (os outros estão logo a seguir).
        if (same) onPress(b[0].id);
        else map.fitBounds(bounds.pad(0.4), { maxZoom: 18 });
      });
      mk.addTo(layer);
    });
    for (const m of singles) {
      const sel = m.id === st.selectedId;
      const mk = L.marker([m.lat, m.lng], { icon: iconFor(m, sel), title: m.title, keyboard: true, riseOnHover: true, zIndexOffset: sel ? 1000 : m.kind === 'event' ? 200 : 0 });
      mk.on('click', () => onPress(m.id));
      mk.on('add', () => hideBroken(mk));
      mk.addTo(layer);
    }
  }

  function update(next: MapState) {
    st = next;
    const key = `${next.center.lat},${next.center.lng},${next.radiusKm}`;
    if (key !== fitKey) {
      fitKey = key;
      ring.setLatLng([next.center.lat, next.center.lng]);
      ring.setRadius(next.radiusKm * 1000);
      me.setLatLng([next.center.lat, next.center.lng]);
      fit();
    }
    // O ponto azul só com a localização do telemóvel (no centro de uma cidade escolhida não estás tu).
    const showMe = next.showMe !== false;
    if (showMe && !map.hasLayer(me)) me.addTo(map);
    else if (!showMe && map.hasLayer(me)) me.remove();
    draw();
    // Escolheste um item da lista (ou a lista subiu e tapou-o): o mapa vai até ele se estiver fora da parte à vista.
    const cv = Math.round(next.coverBottom ?? 0);
    if (next.selectedId && (next.selectedId !== selKey || cv !== coverKey)) reveal(next.selectedId);
    selKey = next.selectedId ?? null;
    coverKey = cv;
  }

  map.on('zoomend', draw);
  map.on('moveend', syncRecenter);
  return {
    update,
    resize: () => {
      // Se o mapa ainda mostrava o raio (ou nem tinha tamanho), volta a enquadrar com o tamanho novo.
      const wasOnFit = !fitted || onFit();
      map.invalidateSize();
      if (wasOnFit && st) {
        fit();
        draw();
      } else syncRecenter();
    },
    destroy: () => map.remove(),
  };
}

export interface PickHandle {
  /** Leva o mapa até `c` (sem animação) e avisa o novo centro. */
  setCenter: (c: { lat: number; lng: number }, zoom?: number) => void;
  resize: () => void;
  destroy: () => void;
}


export interface PickOptions {
  zoomControl: boolean;
  /** O círculo de ~750 m da zona gravada (TxillGroups). Sem ele (locais) o ponto vai exato. Por omissão: sim. */
  zone?: boolean;
  /** Só para ver (o mapa pequeno da página do local): não se arrasta nem faz zoom; a página rola por cima. */
  still?: boolean;
  /** O zoom da primeira vista (15 por omissão). */
  zoom?: number;
}

/**
 * O mapa pequeno de "Marcar no mapa" (o sítio de um TxillGroup ou de um local): arrasta-se o mapa e o alfinete fica parado ao
 * centro (o alfinete é desenhado por cima, fora daqui). Nos grupos, um círculo de ~750 m (metade da quadrícula de 1,5 km) mostra
 * a zona que fica gravada. Avisa o centro em `onMove` quando o mapa para. Com `still`, só mostra o sítio.
 */
export function createPickMap(L: typeof Leaflet, el: HTMLElement, onMove: (c: { lat: number; lng: number }) => void, opts: PickOptions): PickHandle {
  const BRAND = '#d6334f';
  if (!document.getElementById('tx-pick-css')) {
    const css = document.createElement('style');
    css.id = 'tx-pick-css';
    css.textContent = '.leaflet-container{font-family:system-ui,sans-serif;background:#f2efe9}.leaflet-control-attribution{font-size:10px}';
    document.head.appendChild(css);
  }
  const still = !!opts.still;
  const map = L.map(el, {
    zoomControl: false,
    attributionControl: true,
    zoomSnap: 0.5,
    minZoom: 5,
    maxZoom: 18,
    dragging: !still,
    touchZoom: !still,
    scrollWheelZoom: !still,
    doubleClickZoom: !still,
    boxZoom: !still,
    keyboard: !still,
  });
  if (opts.zoomControl && !still) L.control.zoom({ position: 'topright', zoomInTitle: 'Aproximar', zoomOutTitle: 'Afastar' }).addTo(map);
  map.attributionControl.setPrefix(false);
  L.tileLayer(TILE_URL, {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
  }).addTo(map);
  const zone = opts.zone === false ? null : L.circle([0, 0], { radius: 750, color: BRAND, weight: 1.5, opacity: 0.55, fillColor: BRAND, fillOpacity: 0.08, interactive: false }).addTo(map);
  let ready = false;
  const emit = () => {
    const c = map.getCenter();
    if (zone) zone.setLatLng(c);
    onMove({ lat: c.lat, lng: c.lng });
  };
  map.on('move', () => { if (zone) zone.setLatLng(map.getCenter()); });
  map.on('moveend', () => { if (ready) emit(); });
  return {
    setCenter: (c, zoom) => {
      map.setView([c.lat, c.lng], zoom ?? (ready ? map.getZoom() : (opts.zoom ?? 15)), { animate: false });
      ready = true;
      emit();
    },
    resize: () => map.invalidateSize(),
    destroy: () => map.remove(),
  };
}
