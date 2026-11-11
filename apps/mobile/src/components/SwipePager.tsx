import { useCallback, useEffect, useMemo, useRef } from 'react';
import { Platform } from 'react-native';
import { usePanGesture, type PanGesture, type PanGestureConfig } from 'react-native-gesture-handler';
import { claimSwipe, decideSwipe, pagerLock, releaseSwipeSoon, SWIPE_EDGE, type InnerPager } from '@/lib/swipeClaim';

/**
 * Deslizar para os lados para mudar de separador dentro de um ecrã (Mensagens: Conversas / TxillGroups / Pedidos;
 * Perfil: Tudo / Tcheka / Reposts / Presentes / Guardados). A decisão é a de lib/swipeClaim (decideSwipe): só um deslize
 * grande (ou rápido) e claramente para o lado muda de separador, ao largar; a barra e o conteúdo animam como num toque.
 */

/** Telemóvel: quantos pt para o lado até o pan apanhar o gesto (bem mais do que uma linha com swipe, 14). */
const START_X = 40;
/** Telemóvel: estes pt na vertical antes disso e o gesto é da lista (rolar). */
const FAIL_Y = 12;
/** Telemóvel: para um lado sem separador (na ponta), o pan desiste ao fim destes pt (o gesto fica para o voltar atrás). */
const FAIL_EDGE_X = 24;

export interface PagerPanOptions {
  /** Largura do ecrã (para o limite de "deslize grande"). */
  width: number;
  /** Quem muda de separador; lido ao largar (o das Mensagens é o lib/swipeClaim innerPager()). */
  pager: () => InnerPager | null;
  /** true = este gesto não é dos separadores (ex.: começou nas notas, que rolam para o lado). Lido ao largar. */
  skip?: () => boolean;
  /**
   * Para que lados há separador agora. Só ativa para esses lados; para o outro desiste depressa, para o gesto ficar com
   * quem estiver por fora (voltar atrás). Sem isto ativa para os dois lados e decide ao largar (Mensagens).
   */
  can?: { prev: boolean; next: boolean };
  /** Não apanhar gestos que nascem na borda esquerda do ecrã (o voltar do iPhone). */
  leaveEdge?: boolean;
}

/**
 * Telemóvel (react-native-gesture-handler 3): o pan à volta do conteúdo dos separadores. Na web fica desligado (lá são os
 * toques do DOM: lib/swipeTabs nas Mensagens, useWebPager no Perfil). Pede 40 pt para o lado e desiste a 12 pt na
 * vertical, para não roubar o scroll; um toque nunca o ativa (chega intacto aos Pressable lá dentro).
 */
export function usePagerPan({ width, pager, skip, can, leaveEdge }: PagerPanOptions): PanGesture {
  const cb = useRef({ pager, skip });
  cb.current = { pager, skip };
  const prev = can?.prev ?? true;
  const next = can?.next ?? true;
  return usePanGesture(useMemo((): PanGestureConfig => {
    const both = prev && next;
    return {
      runOnJS: true,
      maxPointers: 1,
      // Dedo para a esquerda (negativo) = seguinte; para a direita = anterior.
      activeOffsetX: both ? [-START_X, START_X] : next ? -START_X : START_X,
      ...(both ? null : { failOffsetX: next ? FAIL_EDGE_X : -FAIL_EDGE_X }),
      failOffsetY: [-FAIL_Y, FAIL_Y],
      ...(leaveEdge ? { hitSlop: { left: -SWIPE_EDGE } } : null),
      enabled: Platform.OS !== 'web' && (prev || next),
      onDeactivate: (e: { translationX: number; translationY: number; velocityX: number; canceled?: boolean }) => {
        if (e.canceled || cb.current.skip?.()) return;
        const p = cb.current.pager();
        const d = decideSwipe({ dx: e.translationX, dy: e.translationY, vx: e.velocityX, width }, p);
        if (d.to === 'inner' && p) p.go(d.dir);
      },
    } as PanGestureConfig;
  }, [width, prev, next, leaveEdge]));
}

type Pt = { x: number; t: number };

