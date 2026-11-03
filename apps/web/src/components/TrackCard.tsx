import { useEffect, useRef, useState } from 'react';
import type { Track } from '../lib/api';
import { MUSIC_MUTE_EVENT, isMuted, playTrack, setMusicMuted, stopTrack } from '../lib/musicPlayer';
import { tr } from '../lib/i18n';
import Icon from './Icon';
import { licenseLabel } from './MusicPicker';
import { Sheet } from './ui';

/** Silenciar a música: vale para posts e stories e fica guardado neste aparelho. */
export function useMusicMuted(): [boolean, () => void] {
  const [muted, setMuted] = useState(isMuted);
  useEffect(() => {
    const sync = () => setMuted(isMuted());
    window.addEventListener(MUSIC_MUTE_EVENT, sync);
    return () => window.removeEventListener(MUSIC_MUTE_EVENT, sync);
  }, []);
  return [muted, () => setMusicMuted(!isMuted())];
}

/**
 * Leitor de uma faixa (nota ou post): toca/pára. Com `autoplay` (posts), toca sozinha enquanto o post está à vista e pára quando sai.
 * O botão do som silencia (vale para tudo). Tocar no nome da música mostra os créditos e a licença, sem poluir o cartão.
 */
export default function TrackCard({ track, autoplay = false }: { track: Track; autoplay?: boolean }) {
  const root = useRef<HTMLDivElement>(null);
  const me = useRef(Symbol('track'));
  const [on, setOn] = useState(false);
  const [muted, toggleMute] = useMusicMuted();
  const [info, setInfo] = useState(false);
  const userPaused = useRef(false); // pausaste à mão: não volta a tocar sozinha enquanto o post estiver à vista
  const visible = useRef(false);
  const playing = useRef(false);

  async function play() {
    const ok = await playTrack(me.current, track.url, { loop: autoplay, onStop: () => { playing.current = false; setOn(false); } });
    playing.current = ok;
    setOn(ok);
  }
  // Sempre a versão mais recente (os observadores guardam a função antiga).
  const playRef = useRef(play);
  playRef.current = play;

  useEffect(() => () => stopTrack(me.current), []);

  // Toca sozinha quando o post está bem à vista; pára quando sai ou a app vai para segundo plano.
  useEffect(() => {
    if (!autoplay || !root.current) return;
    const io = new IntersectionObserver(
      ([e]) => {
        visible.current = e.isIntersecting && e.intersectionRatio >= 0.6;
        if (visible.current) {
          if (!userPaused.current && !playing.current) void playRef.current();
        } else {
          userPaused.current = false;
          stopTrack(me.current);
        }
      },
      { threshold: [0, 0.6] },
    );
    io.observe(root.current);
    const vis = () => {
      if (document.visibilityState === 'hidden') stopTrack(me.current);
      else if (visible.current && !userPaused.current && !playing.current) void playRef.current();
    };
    document.addEventListener('visibilitychange', vis);
    return () => {
      io.disconnect();
      document.removeEventListener('visibilitychange', vis);
    };
  }, [autoplay, track.url]);

  function toggle() {
    if (on) {
      userPaused.current = true;
      stopTrack(me.current);
    } else {
      userPaused.current = false;
      void play();
    }
  }

  return (
    <div ref={root} className="mt-3 flex items-center gap-3 rounded-2xl bg-zinc-50 p-3 text-left ring-1 ring-zinc-100">
      <button type="button" onClick={toggle} aria-label={on ? tr('Parar') : tr('Ouvir')} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand text-white active:scale-95">
        <Icon name={on ? 'pause' : 'play'} size={18} fill="currentColor" />
      </button>
      <button type="button" onClick={() => track.kind !== 'clip' && setInfo(true)} aria-label={tr('Créditos da música')} className="min-w-0 flex-1 text-left">
        <span className="block truncate font-semibold">{track.title}</span>
        <span className="block truncate text-xs text-zinc-500">{track.kind === 'clip' ? tr('Áudio original') : track.artist || tr('Autor desconhecido')}</span>
      </button>
      {autoplay && (
        <button type="button" onClick={toggleMute} aria-pressed={muted} aria-label={muted ? tr('Ativar o som') : tr('Silenciar')} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white text-zinc-700 ring-1 ring-zinc-200 active:scale-90">
          <Icon name={muted ? 'volume-off' : 'volume'} size={20} />
        </button>
      )}
      {info && <TrackCredits track={track} onClose={() => setInfo(false)} />}
    </div>
  );
}

/** Só ligações https viram links (defesa a mais: o servidor já recusa o resto). */
const safeHref = (u: string | null | undefined) => (u && /^https:\/\//i.test(u) ? u : null);

/** Créditos da faixa (licença Creative Commons e origem). Ficam fora do cartão, mas sempre à mão. */
export function TrackCredits({ track, onClose }: { track: Track; onClose: () => void }) {
  return (
    <Sheet title={tr('Créditos da música')} onClose={onClose} layer="z-[95]">
      <p className="text-[17px] font-semibold">{track.title}</p>
      <p className="text-zinc-600">{track.artist || tr('Autor desconhecido')}</p>
      <p className="mt-3 text-sm text-zinc-600">
        {tr('Licença')}:{' '}
        {safeHref(track.licenseUrl) ? <a href={safeHref(track.licenseUrl)!} target="_blank" rel="noopener noreferrer" className="font-semibold underline">{licenseLabel(track.license)}</a> : licenseLabel(track.license)}
      </p>
      {safeHref(track.landing) && <p className="mt-1 text-sm"><a href={safeHref(track.landing)!} target="_blank" rel="noopener noreferrer" className="font-semibold underline">{tr('Origem')}</a></p>}
    </Sheet>
  );
}
