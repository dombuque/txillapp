import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { tr } from '../lib/i18n';
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

/**
 * iPhone: um <video> com som aparece no "A tocar" do ecrã de bloqueio, como se fosse um leitor de música.
 * As redes sociais evitam-no passando o som pelo Web Audio: o vídeo fica só imagem e o áudio sai por aqui.
 * Só para vídeos do nosso domínio (sem CORS) e se algo falhar, o vídeo toca como antes.
 */
let audioCtx: AudioContext | null = null;
const routed = new WeakSet<HTMLVideoElement>();
const isIOS = typeof navigator !== 'undefined' && (/iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));
function routeAudio(v: HTMLVideoElement) {
  if (!isIOS || routed.has(v) || !v.currentSrc.startsWith(location.origin)) return;
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    audioCtx ??= new Ctx();
    audioCtx.createMediaElementSource(v).connect(audioCtx.destination);
    routed.add(v);
  } catch {
    /* sem Web Audio: toca como antes */
  }
  void audioCtx?.resume().catch(() => undefined);
}

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
  /** Reels: em vez de repetir sem fim, o vídeo termina e pergunta se se quer ver mais (ou rever). */
  onMore?: () => void;
}

/** Vídeo curto: toca sozinho quando está à vista, sem som; toca-se para ligar/desligar o som. */
export default function VideoPlayer({ src, poster, durationMs, width, height, active, cover = false, className = '', onProgress, id, onMore }: Props) {
  const [ended, setEnded] = useState(false);
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
    if (active === false) {
      setUserPaused(false);
      setEnded(false);
    }
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
    const v = ref.current;
    if (!v) return;
    v.muted = silent;
    if (!silent) routeAudio(v);
  }, [silent]);

  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    if (shouldPlay) {
      v.muted = silent;
      if (!silent) routeAudio(v);
      else void audioCtx?.resume().catch(() => undefined);
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
        loop={!onMore}
        onEnded={onMore ? () => setEnded(true) : undefined}
        playsInline
        disablePictureInPicture
        disableRemotePlayback
        x-webkit-airplay="deny"
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
      {ended && onMore && (
        // Fim do reel, como no Instagram: não repete sozinho, deixa escolher.
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-black/70 px-8 text-center text-white backdrop-blur-sm" onClick={(e) => e.stopPropagation()}>
          <p className="text-xl font-extrabold">{tr('Queres ver mais?')}</p>
          <button type="button" onClick={() => { setEnded(false); onMore(); }} className="h-12 w-full max-w-[240px] rounded-full bg-brand font-bold active:scale-95">{tr('Ver mais reels')}</button>
          <button
            type="button"
            onClick={() => {
              const v = ref.current;
              setEnded(false);
              if (v) { v.currentTime = 0; void v.play().catch(() => undefined); }
            }}
            className="h-11 w-full max-w-[240px] rounded-full bg-white/15 font-semibold active:scale-95"
          >{tr('Ver outra vez')}</button>
        </div>
      )}
      {failed && <p className="absolute inset-0 flex items-center justify-center px-6 text-center text-sm text-white/80">{tr('Não consegui carregar este vídeo.')}</p>}
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
