import { useEffect, useRef, useState } from 'react';
import type { Track } from '../lib/api';
import { tr } from '../lib/i18n';
import Icon from './Icon';
import { licenseLabel } from './MusicPicker';

/** Leitor de uma faixa (nota ou post): toca/pára e mostra o crédito do autor e a licença (obrigatório nas licenças Creative Commons). */
export default function TrackCard({ track }: { track: Track }) {
  const audio = useRef<HTMLAudioElement | null>(null);
  const [on, setOn] = useState(false);
  useEffect(() => () => audio.current?.pause(), []);
  function toggle() {
    if (on) {
      audio.current?.pause();
      setOn(false);
      return;
    }
    const a = audio.current ?? new Audio(track.url);
    a.onended = () => setOn(false);
    a.onerror = () => setOn(false);
    audio.current = a;
    setOn(true);
    void a.play().catch(() => setOn(false));
  }
  return (
    <div className="mt-3 flex items-center gap-3 rounded-2xl bg-zinc-50 p-3 text-left ring-1 ring-zinc-100">
      <button type="button" onClick={toggle} aria-label={on ? tr('Parar') : tr('Ouvir')} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand text-white active:scale-95">
        <Icon name={on ? 'pause' : 'play'} size={18} fill="currentColor" />
      </button>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-semibold">{track.title}</span>
        <span className="block truncate text-xs text-zinc-500">
          {track.kind === 'clip' ? null : <>{track.artist || tr('Autor desconhecido')} ·{' '}</>}
          {track.licenseUrl ? <a href={track.licenseUrl} target="_blank" rel="noopener noreferrer" className="underline">{licenseLabel(track.license)}</a> : licenseLabel(track.license)}
          {track.landing && <> · <a href={track.landing} target="_blank" rel="noopener noreferrer" className="underline">{tr('Origem')}</a></>}
        </span>
      </span>
    </div>
  );
}

