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
  const on = mine ? 'bg-white' : 'bg-brand';
  const off = mine ? 'bg-white/40' : 'bg-zinc-300';

  return (
    <div className={`flex w-[272px] max-w-full items-center gap-2.5 rounded-[20px] px-3 py-2.5 ${mine ? 'rounded-br-md bg-brand text-white' : 'rounded-bl-md bg-zinc-100 text-zinc-900'}`}>
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
        className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition active:scale-90 ${mine ? 'bg-white/25' : 'bg-white shadow-sm'}`}
      >
        <Icon name={playing ? 'pause' : 'play'} size={22} fill="currentColor" />
      </button>

      <div className="min-w-0 flex-1">
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
          className="relative flex h-9 cursor-pointer touch-none items-center gap-[2px]"
        >
          {heights.map((h, i) => (
            <span key={i} className={`w-[3px] shrink-0 rounded-full ${(i + 0.5) / BARS <= frac ? on : off}`} style={{ height: `${Math.round(h * 100)}%`, flex: '1 1 0' }} />
          ))}
          <span
            aria-hidden
            className={`absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full shadow transition-transform ${mine ? 'bg-white' : 'bg-brand'} ${scrub ? 'scale-125' : ''}`}
            style={{ left: `${frac * 100}%` }}
          />
        </div>
        <div className={`mt-0.5 flex items-center justify-between text-xs tabular-nums ${mine ? 'text-white/85' : 'text-zinc-500'}`}>
          <span>{failed ? 'Não consegui tocar' : mmss(playing || scrub || at > 0 ? at : len)}</span>
          {(playing || at > 0) && len > 0 && <span>{mmss(len)}</span>}
        </div>
      </div>

      <button
        type="button"
        {...stop}
        onClick={nextRate}
        aria-label={`Velocidade ${speed}×. Tocar para mudar`}
        className={`flex h-8 min-w-[2.6rem] shrink-0 items-center justify-center rounded-full px-2 text-xs font-extrabold tabular-nums transition active:scale-90 ${mine ? 'bg-white/25 text-white' : 'bg-white text-zinc-700 shadow-sm'}`}
      >
        {speed === 1 ? '1×' : `${speed}×`}
      </button>
    </div>
  );
}
