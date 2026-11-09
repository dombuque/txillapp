import { useEffect, useRef } from 'react';
import { View } from 'react-native';
import { LEAFLET_CSS } from './leafletCss';
import { createNearbyMap, type MapHandle } from './mapRuntime';
import type { NearbyMapProps } from './types';

/** Mapa do "À tua volta" no site: o Leaflet do npm (o CSP do site não deixa scripts de fora), desenhado num div. */
export function NearbyMap({ center, radiusKm, markers, onMarkerPress, selectedId, zoomControl = false, style }: NearbyMapProps) {
  const host = useRef<React.ComponentRef<typeof View>>(null);
  const handle = useRef<MapHandle | null>(null);
  const press = useRef(onMarkerPress);
  press.current = onMarkerPress;
  const state = useRef({ center, radiusKm, markers, selectedId });
  state.current = { center, radiusKm, markers, selectedId };

  useEffect(() => {
    // O site é gerado estático (sem window no servidor): o Leaflet só se carrega aqui, já no browser.
    const L = require('leaflet') as typeof import('leaflet');
    if (!document.getElementById('tx-leaflet-css')) {
      const s = document.createElement('style');
      s.id = 'tx-leaflet-css';
      s.textContent = LEAFLET_CSS;
      document.head.appendChild(s);
    }
    const el = host.current as unknown as HTMLElement;
    const h = createNearbyMap(L, el, (id) => press.current(id), { zoomControl });
    handle.current = h;
    h.update(state.current);
    const ro = new ResizeObserver(() => h.resize());
    ro.observe(el);
    return () => {
      ro.disconnect();
      h.destroy();
      handle.current = null;
    };
  }, [zoomControl]);

  useEffect(() => {
    handle.current?.update({ center, radiusKm, markers, selectedId });
  }, [center, radiusKm, markers, selectedId]);

  return <View ref={host} style={[{ flex: 1, backgroundColor: '#f2efe9', overflow: 'hidden' }, style]} accessibilityLabel="Mapa do que há à tua volta" />;
}
