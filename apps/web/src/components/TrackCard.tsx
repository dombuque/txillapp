import { useEffect, useRef, useState } from 'react';
import type { Track } from '../lib/api';
import { tr } from '../lib/i18n';
import Icon from './Icon';
import { licenseLabel } from './MusicPicker';
import { Sheet } from './ui';

/** Silenciar a música: vale para posts e stories e fica guardado neste aparelho. */
export function useMusicMuted(): [boolean, () => void] {
  const [muted, setMuted] = useState(readMuted);
  useEffect(() => {
    const sync = () => setMuted(readMuted());
    window.addEventListener(MUTE_EVENT, sync);
    return () => window.removeEventListener(MUTE_EVENT, sync);
  }, []);
  return [
    muted,
    () => {
      try {
        localStorage.setItem(MUTE_KEY, readMuted() ? '0' : '1');
      } catch {
        /* sem armazenamento: vale só até fechar a app */
      }
      window.dispatchEvent(new Event(MUTE_EVENT));
    },
  ];
}

const MUTE_KEY = 'tx_music_muted';
const MUTE_EVENT = 'tx-music-muted';
const readMuted = () => {
  try {
    return localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
};
// Só uma música de cada vez, em toda a app.
let playing: { stop: () => void } | null = null;

/**
 * Leitor de uma faixa (nota ou post): toca/pára e mostra o crédito do autor e a licença (obrigatório nas licenças Creative Commons).
 * Com `autoplay` (posts), toca sozinha enquanto o post está à vista e pára quando sai; o botão do som silencia (fica guardado).
 */
export default function TrackCard({ track, autoplay = false }: { track: Track; autoplay?: boolean }) {
  const root = useRef<HTMLDivElement>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const [on, setOn] = useState(false);
  const [muted, setMuted] = useState(readMuted);
  const [info, setInfo] = useState(false);
  const userPaused = useRef(false); // pausaste à mão: não volta a tocar sozinha enquanto o post estiver à vista
  const visible = useRef(false);

  const stop = () => {
    audio.current?.pause();
    setOn(false);
    if (playing && playing.stop === stop) playing = null;
  };
  const stopRef = useRef(stop);
  stopRef.current = stop;

  function play() {
    if (playing && playing.stop !== stopRef.current) playing.stop();
    const a = audio.current ?? new Audio(track.url);
    a.loop = autoplay;
    a.muted = readMuted();
    a.onended = () => setOn(false);
    a.onerror = () => setOn(false);
    audio.current = a;
    playing = { stop: stopRef.current };
    setOn(true);
    // O browser pode recusar tocar sem toque prévio: fica à espera de um toque no botão.
    void a.play().catch(() => {
      setOn(false);
      if (playing?.stop === stopRef.current) playing = null;
    });
  }

  useEffect(() => () => {
    audio.current?.pause();
    if (playing?.stop === stopRef.current) playing = null;
  }, []);

  // Silenciar vale para todos os posts (e fica guardado).
  useEffect(() => {
    const sync = () => {
      const m = readMuted();
      setMuted(m);
      if (audio.current) audio.current.muted = m;
    };
    window.addEventListener(MUTE_EVENT, sync);
    return () => window.removeEventListener(MUTE_EVENT, sync);
  }, []);

  // Toca sozinha quando o post está bem à vista; pára quando sai ou a app vai para segundo plano.
  useEffect(() => {
    if (!autoplay || !root.current) return;
    const io = new IntersectionObserver(
      ([e]) => {
        visible.current = e.isIntersecting && e.intersectionRatio >= 0.6;
        if (visible.current) {
          if (userPaused.current || (audio.current && !audio.current.paused)) return;
          play();
        } else {
          userPaused.current = false;
          stopRef.current();
        }
      },
      { threshold: [0, 0.6] },
    );
    io.observe(root.current);
    const hide = () => document.visibilityState === 'hidden' && stopRef.current();
    const show = () => document.visibilityState === 'visible' && visible.current && !userPaused.current && play();
    document.addEventListener('visibilitychange', hide);
    document.addEventListener('visibilitychange', show);
    return () => {
      io.disconnect();
      document.removeEventListener('visibilitychange', hide);
      document.removeEventListener('visibilitychange', show);
    };
  }, [autoplay, track.url]); // eslint-disable-line react-hooks/exhaustive-deps

  function toggle() {
    if (on) {
      userPaused.current = true;
      stop();
    } else {
      userPaused.current = false;
      play();
    }
  }
  function toggleMute() {
    const next = !readMuted();
    try {
      localStorage.setItem(MUTE_KEY, next ? '1' : '0');
    } catch {
      /* sem armazenamento: vale só até fechar a app */
    }
    setMuted(next);
    if (audio.current) audio.current.muted = next;
    window.dispatchEvent(new Event(MUTE_EVENT));
  }

  return (
    <div ref={root} className="mt-3 flex items-center gap-3 rounded-2xl bg-zinc-50 p-3 text-left ring-1 ring-zinc-100">
      <button type="button" onClick={toggle} aria-label={on ? tr('Parar') : tr('Ouvir')} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand text-white active:scale-95">
        <Icon name={on ? 'pause' : 'play'} size={18} fill="currentColor" />
      </button>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-semibold">{track.title}</span>
        <span className="block truncate text-xs text-zinc-500">{track.kind === 'clip' ? tr('Áudio original') : track.artist || tr('Autor desconhecido')}</span>
      </span>
      {track.kind !== 'clip' && (
        <button type="button" onClick={() => setInfo(true)} aria-label={tr('Créditos da música')} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-zinc-500 active:bg-zinc-200"><Icon name="info" size={18} /></button>
      )}
      {autoplay && (
        <button type="button" onClick={toggleMute} aria-pressed={muted} aria-label={muted ? tr('Ativar o som') : tr('Silenciar')} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white text-zinc-700 ring-1 ring-zinc-200 active:scale-90">
          <Icon name={muted ? 'volume-off' : 'volume'} size={20} />
        </button>
      )}
      {info && <TrackCredits track={track} onClose={() => setInfo(false)} />}
    </div>
  );
}

/** Créditos da faixa (licença Creative Commons e origem). Ficam aqui, fora do cartão, mas sempre à mão. */
export function TrackCredits({ track, onClose }: { track: Track; onClose: () => void }) {
  return (
    <Sheet title={tr('Créditos da música')} onClose={onClose} layer="z-[95]">
      <p className="text-[17px] font-semibold">{track.title}</p>
      <p className="text-zinc-600">{track.artist || tr('Autor desconhecido')}</p>
      <p className="mt-3 text-sm text-zinc-600">
        {tr('Licença')}:{' '}
        {track.licenseUrl ? <a href={track.licenseUrl} target="_blank" rel="noopener noreferrer" className="font-semibold underline">{licenseLabel(track.license)}</a> : licenseLabel(track.license)}
      </p>
      {track.landing && <p className="mt-1 text-sm"><a href={track.landing} target="_blank" rel="noopener noreferrer" className="font-semibold underline">{tr('Origem')}</a></p>}
    </Sheet>
  );
}
