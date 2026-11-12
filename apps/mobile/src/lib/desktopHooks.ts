import { useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { finePointer, isTypingTarget, overlayOpen, viewerKey, wheelStep, type ViewerKey } from './desktopKeys';

/**
 * Teclas de um visor aberto (web com teclado). `on` liga e desliga; os handlers são lidos na hora (sem voltar a ligar).
 * Não apanha quando se escreve (responder ao mimo) nem quando há outra camada por cima (`blocked`).
 */
export function useViewerKeys(on: boolean, handlers: Partial<Record<ViewerKey, () => void>>, blocked?: () => boolean) {
  const ref = useRef({ handlers, blocked });
  ref.current = { handlers, blocked };
  useEffect(() => {
    if (!on || Platform.OS !== 'web' || typeof window === 'undefined') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || isTypingTarget(e.target as HTMLElement)) return;
      if (ref.current.blocked?.()) return;
      const k = viewerKey(e);
      const fn = k ? ref.current.handlers[k] : undefined;
      if (!fn) return;
      e.preventDefault();
      fn();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [on]);
}


/**
 * Tchekas no computador (lista vertical de vídeos): ↑/↓ e a roda do rato passam à anterior/seguinte, uma de cada vez;
 * o espaço muda `pauseSignal` (a tcheka em cena pausa ou continua) e ←/→ mudam `seekSignal` (recua ou avança 5 s).
 * Devolve a ref a pôr na View à volta da lista.
 * No telemóvel não liga nada (só com rato: `(hover: hover) and (pointer: fine)`).
 */
export function useDeskReels(on: boolean, active: () => number, goTo: (index: number) => void) {
  const fns = useRef({ active, goTo });
  fns.current = { active, goTo };
  const [pauseSignal, setPauseSignal] = useState(0);
  const [seekSignal, setSeekSignal] = useState({ n: 0, by: 0 });
  const [el, setEl] = useState<HTMLElement | null>(null);
  const ref = useRef((node: unknown) => setEl(node && typeof (node as HTMLElement).addEventListener === 'function' ? (node as HTMLElement) : null)).current;
  const wheel = useRef({ acc: 0, until: 0 });
  const mouse = on && finePointer();
  useViewerKeys(mouse, {
    up: () => fns.current.goTo(fns.current.active() - 1),
    down: () => fns.current.goTo(fns.current.active() + 1),
    pause: () => setPauseSignal((n) => n + 1),
    prev: () => setSeekSignal((s) => ({ n: s.n + 1, by: -5 })),
    next: () => setSeekSignal((s) => ({ n: s.n + 1, by: 5 })),
  }, overlayOpen);
  useEffect(() => {
    if (!mouse || !el) return;
    const st = wheel.current;
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || overlayOpen() || Math.abs(e.deltaY) < Math.abs(e.deltaX)) return;
      e.preventDefault();
      const d = wheelStep(st, e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY, Date.now());
      if (d) fns.current.goTo(fns.current.active() + d);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [mouse, el]);
  return { ref, pauseSignal, seekSignal };
}
