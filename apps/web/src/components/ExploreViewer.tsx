import { useQueryClient } from '@tanstack/react-query';
import { tr } from '../lib/i18n';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Reel } from '../pages/Reels';
import type { Page, Post } from '../lib/api';
import { useVisualViewport, visibleStyle } from '../lib/useVisualViewport';
import Icon from './Icon';
import PostCard from './PostCard';
import { setMuted, useMuted } from './VideoPlayer';

/** Arrastar para baixo (quando está no topo) fecha: o ecrã acompanha o dedo e, passando de 110 px, sai. */
function useDragDown(scroller: React.RefObject<HTMLElement | null>, onClose: () => void) {
  const [drag, setDrag] = useState(0);
  const start = useRef<{ y: number; x: number } | null>(null);
  return {
    drag,
    handlers: {
      onTouchStart: (e: React.TouchEvent) => {
        const t = e.touches[0];
        start.current = e.touches.length === 1 && (scroller.current?.scrollTop ?? 0) <= 0 ? { y: t.clientY, x: t.clientX } : null;
      },
      onTouchMove: (e: React.TouchEvent) => {
        const s = start.current;
        if (!s) return;
        const dy = e.touches[0].clientY - s.y;
        const dx = Math.abs(e.touches[0].clientX - s.x);
        if (dy > 0 && dy > dx && (scroller.current?.scrollTop ?? 0) <= 0) setDrag(dy);
        else if (dy < 0) {
          start.current = null;
          setDrag(0);
        }
      },
      onTouchEnd: () => {
        if (drag > 110) onClose();
        setDrag(0);
        start.current = null;
      },
    },
  };
}

/**
 * Abre uma publicação do Explorar a sério (não numa folha): ecrã inteiro com seta de voltar.
 * Foto ou texto: só aquela publicação. Vídeo: como os Reels, desliza-se para cima para o seguinte.
 * Arrastar para baixo no topo (ou o voltar do telemóvel) fecha e volta ao Explorar.
 */
