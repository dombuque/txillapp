import { useEffect, useRef } from 'react';
import { View } from 'react-native';
import { LEAFLET_CSS } from './leafletCss';
import { createPickMap, type PickHandle } from './mapRuntime';
import { PickPin } from './PickPin';
import type { PlacePickMapProps } from './types';

/** "Marcar no mapa" no site: o Leaflet do npm num div, com o alfinete fixo ao centro por cima. `readOnly`: só mostra o sítio. */
export function PlacePickMap({ center, onMove, zoomControl = true, zone = true, readOnly = false, zoom, me, pin = true, onDrag, style }: PlacePickMapProps) {
  const host = useRef<React.ComponentRef<typeof View>>(null);
  const handle = useRef<PickHandle | null>(null);
  const move = useRef(onMove);
  move.current = onMove;
  const drag = useRef(onDrag);
  drag.current = onDrag;
  const meNow = useRef(me);
  meNow.current = me;
  const first = useRef(center);
  const last = useRef(center);
  last.current = center;

  useEffect(() => {
    const L = require('leaflet') as typeof import('leaflet');
    if (!document.getElementById('tx-leaflet-css')) {
      const s = document.createElement('style');
      s.id = 'tx-leaflet-css';
      s.textContent = LEAFLET_CSS;
      document.head.appendChild(s);
    }
    const el = host.current as unknown as HTMLElement;
    const h = createPickMap(L, el, (c) => move.current?.(c), { zoomControl, zone, still: readOnly, zoom }, () => drag.current?.());
    handle.current = h;
    h.setCenter(last.current);
    if (meNow.current) h.setMe(meNow.current);
    const ro = new ResizeObserver(() => h.resize());
    ro.observe(el);
    return () => {
      ro.disconnect();
      h.destroy();
      handle.current = null;
    };
  }, [zoomControl, zone, readOnly, zoom]);

  useEffect(() => {
    if (center !== first.current) handle.current?.setCenter(center);
  }, [center]);

  const meKey = me ? `${me.lat},${me.lng},${me.accuracy ?? ''}` : '';
  useEffect(() => {
    handle.current?.setMe(meNow.current ? { lat: meNow.current.lat, lng: meNow.current.lng, accuracy: meNow.current.accuracy ?? null } : null);
  }, [meKey]);

  return (
    <View style={[{ backgroundColor: '#f2efe9', overflow: 'hidden' }, style]}>
      <View ref={host} style={{ flex: 1 }} />
      {pin ? <PickPin /> : null}
    </View>
  );
}
