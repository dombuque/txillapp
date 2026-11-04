import { useRef, useState, type ReactNode, type TouchEvent } from 'react';
import { tr } from '../lib/i18n';
import { useNavigate } from 'react-router-dom';
import { BackIcon } from './icons';

/**
 * Página própria em ecrã inteiro (como a Atividade do Instagram): seta de voltar e título no topo,
 * sem a barra de navegação de baixo. Para ecrãs a que se "entra" e de onde se "volta".
 */
export default function StackPage({ title, children }: { title: string; children: ReactNode }) {
  const navigate = useNavigate();
  // Arrastar para a direita volta atrás (como o gesto de voltar do iPhone). Não conta sobre carrosséis, campos de texto e janelas abertas.
  const t = useRef<{ x: number; y: number; ok: boolean } | null>(null);
  const [dx, setDx] = useState(0);
  const back = () => (window.history.length > 1 ? navigate(-1) : navigate('/', { replace: true }));
  const start = (e: TouchEvent) => {
    const el = e.target as Element;
    // Também a partir da margem esquerda (como o gesto de voltar do iPhone), mesmo por cima de fotos e vídeos.
    const edge = e.touches[0].clientX < 28;
    const ok = !el.closest('[aria-modal="true"],input,textarea,select,[role="slider"]') && (edge || !el.closest('[class*="snap-x"],video,[data-swipe]'));
    t.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, ok };
  };
  const move = (e: TouchEvent) => {
    const s = t.current;
    if (!s || !s.ok) return;
    const mx = e.touches[0].clientX - s.x;
    const my = e.touches[0].clientY - s.y;
    if (mx > 12 && mx > Math.abs(my) * 1.8) setDx(Math.min(mx, 160));
    else if (Math.abs(my) > 14) s.ok = false;
  };
  const end = (e: TouchEvent) => {
    const s = t.current;
    t.current = null;
    const moved = s?.ok ? e.changedTouches[0].clientX - s.x : 0;
    setDx(0);
    if (s?.ok && moved > 90) {
      navigator.vibrate?.(8);
      back();
    }
  };
  return (
    <div className="mx-auto min-h-dvh max-w-xl bg-white pb-8" onTouchStart={start} onTouchMove={move} onTouchEnd={end} style={{ transform: dx ? `translateX(${dx * 0.5}px)` : undefined, transition: dx ? 'none' : 'transform .18s ease-out' }}>
      <header className="sticky top-[env(safe-area-inset-top)] z-10 flex items-center gap-1 border-b border-zinc-100 bg-white px-2 py-2">
        <button
          onClick={back}
          aria-label={tr('Voltar')}
          className="flex h-11 w-11 items-center justify-center rounded-full text-zinc-900 transition active:bg-zinc-100"
        >
          <BackIcon />
        </button>
        <h1 className="text-[20px] font-extrabold">{title}</h1>
      </header>
      {children}
    </div>
  );
}