/** Liga os toques do DOM a um elemento (web). Devolve a função que os desliga. */
function attachWebPager(el: HTMLElement, getPager: () => InnerPager | null): () => void {
  el.style.touchAction = 'pan-y pinch-zoom'; // o browser só rola na vertical; para o lado é connosco
  let g: { x0: number; y0: number; mode: 'wait' | 'side' | 'off'; pts: Pt[] } | null = null;
  let quietUntil = 0;
  /** O sistema de toques do react-native-web cancela o toque quando um antepassado faz scroll: a miniatura não abre. */
  const cancelPress = () => el.dispatchEvent(new Event('scroll'));
  const speed = (pts: Pt[]) => {
    const a = pts[0];
    const b = pts[pts.length - 1];
    if (!a || !b || b.t - a.t <= 0 || Date.now() - b.t > 100) return 0;
    return ((b.x - a.x) / (b.t - a.t)) * 1000; // px/s
  };

  const start = (e: TouchEvent) => {
    const t = e.touches[0];
    // Dois dedos, ou a borda do ecrã (o voltar do iPhone): não é nosso.
    g = e.touches.length === 1 && t.clientX > SWIPE_EDGE && t.clientX < window.innerWidth - SWIPE_EDGE
      ? { x0: t.clientX, y0: t.clientY, mode: 'wait', pts: [{ x: t.clientX, t: Date.now() }] }
      : null;
  };
  const move = (e: TouchEvent) => {
    if (!g || g.mode === 'off') return;
    const t = e.touches[0];
    if (!t || e.touches.length !== 1) {
      g = null;
      return;
    }
    if (g.mode === 'wait') {
      const lock = pagerLock(t.clientX - g.x0, t.clientY - g.y0, e.cancelable, getPager());
      if (lock === 'wait') return;
      if (lock === 'off') {
        g.mode = 'off';
        return;
      }
      g.mode = 'side';
      cancelPress();
    }
    e.preventDefault(); // a lista não rola enquanto o gesto é para o lado
    const now = Date.now();
    g.pts.push({ x: t.clientX, t: now });
    while (g.pts.length > 2 && now - g.pts[0].t > 100) g.pts.shift();
  };
  const end = (e: TouchEvent) => {
    const gg = g;
    g = null;
    if (!gg || gg.mode !== 'side') return;
    quietUntil = Date.now() + 450;
    const t = e.changedTouches[0];
    if (!t) return;
    const p = getPager();
    const d = decideSwipe({ dx: t.clientX - gg.x0, dy: t.clientY - gg.y0, vx: speed(gg.pts), width: window.innerWidth }, p);
    if (d.to !== 'inner' || !p) return;
    // O gesto foi nosso: lib/swipeTabs (que ouve no document, depois deste) não muda também de menu. Devolve-se a seguir.
    claimSwipe();
    releaseSwipeSoon();
    p.go(d.dir);
  };
  const cancel = () => { g = null; };
  /** Depois de deslizar, o clique que o browser ainda mande não abre a miniatura. */
  const swallow = (e: MouseEvent) => {
    if (Date.now() < quietUntil) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  el.addEventListener('touchstart', start, { passive: true });
  el.addEventListener('touchmove', move, { passive: false });
  el.addEventListener('touchend', end);
  el.addEventListener('touchcancel', cancel);
  el.addEventListener('click', swallow, true);
  return () => {
    el.removeEventListener('touchstart', start);
    el.removeEventListener('touchmove', move);
    el.removeEventListener('touchend', end);
    el.removeEventListener('touchcancel', cancel);
    el.removeEventListener('click', swallow, true);
  };
}

/**
 * Web (browser/PWA no telemóvel): os mesmos separadores com os toques do DOM, no próprio elemento (não no document:
 * um ecrã que fica por baixo na pilha não recebe toques, por isso não muda de separador às escondidas).
 * - ao fim de 10 px decide-se (lib/swipeClaim, pagerLock): claramente para o lado e com separador desse lado é nosso
 *   (a lista não rola e o toque nas miniaturas é cancelado); para cima/baixo é rolar e fica com o browser;
 * - na ponta (no primeiro para a direita, no último para a esquerda) não mexe: o gesto fica para quem estiver por fora
 *   (voltar atrás; no meu perfil, lib/swipeTabs muda de menu);
 * - ao largar, um deslize grande muda de separador e reclama o gesto (lib/swipeClaim, claimSwipe) para lib/swipeTabs não
 *   mudar também de menu (o touchstart seguinte, em lib/swipeTabs, liberta-o).
 * Devolve a ref a pôr na View do conteúdo (a ref de uma View do react-native-web é o próprio elemento do DOM).
 */
export function useWebPager(pager: () => InnerPager | null) {
  const get = useRef(pager);
  get.current = pager;
  const detach = useRef<(() => void) | null>(null);
  const ref = useCallback((node: unknown) => {
    detach.current?.();
    detach.current = null;
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    const el = node as HTMLElement | null;
    if (!el || typeof el.addEventListener !== 'function') return;
    detach.current = attachWebPager(el, () => get.current());
  }, []);
  useEffect(() => () => {
    detach.current?.();
    detach.current = null;
  }, []);
  return ref;
}
