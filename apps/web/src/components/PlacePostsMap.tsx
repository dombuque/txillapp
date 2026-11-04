import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Post } from '../lib/api';

/**
 * Mapa dos posts de um sítio: o ponto do sítio em destaque e, à volta, os outros sítios com publicações (com o número delas).
 * Só mostra a posição dos SÍTIOS (arredondada), nunca a de pessoas.
 */
export default function PlacePostsMap({ center, label, items }: { center: { lat: number; lng: number }; label: string; items: Post[] }) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (!box.current) return;
    const m = L.map(box.current, { zoomControl: false, attributionControl: true, center: [center.lat, center.lng], zoom: 14, scrollWheelZoom: false });
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' }).addTo(m);
    layer.current = L.layerGroup().addTo(m);
    map.current = m;
    return () => {
      m.remove();
      map.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const m = map.current;
    const g = layer.current;
    if (!m || !g) return;
    g.clearLayers();
    // Um pino por sítio (nome + posição), com quantas publicações.
    const spots = new Map<string, { label: string; lat: number; lng: number; n: number }>();
    for (const p of items) {
      if (!p.locationGeo || !p.locationLabel) continue;
      const k = `${p.locationLabel.toLowerCase()}|${p.locationGeo.lat}|${p.locationGeo.lng}`;
      const cur = spots.get(k);
      if (cur) cur.n++;
      else spots.set(k, { label: p.locationLabel, lat: p.locationGeo.lat, lng: p.locationGeo.lng, n: 1 });
    }
    const pts: L.LatLngExpression[] = [[center.lat, center.lng]];
    for (const s of spots.values()) {
      const here = s.label.toLowerCase() === label.toLowerCase();
      const icon = L.divIcon({
        className: '',
        iconSize: [34, 34],
        iconAnchor: [17, 17],
        html: `<div style="display:flex;align-items:center;justify-content:center;width:34px;height:34px;border-radius:50%;background:${here ? '#d6334f' : '#18181b'};color:#fff;font:700 14px system-ui;border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.35)">${s.n}</div>`,
      });
      L.marker([s.lat, s.lng], { icon, title: s.label })
        .on('click', () => {
          if (!here) navigate(`/place/${encodeURIComponent(s.label)}`);
        })
        .addTo(g);
      pts.push([s.lat, s.lng]);
    }
    if (pts.length > 1) m.fitBounds(L.latLngBounds(pts), { padding: [36, 36], maxZoom: 16 });
    else m.setView([center.lat, center.lng], 15);
  }, [items, center.lat, center.lng, label, navigate]);

  return <div ref={box} role="img" aria-label={label} className="h-56 w-full overflow-hidden rounded-3xl bg-zinc-100" />;
}
