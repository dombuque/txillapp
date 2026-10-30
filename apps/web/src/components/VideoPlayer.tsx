import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { track } from '../lib/analytics';
import Icon from './Icon';

// Som, como no Instagram: nos Reels o som vem ligado por omissão; no feed os vídeos começam sem som. Quando a pessoa liga ou
// desliga o som uma vez, fica assim em todos os vídeos. Os navegadores só deixam tocar com som depois de um toque: até lá
// o vídeo toca sem som (para nunca ficar parado) e o som liga-se sozinho no primeiro toque.
const KEY = 'txill_sound';
let pref: 'on' | 'off' | null = (() => {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'on' || v === 'off' ? v : null;
  } catch {
    return null;
  }
})();
let activated = typeof navigator !== 'undefined' && (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation?.hasBeenActive === true;
const subs = new Set<() => void>();
const notify = () => subs.forEach((f) => f());
if (typeof window !== 'undefined' && !activated) {
  const onTouch = () => {
    activated = true;
    notify();
    for (const ev of ['pointerdown', 'touchend', 'keydown', 'click']) window.removeEventListener(ev, onTouch, true);
  };
  for (const ev of ['pointerdown', 'touchend', 'keydown', 'click']) window.addEventListener(ev, onTouch, true);
}
export const setMuted = (m: boolean) => {
  pref = m ? 'off' : 'on';
  try {
    localStorage.setItem(KEY, pref);
  } catch {
    /* sem armazenamento: só vale nesta sessão */
  }
  notify();
};
/** Sem som? `reels`: o padrão é com som. Antes do primeiro toque no ecrã nunca há som (o navegador não deixa). */
const mutedFor = (reels: boolean) => !activated || (pref === null ? !reels : pref === 'off');
/** `pref`: o que a pessoa escolheu (para o ícone do botão); o som real só liga depois do primeiro toque. */
export const useMuted = (reels = false) => useSyncExternalStore((cb) => (subs.add(cb), () => subs.delete(cb)), () => (pref === null ? !reels : pref === 'off'));
const useEffectiveMuted = (reels: boolean) => useSyncExternalStore((cb) => (subs.add(cb), () => subs.delete(cb)), () => mutedFor(reels));

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
  const reels = active !== undefined;
  const isMuted = useMuted(reels); // a escolha da pessoa (ícone)
  const silent = useEffectiveMuted(reels); // o que o aparelho deixa tocar agora
  const [playing, setPlaying] = useState(false);
  const [userPaused, setUserPaused] = useState(false);
  const [flash, setFlash] = useState<null | 'play' | 'pause'>(null);
  const [visible, setVisible] = useState(typeof document === 'undefined' || document.visibilityState === 'visible');
  const [failed, setFailed] = useState(false);
  const watch = useRef({ started: 0, total: 0 });

  // Feed: toca quando ≥ 60% está visível.
  useEffect(() => {
    if (active !== undefined || !box.current || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([e]) => setPlaying(e.isIntersecting && e.intersectionRatio >= 0.6), { threshold: [0, 0.6, 1] });
    io.observe(box.current);
    return () => io.disconnect();
  }, [active]);
  // Fora de cena volta a tocar desde o início sem a pausa anterior.
  useEffect(() => {
    if (active === false) setUserPaused(false);
  }, [active]);
  // Separador/app em segundo plano: pára; ao voltar, continua.
  useEffect(() => {
    const f = () => setVisible(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', f);
    return () => document.removeEventListener('visibilitychange', f);
  }, []);
  const shouldPlay = (active ?? playing) && visible && !userPaused;

  // O som segue o que o aparelho deixa (muda sozinho no primeiro toque).
  useEffect(() => {
    if (ref.current) ref.current.muted = silent;
  }, [silent]);

  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    if (shouldPlay) {
      v.muted = silent;
      // Nunca fica parado: se o navegador recusar com som, toca sem som (e o som liga no primeiro toque).
      v.play().catch(() => {
        v.muted = true;
        v.play().catch(() => undefined);
      });
      if (!watch.current.started) watch.current.started = Date.now();
    } else {
      v.pause();
      if (watch.current.started) {
        watch.current.total += Date.now() - watch.current.started;
        watch.current.started = 0;
      }
      if (active === false) v.currentTime = 0; // Reels: volta ao início quando sai de cena
    }
  }, [shouldPlay, active]); // eslint-disable-line react-hooks/exhaustive-deps

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
    <div
      ref={box}
      className={`relative overflow-hidden bg-black ${className}`}
      style={cover ? undefined : { aspectRatio: ratio, maxHeight: '32rem' }}
      onClick={
        reels
          ? () => {
              // Como no Instagram: tocar no vídeo pausa e retoma.
              setUserPaused((p) => !p);
              setFlash(userPaused ? 'play' : 'pause');
              setTimeout(() => setFlash(null), 700);
            }
          : undefined
      }
    >
      <video
        ref={ref}
        src={src}
        poster={poster}
        muted={silent}
        autoPlay={active === undefined ? undefined : active}
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
      {flash && (
        <span className="pointer-events-none absolute inset-0 flex items-center justify-center" aria-hidden>
          <span className="flex h-20 w-20 animate-[pop_.5s_ease-out] items-center justify-center rounded-full bg-black/45 text-white backdrop-blur-sm">
            <Icon name={flash === 'pause' ? 'pause' : 'play'} size={38} fill="currentColor" />
          </span>
        </span>
      )}
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
