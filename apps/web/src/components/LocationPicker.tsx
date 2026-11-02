import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useEffect, useRef, useState } from 'react';
import { api, type NearbyPlaces } from '../lib/api';
import Icon, { type IconName } from './Icon';

const MAPUTO = { lat: -25.9692, lng: 32.5732 };
const kindIcon: Record<string, IconName> = { praia: 'waves', bar: 'cheers', restaurante: 'utensils', lazer: 'trees', turismo: 'camera', local: 'map-pin' };
const dist = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => L.latLng(a.lat, a.lng).distanceTo(L.latLng(b.lat, b.lng));
const meters = (m: number) => (m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1).replace('.', ',')} km`);

export interface Picked {
  lat: number;
  lng: number;
  label: string;
  /** Localização em direto, durante estes minutos. */
  live?: 15 | 60 | 480;
}

/**
 * Enviar localização, como no WhatsApp: mapa com o pino ao centro (mexe-se o mapa para escolher), "enviar a tua localização atual"
 * com a precisão do GPS e a lista de locais próximos (toca para enviar com o nome). Nada fica guardado nem é seguido.
 */
export default function LocationPicker({ onSend, onClose }: { onSend: (p: Picked) => void; onClose: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const me = useRef<{ lat: number; lng: number; acc: number } | null>(null);
  const [mine, setMine] = useState<{ lat: number; lng: number; acc: number } | null>(null);
  const [gpsErr, setGpsErr] = useState(false);
  const [liveOpen, setLiveOpen] = useState(false);
  const [pin, setPin] = useState(MAPUTO);
  const [near, setNear] = useState<NearbyPlaces | null>(null);
  const [loading, setLoading] = useState(false);
  const searched = useRef<{ lat: number; lng: number } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function look(at: { lat: number; lng: number }) {
    searched.current = at;
    setLoading(true);
    try {
      setNear(await api.nearbyPlaces(at.lat, at.lng));
    } catch {
      setNear({ area: null, city: null, places: [] });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!box.current) return;
    const m = L.map(box.current, { zoomControl: false, center: [MAPUTO.lat, MAPUTO.lng], zoom: 16, attributionControl: false });
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(m);
    // O pino está fixo ao centro: quando o mapa pára, é aquele o ponto escolhido.
    m.on('move', () => {
      const c = m.getCenter();
      setPin({ lat: c.lat, lng: c.lng });
    });
    m.on('moveend', () => {
      const c = m.getCenter();
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        if (!searched.current || dist(searched.current, { lat: c.lat, lng: c.lng }) > 150) void look({ lat: c.lat, lng: c.lng });
      }, 500);
    });
    map.current = m;
    void look(MAPUTO);

    if (!navigator.geolocation) setGpsErr(true);
    else {
      navigator.geolocation.getCurrentPosition(
        (p) => {
          const here = { lat: p.coords.latitude, lng: p.coords.longitude, acc: Math.round(p.coords.accuracy) };
          me.current = here;
          setMine(here);
          m.setView([here.lat, here.lng], 17, { animate: false });
          L.circle([here.lat, here.lng], { radius: Math.max(here.acc, 8), color: '#2563eb', weight: 1, fillColor: '#2563eb', fillOpacity: 0.12 }).addTo(m);
          L.circleMarker([here.lat, here.lng], { radius: 7, color: '#fff', weight: 3, fillColor: '#2563eb', fillOpacity: 1 }).addTo(m);
          void look(here);
        },
        () => setGpsErr(true),
        { enableHighAccuracy: true, timeout: 12_000, maximumAge: 20_000 },
      );
    }
    return () => {
      if (timer.current) clearTimeout(timer.current);
      m.remove();
      map.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [onClose]);

  const moved = mine ? dist(pin, mine) > 30 : true;
  const row = 'flex min-h-[64px] w-full items-center gap-3 px-4 text-left active:bg-zinc-100';
  const dot = 'flex h-11 w-11 shrink-0 items-center justify-center rounded-full';

  return (
    <div role="dialog" aria-modal="true" aria-label="Enviar localização" className="fixed inset-0 z-[80] flex flex-col bg-white">
      <div className="relative min-h-0 flex-[0_0_46%]">
        <div ref={box} className="absolute inset-0 bg-zinc-200" />
        <span className="pointer-events-none absolute left-1/2 top-1/2 z-[500] -translate-x-1/2 -translate-y-full drop-shadow-[0_3px_3px_rgba(0,0,0,0.35)]" aria-hidden>
          <svg width="34" height="44" viewBox="0 0 30 38" fill="none"><path d="M15 37C15 37 28 24.5 28 14.5a13 13 0 1 0-26 0C2 24.5 15 37 15 37Z" fill="#d6334f" stroke="#fff" strokeWidth="2.5" /><circle cx="15" cy="14.5" r="5" fill="#fff" /></svg>
        </span>
        <div className="pointer-events-none absolute inset-x-0 top-0 z-[600] flex items-center justify-between px-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
          <button type="button" onClick={onClose} aria-label="Fechar" className="pointer-events-auto flex h-11 w-11 items-center justify-center rounded-full bg-white shadow-lg active:scale-90"><Icon name="x" size={22} strokeWidth={2.2} /></button>
          <span className="rounded-full bg-white px-4 py-2 text-sm font-bold shadow-lg">Enviar localização</span>
          <button
            type="button"
            onClick={() => mine && map.current?.setView([mine.lat, mine.lng], 17, { animate: true })}
            disabled={!mine}
            aria-label="Voltar à minha posição"
            className="pointer-events-auto flex h-11 w-11 items-center justify-center rounded-full bg-white text-sky-600 shadow-lg active:scale-90 disabled:text-zinc-300"
          >
            <Icon name="locate" size={22} />
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain rounded-t-[22px] bg-white pb-[max(1rem,env(safe-area-inset-bottom))] shadow-[0_-8px_24px_rgba(0,0,0,0.1)]">
        <button type="button" disabled={!mine} onClick={() => mine && onSend({ lat: mine.lat, lng: mine.lng, label: 'A minha localização' })} className={`${row} disabled:opacity-60`}>
          <span className={`${dot} bg-sky-100 text-sky-600`}><Icon name="locate" size={22} /></span>
          <span className="min-w-0">
            <span className="block font-semibold">Enviar a tua localização atual</span>
            <span className="block text-sm text-zinc-500">{mine ? `Precisão de ${mine.acc} metros` : gpsErr ? 'Sem acesso à localização. Ativa-a nas definições.' : 'A procurar onde estás…'}</span>
          </span>
        </button>
        <button type="button" disabled={!mine} onClick={() => setLiveOpen((v) => !v)} aria-expanded={liveOpen} className={`${row} disabled:opacity-60`}>
          <span className={`${dot} bg-emerald-100 text-emerald-700`}><Icon name="clock" size={22} /></span>
          <span className="min-w-0">
            <span className="block font-semibold">Partilhar localização em direto</span>
            <span className="block text-sm text-zinc-500">A posição vai-se atualizando enquanto a app estiver aberta</span>
          </span>
        </button>
        {liveOpen && mine && (
          <div className="flex gap-2 px-4 pb-2">
            {([[15, '15 minutos'], [60, '1 hora'], [480, '8 horas']] as const).map(([m, label]) => (
              <button key={m} type="button" onClick={() => onSend({ lat: mine.lat, lng: mine.lng, label: 'Localização em direto', live: m })} className="h-11 flex-1 rounded-full bg-emerald-600 text-sm font-bold text-white active:scale-95">{label}</button>
            ))}
          </div>
        )}
        {moved && (
          <button type="button" onClick={() => onSend({ ...pin, label: near?.area ?? 'Localização escolhida' })} className={row}>
            <span className={`${dot} bg-rose-100 text-brand`}><Icon name="map-pin" size={22} /></span>
            <span className="min-w-0">
              <span className="block font-semibold">Enviar esta localização</span>
              <span className="block truncate text-sm text-zinc-500">{near?.area ?? (loading ? 'A procurar…' : 'O ponto onde está o pino')}</span>
            </span>
          </button>
        )}

        <p className="px-4 pb-1 pt-3 text-xs font-bold uppercase tracking-wider text-zinc-500">Locais próximos</p>
        {loading && !near && <p className="px-4 py-4 text-sm text-zinc-500">A procurar…</p>}
        {near && near.places.length === 0 && <p className="px-4 py-4 text-sm text-zinc-500">Nada por aqui. Mexe o mapa para procurar noutra zona.</p>}
        {near?.places.map((p) => (
          <button key={`${p.name}${p.lat}`} type="button" onClick={() => onSend({ lat: p.lat, lng: p.lng, label: p.name })} className={row}>
            <span className={`${dot} bg-zinc-100 text-zinc-700`}><Icon name={kindIcon[p.kind] ?? 'map-pin'} size={22} /></span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-semibold">{p.name}</span>
              <span className="block truncate text-sm text-zinc-500">{meters(p.distanceM)}{near.area ? ` · ${near.area}` : ''}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
