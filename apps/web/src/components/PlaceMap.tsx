import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useEffect, useRef, useState } from 'react';
import { api, type NearbyPlaces } from '../lib/api';

const emoji: Record<string, string> = { praia: '🏖️', bar: '🍻', restaurante: '🍽️', lazer: '🌳', turismo: '📸', local: '📍' };
const MAPUTO = { lat: -25.9692, lng: 32.5732 };
type Spot = NearbyPlaces['places'][number];

interface Props {
  start: { lat: number; lng: number } | null;
  onPick: (label: string) => void;
  onClose: () => void;
}

/** Mapa para escolher o local: vê os sítios da zona, mexe no mapa e procura de novo ali. Só o nome escolhido é guardado. */
export default function PlaceMap({ start, onPick, onClose }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  const searched = useRef<L.LatLng | null>(null);
  const [spots, setSpots] = useState<Spot[]>([]);
  const [area, setArea] = useState<string | null>(null);
  const [selected, setSelected] = useState<Spot | null>(null);
  const [loading, setLoading] = useState(false);
  const [moved, setMoved] = useState(false);
  const [empty, setEmpty] = useState(false);

  async function search(at: L.LatLng) {
    setLoading(true);
    setMoved(false);
    setEmpty(false);
    searched.current = at;
    try {
      const r = await api.nearbyPlaces(at.lat, at.lng);
      setSpots(r.places);
      setArea(r.area);
      setEmpty(r.places.length === 0);
    } catch {
      setSpots([]);
      setEmpty(true);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!box.current) return;
    const c = start ?? MAPUTO;
    const m = L.map(box.current, { zoomControl: false, center: [c.lat, c.lng], zoom: 16 });
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(m);
    layer.current = L.layerGroup().addTo(m);
    if (start) L.circleMarker([start.lat, start.lng], { radius: 8, color: '#fff', weight: 3, fillColor: '#2563eb', fillOpacity: 1 }).addTo(m);
    m.on('moveend', () => {
      const from = searched.current;
      if (from && m.getCenter().distanceTo(from) > 250) setMoved(true);
    });
    m.on('click', () => setSelected(null));
    map.current = m;
    void search(m.getCenter());
    return () => {
      m.remove();
      map.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const g = layer.current;
    if (!g) return;
    g.clearLayers();
    for (const s of spots) {
      const on = selected?.name === s.name;
      const icon = L.divIcon({
        className: '',
        iconSize: [40, 40],
        iconAnchor: [20, 20],
        html: `<div style="width:40px;height:40px;border-radius:9999px;background:#fff;border:3px solid ${on ? '#d6334f' : '#fff'};box-shadow:0 2px 8px rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;font-size:20px;transform:scale(${on ? 1.2 : 1})">${emoji[s.kind] ?? '📍'}</div>`,
      });
      L.marker([s.lat, s.lng], { icon, keyboard: false, title: s.name })
        .on('click', (e) => {
          L.DomEvent.stopPropagation(e);
          setSelected(s);
        })
        .addTo(g);
    }
  }, [spots, selected]);

  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [onClose]);

  const round = 'flex h-11 w-11 items-center justify-center rounded-full bg-white text-zinc-900 shadow-lg active:scale-90';
  return (
    <div role="dialog" aria-modal="true" aria-label="Mapa de locais" className="fixed inset-0 z-[75] bg-zinc-100">
      <div ref={box} className="absolute inset-0" />

      <div className="pointer-events-none absolute inset-x-0 top-0 z-[1000] flex items-center justify-between gap-2 px-4 pt-[max(1rem,env(safe-area-inset-top))]">
        <button type="button" onClick={onClose} aria-label="Fechar mapa" className={`${round} pointer-events-auto`}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden><path d="M6 6l12 12M18 6 6 18" /></svg>
        </button>
        {(moved || loading) && (
          <button
            type="button"
            disabled={loading}
            onClick={() => map.current && void search(map.current.getCenter())}
            className="pointer-events-auto h-11 rounded-full bg-white px-5 font-bold text-brand shadow-lg active:scale-95"
          >
            {loading ? 'A procurar… 🔎' : 'Procurar nesta zona'}
          </button>
        )}
        <span className="w-11" aria-hidden />
      </div>

      {empty && !loading && (
        <p role="status" className="absolute inset-x-6 top-24 z-[1000] rounded-2xl bg-white/95 px-4 py-3 text-center text-sm shadow-lg">
          Nada por aqui 🤔 Mexe o mapa e procura noutra zona.
        </p>
      )}

      <div className="absolute inset-x-0 bottom-0 z-[1000] px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        {selected ? (
          <div className="flex items-center gap-3 rounded-3xl bg-white p-4 shadow-[0_4px_24px_rgba(0,0,0,0.25)]">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-2xl" aria-hidden>{emoji[selected.kind] ?? '📍'}</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-bold">{selected.name}</span>
              <span className="block truncate text-sm text-zinc-500">{area ?? 'Perto daqui'}</span>
            </span>
            <button type="button" onClick={() => onPick(area ? `${selected.name}, ${area}` : selected.name)} className="h-11 rounded-full bg-brand px-5 font-bold text-white active:scale-95">
              Usar
            </button>
          </div>
        ) : (
          spots.length > 0 && <p className="mx-auto w-fit rounded-full bg-white px-4 py-2 text-sm font-semibold shadow-lg">Toca num sítio para escolher 👆</p>
        )}
      </div>
    </div>
  );
}