export default function ExploreViewer({ items, startId, onClose, title = 'Explorar' }: { items: Post[]; startId: string; onClose: () => void; title?: string }) {
  const start = items.find((p) => p.id === startId);
  const reels = start?.media[0]?.kind === 'video';
  // Publicação normal (foto ou texto): também em ecrã inteiro, com as ações na vertical à direita, como nos reels.
  const immersive = reels || start?.kind === 'post';
  // Vídeo: percorrem-se os vídeos do Explorar (desliza-se para cima para o seguinte). Foto ou texto: só aquela publicação.
  const list = reels ? items.filter((p) => p.media[0]?.kind === 'video') : items.filter((p) => p.id === startId);
  const qc = useQueryClient();
  const vv = useVisualViewport();
  const isMuted = useMuted(true);
  const scroller = useRef<HTMLDivElement>(null);
  const [activeId, setActiveId] = useState(startId);
  const { drag, handlers } = useDragDown(scroller, close);

  // O botão voltar do telemóvel fecha o visualizador (e não a página do Explorar).
  const pushed = useRef(false);
  useEffect(() => {
    window.history.pushState({ explore: true }, '');
    pushed.current = true;
    const pop = () => {
      pushed.current = false;
      onClose();
    };
    window.addEventListener('popstate', pop);
    return () => window.removeEventListener('popstate', pop);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  function close() {
    if (pushed.current) {
      pushed.current = false;
      window.history.back(); // dispara o popstate acima, que fecha
    } else onClose();
  }

  // Começa no que se tocou.
  useLayoutEffect(() => {
    const el = scroller.current;
    const target = el?.querySelector<HTMLElement>(`[data-id="${startId}"]`);
    if (el && target) el.scrollTop = target.offsetTop;
  }, [startId]);

  // Reels: o que ocupa mais de 70% do ecrã é o que toca.
  useEffect(() => {
    const el = scroller.current;
    if (!reels || !el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting && e.intersectionRatio >= 0.7) setActiveId((e.target as HTMLElement).dataset.id ?? startId);
      },
      { root: el, threshold: [0.7] },
    );
    el.querySelectorAll('[data-id]').forEach((n) => io.observe(n));
    return () => io.disconnect();
  }, [reels, list.length, startId]);

  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });

  const patch = (id: string, p: Partial<Post>) => {
    const merge = (i: Post): Post => (i.id === id ? { ...i, ...p } : i);
    qc.setQueriesData<{ pages: Page<Post>[] }>({ queryKey: ['explore'] }, (d) => d && { ...d, pages: d.pages.map((pg) => ({ ...pg, items: pg.items.map(merge) })) });
    qc.setQueriesData<Page<Post>>({ queryKey: ['explore-reels'] }, (d) => d && { ...d, items: d.items.map(merge) });
  };

  if (!start) return null;
  const shell = (children: ReactNode) => (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={reels ? 'Reels' : 'Publicação'}
      className={`fixed inset-0 z-[60] ${immersive ? 'bg-black' : 'bg-white'}`}
      style={{ ...visibleStyle(vv), transform: `translateY(${drag}px)`, transition: drag ? 'none' : 'transform .2s', opacity: Math.max(0.4, 1 - drag / 500) }}
      {...handlers}
    >
      {children}
    </div>
  );

  if (immersive) {
    return shell(
      <>
        <div ref={scroller} className="relative mx-auto h-full max-w-xl snap-y snap-mandatory overflow-y-scroll overscroll-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {list.map((p) => (
            <div key={p.id} data-id={p.id} className="h-full w-full snap-start snap-always">
              <Reel
                post={p}
                active={p.id === activeId}
                onChange={(c) => patch(p.id, c)}
                onMore={() => {
                  const next = list[list.findIndex((x) => x.id === p.id) + 1] ?? list[0];
                  scroller.current?.querySelector(`[data-id="${next.id}"]`)?.scrollIntoView({ behavior: 'smooth' });
                }}
              />
            </div>
          ))}
        </div>
        <div className="pointer-events-none absolute inset-x-0 top-0 mx-auto flex max-w-xl items-center justify-between px-3 pt-[max(0.75rem,env(safe-area-inset-top))] text-white">
          <button onClick={close} aria-label={tr('Voltar ao Explorar')} className="pointer-events-auto flex h-11 w-11 items-center justify-center rounded-full bg-black/35 backdrop-blur-sm active:scale-90"><Icon name="back" size={24} /></button>
          <span className="text-lg font-extrabold drop-shadow">{title}</span>
          {reels ? <button onClick={() => setMuted(!isMuted)} aria-label={isMuted ? 'Ligar o som' : 'Desligar o som'} className="pointer-events-auto flex h-11 w-11 items-center justify-center rounded-full bg-black/35 backdrop-blur-sm active:scale-90">
            <Icon name={isMuted ? 'volume-off' : 'volume'} size={22} />
          </button> : <span className="h-11 w-11" />}
        </div>
      </>,
    );
  }

  return shell(
    <div className="mx-auto flex h-full max-w-xl flex-col bg-white">
      <header className="flex shrink-0 items-center gap-1 border-b border-zinc-100 px-2 pb-2 pt-[max(0.5rem,env(safe-area-inset-top))]">
        <button onClick={close} aria-label={tr('Voltar ao Explorar')} className="flex h-11 w-11 items-center justify-center rounded-full active:bg-zinc-100"><Icon name="back" size={24} /></button>
        <h1 className="text-[20px] font-extrabold">{tr('Publicação')}</h1>
      </header>
      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-canvas pb-10 pt-3">
        {list.map((p) => (
          <div key={p.id} data-id={p.id}>
            <PostCard post={p} />
          </div>
        ))}
      </div>
    </div>,
  );
}
