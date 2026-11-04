import { useEffect } from 'react';

/**
 * Puxar para baixo fecha qualquer janela aberta (visualizadores, revisões, ecrãs cheios): uma única regra para toda a app.
 * Só começa se o conteúdo estiver no topo; segue o dedo; ao largar longe o bastante clica no botão de fechar/voltar da própria janela.
 * Ficam de fora: janelas com `data-swipe="own"` (já tratam do gesto) e `data-swipe="off"` (câmara, mapas, identificar pessoas).
 */
const CLOSERS = '[aria-label="Fechar"],[aria-label="Voltar"],[aria-label="Cancelar"],[aria-label="Fechar câmara"],[aria-label="Voltar à câmara"],[aria-label="Fechar visualizador"]';

function scroller(from: Element, stop: Element): HTMLElement | null {
  for (let el: Element | null = from; el && el !== stop.parentElement; el = el.parentElement) {
    const h = el as HTMLElement;
    const oy = getComputedStyle(h).overflowY;
    if ((oy === 'auto' || oy === 'scroll') && h.scrollHeight > h.clientHeight + 1) return h;
  }
  return null;
}

export default function SwipeClose() {
  useEffect(() => {
    let m: HTMLElement | null = null;
    let y0 = 0;
    let x0 = 0;
    let t0 = 0;
    let on = false;
    let dy = 0;

    const start = (e: TouchEvent) => {
      m = null;
      on = false;
      dy = 0;
      if (e.touches.length !== 1 || !(e.target instanceof Element)) return;
      const modal = e.target.closest('[aria-modal="true"]') as HTMLElement | null;
      if (!modal || modal.closest('[data-swipe]')) return;
      if (e.target.closest('input,textarea,select,video,[role="slider"],[data-swipe="off"],[data-swipe="own"]')) return;
      const sc = scroller(e.target, modal);
      if (sc && sc.scrollTop > 0) return;
      if (!modal.querySelector(CLOSERS)) return;
      m = modal;
      y0 = e.touches[0].clientY;
      x0 = e.touches[0].clientX;
      t0 = Date.now();
    };
    const move = (e: TouchEvent) => {
      if (!m) return;
      const y = e.touches[0].clientY - y0;
      const x = e.touches[0].clientX - x0;
      if (!on) {
        if (y > 14 && y > Math.abs(x) * 1.6) on = true;
        else if (y < -10 || Math.abs(x) > 22) return void (m = null);
        else return;
      }
      dy = Math.max(0, y);
      m.style.transition = 'none';
      m.style.translate = `0 ${dy}px`;
    };
    const end = () => {
      if (!m) return;
      const el = m;
      m = null;
      if (!on) return;
      const fast = dy / Math.max(1, Date.now() - t0) > 0.6;
      el.style.transition = 'translate .2s ease-out';
      if (dy > 130 || (fast && dy > 50)) {
        const btn = el.querySelector(CLOSERS) as HTMLElement | null;
        el.style.translate = '0 0';
        btn?.click();
      } else el.style.translate = '0 0';
    };
    window.addEventListener('touchstart', start, { passive: true, capture: true });
    window.addEventListener('touchmove', move, { passive: true, capture: true });
    window.addEventListener('touchend', end, { capture: true });
    window.addEventListener('touchcancel', end, { capture: true });
    return () => {
      window.removeEventListener('touchstart', start, true);
      window.removeEventListener('touchmove', move, true);
      window.removeEventListener('touchend', end, true);
      window.removeEventListener('touchcancel', end, true);
    };
  }, []);
  return null;
}
