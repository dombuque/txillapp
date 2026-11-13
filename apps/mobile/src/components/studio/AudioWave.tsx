import { createElement, useEffect, useRef, useState, type ReactNode } from 'react';
import { StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import { peaks, suggestStart, type StartMode, type StartSuggestion } from '@/lib/studio/audioMix';
import { colors } from '@/lib/theme';

const dom = createElement as (tag: string, props?: Record<string, unknown>, ...kids: unknown[]) => ReactNode;
const CORAL = colors.brand;
/** Picos por segundo guardados da música (chega para a faixa a qualquer zoom do estúdio). */
const PPS = 40;
const HEIGHT = 76;

export interface MusicAnalysis {
  url: string;
  duration: number;
  /** A onda, `PPS` valores por segundo. */
  peaks: number[];
  /** O trecho sugerido para cada maneira de escolher (calcula-se quando é preciso). */
  suggest: (windowS: number, mode?: StartMode) => StartSuggestion;
}

/**
 * Lê a música (o AudioBuffer que o estúdio já descodificou) e prepara a onda e as sugestões do trecho. `onReady` corre
 * quando há análise nova (para a sugestão automática).
 */
export function useMusicAnalysis(url: string | null, load: () => Promise<AudioBuffer | null>, onReady?: (a: MusicAnalysis) => void): MusicAnalysis | null {
  const [a, setA] = useState<MusicAnalysis | null>(null);
  const ready = useRef(onReady);
  ready.current = onReady;
  useEffect(() => {
    if (!url) { setA(null); return; }
    if (a?.url === url) return;
    let off = false;
    setA(null);
    void (async () => {
      const buf = await load().catch(() => null);
      if (off || !buf) return;
      const ch = buf.getChannelData(0);
      const n = Math.min(Math.ceil(buf.duration * PPS), 40_000);
      const cache = new Map<string, StartSuggestion>();
      const out: MusicAnalysis = {
        url,
        duration: buf.duration,
        peaks: peaks(ch, n),
        suggest: (w, mode = 'forte') => {
          const k = `${mode}:${Math.round(w * 2)}`;
          let s = cache.get(k);
          if (!s) { s = suggestStart(ch, buf.sampleRate, w, mode); cache.set(k, s); }
          return s;
        },
      };
      setA(out);
      ready.current?.(out);
    })();
    return () => { off = true; };
  }, [url]); // eslint-disable-line react-hooks/exhaustive-deps
  return a;
}

const mmss = (s: number) => { const v = Math.max(0, Math.floor(s)); return `${Math.floor(v / 60)}:${String(v % 60).padStart(2, '0')}`; };

/**
 * Escolher o trecho da música pela onda (como no TikTok, mas com a onda verdadeira): a faixa arrasta-se por baixo de uma
 * janela fixa do tamanho da tcheka. Enquanto se arrasta ouve-se dali (`onScrub`); ao largar fica (`onCommit`). Setas do
 * teclado: ±1 s (com Shift, ±5 s). Mostra a sugestão (refrão ou parte mais forte) e onde a pré-visualização vai.
 */
export function AudioWave({ analysis, startMs, windowS, playT, suggestion, onScrub, onScrubEnd, onCommit, disabled }: {
  analysis: MusicAnalysis;
  startMs: number;
  windowS: number;
  /** O instante da pré-visualização (s) ou null se não estiver a tocar. */
  playT: number | null;
  suggestion: StartSuggestion | null;
  onScrub: (startS: number) => void;
  onScrubEnd: () => void;
  onCommit: (startMs: number) => void;
  disabled?: boolean;
}) {
  const [w, setW] = useState(0);
  const [drag, setDrag] = useState<number | null>(null);
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const dur = analysis.duration;
  const win = Math.max(1, Math.min(windowS, dur));
  const maxStart = Math.max(0, dur - win);
  const start = Math.min(maxStart, Math.max(0, drag ?? startMs / 1000));
  // A janela ocupa 60% da faixa, ao centro; a escala sai daí (nunca com mais de 90 px por segundo).
  const winPx = w * 0.6;
  const pps = winPx > 0 ? Math.min(90, winPx / win) : 1;
  const winW = win * pps;
  const left = (w - winW) / 2;
  const gesture = useRef<{ x: number; s: number; id: number } | null>(null);

  useEffect(() => {
    const c = canvas.current;
    const g = c?.getContext('2d');
    if (!c || !g || !w) return;
    const dpr = typeof window !== 'undefined' ? Math.min(3, window.devicePixelRatio || 1) : 1;
    if (c.width !== Math.round(w * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(HEIGHT * dpr); }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, HEIGHT);
    const mid = HEIGHT / 2 + 4;
    const bar = 3, gap = 2;
    const grad = g.createLinearGradient(left, 0, left + winW, 0);
    grad.addColorStop(0, '#ff6b81');
    grad.addColorStop(0.5, CORAL);
    grad.addColorStop(1, '#ff9f6b');
    for (let x = 0; x < w; x += bar + gap) {
      // O instante da faixa debaixo deste píxel.
      const t = start + (x - left) / pps;
      if (t < 0 || t > dur) continue;
      const i0 = Math.floor(t * PPS), i1 = Math.max(i0 + 1, Math.floor((t + (bar + gap) / pps) * PPS));
      let p = 0;
      for (let i = i0; i < i1 && i < analysis.peaks.length; i++) p = Math.max(p, analysis.peaks[i]);
      const h = Math.max(2, p * (HEIGHT - 26));
      const inside = x + bar > left && x < left + winW;
      g.fillStyle = inside ? grad : 'rgba(255,255,255,0.22)';
      g.beginPath();
      (g as CanvasRenderingContext2D & { roundRect?: (x: number, y: number, w: number, h: number, r: number) => void }).roundRect?.(x, mid - h / 2, bar, h, 1.5);
      g.fill();
    }
    // A sugestão: um losango coral em cima, no sítio dela.
    if (suggestion) {
      const sx = left + (suggestion.start - start) * pps;
      if (sx > -6 && sx < w + 6) {
        g.fillStyle = '#ffd60a';
        g.beginPath(); g.moveTo(sx, 4); g.lineTo(sx + 4, 8); g.lineTo(sx, 12); g.lineTo(sx - 4, 8); g.closePath(); g.fill();
        g.fillRect(sx - 0.5, 12, 1, HEIGHT - 16);
      }
    }
    // Onde a pré-visualização vai.
    if (playT !== null && drag === null) {
      const px = left + Math.min(win, playT) * pps;
      g.fillStyle = '#fff';
      g.fillRect(px - 1, 14, 2, HEIGHT - 20);
    }
  }, [w, start, pps, winW, left, analysis, suggestion, playT, drag, dur, win]);

  const commit = (s: number) => onCommit(Math.round(Math.min(maxStart, Math.max(0, s)) * 1000));
  const handlers = disabled ? {} : {
    onPointerDown: (e: PointerEvent) => {
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
      gesture.current = { x: e.clientX, s: start, id: e.pointerId };
      setDrag(start);
      onScrub(start);
    },
    onPointerMove: (e: PointerEvent) => {
      const gs = gesture.current;
      if (!gs || gs.id !== e.pointerId) return;
      const s = Math.min(maxStart, Math.max(0, gs.s - (e.clientX - gs.x) / pps));
      setDrag(s);
      onScrub(s);
    },
    onPointerUp: (e: PointerEvent) => {
      const gs = gesture.current;
      if (!gs || gs.id !== e.pointerId) return;
      gesture.current = null;
      const s = Math.min(maxStart, Math.max(0, gs.s - (e.clientX - gs.x) / pps));
      setDrag(null);
      onScrubEnd();
      commit(s);
    },
    onPointerCancel: () => { gesture.current = null; setDrag(null); onScrubEnd(); },
    onKeyDown: (e: KeyboardEvent) => {
      const step = e.shiftKey ? 5 : 1;
      if (e.key === 'ArrowRight') { e.preventDefault(); commit(start + step); } else if (e.key === 'ArrowLeft') { e.preventDefault(); commit(start - step); } else if (e.key === 'Home') { e.preventDefault(); commit(0); }
    },
  };

  return (
    <View style={st.wrap} onLayout={(e: LayoutChangeEvent) => setW(Math.round(e.nativeEvent.layout.width))}>
      <View style={st.head}>
        <Text style={st.range}>{mmss(start)} a {mmss(start + win)}</Text>
        <Text style={st.hint}>{drag !== null ? 'A ouvir daqui…' : 'Arrasta a onda para escolher o trecho'}</Text>
      </View>
      {dom('div', {
        role: 'slider',
        tabIndex: disabled ? -1 : 0,
        'aria-label': 'Início do trecho da música',
        'aria-valuemin': 0,
        'aria-valuemax': Math.round(maxStart),
        'aria-valuenow': Math.round(start),
        'aria-valuetext': `Começa aos ${mmss(start)}`,
        'aria-disabled': disabled || undefined,
        ...handlers,
        style: { position: 'relative', height: HEIGHT, touchAction: 'none', cursor: disabled ? 'default' : drag !== null ? 'grabbing' : 'grab', userSelect: 'none', outline: 'none', borderRadius: 14, overflow: 'hidden', background: 'linear-gradient(180deg, rgba(255,255,255,0.05), rgba(255,255,255,0.02))' },
      },
      dom('canvas', { ref: (el: HTMLCanvasElement | null) => { canvas.current = el; }, style: { width: '100%', height: HEIGHT, display: 'block' } }),
      w ? dom('div', { style: { position: 'absolute', top: 2, bottom: 2, left, width: winW, borderRadius: 12, border: `2px solid ${CORAL}`, boxShadow: `0 0 18px rgba(214,51,79,0.55), inset 0 0 22px rgba(214,51,79,0.18)`, pointerEvents: 'none' } },
        dom('div', { style: { position: 'absolute', left: -2, top: '50%', width: 6, height: 26, marginTop: -13, borderRadius: 3, background: CORAL } }),
        dom('div', { style: { position: 'absolute', right: -2, top: '50%', width: 6, height: 26, marginTop: -13, borderRadius: 3, background: CORAL } }),
      ) : null,
      )}
      <View style={st.foot}>
        <Text style={st.small}>0:00</Text>
        <View style={st.mini}>
          <View style={[st.miniWin, { left: `${(start / Math.max(0.1, dur)) * 100}%`, width: `${Math.max(2, (win / Math.max(0.1, dur)) * 100)}%` }]} />
          {suggestion ? <View style={[st.miniStar, { left: `${(suggestion.start / Math.max(0.1, dur)) * 100}%` }]} /> : null}
        </View>
        <Text style={st.small}>{mmss(dur)}</Text>
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  wrap: { marginHorizontal: 16, marginTop: 8 },
  head: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 4 },
  range: { color: '#fff', fontSize: 15, fontWeight: '800', fontVariant: ['tabular-nums'] },
  hint: { color: 'rgba(255,255,255,0.55)', fontSize: 14 },
  foot: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 },
  small: { color: 'rgba(255,255,255,0.5)', fontSize: 14, fontVariant: ['tabular-nums'] },
  mini: { flex: 1, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.14)' },
  miniWin: { position: 'absolute', top: 0, bottom: 0, borderRadius: 2, backgroundColor: CORAL },
  miniStar: { position: 'absolute', top: -2, width: 8, height: 8, marginLeft: -4, borderRadius: 4, backgroundColor: '#ffd60a' },
});
