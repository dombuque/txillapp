import { createElement, useEffect, useRef, useState, type ReactNode } from 'react';
import { View, type LayoutChangeEvent } from 'react-native';
import { FRAME, insideSafe, SAFE, snapAngle, snapMove, type Overlay } from '@/lib/studio/effects';
import type { OverlayBox } from '@/lib/studio/renderOverlays';

const dom = createElement as (tag: string, props?: Record<string, unknown>, ...kids: unknown[]) => ReactNode;
const W = FRAME.w, H = FRAME.h;
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

type Mode =
  | { kind: 'move'; id: string; px: number; py: number; x0: number; y0: number; moved: boolean; t0: number }
  | { kind: 'pinch'; id: string; d0: number; a0: number; cx0: number; cy0: number; s0: number; r0: number; x0: number; y0: number }
  | { kind: 'handle'; id: string; d0: number; a0: number; s0: number; r0: number };

/**
 * Por cima da pré-visualização: escolher, mover, rodar e escalar os textos e os stickers. Com o dedo (um para mover, dois
 * para rodar e escalar), com o rato (arrastar; a roda escala e, com Shift, roda; a pega do canto roda e escala). Ao arrastar
 * aparecem a zona segura (o que os botões da tcheka não tapam) e as guias, que colam ao meio e às margens. Nada disto entra
 * no vídeo: é o DOM, não o canvas. Um toque fora das camadas toca/pausa (passa para a pré-visualização).
 */
