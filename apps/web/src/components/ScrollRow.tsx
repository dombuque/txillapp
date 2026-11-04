import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { tr } from '../lib/i18n';

/**
 * Fila que se desliza na horizontal (chips, atalhos): no telemóvel é o deslize normal; no computador também se arrasta com o rato,
 * a roda do rato anda para os lados, e aparecem setas nas pontas quando há mais para ver. Não puxa a página ao chegar ao fim.
 */
export default function ScrollRow({ children, className = '', label }: { children: ReactNode; className?: string; label?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [edge, setEdge] = useState({ left: false, right: false });
  const drag = useRef<{ x: number; start: number; moved: boolean } | null>(null);

  // Só no computador (rato): no telemóvel o deslize é todo nativo, sem JavaScript a cada frame.
  const fine = typeof window !== 'undefined' && window.matchMedia('(pointer: fine)').matches;
  const measure = useCallback(() => {
    const el = box.current;
    if (!el || !fine) return;
    const left = el.scrollLeft > 4;
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 4;
    setEdge((e) => (e.left === left && e.right === right ? e : { left, right }));
  }, [fine]);

  useEffect(() => {
    const el = box.current;
    if (!el || !fine) return;
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    // A roda vertical do rato anda para os lados quando há mais para ver (só se não for já um gesto horizontal).
    const wheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaX) >= Math.abs(e.deltaY) || el.scrollWidth <= el.clientWidth) return;
      const atStart = el.scrollLeft <= 0 && e.deltaY < 0;
      const atEnd = el.scrollLeft + el.clientWidth >= el.scrollWidth - 1 && e.deltaY > 0;
      if (atStart || atEnd) return; // nos extremos a página continua a andar
      e.preventDefault();
      el.scrollLeft += e.deltaY;
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => {
      ro.disconnect();
      el.removeEventListener('wheel', wheel);
    };
  }, [measure, fine]);

  const by = (dir: 1 | -1) => box.current?.scrollBy({ left: dir * Math.max(160, (box.current?.clientWidth ?? 300) * 0.7), behavior: 'smooth' });
  const arrow = 'absolute top-0 z-10 hidden h-10 w-9 items-center justify-center bg-white/95 text-zinc-900 shadow-sm md:flex';

  return (
    <div className="relative">
      {edge.left && <button type="button" onClick={() => by(-1)} aria-label={tr('Para trás')} className={`${arrow} left-0 rounded-r-full`}>‹</button>}
      <div
        ref={box}
        role="presentation"
        aria-label={label}
        onScroll={fine ? measure : undefined}
        onPointerDown={(e) => {
          // Só com o rato (no toque, o navegador já desliza sozinho).
          if (e.pointerType !== 'mouse' || e.button !== 0) return;
          drag.current = { x: e.clientX, start: box.current?.scrollLeft ?? 0, moved: false };
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d || !box.current) return;
          const dx = e.clientX - d.x;
          if (Math.abs(dx) > 4) d.moved = true;
          if (d.moved) box.current.scrollLeft = d.start - dx;
        }}
        onPointerUp={() => { window.setTimeout(() => { drag.current = null; }, 0); }}
        onPointerLeave={() => { drag.current = null; }}
        // Se arrastou, o clique no fim não conta como escolha de um chip.
        onClickCapture={(e) => { if (drag.current?.moved) { e.preventDefault(); e.stopPropagation(); } }}
        className={`overflow-x-auto overscroll-x-contain [-webkit-overflow-scrolling:touch] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${className}`}
      >
        {children}
      </div>
      {edge.right && <button type="button" onClick={() => by(1)} aria-label={tr('Mais')} className={`${arrow} right-0 rounded-l-full`}>›</button>}
    </div>
  );
}
