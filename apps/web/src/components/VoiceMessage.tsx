import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent, type PointerEvent } from 'react';
import { tr } from '../lib/i18n';
import type { ChatMessage } from '../lib/api';
import Icon from './Icon';

const BARS = 42;
const RATES = [1, 1.5, 2];
const mmss = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}`;

/** Só um áudio toca de cada vez, e a velocidade escolhida vale para todos (fica guardada no aparelho). */
let current: HTMLAudioElement | null = null;
let rate = (() => {
  try {
    const r = Number(localStorage.getItem('txill.voice-rate'));
    return RATES.includes(r) ? r : 1;
  } catch {
    return 1;
  }
})();
const subs = new Set<() => void>();
const useRate = () => useSyncExternalStore((cb) => (subs.add(cb), () => subs.delete(cb)), () => rate);
function nextRate() {
  rate = RATES[(RATES.indexOf(rate) + 1) % RATES.length];
  try {
    localStorage.setItem('txill.voice-rate', String(rate));
  } catch {
    /* sem armazenamento: não faz mal */
  }
  if (current) current.playbackRate = rate;
  subs.forEach((f) => f());
}

/** Alturas das barras (0..1): a onda medida na gravação ou, em mensagens antigas, uma onda estável feita a partir do id. */
function shape(m: Pick<ChatMessage, 'id' | 'waveform'>): number[] {
  const out: number[] = [];
  if (m.waveform && m.waveform.length >= 8) {
    const w = m.waveform;
    for (let i = 0; i < BARS; i++) {
      const a = Math.floor((i * w.length) / BARS);
      const b = Math.max(a + 1, Math.floor(((i + 1) * w.length) / BARS));
      let sum = 0;
      for (let k = a; k < b; k++) sum += Number(w[k]);
      out.push(0.16 + 0.84 * (sum / (b - a) / 9));
    }
    return out;
  }
  let seed = [...m.id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 17);
  for (let i = 0; i < BARS; i++) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    out.push(0.2 + 0.8 * Math.abs(Math.sin(i * 0.55 + (seed % 100) / 40)) * (0.45 + (seed % 55) / 100));
  }
  return out;
}

/**
 * Mensagem de voz: tocar/pausar, onda real, arrastar na onda (ou setas do teclado) para avançar ou recuar, velocidade 1×/1,5×/2×
 * e tempo. Só toca uma de cada vez.
 */
export default function VoiceMessage({ m }: { m: ChatMessage }) {
  const mine = m.fromMe;
  const audio = useRef<HTMLAudioElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const pendingSeek = useRef<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [at, setAt] = useState(0); // ms
  const [len, setLen] = useState(m.durationMs ?? 0);
  const [scrub, setScrub] = useState(false);
  const [failed, setFailed] = useState(false);
  const speed = useRate();
  const heights = useMemo(() => shape(m), [m.id, m.waveform]); // eslint-disable-line react-hooks/exhaustive-deps
  const frac = len ? Math.min(1, at / len) : 0;

  useEffect(() => {
    const a = audio.current;
    return () => {
      a?.pause();
      if (current === a) current = null;
    };
  }, []);

  function toggle() {
    const a = audio.current;
    if (!a) return;
    if (playing) return a.pause();
    if (current && current !== a) current.pause();
    current = a;
    a.playbackRate = rate;
    setFailed(false);
    void a.play().catch(() => setFailed(true));
  }

  /** Vai para a posição (0..1) da onda. Se o ficheiro ainda não carregou, guarda o pedido e aplica quando carregar. */
  function seekTo(f: number) {
    const a = audio.current;
    const ms = Math.round(Math.max(0, Math.min(1, f)) * len);
    setAt(ms);
    if (!a) return;
    if (a.readyState >= 1) a.currentTime = ms / 1000;
    else {
      pendingSeek.current = ms / 1000;
      a.load();
    }
  }
  const fromPointer = (e: PointerEvent) => {
    const r = track.current?.getBoundingClientRect();
    if (r && r.width) seekTo((e.clientX - r.left) / r.width);
  };
  const onKey = (e: KeyboardEvent) => {
    const step = e.key === 'ArrowRight' ? 5000 : e.key === 'ArrowLeft' ? -5000 : 0;
    if (step && len) {
      e.preventDefault();
      seekTo((at + step) / len);
    }
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      toggle();
    }
  };

  // Este leitor tem os seus próprios toques: não deixa abrir o menu de carregar-e-segurar da mensagem.
  const stop = { onPointerDown: (e: PointerEvent) => e.stopPropagation() };
  // Pílula limpa: a parte já ouvida enche a onda; o resto fica esbatido.
  const played = mine ? 'bg-white' : 'bg-zinc-900';
  const rest = mine ? 'bg-white/35' : 'bg-zinc-300';
  const shown = playing || scrub || at > 0 ? at : len;

  return (
    <div className={`flex w-[264px] max-w-full items-center gap-2.5 rounded-full py-1.5 pl-1.5 pr-3.5 ${mine ? 'bg-brand text-white' : 'bg-zinc-100 text-zinc-900'}`}>
      <audio
        ref={audio}
        src={m.mediaUrl ?? undefined}
        preload="metadata"
        onLoadedMetadata={(e) => {
          const d = e.currentTarget.duration;
          if (Number.isFinite(d) && d > 0 && !m.durationMs) setLen(Math.round(d * 1000));
          if (pendingSeek.current !== null) {
            e.currentTarget.currentTime = pendingSeek.current;
            pendingSeek.current = null;
          }
        }}
        onTimeUpdate={(e) => !scrub && setAt(e.currentTarget.currentTime * 1000)}
        onEnded={() => {
          setPlaying(false);
          setAt(0);
          if (current === audio.current) current = null;
        }}
        onPause={() => setPlaying(false)}
        onPlay={() => setPlaying(true)}
        onError={() => setFailed(true)}
      />
      <button
        type="button"
        {...stop}
        onClick={toggle}
        aria-label={playing ? 'Pausar' : 'Ouvir mensagem de voz'}
        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition active:scale-90 ${mine ? 'bg-white text-brand' : 'bg-zinc-900 text-white'}`}
      >
        <Icon name={playing ? 'pause' : 'play'} size={19} fill="currentColor" />
      </button>

      <div
        ref={track}
        role="slider"
        tabIndex={0}
        aria-label={tr('Posição da mensagem de voz')}
        aria-valuemin={0}
        aria-valuemax={Math.round(len / 1000)}
        aria-valuenow={Math.round(at / 1000)}
        aria-valuetext={`${mmss(at)} de ${mmss(len)}`}
        onKeyDown={onKey}
        onPointerDown={(e) => {
          e.stopPropagation();
          e.currentTarget.setPointerCapture(e.pointerId);
          setScrub(true);
          fromPointer(e);
        }}
        onPointerMove={(e) => scrub && fromPointer(e)}
        onPointerUp={() => setScrub(false)}
        onPointerCancel={() => setScrub(false)}
        className="relative flex h-10 min-w-0 flex-1 cursor-pointer touch-none items-center gap-[2px]"
      >
        {heights.map((h, i) => {
          const done = (i + 0.5) / BARS <= frac;
          const now = playing && Math.abs((i + 0.5) / BARS - frac) < 1 / BARS; // a barra do momento "respira"
          return (
            <span
              key={i}
              className={`shrink-0 rounded-full transition-[height,background-color] duration-150 ${done ? played : rest}`}
              style={{ width: 2.5, height: `${Math.round((now ? Math.min(1, h + 0.18) : h) * 100)}%`, flex: '1 1 0', minWidth: 2 }}
            />
          );
        })}
        {scrub && <span aria-hidden className={`absolute top-1/2 h-4 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full ${mine ? 'bg-white' : 'bg-zinc-900'}`} style={{ left: `${frac * 100}%` }} />}
      </div>

      <div className="flex w-11 shrink-0 flex-col items-end leading-none">
        <span className={`text-[12px] font-semibold tabular-nums ${mine ? 'text-white/90' : 'text-zinc-600'}`}>{failed ? '!' : mmss(shown)}</span>
        {(playing || at > 0 || speed !== 1) && (
          <button
            type="button"
            {...stop}
            onClick={nextRate}
            aria-label={tr('Velocidade {v0}×. Tocar para mudar', { v0: speed })}
            className={`mt-1 rounded-full px-1.5 py-[2px] text-[10px] font-extrabold tabular-nums transition active:scale-90 ${mine ? 'bg-white/25 text-white' : 'bg-white text-zinc-700 shadow-sm'}`}
          >
            {speed === 1 ? '1×' : `${speed}×`}
          </button>
        )}
      </div>
    </div>
  );
}
