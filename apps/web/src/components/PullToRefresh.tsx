import { PontoLoader } from './Loading';
import Icon from './Icon';
import { useEffect, useRef, useState, type ReactNode } from 'react';

const TRIGGER = 76;

/**
 * Puxar para atualizar, como nas apps: no topo da página, arrasta para baixo e solta.
 * O "elástico" do browser está desligado (index.css), por isso o gesto é nosso.
 */
export default function PullToRefresh({ onRefresh, children }: { onRefresh: () => Promise<unknown> | void; children: ReactNode }) {
  const [pull, setPull] = useState(0);
  const [busy, setBusy] = useState(false);
  const start = useRef<number | null>(null);
  const pullRef = useRef(0);
  const refresh = useRef(onRefresh);
  refresh.current = onRefresh;

  useEffect(() => {
    const down = (e: TouchEvent) => {
      start.current = window.scrollY <= 0 && e.touches.length === 1 ? e.touches[0].clientY : null;
    };
    const move = (e: TouchEvent) => {
      if (start.current === null) return;
      const dy = e.touches[0].clientY - start.current;
      if (dy <= 0 || window.scrollY > 0) {
        pullRef.current = 0;
        setPull(0);
        return;
      }
      pullRef.current = Math.min(dy * 0.5, 110); // resistência
      setPull(pullRef.current);
    };
    const up = async () => {
      const reached = pullRef.current >= TRIGGER;
      start.current = null;
      pullRef.current = 0;
      setPull(0);
      if (!reached) return;
      setBusy(true);
      try {
        await refresh.current();
      } finally {
        setBusy(false);
      }
    };
    window.addEventListener('touchstart', down, { passive: true });
    window.addEventListener('touchmove', move, { passive: true });
    window.addEventListener('touchend', up);
    window.addEventListener('touchcancel', up);
    return () => {
      window.removeEventListener('touchstart', down);
      window.removeEventListener('touchmove', move);
      window.removeEventListener('touchend', up);
      window.removeEventListener('touchcancel', up);
    };
  }, []);

  const shown = busy ? 48 : pull;
  const ready = pull >= TRIGGER;
  return (
    <div className="relative" style={{ transform: shown ? `translateY(${shown}px)` : undefined, transition: pull ? 'none' : 'transform .2s ease-out' }}>
      <div className="pointer-events-none absolute inset-x-0 -top-10 flex h-10 items-center justify-center" aria-hidden={!busy} role={busy ? 'status' : undefined}>
        {busy ? (
          <PontoLoader size={16} label="A atualizar" />
        ) : (
          <span
            className="block h-4 w-4 rounded-full bg-brand"
            style={{ opacity: Math.min(pull / 40, 1), transform: `scale(${0.4 + Math.min(pull / TRIGGER, 1) * (ready ? 1.3 : 0.9)})`, transition: 'transform .12s' }}
          />
        )}
      </div>
      {children}
    </div>
  );
}
