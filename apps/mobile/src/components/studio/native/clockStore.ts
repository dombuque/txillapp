/**
 * O relógio partilhado da pré-visualização nativa: as contas estão em lib/studio/previewClock.ts; aqui está o ciclo
 * (requestAnimationFrame) e quem o ouve. Cada leitor (vídeos, música, voz-off, camadas, linha do tempo) subscreve e põe-se
 * no sítio sozinho, sem fazer desenhar o estúdio inteiro a cada frame.
 */
import { clockEnded, clockPause, clockPlay, clockResize, clockSeek, clockTime, makeClock, type Clock } from '@/lib/studio/previewClock';

export type ClockListener = (t: number, playing: boolean) => void;
export interface ClockStore {
  time(): number;
  playing(): boolean;
  total(): number;
  play(from?: number): void;
  pause(): void;
  toggle(): void;
  seek(t: number): void;
  resize(total: number): void;
  subscribe(fn: ClockListener): () => void;
  dispose(): void;
}

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export function createClockStore(total: number): ClockStore {
  let c: Clock = makeClock(total, now());
  const subs = new Set<ClockListener>();
  let raf: number | null = null;
  const emit = () => { const t = clockTime(c, now()); for (const f of subs) f(t, c.playing); };
  const loop = () => {
    raf = null;
    if (!c.playing) return;
    if (clockEnded(c, now())) { c = clockPause(clockSeek(c, now(), c.total), now()); emit(); return; }
    emit();
    raf = requestAnimationFrame(loop);
  };
  const run = () => { if (raf === null && c.playing) raf = requestAnimationFrame(loop); };
  return {
    time: () => clockTime(c, now()),
    playing: () => c.playing,
    total: () => c.total,
    play(from) { c = clockPlay(c, now(), from); emit(); run(); },
    pause() { if (!c.playing) return; c = clockPause(c, now()); emit(); },
    toggle() { if (c.playing) this.pause(); else this.play(); },
    seek(t) { c = clockSeek(c, now(), t); emit(); },
    resize(T) { if (Math.abs(T - c.total) < 1e-4) return; c = clockResize(c, now(), T); emit(); },
    subscribe(fn) { subs.add(fn); fn(clockTime(c, now()), c.playing); return () => { subs.delete(fn); }; },
    dispose() { subs.clear(); if (raf !== null) cancelAnimationFrame(raf); raf = null; c = { ...c, playing: false }; },
  };
}
