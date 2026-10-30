import Icon, { type IconName } from './Icon';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState, lazy, Suspense } from 'react';
import { api, type NearbyPlaces } from '../lib/api';
import { Sheet } from './ui';

const PlaceMap = lazy(() => import('./PlaceMap'));

const kindIcon: Record<string, IconName> = { praia: 'waves', bar: 'cheers', restaurante: 'utensils', lazer: 'trees', turismo: 'camera', local: 'map-pin' };

type Status = 'idle' | 'locating' | 'searching' | 'ready' | 'error';
export interface PlacePickerProps {
  value: string;
  onChange: (v: string) => void;
}
interface Option {
  label: string;
  sub?: string;
  icon: IconName;
}

/** Lógica de localização: pede a posição, procura sítios perto e guarda as coordenadas só em memória (para ordenar sugestões). */
export function usePlaces() {
  const [status, setStatus] = useState<Status>('idle');
  const [data, setData] = useState<NearbyPlaces | null>(null);
  const [at, setAt] = useState<{ lat: number; lng: number } | null>(null);
  const [msg, setMsg] = useState('');

  function locate() {
    setMsg('');
    if (!('geolocation' in navigator)) {
      setStatus('error');
      return setMsg('Este dispositivo não sabe dizer onde estás. Escreve à mão.');
    }
    setStatus('locating');
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        setStatus('searching');
        setAt({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        try {
          setData(await api.nearbyPlaces(pos.coords.latitude, pos.coords.longitude));
          setStatus('ready');
        } catch {
          setStatus('error');
          setMsg('Não consegui procurar sítios agora. Escreve à mão.');
        }
      },
      (err) => {
        setStatus('error');
        setMsg(
          err.code === err.PERMISSION_DENIED
            ? 'Sem permissão de localização. Ativa-a no browser ou escreve à mão.'
            : 'Não consegui apanhar o teu sinal. Tenta outra vez ou escreve à mão.',
        );
      },
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 60_000 },
    );
  }
  return { status, data, at, msg, locate };
}

function useDebounced<T>(value: T, ms: number) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

const SearchIcon = () => <Icon name="search" size={20} strokeWidth={2.2} />;

const Skeleton = () => (
  <ul className="mt-3" aria-hidden>
    {[0, 1, 2].map((i) => (
      <li key={i} className="flex items-center gap-3 px-1 py-2.5">
        <span className="skel h-11 w-11 rounded-full" />
        <span className="flex-1 space-y-2">
          <span className="skel block h-3.5 w-2/3 rounded-full" />
          <span className="skel block h-3 w-1/3 rounded-full" />
        </span>
      </li>
    ))}
  </ul>
);

function Row({ o, onPick }: { o: Option; onPick: () => void }) {
  return (
    <li>
      <button type="button" onClick={onPick} className="flex w-full items-center gap-3 rounded-xl px-1 py-2.5 text-left active:bg-zinc-100">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-zinc-100 " aria-hidden><Icon name={o.icon} size={22} /></span>
        <span className="min-w-0">
          <span className="block truncate font-semibold">{o.label}</span>
          {o.sub && <span className="block truncate text-sm text-zinc-500">{o.sub}</span>}
        </span>
      </button>
    </li>
  );
}

