import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as RPointerEvent, type ReactNode } from 'react';
import { startsOf, type ProjectClip, type TrimEdge } from '@/lib/studio/project';
import { cachedThumb, videoThumb } from '@/lib/studio/thumbs';
import { clampPps, cutPoints, fitPps, followScroll, pinchDistance, PPS_DEFAULT, preciseClock, reorderIndex, rulerTicks, snapTime, timeAtX, zoomAt } from '@/lib/studio/timeline';
import { fmtS, speedLabel, TCHEKA_MAX_S } from '@/lib/tchekaRules';

/**
 * A linha do tempo do estúdio (só web: é o browser que corre o estúdio). Ao toque (PWA) e com o rato:
 * - miniaturas dos clipes à escala do tempo (fotos repetidas; vídeos com frames do bocado cortado), régua com os segundos;
 * - o cursor segue a pré-visualização (desliza suave entre as atualizações) e arrasta-se na régua para procurar (com íman
 *   nas junções); a tocar, a linha desliza com ele;
 * - zoom com a pinça, com Ctrl + roda no computador e com os botões (− / ver tudo / +);
 * - no clipe escolhido, pegas nas pontas para cortar a arrastar (toque leve ao chegar ao mínimo ou ao fim do ficheiro);
 * - toque longo (ou, com o rato, agarrar e arrastar) para reordenar: os clipes ficam em quadrados e o arrastado segue o dedo;
 * - com um dedo desliza (com inércia); a roda do rato também.
 * Bloqueada (`locked`, durante a montagem) não responde a nada.
 */
export interface TimelineProps {
  clips: ProjectClip[];
  /** Quanto cada clipe dura na sequência (ao ritmo, se for o caso). */
  durations: number[];
  time: number;
  playing: boolean;
  selected: string | null;
  locked: boolean;
  /** As batidas da música (ao ritmo), em segundos. */
  beats?: number[];
  /** Um aviso curto por cima (ex.: «Não cabe: máximo 60 s»). */
  note?: string | null;
  /** O botão de juntar mais fotos e vídeos, no fim da linha. */
  addButton?: ReactNode;
  onSelect: (key: string | null) => void;
  onSeek: (t: number, phase: 'start' | 'move' | 'end') => void;
  /** Cortar pela ponta: `delta` em segundos desde o início do gesto. Devolve se bateu no mínimo ou no máximo. */
  onTrim: (key: string, edge: TrimEdge, delta: number, phase: 'start' | 'move' | 'end') => 'min' | 'max' | null;
  onMove: (from: number, to: number) => void;
}

const C = {
  bg: '#07070b', lane: '#13131a', line: 'rgba(255,255,255,0.08)', dim: 'rgba(255,255,255,0.5)', faint: 'rgba(255,255,255,0.22)',
  coral: '#d6334f', hot: '#ff4f6d', glow: 'rgba(255,79,109,0.55)', beat: '#ffd60a', text: '#f4f4f5',
};
const PAD = 28;
const HEAD_H = 34;
const RULER_H = 22;
const TRACK_H = 58;
const HANDLE_W = 16;
const GAP = 2;
const TILE = 52;
const SLOT = 58;
const ADD_W = 54;
const TW = Math.round((TRACK_H * 9) / 16);
const font = 'Inter, system-ui, -apple-system, "Segoe UI", sans-serif';

type Gesture =
  | { kind: 'pending'; id: number; x0: number; y0: number; key: string; index: number; mouse: boolean; timer: ReturnType<typeof setTimeout> | null }
  | { kind: 'empty'; id: number; x0: number; mouse: boolean }
  | { kind: 'pan'; id: number; x: number; vx: number; at: number }
  | { kind: 'scrub'; id: number }
  | { kind: 'trim'; id: number; key: string; edge: TrimEdge; x0: number; scroll0: number; hit: 'min' | 'max' | null; delta: number }
  | { kind: 'reorder'; id: number }
  | { kind: 'pinch'; d0: number; pps0: number; scroll0: number; mid: number };

const buzz = (ms: number) => { try { (navigator as Navigator & { vibrate?: (n: number) => boolean }).vibrate?.(ms); } catch { /* sem vibração */ } };

