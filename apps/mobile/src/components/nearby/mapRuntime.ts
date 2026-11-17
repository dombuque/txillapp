/**
 * O mapa do "À tua volta" (Leaflet + mosaicos do OpenStreetMap servidos pelo Txillapp, com a atribuição) e o mapa pequeno
 * de "Marcar no mapa" (createPickMap: o sítio de um TxillGroup ou de um local, e o mapa só de ver da página do local).
 * Este ficheiro corre em dois sítios e por isso NÃO importa nada (só tipos):
 *  - no site (NearbyMap.web.tsx, PlacePickMap.web.tsx) é importado como módulo normal;
 *  - na app (NearbyMap.tsx, PlacePickMap.tsx) vai como texto dentro da página da WebView. Depois de mudar este ficheiro corre
 *    `node scripts/make-leaflet-inline.mjs` para atualizar src/components/nearby/leafletInline.ts.
 */
import type * as Leaflet from 'leaflet';
import { t } from '@/lib/i18n';

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
  /** Só locais: o tipo (bar, restaurante, cafe, discoteca, hotel…), para o ícone do pino quando não há logótipo. */
  category?: string | null;
  /** Destaque pago (Bombar): pino realçado com a etiqueta "Patrocinado", nunca agrupado e por cima dos outros. */
  boosted?: boolean;
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
  const WARM = '#ff9a5b';
  const MAX = 200; // marcadores no máximo (os mais perto vêm primeiro)
  const CELL = 54; // tamanho da grelha de agrupamento, em pixels
  const MONTHS = ['JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN', 'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ'];
  const PIN = '<path d="M12 21.3s-6.9-6-6.9-11.3a6.9 6.9 0 0 1 13.8 0C18.9 15.3 12 21.3 12 21.3Z"/><path d="M9.5 9.8a2.5 2.5 0 1 0 5.0 0a2.5 2.5 0 1 0 -5.0 0"/>';
  const CAMERA = '<path d="M3.5 9a2.5 2.5 0 0 1 2.5-2.5h1.6l1.4-2.2h5.9l1.4 2.2H18A2.5 2.5 0 0 1 20.5 9v8.5A2.5 2.5 0 0 1 18 20H6a2.5 2.5 0 0 1-2.5-2.5Z"/><path d="M8.3 13a3.7 3.7 0 1 0 7.4 0a3.7 3.7 0 1 0 -7.4 0"/>';
  const USERS = '<path d="M5.7 8.2a3.3 3.3 0 1 0 6.6 0a3.3 3.3 0 1 0 -6.6 0"/><path d="M2.8 19.6c.7-3.1 3.2-5 6.2-5s5.5 1.9 6.2 5"/><path d="M16.2 5.3a3.2 3.2 0 0 1 0 5.8"/><path d="M17.8 14.9c2.2.5 3.7 2.2 4.1 4.7"/>';
  /**
   * O ícone de cada tipo de local (os mesmos traços dos ícones Tx de src/icons/tx.ts, copiados porque este ficheiro não
   * importa nada): bar = copo, restaurante = talheres, café = chávena, discoteca = música, hotel = chave, evento = calendário.
   * O teste nearbyMapRuntime confirma que são iguais aos do tx.ts.
   */
  const VENUE_ICON: Record<string, string> = {
    bar: '<path d="M3.5 4.4h17L12 13.6Z"/><path d="M12 13.6v7"/><path d="M7.6 20.6h8.8"/><path d="M7 8.4h10"/>',
    restaurante: '<path d="M7 3.5v7a2.5 2.5 0 0 0 5 0v-7"/><path d="M9.5 3.5v17"/><path d="M17 20.5V3.5c-2.5 1-3.5 3.5-3.5 7H17"/>',
    cafe: '<path d="M4.5 8.5h12v6a5 5 0 0 1-5 5h-2a5 5 0 0 1-5-5Z"/><path d="M16.5 10h1.5a2.5 2.5 0 0 1 0 5h-1.7"/><path d="M8.5 3.4v2.2"/><path d="M12.5 3.4v2.2"/>',
    discoteca: '<path d="M9 17.4V5.6l10-2v11.8"/><path d="M4.0 17.5a2.5 2.5 0 1 0 5.0 0a2.5 2.5 0 1 0 -5.0 0"/><path d="M14.0 15.5a2.5 2.5 0 1 0 5.0 0a2.5 2.5 0 1 0 -5.0 0"/>',
    hotel: '<path d="M4.2 15.5a3.8 3.8 0 1 0 7.6 0a3.8 3.8 0 1 0 -7.6 0"/><path d="M10.8 12.7 19.8 3.7"/><path d="M16.4 7.1l2.6 2.6"/><path d="M13.6 9.9l2.2 2.2"/>',
    evento: '<path d="M20.5 12v-3.5a3 3 0 0 0-3-3h-11a3 3 0 0 0-3 3v9a3 3 0 0 0 3 3h11a3 3 0 0 0 3-3"/><path d="M3.5 10h17"/><path d="M8 3v3.5"/><path d="M16 3v3.5"/>',
  };
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

  // Estilos (uma vez por página). Todos os marcadores com a mesma borda branca e a mesma sombra; o tipo vê-se pela forma:
  // locais = quadrado escuro com o ícone do tipo (bar, café…), eventos = folha de calendário com o dia, publicações = foto com
  // bico, TxillGroups = círculo roxo, pessoas = foto com o anel da marca (como as histórias). O escolhido cresce e mostra o nome.
  if (!document.getElementById('tx-nearby-css')) {
    const SH = '0 1px 2px rgba(0,0,0,.2),0 4px 12px rgba(0,0,0,.16)';
    const css = document.createElement('style');
    css.id = 'tx-nearby-css';
    css.textContent = [
      // O mapa de fundo mais calmo e limpo (menos cor, um pouco mais de contraste): os marcadores destacam-se.
      '.txnb .leaflet-tile-pane{filter:saturate(.62) contrast(1.06) brightness(1.03)}',
      // A atribuição do OpenStreetMap fica sempre à vista, logo acima da folha da lista (--txcover, posto pelo mapa).
      '.txnb .leaflet-bottom{bottom:var(--txcover,0px);transition:bottom .2s ease}',
      '.txnb .leaflet-control-attribution{font-size:10px;background:rgba(255,255,255,.82);border-radius:6px 0 0 0;padding:1px 6px;color:#52525b}',
      '.txnb .leaflet-control-attribution a{color:#3f3f46}',
      '.txm{background:none;border:0}',
      '.txm .b{position:relative;box-sizing:border-box;transition:transform .16s cubic-bezier(.3,1.4,.6,1);transform-origin:50% 100%;cursor:pointer;-webkit-font-smoothing:antialiased}',
      '.txm.sel .b{transform:scale(1.2)}',
      '.txm img{display:block;width:100%;height:100%;object-fit:cover}',
      '.txm .ini{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font:800 13px system-ui,sans-serif;color:' + BRAND + '}',
      '.txm .kb{position:absolute;right:-6px;bottom:-6px;width:19px;height:19px;border-radius:50%;border:2px solid #fff;box-sizing:border-box;display:flex;align-items:center;justify-content:center;box-shadow:0 1px 3px rgba(0,0,0,.25)}',
      // O nome do escolhido, numa pílula escura por baixo do marcador (como o Airbnb e o Apple Maps).
      '.txm .lb{position:absolute;left:50%;top:100%;margin-top:7px;transform:translateX(-50%);max-width:170px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:4px 9px;border-radius:999px;background:#18181b;color:#fff;font:700 12px/1.2 system-ui,sans-serif;box-shadow:0 2px 8px rgba(0,0,0,.25);pointer-events:none}',
      '.tx-venue{width:40px;height:40px;border-radius:13px;background:#18181b;border:2.5px solid #fff;box-shadow:' + SH + '}',
      '.tx-venue .in,.tx-post .in,.tx-group .in{width:100%;height:100%;border-radius:10px;overflow:hidden;display:flex;align-items:center;justify-content:center}',
      '.tx-venue .kb{background:#18181b}',
      // Evento: uma folha de calendário (o mês na faixa da marca, o dia grande) com um bico a apontar o sítio.
      '.tx-event{width:40px;height:50px}',
      '.tx-event .cal{width:40px;height:43px;border-radius:11px;background:#fff;box-shadow:' + SH + ';overflow:hidden;display:flex;flex-direction:column;font-family:system-ui,sans-serif;line-height:1}',
      '.tx-event .mo{height:14px;background:' + BRAND + ';color:#fff;font-size:9px;font-weight:800;letter-spacing:.6px;display:flex;align-items:center;justify-content:center}',
      '.tx-event .dy{flex:1;display:flex;align-items:center;justify-content:center;color:#18181b;font-size:17px;font-weight:800}',
      '.tx-event:after{content:"";position:absolute;left:50%;top:42px;margin-left:-6px;border:6px solid transparent;border-top-color:#fff;border-bottom:0;filter:drop-shadow(0 2px 1px rgba(0,0,0,.12))}',
      '.tx-post{width:44px;height:44px;border-radius:12px;background:#e4e4e7;border:2.5px solid #fff;box-shadow:' + SH + '}',
      '.tx-post:after{content:"";position:absolute;left:50%;bottom:-9px;margin-left:-6px;border:6px solid transparent;border-top-color:#fff;border-bottom:0}',
      '.tx-post .kb{background:' + BRAND + ';bottom:auto;top:-6px}',
      '.tx-group{width:40px;height:40px;border-radius:50%;background:#7c3aed;border:2.5px solid #fff;box-shadow:' + SH + '}',
      '.tx-group .in{border-radius:50%}',
      '.tx-group .kb{background:#7c3aed}',
      // Pessoa: a foto dentro de um anel com o gradiente da marca (o mesmo das histórias e do Mixar).
      '.tx-person{width:44px;height:44px;border-radius:50%;padding:2.5px;background:linear-gradient(45deg,' + BRAND + ',' + WARM + ');box-shadow:' + SH + '}',
      '.tx-person .in{position:relative;width:100%;height:100%;border-radius:50%;border:2px solid #fff;box-sizing:border-box;overflow:hidden;background:#fff1f2}',
      '.tx-person img{position:relative}',
      // Grupos de marcadores: um círculo escuro que cresce com a quantidade, com um anel suave à volta.
      '.tx-cluster{border-radius:50%;background:#18181b;color:#fff;border:2.5px solid #fff;box-shadow:0 0 0 5px rgba(24,24,27,.14),' + SH + ';display:flex;align-items:center;justify-content:center;font:800 14px system-ui,sans-serif;box-sizing:border-box}',
      // O raio: a distância escrita no topo do círculo.
      '.txr{background:none;border:0;pointer-events:none}',
      '.txr span{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);white-space:nowrap;padding:3px 9px;border-radius:999px;background:#fff;color:' + BRAND + ';font:800 11px/1.2 system-ui,sans-serif;box-shadow:0 1px 4px rgba(0,0,0,.18);font-variant-numeric:tabular-nums}',
      // A minha posição: o ponto azul com um pulso suave (parado para quem pediu menos movimento).
      '.txme{background:none;border:0;pointer-events:none}',
      '.txme .pulse{position:absolute;left:-10px;top:-10px;width:44px;height:44px;border-radius:50%;background:rgba(29,155,240,.28);animation:txpulse 2.4s ease-out infinite}',
      '.txme .ring{position:absolute;left:-4px;top:-4px;width:32px;height:32px;border-radius:50%;background:rgba(29,155,240,.16)}',
      '.txme .dot{position:absolute;left:3px;top:3px;width:18px;height:18px;border-radius:50%;background:#1d9bf0;border:3px solid #fff;box-sizing:border-box;box-shadow:0 1px 5px rgba(0,0,0,.35)}',
      '@keyframes txpulse{0%{transform:scale(.4);opacity:.9}80%{opacity:0}100%{transform:scale(1.6);opacity:0}}',
      '@media (prefers-reduced-motion:reduce){.txme .pulse{animation:none;opacity:0}.txm .b{transition:none}}',
      // "Voltar ao centro": só aparece depois de o mapa sair do enquadramento do raio.
      '.txc{display:none;width:44px;height:44px;border-radius:50%;background:#fff;border:0;padding:0;margin:0;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.22);align-items:center;justify-content:center;-webkit-tap-highlight-color:transparent}',
      '.txc.on{display:flex}',
      '.txc:focus-visible{outline:2px solid ' + BRAND + ';outline-offset:2px}',
      // Bombar: anel dourado e a etiqueta "Patrocinado" por cima do pino (publicidade identificada).
      '.txm.boost .b{box-shadow:0 0 0 3px #f59e0b,' + SH + '}',
      '.txm.boost .tx-event{box-shadow:none}.txm.boost .tx-event .cal{box-shadow:0 0 0 3px #f59e0b,' + SH + '}',
      '.txm .bt{position:absolute;left:50%;bottom:100%;margin-bottom:6px;transform:translateX(-50%);white-space:nowrap;padding:2px 7px;border-radius:999px;background:#f59e0b;color:#18181b;font:800 10px system-ui,sans-serif;box-shadow:0 1px 3px rgba(0,0,0,.25);pointer-events:none}',
      '.leaflet-container{font-family:system-ui,sans-serif;background:#f2efe9}',
      '.leaflet-control-attribution{font-size:10px}',
      '.txnb .leaflet-control-zoom{border:0;box-shadow:0 2px 8px rgba(0,0,0,.18);border-radius:12px;overflow:hidden}',
      '.txnb .leaflet-control-zoom a{width:36px;height:36px;line-height:36px;font-size:18px;color:#18181b}',
    ].join('\n');
    document.head.appendChild(css);
  }
  el.classList?.add('txnb');

  const map = L.map(el, { zoomControl: false, attributionControl: true, zoomSnap: 0.5, minZoom: 4, maxZoom: 19 });
  if (opts.zoomControl) L.control.zoom({ position: 'topright', zoomInTitle: t('Aproximar'), zoomOutTitle: t('Afastar') }).addTo(map);
  map.attributionControl.setPrefix(false);
  // Mosaicos do OpenStreetMap servidos pelo próprio Txillapp (com cache), sem chave.
  L.tileLayer(TILE_URL, {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
  }).addTo(map);

  // Fora do raio o mapa fica esbatido (um véu branco com um buraco no círculo): a zona da procura salta à vista.
  const veil = L.polygon([], { stroke: false, fillColor: '#ffffff', fillOpacity: 0.42, interactive: false }).addTo(map);
  // O raio: um contorno da marca e um preenchimento muito suave, para não competir com os marcadores.
  const ring = L.circle([0, 0], { radius: 1, color: BRAND, weight: 1.5, opacity: 0.6, fillColor: BRAND, fillOpacity: 0.05, interactive: false }).addTo(map);
  const ringLabel = L.marker([0, 0], { icon: L.divIcon({ className: 'txr', html: '<span></span>', iconSize: [0, 0] }), interactive: false, keyboard: false, zIndexOffset: -500 }).addTo(map);
  const halos = L.layerGroup().addTo(map);
  const layer = L.layerGroup().addTo(map);
  // Um marcador (e não um círculo no SVG) para ficar por cima dos outros: o bico de uma publicação no mesmo sítio já não o tapa.
  const me = L.marker([0, 0], {
    icon: L.divIcon({ className: 'txme', html: '<div class="pulse"></div><div class="ring"></div><div class="dot"></div>', iconSize: [24, 24], iconAnchor: [12, 12] }),
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
      b.title = t('Voltar ao centro');
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

  /** Os graus de latitude e de longitude que o raio ocupa à volta do centro. */
  function span(c: { lat: number; lng: number }, km: number) {
    return { dLat: km / 111.32, dLng: km / (111.32 * Math.max(0.2, Math.cos((c.lat * Math.PI) / 180))) };
  }

  /** O véu de fora do raio: o mundo inteiro com um buraco redondo no círculo (64 pontos chegam para parecer redondo). */
  function drawVeil(c: { lat: number; lng: number }, km: number) {
    const { dLat, dLng } = span(c, km);
    const hole: [number, number][] = [];
    for (let i = 0; i < 64; i++) {
      const a = (i / 64) * Math.PI * 2;
      hole.push([c.lat + dLat * Math.sin(a), c.lng + dLng * Math.cos(a)]);
    }
    veil.setLatLngs([
      [[85, -180], [85, 180], [-85, 180], [-85, -180]],
      hole,
    ]);
  }

  /** Enquadra o círculo do raio (acima da parte tapada pela lista). */
  function fit() {
    if (!st) return;
    const c = st.center;
    // Caixa do círculo à mão (o getBounds do círculo precisa de o mapa já ter vista).
    const { dLat, dLng } = span(c, st.radiusKm);
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
      // 22 px em cima: a distância escrita no topo do círculo cabe à vista.
      { paddingTopLeft: [12, 22], paddingBottomRight: [12, 12 + cover()], animate: false },
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
      const icon = VENUE_ICON[m.category ?? ''] ?? PIN;
      html = `<div class="b tx-venue"><div class="in">${img || svg(icon, 20, '#fff')}</div>${badge(icon, !!img)}</div>`;
    } else if (m.kind === 'event') {
      const d = m.date ? new Date(m.date) : null;
      const ok = d && !isNaN(d.getTime());
      html = `<div class="b tx-event"><div class="cal"><span class="mo">${ok ? MONTHS[d!.getMonth()] : ''}</span><span class="dy">${ok ? d!.getDate() : svg(VENUE_ICON.evento, 16, BRAND)}</span></div></div>`;
      size = [40, 50];
      anchor = [20, 50];
    } else if (m.kind === 'post') {
      html = `<div class="b tx-post"><div class="in">${img || svg(CAMERA, 20, '#71717a')}</div>${badge(CAMERA, !!img)}</div>`;
      size = [44, 53];
      anchor = [22, 53];
    } else if (m.kind === 'group') {
      html = `<div class="b tx-group"><div class="in">${img || svg(USERS, 20, '#fff')}</div>${badge(USERS, !!img)}</div>`;
    } else {
      html = `<div class="b tx-person"><div class="in"><span class="ini">${esc(initials(m.title))}</span>${img}</div></div>`;
      size = [44, 44];
      anchor = [22, 22];
    }
    const extra = (m.boosted ? '<span class="bt">Patrocinado</span>' : '') + (sel ? `<span class="lb">${esc(m.title)}</span>` : '');
    if (extra) html = html.slice(0, html.lastIndexOf('</div>')) + extra + '</div>';
    return L.divIcon({ className: 'txm' + (sel ? ' sel' : '') + (m.boosted ? ' boost' : ''), html, iconSize: size, iconAnchor: anchor });
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
      if (m.id === st.selectedId || m.boosted) {
        singles.push(m);
        continue;
      }
      const p = map.project([m.lat, m.lng], zoom);
      const k = `${Math.floor(p.x / CELL)}:${Math.floor(p.y / CELL)}`;
      const b = buckets.get(k);
      if (b) b.push(m);
      else buckets.set(k, [m]);
    }
    // Quadrículas vizinhas com os grupos quase em cima uns dos outros (a menos de 46 px) juntam-se num só: dois "4"
    // sobrepostos na fronteira de duas quadrículas liam-se mal e o de baixo não se podia tocar.
    const groups: { x: number; y: number; ms: MapMarker[] }[] = [];
    buckets.forEach((b) => {
      const pts = b.map((m) => map.project([m.lat, m.lng], zoom));
      const x = pts.reduce((s, p) => s + p.x, 0) / pts.length;
      const y = pts.reduce((s, p) => s + p.y, 0) / pts.length;
      const near = groups.find((g) => Math.hypot(g.x - x, g.y - y) < 46);
      if (!near) {
        groups.push({ x, y, ms: [...b] });
        return;
      }
      const n = near.ms.length;
      near.x = (near.x * n + x * b.length) / (n + b.length);
      near.y = (near.y * n + y * b.length) / (n + b.length);
      near.ms.push(...b);
    });
    groups.forEach(({ ms: b }) => {
      const bounds = L.latLngBounds(b.map((m) => [m.lat, m.lng] as [number, number]));
      // No mesmo sítio (menos de 30 m: a mesma quadrícula da malta, o mesmo prédio): fica sempre agrupado, senão os
      // marcadores ficavam uns por cima dos outros e só o de cima se podia tocar.
      const same = bounds.getNorthEast().distanceTo(bounds.getSouthWest()) < 30;
      if (b.length === 1 || (zoom >= 18 && !same)) {
        singles.push(...b);
        return;
      }
      const c = bounds.getCenter();
      const d = clusterSize(b.length);
      const mk = L.marker(c, {
        icon: L.divIcon({ className: 'txm', html: `<div class="b tx-cluster" style="width:${d}px;height:${d}px">${b.length > 99 ? '99+' : b.length}</div>`, iconSize: [d, d], iconAnchor: [d / 2, d / 2] }),
        keyboard: true,
        title: t('{n} sítios', { n: b.length }),
        // Por cima do ponto azul: o número de um grupo no sítio onde estou não fica tapado.
        zIndexOffset: 6000,
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
      const mk = L.marker([m.lat, m.lng], { icon: iconFor(m, sel), title: m.boosted ? t('{title} · Patrocinado', { title: m.title }) : m.title, keyboard: true, riseOnHover: true, zIndexOffset: sel ? 1000 : m.boosted ? 800 : m.kind === 'event' ? 200 : 0 });
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
      drawVeil(next.center, next.radiusKm);
      ringLabel.setLatLng([next.center.lat + span(next.center, next.radiusKm).dLat, next.center.lng]);
      const lbl = ringLabel.getElement?.()?.querySelector('span');
      if (lbl) lbl.textContent = t('{radiusKm} km', { radiusKm: next.radiusKm });
      else ringLabel.setIcon?.(L.divIcon({ className: 'txr', html: `<span>${next.radiusKm} km</span>`, iconSize: [0, 0] }));
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
    el.style?.setProperty('--txcover', `${Math.round(cover())}px`);
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
      if (st) el.style?.setProperty('--txcover', `${Math.round(cover())}px`);
      if (wasOnFit && st) {
        fit();
        draw();
      } else syncRecenter();
    },
    destroy: () => map.remove(),
  };
}

/** O tamanho do círculo de um grupo de marcadores: cresce com a quantidade (36 px até 4, 42 até 19, 48 daí para cima). */
export function clusterSize(n: number): number {
  return n < 5 ? 36 : n < 20 ? 42 : 48;
}

export interface PickHandle {
  /** Leva o mapa até `c` (sem animação) e avisa o novo centro. */
  setCenter: (c: { lat: number; lng: number }, zoom?: number) => void;
  /** O ponto azul "estou aqui" com o círculo da precisão (em metros); null tira-o. */
  setMe: (p: { lat: number; lng: number; accuracy?: number | null } | null) => void;
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
 * `onDrag` avisa quando a pessoa começa a arrastar o mapa com o dedo (ou o rato), e não quando é a app a mudá-lo.
 */
export function createPickMap(L: typeof Leaflet, el: HTMLElement, onMove: (c: { lat: number; lng: number }) => void, opts: PickOptions, onDrag?: () => void): PickHandle {
  const BRAND = '#d6334f';
  if (!document.getElementById('tx-pick-css')) {
    const css = document.createElement('style');
    css.id = 'tx-pick-css';
    css.textContent = '.leaflet-container{font-family:system-ui,sans-serif;background:#f2efe9}.leaflet-control-attribution{font-size:10px}' +
      '.txpme{background:none;border:0;pointer-events:none}.txpme .dot{position:absolute;left:2px;top:2px;width:18px;height:18px;border-radius:50%;background:#1d9bf0;border:3px solid #fff;box-sizing:border-box;box-shadow:0 1px 4px rgba(0,0,0,.3)}';
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
  if (opts.zoomControl && !still) L.control.zoom({ position: 'topright', zoomInTitle: t('Aproximar'), zoomOutTitle: t('Afastar') }).addTo(map);
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
  map.on('dragstart', () => onDrag?.());
  const ME = '#1d9bf0';
  let meDot: Leaflet.Marker | null = null;
  let meRing: Leaflet.Circle | null = null;
  return {
    setCenter: (c, zoom) => {
      map.setView([c.lat, c.lng], zoom ?? (ready ? map.getZoom() : (opts.zoom ?? 15)), { animate: false });
      ready = true;
      emit();
    },
    setMe: (p) => {
      if (!p) {
        meDot?.remove();
        meRing?.remove();
        meDot = null;
        meRing = null;
        return;
      }
      const at: [number, number] = [p.lat, p.lng];
      const r = Math.max(1, Math.min(5000, Number(p.accuracy) || 1));
      if (!meDot || !meRing) {
        meRing = L.circle(at, { radius: r, color: ME, weight: 1, opacity: 0.45, fillColor: ME, fillOpacity: 0.12, interactive: false }).addTo(map);
        meDot = L.marker(at, {
          icon: L.divIcon({ className: 'txpme', html: '<div class="dot"></div>', iconSize: [22, 22], iconAnchor: [11, 11] }),
          interactive: false,
          keyboard: false,
          zIndexOffset: 5000,
        }).addTo(map);
      } else {
        meRing.setLatLng(at);
        meRing.setRadius(r);
        meDot.setLatLng(at);
      }
    },
    resize: () => map.invalidateSize(),
    destroy: () => map.remove(),
  };
}