/** "Adicionar local" como no Instagram: sugere enquanto escreves, mostra o que há perto, e aceita texto livre. Só o nome escolhido é guardado. */
export default function PlaceSheet({ value, onChange, onClose }: PlacePickerProps & { onClose: () => void }) {
  const { status, data, at, msg, locate } = usePlaces();
  const [typed, setTyped] = useState(value);
  const [started, setStarted] = useState(true);
  // Como no Instagram: ao abrir, já procura sítios perto (o browser pede a permissão uma vez).
  useEffect(() => { locate(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const input = useRef<HTMLInputElement>(null);
  const [mapOpen, setMapOpen] = useState(false);
  const hot = useQuery({ queryKey: ['places-hot'], queryFn: api.hotPlaces, staleTime: 5 * 60_000, retry: false });
  const text = typed.trim();
  const debounced = useDebounced(text, 300);

  const found = useQuery({
    queryKey: ['place-search', debounced, at?.lat, at?.lng],
    queryFn: () => api.searchPlaces(debounced, at ?? undefined),
    enabled: debounced.length >= 2,
    staleTime: 5 * 60_000,
    retry: false,
  });

  const pick = (label: string) => {
    onChange(label);
    onClose();
  };

  const nearby: Option[] = [];
  if (data) {
    for (const p of data.places) {
      const d = p.distanceM < 1000 ? `${p.distanceM} m` : `${(p.distanceM / 1000).toFixed(1)} km`;
      nearby.push({ label: p.name, sub: `${d}${data.area ? ` · ${data.area}` : ''}`, icon: kindIcon[p.kind] ?? 'map-pin' });
    }
    if (data.area) nearby.push({ label: data.area, sub: data.city ?? undefined, icon: 'home' });
    if (data.city && data.city !== data.area) nearby.push({ label: data.city, icon: 'city' });
  }
  // Sem sugestões perto (sem permissão, sem sinal ou sem resultados): abre logo a pesquisa para escrever.
  const noNearby = status === 'error' || (status === 'ready' && nearby.length === 0);
  useEffect(() => { if (noNearby) input.current?.focus(); }, [noNearby]);
  const suggestions: Option[] = (found.data ?? []).map((h) => ({ label: h.name, sub: h.sub || undefined, icon: kindIcon[h.kind] ?? 'map-pin' }));
  const searching = text.length >= 2;
  // Ao escolher um sítio da pesquisa, junta-se a zona para ficar claro (ex.: "Costa do Sol, Maputo").
  const fullName = (o: Option) => (o.sub ? `${o.label}, ${o.sub.split(', ')[0]}` : o.label);

  return (
    <Sheet title="Onde estás?" onClose={onClose}>
      <div className="min-h-[260px]">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (text) pick(text);
        }}
        className="relative"
      >
        <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500"><SearchIcon /></span>
        <input
          ref={input}
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          maxLength={80}
          enterKeyHint="done"
          autoComplete="off"
          placeholder="Procura um sítio…"
          aria-label="Local"
          className="h-12 w-full rounded-full bg-zinc-100 pl-11 pr-11 text-base outline-none ring-1 ring-transparent transition placeholder:text-zinc-500 focus:bg-white focus:ring-2 focus:ring-brand/60"
        />
        {typed && (
          <button type="button" onClick={() => setTyped('')} aria-label="Limpar" className="absolute right-1.5 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full text-zinc-500 active:bg-zinc-200">
            <Icon name="x" size={18} />
          </button>
        )}
      </form>

      {!started && !searching && (
        <button
          type="button"
          onClick={() => {
            setStarted(true);
            locate();
          }}
          className="mt-4 flex w-full items-center gap-3 rounded-2xl bg-gradient-to-r from-rose-50 to-amber-50 px-4 py-3.5 text-left ring-1 ring-rose-100 transition active:scale-[0.99]"
        >
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand text-white shadow-sm">
            <Icon name="locate" size={22} strokeWidth={2.2} />
          </span>
          <span>
            <span className="block font-bold text-zinc-900">Usar a minha localização</span>
            <span className="block text-sm text-zinc-600">Vê o que há por perto</span>
          </span>
        </button>
      )}

      {!searching && (
        <>
          <button
            type="button"
            onClick={() => setMapOpen(true)}
            className="mt-3 flex w-full items-center gap-3 rounded-2xl bg-zinc-100 px-4 py-3 text-left transition active:scale-[0.99]"
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white shadow-sm" aria-hidden><Icon name="map" size={20} /></span>
            <span className="min-w-0 flex-1 font-semibold">Procurar no mapa</span>
            <span aria-hidden className="text-zinc-400">›</span>
          </button>
          {(hot.data?.length ?? 0) > 0 && (
            <div className="mt-4">
              <p className="mb-2 text-sm font-semibold text-zinc-500">A bater agora</p>
              <ul className="-mx-5 flex gap-2 overflow-x-auto px-5 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {hot.data!.map((h) => (
                  <li key={h.name} className="shrink-0">
                    <button type="button" onClick={() => pick(h.name)} className="flex items-center gap-1.5 rounded-full bg-amber-50 px-3.5 py-2 text-sm font-semibold ring-1 ring-amber-200 active:scale-95">
                      <Icon name="flame" size={14} className="mr-1 inline align-[-2px]" />{h.name} <span className="text-xs font-bold text-amber-700">{h.posts}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}

      {searching ? (
        <ul className="mt-2" aria-live="polite">
          <Row o={{ label: `Usar “${text}”`, sub: 'Escrever à mão', icon: 'pencil' }} onPick={() => pick(text)} />
          {found.isFetching && suggestions.length === 0 && <li><Skeleton /></li>}
          {suggestions.map((o, i) => (
            <Row key={`${o.label}-${i}`} o={o} onPick={() => pick(fullName(o))} />
          ))}
          {!found.isFetching && debounced === text && suggestions.length === 0 && (
            <li className="px-1 py-3 text-sm text-zinc-500">Nada com esse nome. Podes usar o que escreveste.</li>
          )}
        </ul>
      ) : (
        <>
          {started && (status === 'locating' || status === 'searching') && (
            <>
              <p className="mt-4 text-sm font-semibold text-zinc-500">{status === 'locating' ? 'A apanhar o teu sinal…' : 'A ver o que há por perto…'}</p>
              <Skeleton />
            </>
          )}
          {started && status === 'error' && (
            <div role="alert" className="py-6 text-center text-zinc-700">
              <p>{msg}</p>
              <button type="button" onClick={locate} className="mt-3 rounded-full bg-rose-50 px-5 py-2 font-semibold text-brand active:scale-95">Tentar outra vez</button>
            </div>
          )}
          {started && status === 'ready' && nearby.length === 0 && <p className="py-6 text-center text-zinc-600">Não encontrei nada por perto. Escreve o sítio acima.</p>}
          {status === 'ready' && nearby.length > 0 && (
            <>
              <p className="mb-1 mt-4 text-sm font-semibold text-zinc-500">Perto de ti</p>
              <ul>
                {nearby.map((o, i) => (
                  <Row key={`${o.label}-${i}`} o={o} onPick={() => pick(data?.area && o.label !== data.area && o.sub?.includes('·') ? `${o.label}, ${data.area}` : o.label)} />
                ))}
              </ul>
            </>
          )}
        </>
      )}
      </div>
      {mapOpen && (
        <Suspense fallback={null}>
          <PlaceMap start={at} onPick={pick} onClose={() => setMapOpen(false)} />
        </Suspense>
      )}
    </Sheet>
  );
}