/** Um frame de um vídeo (aparece quando estiver pronto). */
function Frame({ uri, t, w, h, style }: { uri: string; t: number; w: number; h: number; style?: CSSProperties }) {
  const [src, setSrc] = useState(() => cachedThumb(uri, t));
  useEffect(() => {
    if (src) return;
    let off = false;
    void videoThumb(uri, t).then((u) => { if (!off) setSrc(u); });
    return () => { off = true; };
  }, [uri, t, src]);
  return <div style={{ width: w, height: h, flex: '0 0 auto', backgroundColor: '#1d1d26', backgroundImage: src ? `url(${src})` : undefined, backgroundSize: 'cover', backgroundPosition: 'center', ...style }} />;
}

/** Passo dos frames do filme: mais fino quanto mais perto. */
const frameStep = (pps: number, speed: number) => { const s = (TW / pps) * speed; return [0.1, 0.25, 0.5, 1, 2, 4].find((q) => q >= s * 0.75) ?? 4; };

export function Timeline(p: TimelineProps) {
  const { clips, durations, locked, selected } = p;
  const total = durations.reduce((a, b) => a + b, 0);
  const wrap = useRef<HTMLDivElement | null>(null);
  const scroller = useRef<HTMLDivElement | null>(null);
  const playheadEl = useRef<HTMLDivElement | null>(null);
  const clockEl = useRef<HTMLSpanElement | null>(null);
  const [width, setWidth] = useState(0);
  const [pps, setPpsState] = useState(PPS_DEFAULT);
  const ppsRef = useRef(pps);
  const setPps = (v: number) => { ppsRef.current = v; setPpsState(v); };
  const fitted = useRef(false);
  const pendingScroll = useRef<number | null>(null);
  const [scrollX, setScrollX] = useState(0);
  const [trim, setTrim] = useState<{ key: string; edge: TrimEdge; origDur: number; index: number } | null>(null);
  const [reorder, setReorder] = useState<{ from: number; to: number; x: number; rowLeft: number } | null>(null);
  const reorderRef = useRef(reorder);
  reorderRef.current = reorder;
  const [scrubT, setScrubT] = useState<number | null>(null);
  const scrubRef = useRef<number | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const g = useRef<Gesture | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const lastX = useRef<number | null>(null);
  const live = useRef({ ...p, total });
  live.current = { ...p, total };
  const lastUser = useRef(0);
  const clock = useRef({ t: p.time, at: 0 });
  const mom = useRef(0);
  const pendingSeek = useRef<number | null>(null);

  // O tempo que vem da pré-visualização (a cada 0,1 s): o cursor anda suave entre um e outro.
  useEffect(() => { clock.current = { t: p.time, at: performance.now() }; }, [p.time, p.playing]);

  // A largura da vista; a primeira vez, a escala para caber tudo.
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const measure = () => setWidth(el.clientWidth);
    measure();
    const RO = (window as unknown as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver;
    if (!RO) { window.addEventListener('resize', measure); return () => window.removeEventListener('resize', measure); }
    const ro = new RO(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    if (fitted.current || !width || total <= 0) return;
    fitted.current = true;
    setPps(Math.min(PPS_DEFAULT * 1.5, fitPps(total, width - ADD_W - 16, PAD)));
  }, [width, total]);
  useLayoutEffect(() => {
    const sc = scroller.current;
    if (sc && pendingScroll.current !== null) { sc.scrollLeft = pendingScroll.current; pendingScroll.current = null; setScrollX(sc.scrollLeft); }
  });

  // A disposição: durante o corte pela ponta do início, o resto fica parado (o clipe encolhe para a direita) até largar.
  const layoutDur = trim?.edge === 'start' ? durations.map((d, i) => (i === trim.index ? trim.origDur : d)) : durations;
  const starts = useMemo(() => startsOf(layoutDur), [layoutDur]); // eslint-disable-line react-hooks/exhaustive-deps
  const layoutTotal = layoutDur.reduce((a, b) => a + b, 0);
  const contentW = PAD + layoutTotal * pps + 10 + ADD_W + PAD + Math.max(0, width / 2 - ADD_W);
  const cuts = useMemo(() => cutPoints(durations), [durations]);
  const cutsRef = useRef(cuts);
  cutsRef.current = cuts;

  const xOfT = (t: number) => PAD + t * ppsRef.current;
  const relX = (clientX: number) => clientX - (scroller.current?.getBoundingClientRect().left ?? 0);
  const tAt = (clientX: number) => timeAtX(relX(clientX) + (scroller.current?.scrollLeft ?? 0), ppsRef.current, PAD, live.current.total);

  function zoomBy(factor: number, anchorX?: number) {
    const sc = scroller.current;
    if (!sc) return;
    const base = pendingScroll.current ?? sc.scrollLeft;
    const t = scrubRef.current ?? live.current.time;
    const ax = anchorX ?? Math.max(0, Math.min(sc.clientWidth, xOfT(t) - base));
    const z = zoomAt({ pps: ppsRef.current, factor, anchorX: ax, scrollLeft: base, pad: PAD });
    pendingScroll.current = z.scrollLeft;
    setPps(z.pps);
  }
  function fitAll() {
    const sc = scroller.current;
    if (!sc) return;
    pendingScroll.current = 0;
    setPps(fitPps(live.current.total, sc.clientWidth - ADD_W - 16, PAD));
  }

  // O ciclo: o cursor e o relógio (sem re-render), seguir a reprodução, a inércia, deslizar nas pontas, e procurar.
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const L = live.current;
      const sc = scroller.current;
      const now = performance.now();
      let t = scrubRef.current ?? L.time;
      if (L.playing && scrubRef.current === null && clock.current.at) t = Math.min(L.total, clock.current.t + Math.min(0.25, (now - clock.current.at) / 1000));
      const x = PAD + t * ppsRef.current;
      if (playheadEl.current) playheadEl.current.style.transform = `translateX(${x}px)`;
      if (clockEl.current) {
        const txt = preciseClock(t);
        if (clockEl.current.textContent !== txt) clockEl.current.textContent = txt;
      }
      if (!sc) return;
      if (L.playing && !g.current && now - lastUser.current > 1200 && !mom.current) {
        const to = followScroll({ x, scrollLeft: sc.scrollLeft, width: sc.clientWidth });
        if (to !== null) sc.scrollLeft = to;
      }
      if (mom.current) {
        sc.scrollLeft -= mom.current * 16;
        mom.current *= 0.94;
        if (Math.abs(mom.current) < 0.02) mom.current = 0;
      }
      // Arrastar perto das pontas faz deslizar (a procurar, a cortar ou a reordenar).
      const gk = g.current?.kind;
      if (lastX.current !== null && (gk === 'scrub' || gk === 'trim' || gk === 'reorder')) {
        const rx = relX(lastX.current);
        const w = sc.clientWidth;
        const sp = rx < 36 ? -(36 - rx) / 3 : rx > w - 36 ? (rx - (w - 36)) / 3 : 0;
        if (sp) {
          if (gk === 'reorder') {
            const r = reorderRef.current;
            if (r) {
              const rowW = live.current.clips.length * SLOT;
              if (rowW > w - 16) setReorder({ ...r, rowLeft: Math.max(w - rowW - 8, Math.min(8, r.rowLeft - sp)) });
            }
          } else {
            sc.scrollLeft += sp;
            moveGesture(lastX.current);
          }
        }
      }
      if (pendingSeek.current !== null) { const s = pendingSeek.current; pendingSeek.current = null; L.onSeek(s, 'move'); }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // A roda: desliza; com Ctrl (ou ⌘, ou a pinça do trackpad) faz zoom à volta do rato.
  useEffect(() => {
    const sc = scroller.current;
    if (!sc) return;
    const onWheel = (e: WheelEvent) => {
      if (live.current.locked) return;
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) { zoomBy(Math.exp(-e.deltaY * 0.004), relX(e.clientX)); return; }
      mom.current = 0;
      lastUser.current = performance.now();
      sc.scrollLeft += Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    };
    sc.addEventListener('wheel', onWheel, { passive: false });
    return () => sc.removeEventListener('wheel', onWheel);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------------------------------------------------------------- gestos
  function beginScrub(clientX: number, id: number) {
    const t = snapTime(tAt(clientX), cutsRef.current, ppsRef.current);
    g.current = { kind: 'scrub', id };
    scrubRef.current = t;
    setScrubT(t);
    live.current.onSeek(t, 'start');
  }
  function beginReorder(clientX: number, index: number, id: number) {
    const sc = scroller.current;
    if (!sc) return;
    if (g.current?.kind === 'pending' && g.current.timer) clearTimeout(g.current.timer);
    buzz(15);
    const x = relX(clientX);
    const n = live.current.clips.length;
    const rowW = n * SLOT;
    const w = sc.clientWidth;
    let rowLeft = x - (index * SLOT + TILE / 2);
    rowLeft = rowW <= w - 16 ? Math.max(8, Math.min(w - rowW - 8, rowLeft)) : Math.max(w - rowW - 8, Math.min(8, rowLeft));
    g.current = { kind: 'reorder', id };
    setReorder({ from: index, to: index, x, rowLeft });
  }
  function moveGesture(clientX: number) {
    const cur = g.current;
    const sc = scroller.current;
    if (!cur || !sc) return;
    if (cur.kind === 'scrub') {
      const t = snapTime(tAt(clientX), cutsRef.current, ppsRef.current);
      scrubRef.current = t;
      setScrubT(t);
      pendingSeek.current = t;
    } else if (cur.kind === 'trim') {
      const delta = (clientX - cur.x0 + (sc.scrollLeft - cur.scroll0)) / ppsRef.current;
      cur.delta = delta;
      const hit = live.current.onTrim(cur.key, cur.edge, delta, 'move');
      if (hit && hit !== cur.hit) { buzz(hit === 'min' ? 14 : 8); setFlash(`${cur.key}:${cur.edge}`); setTimeout(() => setFlash(null), 260); }
      cur.hit = hit;
    } else if (cur.kind === 'reorder') {
      const r = reorderRef.current;
      if (!r) return;
      const x = relX(clientX);
      const to = reorderIndex(x - r.rowLeft + (SLOT - TILE) / 2, SLOT, live.current.clips.length);
      setReorder({ ...r, x, to });
    }
  }

  const onPointerDown = (e: RPointerEvent<HTMLDivElement>) => {
    if (locked) return;
    const sc = scroller.current;
    if (!sc) return;
    const el = (e.target as HTMLElement).closest('[data-tl]') as HTMLElement | null;
    const role = el?.dataset.tl ?? 'empty';
    if (role === 'add' || role === 'ui') return; // o botão de juntar (input de ficheiro) e os botões tratam do toque
    const mouse = e.pointerType === 'mouse';
    if (mouse && e.button !== 0) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try { sc.setPointerCapture(e.pointerId); } catch { /* sem captura */ }
    mom.current = 0;
    lastX.current = e.clientX;
    if (pointers.current.size === 2) {
      // Pinça: o que estava a meio fica sem efeito (um corte acaba onde estava).
      endGesture(false);
      const [a, b] = [...pointers.current.values()];
      g.current = { kind: 'pinch', d0: Math.max(10, pinchDistance(a, b)), pps0: ppsRef.current, scroll0: sc.scrollLeft, mid: relX((a.x + b.x) / 2) };
      return;
    }
    if (pointers.current.size > 2) return;
    const key = el?.dataset.key ?? '';
    if (role === 'h-start' || role === 'h-end') {
      const index = live.current.clips.findIndex((c) => c.key === key);
      if (index < 0) return;
      const edge: TrimEdge = role === 'h-start' ? 'start' : 'end';
      setTrim({ key, edge, origDur: live.current.durations[index] ?? 0, index });
      g.current = { kind: 'trim', id: e.pointerId, key, edge, x0: e.clientX, scroll0: sc.scrollLeft, hit: null, delta: 0 };
      live.current.onTrim(key, edge, 0, 'start');
      return;
    }
    if (role === 'ruler' || role === 'playhead' || (role === 'empty' && mouse)) {
      if (role === 'empty') g.current = { kind: 'empty', id: e.pointerId, x0: e.clientX, mouse };
      else beginScrub(e.clientX, e.pointerId);
      return;
    }
    if (role === 'clip') {
      const index = Number(el?.dataset.index ?? -1);
      const pending: Gesture = { kind: 'pending', id: e.pointerId, x0: e.clientX, y0: e.clientY, key, index, mouse, timer: null };
      if (!mouse) pending.timer = setTimeout(() => { if (g.current === pending) beginReorder(lastX.current ?? e.clientX, index, e.pointerId); }, 380);
      g.current = pending;
      return;
    }
    g.current = { kind: 'empty', id: e.pointerId, x0: e.clientX, mouse };
  };

  const onPointerMove = (e: RPointerEvent<HTMLDivElement>) => {
    if (locked || !pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const cur = g.current;
    const sc = scroller.current;
    if (!cur || !sc) return;
    if (cur.kind === 'pinch') {
      const [a, b] = [...pointers.current.values()];
      if (!a || !b) return;
      const z = zoomAt({ pps: cur.pps0, factor: pinchDistance(a, b) / cur.d0, anchorX: cur.mid, scrollLeft: cur.scroll0, pad: PAD });
      pendingScroll.current = z.scrollLeft;
      setPps(z.pps);
      return;
    }
    if ('id' in cur && cur.id !== e.pointerId) return;
    lastX.current = e.clientX;
    if (cur.kind === 'pending') {
      const d = Math.hypot(e.clientX - cur.x0, e.clientY - cur.y0);
      if (d > (cur.mouse ? 5 : 9)) {
        if (cur.timer) clearTimeout(cur.timer);
        if (cur.mouse) beginReorder(e.clientX, cur.index, cur.id);
        else g.current = { kind: 'pan', id: cur.id, x: e.clientX, vx: 0, at: performance.now() };
      }
      return;
    }
    if (cur.kind === 'empty') {
      if (Math.abs(e.clientX - cur.x0) > (cur.mouse ? 3 : 9)) {
        if (cur.mouse) beginScrub(e.clientX, cur.id);
        else g.current = { kind: 'pan', id: cur.id, x: e.clientX, vx: 0, at: performance.now() };
      }
      return;
    }
    if (cur.kind === 'pan') {
      const now = performance.now();
      const dx = e.clientX - cur.x;
      sc.scrollLeft -= dx;
      const dt = Math.max(1, now - cur.at);
      cur.vx = cur.vx * 0.6 + (dx / dt) * 0.4;
      cur.x = e.clientX;
      cur.at = now;
      lastUser.current = now;
      return;
    }
    moveGesture(e.clientX);
  };

  /** Acaba o gesto em curso (`commit` = largou normalmente). */
  function endGesture(commit: boolean, clientX?: number) {
    const cur = g.current;
    g.current = null;
    lastX.current = null;
    if (!cur) return;
    const L = live.current;
    if (cur.kind === 'pending') {
      if (cur.timer) clearTimeout(cur.timer);
      if (commit) L.onSelect(cur.key);
    } else if (cur.kind === 'empty') {
      if (commit) {
        L.onSelect(null);
        if (cur.mouse && clientX != null) { const t = snapTime(tAt(clientX), cutsRef.current, ppsRef.current); L.onSeek(t, 'start'); L.onSeek(t, 'end'); }
      }
    } else if (cur.kind === 'pan') {
      if (commit && performance.now() - cur.at < 80) mom.current = cur.vx;
    } else if (cur.kind === 'scrub') {
      const t = scrubRef.current ?? L.time;
      pendingSeek.current = null;
      scrubRef.current = null;
      setScrubT(null);
      clock.current = { t, at: performance.now() };
      L.onSeek(t, 'end');
    } else if (cur.kind === 'trim') {
      L.onTrim(cur.key, cur.edge, cur.delta, 'end');
      const tr = trim;
      const sc = scroller.current;
      if (cur.edge === 'start' && tr && sc) {
        // O espaço que o início deixou fecha-se: a ponta direita fica onde estava no ecrã.
        const now = L.durations[tr.index] ?? tr.origDur;
        pendingScroll.current = Math.max(0, sc.scrollLeft - (tr.origDur - now) * ppsRef.current);
      }
      setTrim(null);
    } else if (cur.kind === 'reorder') {
      const r = reorderRef.current;
      setReorder(null);
      if (commit && r && r.to !== r.from) L.onMove(r.from, r.to);
    }
  }
  const onPointerUp = (e: RPointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.delete(e.pointerId);
    const cur = g.current;
    if (cur?.kind === 'pinch') { if (pointers.current.size < 2) g.current = null; return; }
    if (cur && 'id' in cur && cur.id !== e.pointerId) return;
    endGesture(e.type === 'pointerup' && !locked, e.clientX);
  };
  // A montagem começou a meio de um gesto: larga-se onde está.
  useEffect(() => { if (locked) { endGesture(false); pointers.current.clear(); } }, [locked]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------------------------------------------------------------- desenho
  const vw = width || 400;
  const visL = scrollX - vw, visR = scrollX + 2 * vw;
  const ruler = useMemo(() => rulerTicks(pps, Math.max(1, layoutTotal)), [pps, layoutTotal]);
  const ticks = ruler.ticks.filter((tk) => { const x = PAD + tk.t * pps; return x >= visL && x <= visR; });
  const over = total > TCHEKA_MAX_S + 0.05;
  const showT = scrubT ?? p.time;

  const blocks = clips.map((c, i) => {
    const d = durations[i] ?? 0;
    const shift = trim?.edge === 'start' && trim.index === i ? (trim.origDur - d) * pps : 0;
    const left = PAD + starts[i] * pps + shift;
    const w = Math.max(4, d * pps - GAP);
    const sel = c.key === selected;
    const tiles: ReactNode[] = [];
    if (c.video && left + w >= visL && left <= visR) {
      const q = frameStep(pps, c.speed);
      const n = Math.ceil(w / TW);
      const from = Math.max(0, Math.floor((visL - left) / TW)), to = Math.min(n, Math.ceil((visR - left) / TW));
      for (let k = from; k < to; k++) {
        const st = c.trim.start + (((k + 0.5) * TW) / pps) * c.speed;
        const tq = Math.min(Math.max(0, c.length - 0.05), Math.round(st / q) * q);
        tiles.push(<Frame key={`${k}@${tq}`} uri={c.uri} t={tq} w={TW} h={TRACK_H} style={{ position: 'absolute', left: k * TW, top: 0 }} />);
      }
    }
    // A pega do clipe escolhido tapa a ponta esquerda do seguinte: o tempo dele chega-se para a direita.
    const labelL = clips[i - 1]?.key === selected && !locked ? HANDLE_W + 6 : 6;
    const fl = flash?.startsWith(`${c.key}:`) ? flash.slice(c.key.length + 1) : null;
    const handle = (edge: TrimEdge) => (
      <div
        data-tl={edge === 'start' ? 'h-start' : 'h-end'}
        data-key={c.key}
        aria-label={edge === 'start' ? 'Cortar o início (arrasta)' : 'Cortar o fim (arrasta)'}
        style={{
          position: 'absolute', top: -2, bottom: -2, width: HANDLE_W, [edge === 'start' ? 'left' : 'right']: -HANDLE_W, zIndex: 3,
          background: fl === edge ? '#fff' : `linear-gradient(180deg, ${C.hot}, ${C.coral})`, cursor: 'ew-resize', touchAction: 'none',
          borderRadius: edge === 'start' ? '9px 0 0 9px' : '0 9px 9px 0', display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: `0 0 14px ${C.glow}`, transition: 'background 120ms',
        }}
      >
        <div style={{ width: 3, height: 20, borderRadius: 2, background: fl === edge ? C.coral : 'rgba(255,255,255,0.92)' }} />
      </div>
    );
    return (
      <div
        key={c.key}
        data-tl="clip"
        data-key={c.key}
        data-index={i}
        role="button"
        tabIndex={0}
        aria-pressed={sel}
        aria-label={`Clipe ${i + 1}, ${c.video ? 'vídeo' : 'foto'}, ${fmtS(d)} s${sel ? ', escolhido' : ''}`}
        onKeyDown={(ev) => { if (ev.key === 'Enter' && !locked) live.current.onSelect(c.key); }}
        style={{
          position: 'absolute', left, top: 0, width: w, height: TRACK_H, borderRadius: 9, zIndex: sel ? 2 : 1,
          outline: 'none', cursor: locked ? 'default' : 'grab', opacity: reorder ? 0 : 1, transition: 'opacity 160ms',
        }}
      >
        <div style={{ position: 'absolute', inset: 0, borderRadius: 9, overflow: 'hidden', background: '#1d1d26' }}>
          {c.video ? tiles : <div style={{ position: 'absolute', inset: 0, backgroundImage: `url("${c.uri}")`, backgroundSize: `${TW}px ${TRACK_H}px`, backgroundRepeat: 'repeat-x' }} />}
          <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, rgba(0,0,0,0.35) 0%, rgba(0,0,0,0) 38%, rgba(0,0,0,0) 60%, rgba(0,0,0,0.55) 100%)' }} />
          {w > 34 ? <span style={{ position: 'absolute', left: labelL, bottom: 4, fontSize: 10, fontWeight: 800, color: '#fff', fontVariantNumeric: 'tabular-nums', letterSpacing: 0.2, textShadow: '0 1px 2px rgba(0,0,0,0.8)' }}>{fmtS(d)}s</span> : null}
          {c.video && c.speed !== 1 && w > 30 ? <span style={{ position: 'absolute', left: labelL - 1, top: 4, fontSize: 9, fontWeight: 900, color: '#0b0b0f', background: C.beat, borderRadius: 5, padding: '1px 4px' }}>{speedLabel(c.speed)}</span> : null}
          {c.video && c.hasAudio === false && w > 50 ? <span style={{ position: 'absolute', right: 5, top: 4, fontSize: 9, fontWeight: 800, color: '#fff', background: 'rgba(0,0,0,0.55)', borderRadius: 5, padding: '1px 4px' }}>sem som</span> : null}
        </div>
        <div style={{ position: 'absolute', inset: 0, borderRadius: 9, pointerEvents: 'none', boxShadow: sel ? `inset 0 0 0 2px ${C.hot}, 0 0 18px ${C.glow}` : 'inset 0 0 0 1px rgba(255,255,255,0.10)' }} />
        {sel && !reorder && !locked ? handle('start') : null}
        {sel && !reorder && !locked ? handle('end') : null}
      </div>
    );
  });

  const zoomBtn = (label: string, aria: string, onClick: () => void, wide = false) => (
    <button
      type="button"
      data-tl="ui"
      aria-label={aria}
      title={aria}
      disabled={locked}
      onClick={onClick}
      style={{ height: 28, minWidth: wide ? 44 : 28, padding: wide ? '0 8px' : 0, borderRadius: 14, border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.06)', color: C.text, fontSize: wide ? 11 : 16, fontWeight: 800, fontFamily: font, cursor: 'pointer', lineHeight: '26px' }}
    >
      {label}
    </button>
  );

  return (
    <div ref={wrap} aria-label="Linha do tempo" style={{ position: 'relative', background: `linear-gradient(180deg, ${C.bg}, #0b0b12)`, borderTop: `1px solid ${C.line}`, userSelect: 'none', WebkitUserSelect: 'none', fontFamily: font }}>
      <div style={{ height: HEAD_H, display: 'flex', alignItems: 'center', gap: 8, padding: '0 12px' }}>
        <span style={{ color: '#fff', fontSize: 13, fontWeight: 800, fontVariantNumeric: 'tabular-nums', letterSpacing: 0.3 }}>
          <span ref={clockEl}>{preciseClock(showT)}</span>
          <span style={{ color: C.dim, fontWeight: 700 }}> / {preciseClock(Math.min(total, TCHEKA_MAX_S))}</span>
        </span>
        {over ? <span style={{ color: '#fff', background: C.coral, borderRadius: 999, padding: '2px 8px', fontSize: 11, fontWeight: 800 }}>+{fmtS(total - TCHEKA_MAX_S)} s</span> : null}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', justifyContent: 'center' }}>
          {p.note ? <span role="status" style={{ color: '#fff', background: 'rgba(214,51,79,0.9)', borderRadius: 999, padding: '3px 10px', fontSize: 11, fontWeight: 800, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%' }}>{p.note}</span> : null}
        </div>
        {zoomBtn('−', 'Afastar', () => zoomBy(1 / 1.6))}
        {zoomBtn('Tudo', 'Ver tudo', fitAll, true)}
        {zoomBtn('+', 'Aproximar', () => zoomBy(1.6))}
      </div>
      <div
        ref={scroller}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onScroll={(e) => { const x = (e.target as HTMLDivElement).scrollLeft; if (Math.abs(x - scrollX) > vw / 3) setScrollX(x); }}
        style={{ position: 'relative', overflowX: 'auto', overflowY: 'hidden', touchAction: 'none', overscrollBehavior: 'contain', scrollbarWidth: 'none', paddingBottom: 10 } as CSSProperties}
      >
        <div style={{ position: 'relative', width: contentW, height: RULER_H + TRACK_H + 12 }}>
          {/* A régua */}
          <div data-tl="ruler" style={{ position: 'absolute', left: 0, top: 0, width: contentW, height: RULER_H, cursor: locked ? 'default' : 'col-resize' }}>
            {ticks.map((tk) => (
              <div key={tk.t} style={{ position: 'absolute', left: PAD + tk.t * pps, bottom: 2, width: 1, height: tk.major ? 7 : 3, background: tk.major ? C.dim : C.faint }}>
                {tk.label ? <span style={{ position: 'absolute', left: 3, bottom: 5, fontSize: 9.5, fontWeight: 700, color: C.dim, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{tk.label}</span> : null}
              </div>
            ))}
          </div>
          {/* A pista dos clipes */}
          <div style={{ position: 'absolute', left: 0, top: RULER_H + 4, width: contentW, height: TRACK_H }}>
            <div style={{ position: 'absolute', left: PAD - 4, right: PAD, top: -3, bottom: -3, borderRadius: 12, background: C.lane, boxShadow: `inset 0 0 0 1px ${C.line}` }} />
            {blocks}
            {over ? (
              <div aria-hidden style={{ position: 'absolute', left: PAD + TCHEKA_MAX_S * pps, top: -3, height: TRACK_H + 6, width: Math.max(0, (layoutTotal - TCHEKA_MAX_S) * pps), zIndex: 4, pointerEvents: 'none', borderLeft: `2px solid ${C.hot}`, background: 'repeating-linear-gradient(135deg, rgba(214,51,79,0.42) 0 6px, rgba(214,51,79,0.12) 6px 12px)' }}>
                <span style={{ position: 'absolute', left: 4, top: 3, fontSize: 9, fontWeight: 900, color: '#fff', background: C.coral, borderRadius: 4, padding: '1px 4px' }}>60 s</span>
              </div>
            ) : null}
            {(p.beats ?? []).filter((b) => b <= total && PAD + b * pps >= visL && PAD + b * pps <= visR).map((b) => (
              <div key={b} aria-hidden style={{ position: 'absolute', left: PAD + b * pps - 2, top: TRACK_H + 4, width: 4, height: 4, borderRadius: 2, background: C.beat, opacity: 0.85, pointerEvents: 'none' }} />
            ))}
            {p.addButton ? <div data-tl="add" style={{ position: 'absolute', left: PAD + layoutTotal * pps + 10, top: 0, width: ADD_W - 6, height: TRACK_H, opacity: reorder ? 0 : 1 }}>{p.addButton}</div> : null}
          </div>
          {/* O cursor */}
          <div ref={playheadEl} style={{ position: 'absolute', left: -1, top: 0, width: 2, height: RULER_H + TRACK_H + 10, zIndex: 6, transform: `translateX(${PAD + showT * pps}px)`, pointerEvents: 'none', willChange: 'transform', opacity: reorder ? 0 : 1 }}>
            <div style={{ position: 'absolute', left: 0, top: RULER_H - 6, bottom: 0, width: 2, borderRadius: 1, background: '#fff', boxShadow: '0 0 10px rgba(255,255,255,0.7)' }} />
            <div data-tl="playhead" style={{ position: 'absolute', left: -11, top: -2, width: 24, height: RULER_H + 2, pointerEvents: locked ? 'none' : 'auto', cursor: 'grab', display: 'flex', justifyContent: 'center', touchAction: 'none' }}>
              <div style={{ width: 12, height: 16, marginTop: 3, borderRadius: '4px 4px 7px 7px', background: '#fff', boxShadow: `0 0 0 2px ${C.coral}, 0 0 12px ${C.glow}` }} />
            </div>
          </div>
        </div>
      </div>
      {/* A reordenar: quadrados iguais, o arrastado segue o dedo. */}
      {reorder ? (
        <div aria-live="polite" style={{ position: 'absolute', left: 0, right: 0, top: HEAD_H + RULER_H + 4, height: TRACK_H, pointerEvents: 'none', zIndex: 8 }}>
          <div style={{ position: 'absolute', left: 8, right: 8, top: -3, bottom: -3, borderRadius: 12, background: 'rgba(255,79,109,0.06)', boxShadow: 'inset 0 0 0 1px rgba(255,79,109,0.35)' }} />
          {(() => {
            const order = clips.map((_, i) => i).filter((i) => i !== reorder.from);
            order.splice(reorder.to, 0, reorder.from);
            return order.map((i, slot) => {
              const c = clips[i];
              const dragging = i === reorder.from;
              const left = dragging ? reorder.x - TILE / 2 : reorder.rowLeft + slot * SLOT;
              const thumb = c.video
                ? <Frame uri={c.uri} t={Math.min(Math.max(0, c.length - 0.05), Math.round(c.trim.start * 4) / 4)} w={TILE} h={TRACK_H} />
                : <div style={{ width: '100%', height: '100%', backgroundImage: `url("${c.uri}")`, backgroundSize: 'cover', backgroundPosition: 'center' }} />;
              return (
                <div key={c.key} style={{ position: 'absolute', left, top: 0, width: TILE, height: TRACK_H, borderRadius: 10, overflow: 'hidden', transition: dragging ? 'none' : 'left 160ms ease', transform: dragging ? 'scale(1.1) translateY(-4px)' : 'none', boxShadow: dragging ? `0 0 0 2px ${C.hot}, 0 10px 24px rgba(0,0,0,0.6), 0 0 20px ${C.glow}` : 'inset 0 0 0 1px rgba(255,255,255,0.15)', zIndex: dragging ? 2 : 1 }}>
                  {thumb}
                </div>
              );
            });
          })()}
        </div>
      ) : null}
    </div>
  );
}
