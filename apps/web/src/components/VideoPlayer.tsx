import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { track } from '../lib/analytics';
import Icon from './Icon';

// Som: os vídeos começam sempre sem som (os browsers só deixam tocar assim sozinhos). Se a pessoa liga o som uma vez,
// fica ligado nos vídeos seguintes, como no Instagram.
const KEY = 'txill_sound';
let muted = (() => {
  try {
    return localStorage.getItem(KEY) !== 'on';
  } catch {
    return true;
  }
})();
const subs = new Set<() => void>();
export const setMuted = (m: boolean) => {
  muted = m;
  try {
    localStorage.setItem(KEY, m ? 'off' : 'on');
  } catch {
    /* sem armazenamento: só vale nesta sessão */
  }
  subs.forEach((f) => f());
};
export const useMuted = () => useSyncExternalStore((cb) => (subs.add(cb), () => subs.delete(cb)), () => muted);

const mmss = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}`;

interface Props {
  src: string;
  poster?: string;
  durationMs?: number | null;
  width?: number | null;
  height?: number | null;
  /** Se definido, manda: toca quando verdadeiro (Reels). Se não, toca quando está visível no ecrã (feed). */
  active?: boolean;
  /** Cobre o ecrã todo (Reels) em vez de manter a proporção. */
  cover?: boolean;
  className?: string;
  onProgress?: (fraction: number) => void;
  id?: string;
}

/** Vídeo curto: toca sozinho quando está à vista, sem som; toca-se para ligar/desligar o som. */
export default function VideoPlayer({ src, poster, durationMs, width, height, active, cover = false, className = '', onProgress, id }: Props) {
  const ref = useRef<HTMLVideoElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const isMuted = useMuted();
  const [playing, setPlaying] = useState(false);
  const [failed, setFailed] = useState(false);
  const watch = useRef({ started: 0, total: 0 });

  // Feed: toca quando ≥ 60% está visível.
  useEffect(() => {
    if (active !== undefined || !box.current || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([e]) => setPlaying(e.isIntersecting && e.intersectionRatio >= 0.6), { threshold: [0, 0.6, 1] });
    io.observe(box.current);
    return () => io.disconnect();
  }, [active]);
  const shouldPlay = active ?? playing;

  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    if (shouldPlay) {
      v.play().catch(() => undefined); // sem permissão de som/auto-play: fica parado na capa
      watch.current.started = Date.now();
    } else {
      v.pause();
      if (watch.current.started) {
        watch.current.total += Date.now() - watch.current.started;
        watch.current.started = 0;
      }
      if (active === false) v.currentTime = 0; // Reels: volta ao início quando sai de cena
    }
  }, [shouldPlay, active]);

  // Quanto tempo se viu (para as estatísticas), ao sair.
  useEffect(
    () => () => {
      const ms = watch.current.total + (watch.current.started ? Date.now() - watch.current.started : 0);
      if (ms > 1500) track('video_view', { ms: Math.round(ms), of: durationMs ?? 0, id: id ?? '' });
    },
    [durationMs, id],
  );

  const ratio = width && height ? `${width} / ${height}` : '9 / 16';
  return (
    <div ref={box} className={`relative overflow-hidden bg-black ${className}`} style={cover ? undefined : { aspectRatio: ratio, maxHeight: '32rem' }}>
      <video
        ref={ref}
        src={src}
        poster={poster}
        muted={isMuted}
        loop
        playsInline
        disablePictureInPicture
        disableRemotePlayback
        controlsList="nodownload noremoteplayback"
        preload={active === false ? 'none' : 'metadata'}
        onTimeUpdate={(e) => onProgress?.(e.currentTarget.duration ? e.currentTarget.currentTime / e.currentTarget.duration : 0)}
        onError={() => setFailed(true)}
        className={`h-full w-full ${cover ? 'object-contain' : 'object-cover'}`}
      />
      {failed && <p className="absolute inset-0 flex items-center justify-center px-6 text-center text-sm text-white/80">Não consegui carregar este vídeo.</p>}
      {durationMs ? <span className="pointer-events-none absolute bottom-3 left-3 rounded-full bg-black/60 px-2.5 py-0.5 text-xs font-semibold text-white">{mmss(durationMs)}</span> : null}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setMuted(!isMuted);
        }}
        aria-label={isMuted ? 'Ligar o som' : 'Desligar o som'}
        className="absolute bottom-2.5 right-3 flex h-9 w-9 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur-sm active:scale-90"
      >
        <Icon name={isMuted ? 'volume-off' : 'volume'} size={18} />
      </button>
    </div>
  );
}
