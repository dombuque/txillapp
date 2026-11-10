import { usePathname, useRouter } from 'expo-router';
import { useEffect } from 'react';
import { Platform } from 'react-native';
import { decideSwipe, innerPager, isSwipeClaimed, navSwipeThreshold, resetSwipeClaim } from '@/lib/swipeClaim';

/** Separadores principais, pela ordem da barra de baixo (o "+" não conta: abrir a publicar a deslizar seria estranho). */
const TABS = ['/', '/reels', '/messages', '/profile'];

/** O gesto começou num sítio que já usa deslizes ou escrita (carrossel, stories, texto, folhas abertas)? */
function busy(start: EventTarget | null) {
  for (let el = start as HTMLElement | null; el && el !== document.body; el = el.parentElement) {
    if (el.matches?.('input, textarea, select, [contenteditable], [role="dialog"], [aria-modal="true"], [data-no-swipe]')) return true;
    if (el.scrollWidth > el.clientWidth + 2 && /(auto|scroll)/.test(getComputedStyle(el).overflowX)) return true;
  }
  return false;
}

/** Tempo máximo do gesto de mudar de menu: chega para um deslize longo e decidido, não para um arrasto lento a meio de ler. */
const NAV_MAX_MS = 900;
/** O gesto tem de ser claramente para o lado: |dx| pelo menos 1,8 vezes |dy| (rolar com desvio não muda de menu). */
const NAV_RATIO = 1.8;

/**
 * Deslizar para os lados nos ecrãs principais muda de separador (sem dar a volta: nas pontas não passa);
 * no Início, deslizar para a direita abre a câmara (como tocar no "+"). Só na web por agora.
 * Só um deslize grande (navSwipeThreshold, ~40% do ecrã) muda de menu; os pequenos ficam para quem os reclamar
 * (lib/swipeClaim: ex. uma linha da lista de conversas a mostrar "Lida" ou "Apagar").
 * Num ecrã com "pager interno" (lib/swipeClaim: Mensagens) o deslize grande muda primeiro de separador dentro do ecrã.
 */
export function useSwipeTabs() {
  const pathname = usePathname();
  const router = useRouter();
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    const here = TABS.indexOf(pathname === '' ? '/' : pathname);
    if (here < 0) return;
    let s: { x: number; y: number; t: number } | null = null;
    const down = (e: TouchEvent) => {
      resetSwipeClaim(); // em captura: corre antes de qualquer linha reclamar o gesto
      const t = e.touches[0];
      const edge = 24; // a margem é do gesto de voltar do iPhone
      const ok = e.touches.length === 1 && t.clientX > edge && t.clientX < window.innerWidth - edge && !busy(e.target) && window.innerWidth < 1024;
      s = ok ? { x: t.clientX, y: t.clientY, t: Date.now() } : null;
    };
    const up = (e: TouchEvent) => {
      if (!s) return;
      const t = e.changedTouches[0];
      const dx = t.clientX - s.x;
      const dy = t.clientY - s.y;
      const quick = Date.now() - s.t < NAV_MAX_MS;
      s = null;
      if (isSwipeClaimed() || !quick || Math.abs(dx) < navSwipeThreshold() || Math.abs(dx) < Math.abs(dy) * NAV_RATIO) return;
      // Ecrã com separadores próprios (Mensagens): primeiro muda de separador lá dentro; só na ponta muda de menu.
      const p = innerPager();
      const d = decideSwipe({ dx, dy, width: window.innerWidth, threshold: navSwipeThreshold() }, p);
      if (d.to === 'inner' && p) {
        p.go(d.dir);
        return;
      }
      const next = here + (dx < 0 ? 1 : -1);
      // Sem voltas. No Início, para a direita, abre a câmara.
      if (next < 0) {
        if (pathname === '/' || pathname === '') router.navigate('/new' as never);
        return;
      }
      if (next >= TABS.length) return;
      router.navigate(TABS[next] as never);
    };
    const cancel = () => { s = null; };
    document.addEventListener('touchstart', down, { passive: true, capture: true });
    document.addEventListener('touchend', up, { passive: true });
    document.addEventListener('touchcancel', cancel, { passive: true });
    return () => {
      document.removeEventListener('touchstart', down, { capture: true });
      document.removeEventListener('touchend', up);
      document.removeEventListener('touchcancel', cancel);
    };
  }, [pathname, router]);
}