export function FxStage({ overlays, selId, boxes, onSelect, onChange, onEdit, onDelete, onGesture, showSafe, locked, tick }: {
  overlays: Overlay[];
  selId: string | null;
  /** Onde ficou cada camada no último frame desenhado. */
  boxes: () => OverlayBox[];
  onSelect: (id: string | null) => void;
  onChange: (o: Overlay) => void;
  /** Toque duplo num texto (ou no lápis): escrever. */
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
  /** Um gesto (arrastar, rodar, escalar) começa e acaba: as mudanças pelo meio contam como um passo para desfazer. */
  onGesture?: (phase: 'start' | 'end') => void;
  showSafe: boolean;
  locked: boolean;
  /** Muda a cada frame redesenhado em pausa (para a caixa da seleção acompanhar). */
  tick: number;
}) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [drag, setDrag] = useState<{ vx: number | null; hy: number | null; out: boolean } | null>(null);
  const el = useRef<HTMLDivElement | null>(null);
  const props = useRef({ overlays, selId, boxes, onSelect, onChange, onEdit, onDelete, onGesture, locked });
  props.current = { overlays, selId, boxes, onSelect, onChange, onEdit, onDelete, onGesture, locked };
  const mode = useRef<Mode | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const stop = useRef(false);
  const lastTap = useRef<{ id: string; at: number } | null>(null);

  const k = size.w && size.h ? Math.min(size.w / W, size.h / H) : 0;
  const cw = W * k, ch = H * k, left = (size.w - cw) / 2, top = (size.h - ch) / 2;

  useEffect(() => {
    const node = el.current;
    if (!node) return;
    const toFrame = (e: { clientX: number; clientY: number }) => {
      const r = node.getBoundingClientRect();
      return { x: ((e.clientX - r.left) / Math.max(1, r.width)) * W, y: ((e.clientY - r.top) / Math.max(1, r.height)) * H };
    };
    const hit = (p: { x: number; y: number }): string | null => {
      const list = props.current.boxes();
      const sel = props.current.selId;
      // A escolhida primeiro (fica mais fácil de agarrar), depois de cima para baixo.
      const order = [...list].reverse().sort((a, b) => (a.id === sel ? -1 : b.id === sel ? 1 : 0));
      for (const b of order) {
        const a = (-b.rot * Math.PI) / 180;
        const dx = p.x - b.cx, dy = p.y - b.cy;
        const lx = dx * Math.cos(a) - dy * Math.sin(a), ly = dx * Math.sin(a) + dy * Math.cos(a);
        const pad = 26;
        if (Math.abs(lx) <= b.w / 2 + pad && Math.abs(ly) <= b.h / 2 + pad) return b.id;
      }
      return null;
    };
    const find = (id: string) => props.current.overlays.find((o) => o.id === id);
    let raf = 0;
    let pending: Overlay | null = null;
    const emit = (o: Overlay) => {
      pending = o;
      if (raf) return;
      raf = requestAnimationFrame(() => { raf = 0; if (pending) props.current.onChange(pending); pending = null; });
    };
    const boxOf = (id: string) => props.current.boxes().find((b) => b.id === id);
    const startPinch = (id: string) => {
      const o = find(id);
      const [p1, p2] = [...pointers.current.values()];
      if (!o || !p1 || !p2) return;
      mode.current = { kind: 'pinch', id, d0: Math.max(10, Math.hypot(p2.x - p1.x, p2.y - p1.y)), a0: Math.atan2(p2.y - p1.y, p2.x - p1.x), cx0: (p1.x + p2.x) / 2, cy0: (p1.y + p2.y) / 2, s0: o.scale, r0: o.rot, x0: o.x, y0: o.y };
    };

    const down = (e: PointerEvent) => {
      if (props.current.locked) return;
      const p = toFrame(e);
      const handle = (e.target as HTMLElement | null)?.closest?.('[data-h]')?.getAttribute('data-h');
      const sel = props.current.selId;
      if (handle && sel) {
        stop.current = true;
        e.preventDefault();
        if (handle === 'del') { props.current.onDelete(sel); return; }
        if (handle === 'edit') { props.current.onEdit(sel); return; }
        const o = find(sel);
        if (!o) return;
        const dx = p.x - o.x * W, dy = p.y - o.y * H;
        mode.current = { kind: 'handle', id: sel, d0: Math.max(10, Math.hypot(dx, dy)), a0: Math.atan2(dy, dx), s0: o.scale, r0: o.rot };
        props.current.onGesture?.('start');
        node.setPointerCapture?.(e.pointerId);
        return;
      }
      pointers.current.set(e.pointerId, p);
      const id = hit(p);
      if (pointers.current.size === 2 && mode.current && mode.current.kind === 'move') { stop.current = true; startPinch(mode.current.id); node.setPointerCapture?.(e.pointerId); return; }
      if (!id) {
        // Fora das camadas: com uma escolhida, só a larga; sem nenhuma, o toque segue para tocar/pausar.
        stop.current = !!sel;
        if (sel) props.current.onSelect(null);
        pointers.current.delete(e.pointerId);
        return;
      }
      stop.current = true;
      e.preventDefault();
      const o = find(id);
      if (!o) return;
      if (id !== sel) props.current.onSelect(id);
      mode.current = { kind: 'move', id, px: p.x, py: p.y, x0: o.x, y0: o.y, moved: false, t0: performance.now() };
      props.current.onGesture?.('start');
      node.setPointerCapture?.(e.pointerId);
    };
    const move = (e: PointerEvent) => {
      const m = mode.current;
      if (!m || props.current.locked) return;
      const p = toFrame(e);
      if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, p);
      const o = find(m.id);
      if (!o) return;
      const b = boxOf(m.id);
      const half = { hw: (b?.w ?? 200) / 2 / W, hh: (b?.h ?? 100) / 2 / H };
      if (m.kind === 'move') {
        const dx = p.x - m.px, dy = p.y - m.py;
        if (!m.moved && Math.hypot(dx, dy) < 8) return;
        m.moved = true;
        const s = snapMove(m.x0 + dx / W, m.y0 + dy / H, half);
        setDrag({ vx: s.vx, hy: s.hy, out: !insideSafe({ x: s.x, y: s.y, ...half }) });
        emit({ ...o, x: s.x, y: s.y });
      } else if (m.kind === 'pinch') {
        const [p1, p2] = [...pointers.current.values()];
        if (!p1 || !p2) return;
        const d = Math.hypot(p2.x - p1.x, p2.y - p1.y), a = Math.atan2(p2.y - p1.y, p2.x - p1.x);
        const cx = (p1.x + p2.x) / 2, cy = (p1.y + p2.y) / 2;
        const x = clamp(m.x0 + (cx - m.cx0) / W, 0, 1), y = clamp(m.y0 + (cy - m.cy0) / H, 0, 1);
        setDrag({ vx: null, hy: null, out: !insideSafe({ x, y, ...half }) });
        emit({ ...o, scale: clamp((m.s0 * d) / m.d0, 0.2, 6), rot: snapAngle(m.r0 + ((a - m.a0) * 180) / Math.PI), x, y });
      } else {
        const dx = p.x - o.x * W, dy = p.y - o.y * H;
        setDrag({ vx: null, hy: null, out: !insideSafe({ x: o.x, y: o.y, ...half }) });
        emit({ ...o, scale: clamp((m.s0 * Math.hypot(dx, dy)) / m.d0, 0.2, 6), rot: snapAngle(m.r0 + ((Math.atan2(dy, dx) - m.a0) * 180) / Math.PI) });
      }
    };
    const up = (e: PointerEvent) => {
      pointers.current.delete(e.pointerId);
      const m = mode.current;
      if (m && m.kind === 'pinch' && pointers.current.size === 1) {
        // Ficou um dedo: continua a mover a partir dali.
        const [p] = [...pointers.current.values()];
        const o = find(m.id);
        if (p && o) { mode.current = { kind: 'move', id: m.id, px: p.x, py: p.y, x0: o.x, y0: o.y, moved: true, t0: 0 }; return; }
      }
      if (m && m.kind === 'move' && !m.moved && performance.now() - m.t0 < 350) {
        const prev = lastTap.current;
        const now = performance.now();
        if (prev && prev.id === m.id && now - prev.at < 380) { lastTap.current = null; props.current.onEdit(m.id); } else lastTap.current = { id: m.id, at: now };
      }
      if (pointers.current.size === 0) {
        // A última mudança (à espera do frame) entra antes de o gesto acabar.
        if (m) {
          if (raf) { cancelAnimationFrame(raf); raf = 0; }
          if (pending) { props.current.onChange(pending); pending = null; }
          props.current.onGesture?.('end');
        }
        mode.current = null;
        setDrag(null);
      }
      setTimeout(() => { stop.current = false; }, 400);
    };
    const wheel = (e: WheelEvent) => {
      if (props.current.locked) return;
      const sel = props.current.selId;
      const id = hit(toFrame(e)) ?? sel;
      const o = id ? find(id) : null;
      if (!o) return;
      e.preventDefault();
      if (id !== sel) props.current.onSelect(id);
      if (e.shiftKey || e.altKey) emit({ ...o, rot: snapAngle(o.rot + e.deltaY * 0.15) });
      else emit({ ...o, scale: clamp(o.scale * Math.exp(-e.deltaY * 0.0018), 0.2, 6) });
    };
    // Um toque que agarrou uma camada não chega à pré-visualização (que tocaria/pausaria).
    const swallow = (e: Event) => { if (stop.current) { e.stopPropagation(); if (e.type === 'click' || e.type === 'touchstart') e.preventDefault(); } };
    node.addEventListener('pointerdown', down);
    node.addEventListener('pointermove', move);
    node.addEventListener('pointerup', up);
    node.addEventListener('pointercancel', up);
    node.addEventListener('wheel', wheel, { passive: false });
    for (const t of ['mousedown', 'mouseup', 'click', 'touchstart', 'touchend']) node.addEventListener(t, swallow, { passive: false } as AddEventListenerOptions);
    return () => {
      cancelAnimationFrame(raf);
      node.removeEventListener('pointerdown', down);
      node.removeEventListener('pointermove', move);
      node.removeEventListener('pointerup', up);
      node.removeEventListener('pointercancel', up);
      node.removeEventListener('wheel', wheel);
      for (const t of ['mousedown', 'mouseup', 'click', 'touchstart', 'touchend']) node.removeEventListener(t, swallow);
    };
  }, [k > 0]); // eslint-disable-line react-hooks/exhaustive-deps

  const sel = selId ? overlays.find((o) => o.id === selId) : null;
  const box = sel ? boxes().find((b) => b.id === sel.id) : null;
  const pct = (v: number) => `${v * 100}%`;
  const safeOn = showSafe || !!drag;
  void tick;

  return (
    <View style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }} pointerEvents={locked ? 'none' : 'box-none'} onLayout={(e: LayoutChangeEvent) => setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
      {k > 0 ? dom('div', {
        ref: (n: HTMLDivElement | null) => { el.current = n; },
        'data-fx-stage': '',
        style: { position: 'absolute', left, top, width: cw, height: ch, touchAction: 'none', cursor: sel ? 'move' : 'default', userSelect: 'none', WebkitUserSelect: 'none' },
      },
      safeOn ? dom('div', {
        key: 'safe',
        'aria-hidden': true,
        style: {
          position: 'absolute', left: pct(SAFE.left), top: pct(SAFE.top), right: pct(SAFE.right), bottom: pct(SAFE.bottom), borderRadius: 10, pointerEvents: 'none',
          border: `1.5px dashed ${drag?.out ? 'rgba(255,196,0,0.95)' : 'rgba(255,255,255,0.55)'}`, boxShadow: drag ? '0 0 0 9999px rgba(0,0,0,0.28)' : 'none', transition: 'border-color 120ms',
        },
      }, drag?.out ? dom('div', { style: { position: 'absolute', left: '50%', bottom: 8, transform: 'translateX(-50%)', whiteSpace: 'nowrap', padding: '4px 10px', borderRadius: 999, background: 'rgba(0,0,0,0.72)', border: '1px solid rgba(255,214,10,0.7)', color: '#ffd60a', fontSize: 11, fontWeight: 800, fontFamily: 'system-ui, sans-serif' } }, 'Os botões podem tapar isto') : null) : null,
      drag && drag.vx !== null ? dom('div', { key: 'gv', 'aria-hidden': true, style: { position: 'absolute', top: 0, bottom: 0, left: pct(drag.vx), width: 1.5, marginLeft: -0.75, background: '#ff5c6c', boxShadow: '0 0 8px #ff5c6c', pointerEvents: 'none' } }) : null,
      drag && drag.hy !== null ? dom('div', { key: 'gh', 'aria-hidden': true, style: { position: 'absolute', left: 0, right: 0, top: pct(drag.hy), height: 1.5, marginTop: -0.75, background: '#ff5c6c', boxShadow: '0 0 8px #ff5c6c', pointerEvents: 'none' } }) : null,
      sel && box ? dom('div', {
        key: 'sel',
        style: {
          position: 'absolute', left: (box.cx / W) * cw, top: (box.cy / H) * ch, width: (box.w / W) * cw + 16, height: (box.h / H) * ch + 12,
          transform: `translate(-50%, -50%) rotate(${box.rot}deg)`, border: '1.5px solid rgba(255,255,255,0.95)', borderRadius: 10, boxShadow: '0 0 0 1px rgba(255,92,108,0.7), 0 0 16px rgba(255,92,108,0.45)', pointerEvents: 'none',
        },
      },
      handle('del', { left: -14, top: -14 }, '×', 'Apagar', '#18181b'),
      sel.kind === 'text' ? handle('edit', { right: -14, top: -14 }, '✎', 'Escrever', '#18181b') : null,
      handle('rot', { right: -14, bottom: -14 }, '⤡', 'Rodar e escalar', '#d6334f')) : null) : null}
    </View>
  );
}

function handle(id: string, pos: Record<string, number>, glyph: string, label: string, bg: string): ReactNode {
  return dom('div', {
    key: id,
    'data-h': id,
    role: 'button',
    'aria-label': label,
    title: label,
    style: {
      position: 'absolute', ...pos, width: 28, height: 28, borderRadius: 14, background: bg, color: '#fff', border: '1.5px solid rgba(255,255,255,0.9)', display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: 15, fontWeight: 900, lineHeight: '1', fontFamily: 'system-ui, sans-serif', pointerEvents: 'auto', cursor: id === 'rot' ? 'nwse-resize' : 'pointer', boxShadow: '0 2px 8px rgba(0,0,0,0.5)',
    },
  }, glyph);
}
