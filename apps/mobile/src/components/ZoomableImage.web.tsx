import { Image } from 'expo-image';
import { useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import {
  atRest,
  clampPan,
  DOUBLE_TAP_MS,
  doubleTapTarget,
  isDoubleTap,
  isTap,
  panStep,
  pinchStep,
  REST,
  ringOpacity,
  settle,
  TAP_SLOP,
  wheelFactor,
  wheelStep,
  type Box,
  type Zoom,
} from '@/lib/zoomMath';
import type { ZoomableImageProps } from './ZoomableImage';

const EASE_WEB = 'transform 220ms cubic-bezier(0.2, 0.8, 0.2, 1)';

/** Na web, a ref de uma View do react-native-web é o próprio elemento do DOM. */
type El = HTMLElement | null;

/**
 * A mesma foto com zoom (ver ZoomableImage.tsx), na web (sobretudo o PWA no Safari do iPhone): aqui os gestos do
 * gesture-handler estão desligados, por isso usam-se os pointer events do DOM e um `transform` em CSS.
 * - `touch-action: none` no visor: o browser não rola nem amplia a página com os dedos que começam nele;
 * - o Safari ainda amplia a página toda com dois dedos (gesturestart/gesturechange): impede-se enquanto o visor está aberto;
 *   no Mac (trackpad, sem dedos no ecrã) esses mesmos eventos servem para ampliar a foto;
 * - roda do rato e aperto no trackpad do Chrome (wheel com ctrlKey): zoom à volta do cursor;
 * - um toque a 1× fecha (espera DOUBLE_TAP_MS para ver se vem o segundo); dois toques ampliam/reduzem no ponto tocado.
 */
export function ZoomableImage({ uri, placeholderUri, size, onClose, accessibilityLabel }: ZoomableImageProps) {
  const root = useRef<El>(null);
  const photo = useRef<El>(null);
  const ring = useRef<El>(null);
  const live = useRef({ onClose, size });
  live.current = { onClose, size };

  useEffect(() => {
    const el = root.current;
    if (!el || typeof window === 'undefined') return;
    const css = el.style as CSSStyleDeclaration & { webkitUserSelect?: string; webkitTouchCallout?: string };
    css.touchAction = 'none';
    css.userSelect = 'none';
    css.webkitUserSelect = 'none';
    css.webkitTouchCallout = 'none';

    let z: Zoom = REST;
    const box = (): Box => {
      const r = el.getBoundingClientRect();
      return { base: live.current.size, w: r.width, h: r.height };
    };
    /** Ponto do ecrã → a partir do centro do visor. */
    const rel = (cx: number, cy: number) => {
      const r = el.getBoundingClientRect();
      return { x: cx - (r.left + r.width / 2), y: cy - (r.top + r.height / 2) };
    };
    const paint = (next: Zoom, animate: boolean) => {
      z = next;
      const p = photo.current;
      if (p) {
        p.style.transition = animate ? EASE_WEB : 'none';
        p.style.transform = `translate3d(${next.x}px, ${next.y}px, 0) scale(${next.scale})`;
      }
      const g = ring.current;
      if (g) g.style.opacity = String(ringOpacity(next.scale));
    };
    const rest = () => paint(settle(z, box()), true);

    // ——— Dedos (e rato) ———
    const pts = new Map<number, { x: number; y: number }>();
    /** O gesto atual (do primeiro dedo a pousar até ao último a sair). */
    let g: { t: number; x0: number; y0: number; moved: boolean; multi: boolean } | null = null;
    let pinchPrev: { f: { x: number; y: number }; d: number } | null = null;
    let lastTap: { t: number; x: number; y: number } | null = null;
    let tapTimer: ReturnType<typeof setTimeout> | null = null;
    const two = () => {
      const [a, b] = [...pts.values()];
      return { f: rel((a.x + b.x) / 2, (a.y + b.y) / 2), d: Math.hypot(a.x - b.x, a.y - b.y) };
    };

    const down = (e: PointerEvent) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      e.preventDefault();
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        /* sem captura: os movimentos ainda chegam enquanto o dedo está no visor */
      }
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 1) g = { t: e.timeStamp, x0: e.clientX, y0: e.clientY, moved: false, multi: false };
      else if (g) g.multi = true;
      pinchPrev = pts.size >= 2 ? two() : null;
      paint(z, false); // uma animação a meio acaba já (no destino), para o gesto partir do sítio certo
    };
    const move = (e: PointerEvent) => {
      const prev = pts.get(e.pointerId);
      if (!prev) return;
      e.preventDefault();
      const now = { x: e.clientX, y: e.clientY };
      pts.set(e.pointerId, now);
      if (pts.size >= 2) {
        const cur = two();
        if (pinchPrev && pinchPrev.d > 0) paint(pinchStep(z, cur.d / pinchPrev.d, cur.f, pinchPrev.f), false);
        pinchPrev = cur;
        return;
      }
      if (g && !g.moved && Math.hypot(now.x - g.x0, now.y - g.y0) >= TAP_SLOP) g.moved = true;
      if (g?.moved && !atRest(z.scale)) paint(panStep(z, now.x - prev.x, now.y - prev.y, box()), false);
    };
    const tap = (cx: number, cy: number, t: number) => {
      const here = { t, x: cx, y: cy };
      if (isDoubleTap(lastTap, here)) {
        if (tapTimer) clearTimeout(tapTimer);
        tapTimer = null;
        lastTap = null;
        const p = rel(cx, cy);
        paint(doubleTapTarget(z, p.x, p.y, box()), true);
        return;
      }
      lastTap = here;
      if (tapTimer) clearTimeout(tapTimer);
      tapTimer = setTimeout(() => {
        tapTimer = null;
        lastTap = null;
        if (atRest(z.scale)) live.current.onClose();
      }, DOUBLE_TAP_MS);
    };
    const up = (e: PointerEvent) => {
      if (!pts.delete(e.pointerId)) return;
      pinchPrev = pts.size >= 2 ? two() : null;
      if (pts.size > 0) return; // ainda há dedos: um que fica continua a arrastar
      const gg = g;
      g = null;
      if (e.type === 'pointerup' && gg && !gg.multi && isTap(e.clientX - gg.x0, e.clientY - gg.y0, e.timeStamp - gg.t)) {
        tap(e.clientX, e.clientY, e.timeStamp);
        return;
      }
      rest();
    };
    const noDrag = (e: Event) => e.preventDefault();

    // ——— Roda do rato / trackpad ———
    let wheelEnd: ReturnType<typeof setTimeout> | null = null;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const p = rel(e.clientX, e.clientY);
      paint(wheelStep(z, wheelFactor(e.deltaY, e.deltaMode, e.ctrlKey), p.x, p.y, box()), false);
      if (wheelEnd) clearTimeout(wheelEnd);
      wheelEnd = setTimeout(() => paint(clampPan(z, box()), true), 160);
    };

    // ——— Safari: o zoom da página com dois dedos (iPhone) ou com o trackpad (Mac) ———
    type GestureEv = Event & { scale?: number; clientX?: number; clientY?: number };
    let gScale = 1;
    const gStart = (e: Event) => {
      e.preventDefault();
      gScale = 1;
    };
    const gChange = (e: GestureEv) => {
      e.preventDefault();
      // No iPhone os dedos já chegam pelos pointer events; isto é só o trackpad do Mac (sem dedos no visor).
      if (pts.size > 0 || !el.isConnected || typeof e.scale !== 'number') return;
      const f = rel(e.clientX ?? 0, e.clientY ?? 0);
      paint(pinchStep(z, e.scale / gScale, f, f), false);
      gScale = e.scale;
    };
    const gEnd = (e: Event) => {
      e.preventDefault();
      if (pts.size === 0) rest();
    };
    // Dois dedos no ecrã: nada de rolar nem ampliar a página (o touch-action já chega quase sempre; isto é para o Safari antigo).
    const touchMove = (e: TouchEvent) => {
      if (e.touches.length > 1) e.preventDefault();
    };

    const opts = { passive: false } as AddEventListenerOptions;
    el.addEventListener('pointerdown', down, opts);
    el.addEventListener('pointermove', move, opts);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('lostpointercapture', up);
    el.addEventListener('dragstart', noDrag);
    el.addEventListener('wheel', wheel, opts);
    el.addEventListener('touchmove', touchMove, opts);
    document.addEventListener('gesturestart', gStart, opts);
    document.addEventListener('gesturechange', gChange as EventListener, opts);
    document.addEventListener('gestureend', gEnd, opts);
    return () => {
      if (tapTimer) clearTimeout(tapTimer);
      if (wheelEnd) clearTimeout(wheelEnd);
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      el.removeEventListener('lostpointercapture', up);
      el.removeEventListener('dragstart', noDrag);
      el.removeEventListener('wheel', wheel);
      el.removeEventListener('touchmove', touchMove);
      document.removeEventListener('gesturestart', gStart);
      document.removeEventListener('gesturechange', gChange as EventListener);
      document.removeEventListener('gestureend', gEnd);
    };
  }, []);

  const r = size / 2;
  return (
    <View ref={root as never} style={st.root} accessibilityRole="image" accessibilityLabel={accessibilityLabel} accessibilityHint="Dois dedos ou a roda do rato para ampliar. Um toque ou Esc fecha.">
      <View ref={photo as never} style={[st.circle, { width: size, height: size, borderRadius: r }, { willChange: 'transform' } as object]}>
        {placeholderUri ? <Image source={{ uri: placeholderUri }} style={StyleSheet.absoluteFill} contentFit="cover" /> : null}
        <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="cover" transition={150} priority="high" />
        <View ref={ring as never} pointerEvents="none" style={[StyleSheet.absoluteFill, { borderRadius: r, borderWidth: 4, borderColor: '#fff' }]} />
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, alignSelf: 'stretch', alignItems: 'center', justifyContent: 'center' },
  circle: { overflow: 'hidden', backgroundColor: '#27272a' },
});
