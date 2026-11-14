/**
 * O relógio partilhado da pré-visualização nativa: as contas estão em lib/studio/previewClock.ts; aqui está o ciclo
 * (requestAnimationFrame) e quem o ouve. Cada leitor (vídeos, música, voz-off, camadas, linha do tempo) subscreve e põe-se
 * no sítio sozinho, sem fazer desenhar o estúdio inteiro a cada frame.
 *
 * O que tem de andar liso frame a frame (o zoom das fotos, as transições, o ritmo dos vídeos da Skia) não ouve os tiques:
 * lê a âncora (`anchor`/`onAnchor`, que só muda ao tocar, pausar, saltar ou mudar a duração) e faz as contas no fio da
 * interface (`useStageTime` em NativeStage.tsx).
 */
import { clockEnded, clockPause, clockPlay, clockResize, clockSeek, clockTime, makeClock, type Clock, type ClockAnchor } from '@/lib/studio/previewClock';

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
  /** O relógio para o fio da interface (muda só ao tocar, pausar, saltar ou mudar a duração). */
  anchor(): ClockAnchor;
  /** Avisa quando a âncora muda (não a cada frame). */
  onAnchor(fn: (a: ClockAnchor) => void): () => void;
  dispose(): void;
}

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export function createClockStore(total: number): ClockStore {
  let c: Clock = makeClock(total, now());
  const subs = new Set<ClockListener>();
  const anchorSubs = new Set<(a: ClockAnchor) => void>();
  let anchor: ClockAnchor = { playing: false, base: 0, wall: Date.now(), total: c.total };
  /** O relógio mudou de estado (ou não): a âncora de parede (`Date.now`) no mesmo instante, só quando muda de facto. */
  const reanchor = () => {
    const wall = Date.now();
    const a: ClockAnchor = { playing: c.playing, base: clockTime(c, now()), wall, total: c.total };
    const expected = anchor.playing ? anchor.base + (wall - anchor.wall) / 1000 : anchor.base;
    if (a.playing === anchor.playing && a.total === anchor.total && Math.abs(a.base - Math.min(expected, anchor.total)) < 0.004) return;
    anchor = a;
    for (const f of anchorSubs) f(a);
  };
  const emit = () => { reanchor(); const t = clockTime(c, now()); for (const f of subs) f(t, c.playing); };
  let raf: number | null = null;
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
    anchor: () => anchor,
    onAnchor(fn) { anchorSubs.add(fn); fn(anchor); return () => { anchorSubs.delete(fn); }; },
    dispose() { subs.clear(); anchorSubs.clear(); if (raf !== null) cancelAnimationFrame(raf); raf = null; c = { ...c, playing: false }; },
  };
}
