import { useEffect, useRef, useState } from 'react';
import { api, type Track } from '../lib/api';
import { tr } from '../lib/i18n';
import Icon from './Icon';
import { Sheet } from './ui';

const mmss = (ms: number | null) => (ms ? `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}` : '');
export const licenseLabel = (l: string) => (l === 'cc0' ? 'CC0' : l === 'pdm' ? tr('Domínio público') : `CC ${l.toUpperCase()}`);

/** Escolher uma faixa de música de licença aberta (Creative Commons): pesquisa, ouve-se um pedaço e usa-se. O crédito do autor segue com a faixa. */
export default function MusicPicker({ onPick, onClose }: { onPick: (t: Track) => void; onClose: () => void }) {
  const [term, setTerm] = useState('');
  const [items, setItems] = useState<Track[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [playing, setPlaying] = useState<string | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);

  // Procura meio segundo depois de parares de escrever.
  useEffect(() => {
    const q = term.trim();
    if (q.length < 2) {
      setItems(null);
      return;
    }
    const t = setTimeout(async () => {
      setBusy(true);
      setErr('');
      try {
        setItems(await api.searchMusic(q));
      } catch (e) {
        setErr((e as Error).message);
        setItems([]);
      }
      setBusy(false);
    }, 500);
    return () => clearTimeout(t);
  }, [term]);

  // Pára o som ao sair.
  useEffect(() => () => audio.current?.pause(), []);

  function toggle(t: Track) {
    if (playing === t.id) {
      audio.current?.pause();
      setPlaying(null);
      return;
    }
    audio.current?.pause();
    const a = new Audio(t.url);
    a.volume = 0.8;
    a.onended = () => setPlaying(null);
    a.onerror = () => {
      setPlaying(null);
      setErr(tr('Não consegui tocar'));
    };
    audio.current = a;
    setPlaying(t.id);
    void a.play().catch(() => setPlaying(null));
  }

  return (
    <Sheet title={tr('Música e sons')} onClose={onClose} layer="z-[70]">
      <label className="flex h-11 items-center gap-2 rounded-full bg-zinc-100 px-4 text-zinc-500 focus-within:bg-zinc-200/70">
        <Icon name="search" size={18} />
        <input value={term} onChange={(e) => setTerm(e.target.value)} autoFocus placeholder={tr('Procurar música ou sons')} aria-label={tr('Procurar música ou sons')} className="min-w-0 flex-1 bg-transparent text-[16px] text-zinc-900 outline-none placeholder:text-zinc-500" />
      </label>
      <p className="mt-2 text-xs text-zinc-500">{tr('Só músicas e sons de licença aberta (Creative Commons), com o crédito de quem os fez. Para a música do momento, ainda não há licença.')}</p>
      {err && <p role="alert" className="mt-2 text-sm text-red-600">{err}</p>}
      <ul className="mt-3 max-h-[46dvh] overflow-y-auto">
        {busy && <li className="py-6 text-center text-zinc-500">{tr('A procurar…')}</li>}
        {!busy && items?.length === 0 && !err && <li className="py-6 text-center text-zinc-500">{tr('Nada com esse nome')}</li>}
        {!busy &&
          items?.map((t) => (
            <li key={t.id} className="flex items-center gap-3 py-2">
              <button type="button" onClick={() => toggle(t)} aria-label={playing === t.id ? tr('Parar') : tr('Ouvir')} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand text-white active:scale-95">
                <Icon name={playing === t.id ? 'pause' : 'play'} size={18} fill="currentColor" />
              </button>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold">{t.title}</span>
                <span className="block truncate text-sm text-zinc-500">{t.artist || tr('Autor desconhecido')} · {licenseLabel(t.license)}{t.durationMs ? ` · ${mmss(t.durationMs)}` : ''}</span>
              </span>
              <button type="button" onClick={() => { audio.current?.pause(); onPick(t); }} className="h-9 shrink-0 rounded-full bg-zinc-100 px-4 text-sm font-bold active:scale-95">{tr('Usar')}</button>
            </li>
          ))}
      </ul>
    </Sheet>
  );
}
