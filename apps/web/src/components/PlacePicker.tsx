import { useState } from 'react';
import { api, type NearbyPlaces } from '../lib/api';
import { Sheet, fieldInput } from './ui';

const emoji: Record<string, string> = { praia: '🏖️', bar: '🍻', restaurante: '🍽️', lazer: '🌳', turismo: '📸', local: '📍' };

type Status = 'idle' | 'locating' | 'searching' | 'ready' | 'error';
export interface PlacePickerProps {
  value: string;
  onChange: (v: string) => void;
}

/** Hook com a lógica de localização, usado pelo botão "Local" da publicação. */
export function usePlaces() {
  const [status, setStatus] = useState<Status>('idle');
  const [data, setData] = useState<NearbyPlaces | null>(null);
  const [msg, setMsg] = useState('');

  function locate() {
    setMsg('');
    if (!('geolocation' in navigator)) {
      setStatus('error');
      return setMsg('Este dispositivo não sabe dizer onde estás 🤷 Escreve à mão.');
    }
    setStatus('locating');
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        setStatus('searching');
        try {
          setData(await api.nearbyPlaces(pos.coords.latitude, pos.coords.longitude));
          setStatus('ready');
        } catch {
          setStatus('error');
          setMsg('Não consegui procurar sítios agora 😅 Escreve à mão.');
        }
      },
      (err) => {
        setStatus('error');
        setMsg(
          err.code === err.PERMISSION_DENIED
            ? 'Sem permissão de localização 🙈 Ativa-a no browser ou escreve à mão.'
            : 'Não consegui apanhar o teu sinal 📡 Tenta outra vez ou escreve à mão.',
        );
      },
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 60_000 },
    );
  }
  return { status, data, msg, locate };
}

/** "Adicionar local" como no Instagram/Facebook: sugestões perto de ti, ou escreve à mão. Só o nome escolhido é guardado. */
export default function PlaceSheet({ value, onChange, onClose }: PlacePickerProps & { onClose: () => void }) {
  const { status, data, msg, locate } = usePlaces();
  const [typed, setTyped] = useState(value);
  const [started, setStarted] = useState(false);

  const options: { label: string; sub?: string; icon: string }[] = [];
  if (data) {
    for (const p of data.places) {
      const d = p.distanceM < 1000 ? `${p.distanceM} m` : `${(p.distanceM / 1000).toFixed(1)} km`;
      options.push({ label: p.name, sub: `${d}${data.area ? ` · ${data.area}` : ''}`, icon: emoji[p.kind] ?? '📍' });
    }
    if (data.area) options.push({ label: data.area, sub: data.city ?? undefined, icon: '🏘️' });
    if (data.city && data.city !== data.area) options.push({ label: data.city, icon: '🏙️' });
  }
  const pick = (label: string) => {
    onChange(label);
    onClose();
  };

  return (
    <Sheet title="Onde estás? 📍" onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (typed.trim()) pick(typed.trim());
        }}
        className="flex gap-2"
      >
        <input value={typed} onChange={(e) => setTyped(e.target.value)} maxLength={80} placeholder="Escreve um sítio…" aria-label="Local" className={fieldInput} />
        <button disabled={!typed.trim()} className="rounded-full bg-brand px-5 font-semibold text-white disabled:opacity-40">
          OK
        </button>
      </form>

      {!started && (
        <button
          type="button"
          onClick={() => {
            setStarted(true);
            locate();
          }}
          className="mt-4 flex w-full items-center gap-3 rounded-2xl bg-rose-50 px-4 py-3.5 text-left font-semibold text-brand active:scale-[0.99]"
        >
          <span className="text-2xl">📍</span> Usar a minha localização
        </button>
      )}
      {started && status === 'locating' && <p className="py-6 text-center text-zinc-600">A apanhar o teu sinal… 📡</p>}
      {started && status === 'searching' && <p className="py-6 text-center text-zinc-600">A ver o que há por perto… 🔎</p>}
      {started && status === 'error' && <p role="alert" className="py-6 text-center text-zinc-700">{msg}</p>}
      {started && status === 'ready' && options.length === 0 && (
        <p className="py-6 text-center text-zinc-600">Não encontrei nada por perto 🤔 Escreve o sítio acima.</p>
      )}
      {status === 'ready' && options.length > 0 && (
        <>
          <p className="mb-1 mt-5 text-sm font-semibold text-zinc-500">Perto de ti</p>
          <ul>
            {options.map((o, i) => (
              <li key={`${o.label}-${i}`}>
                <button
                  type="button"
                  onClick={() => pick(data?.area && o.label !== data.area && o.sub?.includes('·') ? `${o.label}, ${data.area}` : o.label)}
                  className="flex w-full items-center gap-3 rounded-xl py-3 text-left active:bg-zinc-100"
                >
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-2xl" aria-hidden>{o.icon}</span>
                  <span className="min-w-0">
                    <span className="block truncate font-semibold">{o.label}</span>
                    {o.sub && <span className="block truncate text-sm text-zinc-500">{o.sub}</span>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      <p className="mt-4 text-xs text-zinc-500">🔒 Só guardamos o nome do sítio que escolheres, nunca a tua posição exacta.</p>
    </Sheet>
  );
}
