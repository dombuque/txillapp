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
        <svg
          width="26"
          height="26"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#d6334f"
          strokeWidth="2.4"
          strokeLinecap="round"
          className={busy ? 'animate-spin' : ''}
          style={busy ? undefined : { transform: `rotate(${Math.min(pull / TRIGGER, 1) * 270}deg)`, opacity: Math.min(pull / 40, 1) }}
        >
          <path d="M12 3a9 9 0 1 0 9 9" />
          {ready && !busy && <path d="M12 3l3-2M12 3l3 2" />}
        </svg>
        {busy && <span className="sr-only">A atualizar…</span>}
      </div>
      {children}
    </div>
  );
}
