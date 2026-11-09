/**
 * O mapa do "À tua volta" (Leaflet + mosaicos CARTO Voyager, de graça, com a atribuição do OpenStreetMap).
 * Este ficheiro corre em dois sítios e por isso NÃO importa nada (só tipos):
 *  - no site (NearbyMap.web.tsx) é importado como módulo normal;
 *  - na app (NearbyMap.tsx) vai como texto dentro da página da WebView. Depois de mudar este ficheiro corre
 *    `node scripts/make-leaflet-inline.mjs` para atualizar src/components/nearby/leafletInline.ts.
 */
import type * as Leaflet from 'leaflet';

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

  // Estilos dos marcadores (uma vez por página).
  if (!document.getElementById('tx-nearby-css')) {
    const css = document.createElement('style');
    css.id = 'tx-nearby-css';
    css.textContent = [
      '.txm{background:none;border:0}',
      '.txm .b{position:relative;transition:transform .15s ease;transform-origin:50% 100%;cursor:pointer}',
      '.txm.sel .b{transform:scale(1.22)}',
      '.txm img{display:block;width:100%;height:100%;object-fit:cover}',
      '.txm .ini{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font:700 13px system-ui,sans-serif;color:' + BRAND + '}',
      '.tx-venue{width:40px;height:40px;border-radius:12px;background:#18181b;border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.28);overflow:hidden;display:flex;align-items:center;justify-content:center}',
      '.tx-event{width:44px;height:52px}',
      '.tx-event .h{width:44px;height:44px;border-radius:50% 50% 50% 4px;transform:rotate(-45deg);background:' + BRAND + ';border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.3);box-sizing:border-box}',
      '.tx-event .t{position:absolute;left:0;top:0;width:44px;height:44px;display:flex;flex-direction:column;align-items:center;justify-content:center;color:#fff;font-family:system-ui,sans-serif;line-height:1}',
      '.tx-event .d{font-size:15px;font-weight:800}.tx-event .m{font-size:9px;font-weight:700;margin-top:1px;letter-spacing:.4px}',
      '.tx-post{width:46px;height:46px;border-radius:12px;background:#e4e4e7;border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.3);overflow:visible}',
      '.tx-post .in{width:100%;height:100%;border-radius:9px;overflow:hidden}',
      '.tx-post:after{content:"";position:absolute;left:50%;bottom:-8px;margin-left:-6px;border:6px solid transparent;border-top-color:#fff;border-bottom:0}',
      '.tx-group{width:40px;height:40px;border-radius:50%;background:#7c3aed;border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.3);display:flex;align-items:center;justify-content:center;overflow:hidden}',
      '.tx-person{width:38px;height:38px;border-radius:50%;background:#fff1f2;border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.25);overflow:hidden}',
      '.tx-person img{position:relative}',
      '.tx-cluster{width:40px;height:40px;border-radius:50%;background:#18181b;color:#fff;border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.3);display:flex;align-items:center;justify-content:center;font:800 14px system-ui,sans-serif}',
      '.leaflet-container{font-family:system-ui,sans-serif;background:#f2efe9}',
      '.leaflet-control-attribution{font-size:10px}',
    ].join('\n');
    document.head.appendChild(css);
  }

  const map = L.map(el, { zoomControl: false, attributionControl: true, zoomSnap: 0.5, minZoom: 4, maxZoom: 19 });
  if (opts.zoomControl) L.control.zoom({ position: 'topright', zoomInTitle: 'Aproximar', zoomOutTitle: 'Afastar' }).addTo(map);
  map.attributionControl.setPrefix(false);
  L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
    subdomains: 'abcd',
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>, &copy; <a href="https://carto.com/attributions" target="_blank" rel="noopener">CARTO</a>',
  }).addTo(map);

  const ring = L.circle([0, 0], { radius: 1, color: BRAND, weight: 1.5, opacity: 0.7, fillColor: BRAND, fillOpacity: 0.05, interactive: false }).addTo(map);
  const halos = L.layerGroup().addTo(map);
  const layer = L.layerGroup().addTo(map);
  const me = L.circleMarker([0, 0], { radius: 7, color: '#fff', weight: 3, fillColor: '#1d9bf0', fillOpacity: 1, interactive: false }).addTo(map);

  let st: MapState | null = null;
  let fitKey = '';
  let selKey: string | null = null;

  function iconFor(m: MapMarker, sel: boolean): Leaflet.DivIcon {
    const img = m.image ? `<img src="${esc(m.image)}" alt="" referrerpolicy="no-referrer">` : '';
    let html = '';
    let size: [number, number] = [40, 40];
    let anchor: [number, number] = [20, 20];
    if (m.kind === 'venue') {
      html = `<div class="b tx-venue">${img || svg(PIN, 20, '#fff')}</div>`;
    } else if (m.kind === 'event') {
      const d = m.date ? new Date(m.date) : null;
      const ok = d && !isNaN(d.getTime());
      html = `<div class="b tx-event"><div class="h"></div><div class="t">${ok ? `<span class="d">${d!.getDate()}</span><span class="m">${MONTHS[d!.getMonth()]}</span>` : svg(PIN, 18, '#fff')}</div></div>`;
      size = [44, 52];
      anchor = [8, 50];
    } else if (m.kind === 'post') {
      html = `<div class="b tx-post"><div class="in">${img}</div></div>`;
      size = [46, 54];
      anchor = [23, 54];
    } else if (m.kind === 'group') {
      html = `<div class="b tx-group">${img || svg(USERS, 20, '#fff')}</div>`;
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
    for (const m of list) {
      // Pessoas: um círculo suave à volta (a posição é aproximada, nunca a exata).
      if (m.kind === 'person') L.circle([m.lat, m.lng], { radius: 700, stroke: false, fillColor: BRAND, fillOpacity: 0.12, interactive: false }).addTo(halos);
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
      if (b.length === 1 || zoom >= 18) {
        singles.push(...b);
        return;
      }
      const bounds = L.latLngBounds(b.map((m) => [m.lat, m.lng] as [number, number]));
      const c = bounds.getCenter();
      const mk = L.marker(c, {
        icon: L.divIcon({ className: 'txm', html: `<div class="b tx-cluster">${b.length > 99 ? '99+' : b.length}</div>`, iconSize: [40, 40], iconAnchor: [20, 20] }),
        keyboard: true,
        title: `${b.length} sítios`,
      });
      mk.on('click', () => {
        const same = bounds.getNorthEast().distanceTo(bounds.getSouthWest()) < 30;
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
      // Caixa do círculo à mão (o getBounds do círculo precisa de o mapa já ter vista).
      const dLat = next.radiusKm / 111.32;
      const dLng = next.radiusKm / (111.32 * Math.max(0.2, Math.cos((next.center.lat * Math.PI) / 180)));
      map.fitBounds(
        [
          [next.center.lat - dLat, next.center.lng - dLng],
          [next.center.lat + dLat, next.center.lng + dLng],
        ],
        { padding: [12, 12], animate: false },
      );
    }
    draw();
    // Escolheste um item da lista: o mapa vai até ele se estiver fora da vista.
    if (next.selectedId && next.selectedId !== selKey) {
      const m = next.markers.find((x) => x.id === next.selectedId);
      if (m && !map.getBounds().pad(-0.15).contains([m.lat, m.lng])) map.panTo([m.lat, m.lng]);
    }
    selKey = next.selectedId ?? null;
  }

  map.on('zoomend', draw);
  return {
    update,
    resize: () => map.invalidateSize(),
    destroy: () => map.remove(),
  };
}
