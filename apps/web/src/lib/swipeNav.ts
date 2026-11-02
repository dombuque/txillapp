import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { DESKTOP_QUERY } from './useDesktop';

/** Separadores principais, pela ordem da barra de baixo (o "+" não conta: abrir a publicar a deslizar seria estranho). */
const TABS = ['/', '/reels', '/messages', '/profile'];

/** Lado de onde o próximo ecrã entra (definido pelo gesto, gasto uma vez por quem anima). */
let incoming: 'left' | 'right' | null = null;
export const takeSlide = () => {
  const d = incoming;
  incoming = null;
  return d;
};
/** Classe da animação de entrada para o ecrã atual (vazia se não veio de um deslize). */
export const slideClass = (d: 'left' | 'right' | null) => (d === 'right' ? 'animate-[slide-from-right_.24s_ease-out]' : d === 'left' ? 'animate-[slide-from-left_.24s_ease-out]' : '');

/** O gesto começou num sítio que já usa deslizes ou escrita (carrossel, stories, texto, folhas abertas)? */
function busy(start: EventTarget | null) {
  for (let el = start as HTMLElement | null; el && el !== document.body; el = el.parentElement) {
    if (el.matches?.('input, textarea, select, [contenteditable], [role="dialog"], [data-no-swipe]')) return true;
    if (el.scrollWidth > el.clientWidth + 2 && /(auto|scroll)/.test(getComputedStyle(el).overflowX)) return true;
  }
  return false;
}

/** Deslizar para os lados nos ecrãs principais muda de separador (sem dar a volta: nas pontas não passa; no Início, para a direita, abre a câmara), com o ecrã novo a entrar desse lado. Só no telemóvel. */
export function useSwipeTabs() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  useEffect(() => {
    const here = TABS.indexOf(pathname);
    if (here < 0) return;
    let s: { x: number; y: number; t: number } | null = null;
    const down = (e: TouchEvent) => {
      const t = e.touches[0];
      const edge = 24; // a margem é do gesto de voltar do iPhone
      const ok = e.touches.length === 1 && t.clientX > edge && t.clientX < window.innerWidth - edge && !busy(e.target) && !window.matchMedia(DESKTOP_QUERY).matches;
      s = ok ? { x: t.clientX, y: t.clientY, t: Date.now() } : null;
    };
    const up = (e: TouchEvent) => {
      if (!s) return;
      const t = e.changedTouches[0];
      const dx = t.clientX - s.x;
      const dy = t.clientY - s.y;
      const quick = Date.now() - s.t < 700;
      s = null;
      if (!quick || Math.abs(dx) < 70 || Math.abs(dx) < Math.abs(dy) * 1.8) return;
      const next = here + (dx < 0 ? 1 : -1);
      // Sem voltas: no fim da direita não passa. No Início, deslizar para a direita abre a câmara (como tocar no "+").
      if (next < 0) {
        if (pathname === '/') {
          incoming = 'left';
          navigate('/new');
        }
        return;
      }
      if (next >= TABS.length) return;
      incoming = dx < 0 ? 'right' : 'left';
      navigate(TABS[next]);
    };
    const cancel = () => (s = null);
    document.addEventListener('touchstart', down, { passive: true });
    document.addEventListener('touchend', up, { passive: true });
    document.addEventListener('touchcancel', cancel, { passive: true });
    return () => {
      document.removeEventListener('touchstart', down);
      document.removeEventListener('touchend', up);
      document.removeEventListener('touchcancel', cancel);
    };
  }, [pathname, navigate]);
}
