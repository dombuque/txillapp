import type React from 'react';
import { createElement, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '@/lib/theme';
import { FeatureIntro } from './FeatureIntro';
import { Icon } from './Icon';
import { acquireCamera, releaseCamera } from './zas/cameraSession';

/**
 * A câmara oficial do Txillapp no browser (publicações, status). Ecrã inteiro, com a identidade da marca:
 * obturador com anel coral em degradê, filtros de cor (carrossel e a deslizar no visor), layout (várias fotos numa só), zoom por pinça,
 * flash/lanterna, temporizador, virar câmara, foto ou vídeo (até 60 s), e a galeria lá dentro. Precisa de HTTPS ou localhost (regra dos browsers).
 * Só deve ser montada quando `liveCameraSupported()`.
 */
export const liveCameraSupported = () => Platform.OS === 'web' && typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;

export interface Shot { uri: string; video: boolean; mime: string; durationMs?: number }
export type CamMode = 'photo' | 'video' | 'text';
type Problem = null | 'denied' | 'unsupported' | 'failed';
const MAX_VIDEO_S = 60;
const recorderType = () => ['video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find((t) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t)) ?? '';
const dom = createElement as (tag: string, props?: Record<string, unknown>, ...kids: unknown[]) => ReactNode;
const web = (o: Record<string, unknown>) => o as never;
/** Filtros de cor ("looks"): no visor são CSS; na foto aplicam-se pixel a pixel com as mesmas fórmulas (W3C filter effects). */
export interface Look { id: string; name: string; b: number; c: number; s: number; sep: number; g: number; tint?: [number, number, number, number] }
export const LOOKS: Look[] = [
  { id: 'normal', name: 'Normal', b: 1, c: 1, s: 1, sep: 0, g: 0 },
  { id: 'vivo', name: 'Vivo', b: 1.04, c: 1.1, s: 1.35, sep: 0, g: 0 },
  { id: 'quente', name: 'Quente', b: 1.03, c: 1.05, s: 1.1, sep: 0.25, g: 0 },
  { id: 'fresco', name: 'Fresco', b: 1.02, c: 1.05, s: 0.95, sep: 0, g: 0, tint: [80, 140, 255, 0.12] },
  { id: 'suave', name: 'Suave', b: 1.08, c: 0.9, s: 0.9, sep: 0.1, g: 0 },
  { id: 'dourado', name: 'Dourado', b: 1.04, c: 1.08, s: 1.15, sep: 0.35, g: 0, tint: [255, 180, 60, 0.1] },
  { id: 'fade', name: 'Fade', b: 1.1, c: 0.85, s: 0.8, sep: 0.15, g: 0 },
  { id: 'txilla', name: 'Txilla', b: 1.04, c: 1.04, s: 1.08, sep: 0, g: 0, tint: [214, 51, 79, 0.1] },
  { id: 'vintage', name: 'Vintage', b: 0.98, c: 0.95, s: 0.85, sep: 0.5, g: 0, tint: [120, 60, 30, 0.08] },
  { id: 'pb', name: 'P&B', b: 1.02, c: 1.15, s: 1, sep: 0, g: 1 },
];
export const lookCss = (l: Look) => (l.id === 'normal' ? 'none' : `brightness(${l.b}) contrast(${l.c}) saturate(${l.s}) sepia(${l.sep}) grayscale(${l.g})`);
/** Aplica o look aos pixels do canvas (brilho, contraste, saturação, sépia, cinzento e a tinta), como o CSS do visor. */
export function applyLook(c: HTMLCanvasElement, l: Look) {
  if (l.id === 'normal') return;
  const g = c.getContext('2d')!;
  const img = g.getImageData(0, 0, c.width, c.height);
  const d = img.data;
  const sv = l.s, sp = 1 - l.sep, gr = 1 - l.g;
  const S = [0.213 + 0.787 * sv, 0.715 - 0.715 * sv, 0.072 - 0.072 * sv, 0.213 - 0.213 * sv, 0.715 + 0.285 * sv, 0.072 - 0.072 * sv, 0.213 - 0.213 * sv, 0.715 - 0.715 * sv, 0.072 + 0.928 * sv];
  const P = [0.393 + 0.607 * sp, 0.769 - 0.769 * sp, 0.189 - 0.189 * sp, 0.349 - 0.349 * sp, 0.686 + 0.314 * sp, 0.168 - 0.168 * sp, 0.272 - 0.272 * sp, 0.534 - 0.534 * sp, 0.131 + 0.869 * sp];
  const G = [0.2126 + 0.7874 * gr, 0.7152 - 0.7152 * gr, 0.0722 - 0.0722 * gr, 0.2126 - 0.2126 * gr, 0.7152 + 0.2848 * gr, 0.0722 - 0.0722 * gr, 0.2126 - 0.2126 * gr, 0.7152 - 0.7152 * gr, 0.0722 + 0.9278 * gr];
  const mul = (A: number[], B: number[]) => [0, 1, 2].flatMap((i) => [0, 1, 2].map((j) => A[i * 3] * B[j] + A[i * 3 + 1] * B[3 + j] + A[i * 3 + 2] * B[6 + j]));
  const M = mul(G, mul(P, S));
  const bc = l.b * l.c, off = 128 * (1 - l.c);
  const [tr, tg, tb, ta] = l.tint ?? [0, 0, 0, 0];
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i] * bc + off, gg = d[i + 1] * bc + off, b = d[i + 2] * bc + off;
    let R = M[0] * r + M[1] * gg + M[2] * b, Gc = M[3] * r + M[4] * gg + M[5] * b, B = M[6] * r + M[7] * gg + M[8] * b;
    if (ta) { R += (tr - R) * ta; Gc += (tg - Gc) * ta; B += (tb - B) * ta; }
    d[i] = R < 0 ? 0 : R > 255 ? 255 : R; d[i + 1] = Gc < 0 ? 0 : Gc > 255 ? 255 : Gc; d[i + 2] = B < 0 ? 0 : B > 255 ? 255 : B;
  }
  g.putImageData(img, 0, 0);
}

/** Layout (como no Instagram): várias fotos numa imagem só. Cada célula é [x, y, largura, altura] em fração da moldura. */
type Cell = [number, number, number, number];
/** A assinatura do Txillapp no canto de baixo à direita (o "a" a coral), com fundo translúcido para se ler em qualquer imagem. */
export function stampTxillapp(g: CanvasRenderingContext2D, W: number, H: number) {
  const fs = Math.max(22, Math.round(Math.min(W, H) * 0.045));
  const m = Math.round(Math.min(W, H) * 0.035);
  g.save();
  g.font = `bold ${fs}px "Inter", -apple-system, system-ui, "Helvetica Neue", Arial, sans-serif`;
  g.textBaseline = 'middle';
  g.textAlign = 'left';
  const parts: [string, string][] = [['txill', '#fff'], ['a', '#ff5c6c'], ['pp', '#fff']];
  const total = parts.reduce((n, [t]) => n + g.measureText(t).width, 0);
  const padX = Math.round(fs * 0.55), padY = Math.round(fs * 0.38);
  const bw = total + padX * 2, bh = fs + padY * 2;
  const bx = W - m - bw, by = H - m - bh;
  // Fundo escuro translúcido para se ler em qualquer foto, com os cantos redondos.
  g.fillStyle = 'rgba(0,0,0,0.38)';
  const r = Math.round(bh / 2);
  g.beginPath();
  g.moveTo(bx + r, by); g.lineTo(bx + bw - r, by); g.quadraticCurveTo(bx + bw, by, bx + bw, by + r); g.lineTo(bx + bw, by + bh - r); g.quadraticCurveTo(bx + bw, by + bh, bx + bw - r, by + bh); g.lineTo(bx + r, by + bh); g.quadraticCurveTo(bx, by + bh, bx, by + bh - r); g.lineTo(bx, by + r); g.quadraticCurveTo(bx, by, bx + r, by);
  g.closePath();
  g.fill();
  let x = bx + padX;
  const y = by + bh / 2;
  for (const [t, color] of parts) { g.fillStyle = color; g.fillText(t, x, y); x += g.measureText(t).width; }
  g.restore();
}

export const LAYOUTS: { id: string; name: string; cells: Cell[] }[] = [
  { id: '2v', name: '2 lado a lado', cells: [[0, 0, 0.5, 1], [0.5, 0, 0.5, 1]] },
  { id: '2h', name: '2 em cima e baixo', cells: [[0, 0, 1, 0.5], [0, 0.5, 1, 0.5]] },
  { id: '3', name: '1 grande + 2', cells: [[0, 0, 0.5, 1], [0.5, 0, 0.5, 0.5], [0.5, 0.5, 0.5, 0.5]] },
  { id: '4', name: '4', cells: [[0, 0, 0.5, 0.5], [0.5, 0, 0.5, 0.5], [0, 0.5, 0.5, 0.5], [0.5, 0.5, 0.5, 0.5]] },
  { id: '6', name: '6', cells: [[0, 0, 0.5, 1 / 3], [0.5, 0, 0.5, 1 / 3], [0, 1 / 3, 0.5, 1 / 3], [0.5, 1 / 3, 0.5, 1 / 3], [0, 2 / 3, 0.5, 1 / 3], [0.5, 2 / 3, 0.5, 1 / 3]] },
];
const GAP = 3; // a linha branca entre as fotos
/** Desenha `src` a preencher o retângulo (cover), cortando o que sobra. */
function cover(g: CanvasRenderingContext2D, src: CanvasImageSource, srcW: number, srcH: number, x: number, y: number, w: number, h: number) {
  const k = Math.max(w / srcW, h / srcH);
  const sw = w / k, sh = h / k;
  g.drawImage(src, (srcW - sw) / 2, (srcH - sh) / 2, sw, sh, x, y, w, h);
}

const buzz = (ms: number) => { try { navigator.vibrate?.(ms); } catch { /* sem vibração */ } };

export function TxCamera({
  count, max, modes = ['photo', 'video', 'text'], onShot, onGallery, onClose, onDone, onText, doneLabel = 'Feito', thumbs, kinds, kind, onKind,
}: {
  count: number; max: number; modes?: CamMode[]; onShot: (s: Shot) => void; onGallery: (files: File[]) => void; onClose: () => void; onDone?: () => void; onText?: () => void; doneLabel?: string;
  /** Miniaturas do que já foi escolhido (a fila de "recentes", como no Instagram). */
  thumbs?: string[];
  /** A barra de baixo com o que se vai criar (Publicação · Tcheka · Zás · Mimo): tocar noutro chama onKind. */
  kinds?: { id: string; label: string }[]; kind?: string; onKind?: (id: string) => void;
}) {
  const insets = useSafeAreaInsets();
  const video = useRef<HTMLVideoElement | null>(null);
  const pinch = useRef<{ d: number; z: number } | null>(null);
  const looksRow = useRef<React.ComponentRef<typeof ScrollView>>(null);
  const stream = useRef<MediaStream | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const timer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const countTimer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const startedAt = useRef(0);
  const swipe = useRef<{ x: number; y: number } | null>(null);
  const pausedForPicker = useRef(false);
  const [mode, setMode] = useState<CamMode>(modes.includes('photo') ? 'photo' : modes[0]);
  const [facing, setFacing] = useState<'environment' | 'user'>('environment');
  const [ready, setReady] = useState(false);
  const [problem, setProblem] = useState<Problem>(null);
  const [canFlip, setCanFlip] = useState(false);
  const [canTorch, setCanTorch] = useState(false);
  const [light, setLight] = useState(false);
  const [lit, setLit] = useState(false);
  const [flash, setFlash] = useState(false);
  const [delay, setDelay] = useState<0 | 3 | 10>(0);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [look, setLook] = useState(0);
  const [lookName, setLookName] = useState<string | null>(null);
  const [area, setArea] = useState({ w: 0, h: 0 });
  // Layout: qual (ou nenhum), o seletor aberto, e as fotos já tiradas (uma por célula).
  const [layout, setLayout] = useState<number | null>(null);
  const [layoutOpen, setLayoutOpen] = useState(false);
  const [cells, setCells] = useState<string[]>([]);
  const cellCanvases = useRef<HTMLCanvasElement[]>([]);
  const [zoom, setZoom] = useState(1);
  const [recording, setRecording] = useState(false);
  // Depois de tirar: a pré-visualização, com Repetir ou Usar.
  const [review, setReview] = useState<Shot | null>(null);
  const reviewSrc = useRef<HTMLCanvasElement | null>(null);
  // Edição na pré-visualização: rodar/espelhar, cortar, filtro e ajustes. Aplica-se ao original a cada mudança.
  type Box = { x: number; y: number; w: number; h: number };
  type Edit = { rot: 0 | 90 | 180 | 270; flip: boolean; aspect: number | null; box: Box | null; look: number; b: number; c: number; s: number };
  const EDIT0: Edit = { rot: 0, flip: false, aspect: null, box: null, look: 0, b: 1, c: 1, s: 1 };
  const stamp = stampTxillapp;
  const [edit, setEdit] = useState<Edit>(EDIT0);
  const [tool, setTool] = useState<null | 'look' | 'adjust' | 'crop'>(null);
  const renderTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  function renderEdit(src: HTMLCanvasElement, e: Edit, sign = true): HTMLCanvasElement {
    const turned = e.rot === 90 || e.rot === 270;
    const w = turned ? src.height : src.width, h = turned ? src.width : src.height;
    // Corte: livre (caixa escolhida à mão) ou ao centro na proporção pedida.
    let cx = 0, cy = 0, cw = w, ch = h;
    if (e.box) {
      cx = Math.round(e.box.x * w); cy = Math.round(e.box.y * h); cw = Math.max(16, Math.round(e.box.w * w)); ch = Math.max(16, Math.round(e.box.h * h));
    } else if (e.aspect) {
      if (w / h > e.aspect) cw = Math.round(h * e.aspect); else ch = Math.round(w / e.aspect);
      cx = Math.round((w - cw) / 2); cy = Math.round((h - ch) / 2);
    }
    const out = document.createElement('canvas');
    out.width = cw;
    out.height = ch;
    const g = out.getContext('2d')!;
    g.save();
    g.translate(w / 2 - cx, h / 2 - cy);
    if (e.flip) g.scale(-1, 1);
    g.rotate((e.rot * Math.PI) / 180);
    g.drawImage(src, -src.width / 2, -src.height / 2);
    g.restore(); // sem isto a assinatura era desenhada com a rotação e caía fora da imagem
    const base = LOOKS[e.look];
    const l: Look = { ...base, id: base.id === 'normal' && e.b === 1 && e.c === 1 && e.s === 1 ? 'normal' : 'edit', b: base.b * e.b, c: base.c * e.c, s: base.s * e.s };
    applyLook(out, l);
    if (sign) stamp(out.getContext('2d')!, cw, ch);
    return out;
  }
  // Corte livre: a caixa (frações da imagem já rodada) arrasta-se pelos cantos ou pelo meio, por cima da foto inteira.
  const [freeCrop, setFreeCrop] = useState(false);
  const [box, setBox] = useState<Box>({ x: 0.08, y: 0.08, w: 0.84, h: 0.84 });
  const boxRef = useRef(box);
  boxRef.current = box;
  const imgEl = useRef<HTMLImageElement | null>(null);
  const [imgTick, setImgTick] = useState(0);
  const drag = useRef<{ kind: 'nw' | 'ne' | 'sw' | 'se' | 'move'; x: number; y: number; box: Box } | null>(null);
  /** Onde a foto está mesmo no ecrã (object-fit: contain). */
  function imageRect(): { left: number; top: number; width: number; height: number } | null {
    const el = imgEl.current;
    if (!el || !el.naturalWidth) return null;
    const r = el.getBoundingClientRect();
    const k = Math.min(r.width / el.naturalWidth, r.height / el.naturalHeight);
    const width = el.naturalWidth * k, height = el.naturalHeight * k;
    return { left: (r.width - width) / 2, top: (r.height - height) / 2, width, height };
  }
  function cropTouchStart(e: TouchEvent) {
    const rect = imageRect();
    if (!rect || e.touches.length !== 1) return;
    e.preventDefault();
    const t = e.touches[0];
    const host = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const px = t.clientX - host.left - rect.left, py = t.clientY - host.top - rect.top;
    const b = boxRef.current;
    const corners: [typeof drag.current extends infer D ? (D extends { kind: infer K } ? K : never) : never, number, number][] = [
      ['nw', b.x * rect.width, b.y * rect.height], ['ne', (b.x + b.w) * rect.width, b.y * rect.height],
      ['sw', b.x * rect.width, (b.y + b.h) * rect.height], ['se', (b.x + b.w) * rect.width, (b.y + b.h) * rect.height],
    ];
    let kind: 'nw' | 'ne' | 'sw' | 'se' | 'move' = 'move';
    for (const [k, x, y] of corners) if (Math.hypot(px - x, py - y) < 34) { kind = k as typeof kind; break; }
    drag.current = { kind, x: t.clientX, y: t.clientY, box: b };
  }
  function cropTouchMove(e: TouchEvent) {
    const d = drag.current; const rect = imageRect();
    if (!d || !rect || e.touches.length !== 1) return;
    e.preventDefault();
    const t = e.touches[0];
    const dx = (t.clientX - d.x) / rect.width, dy = (t.clientY - d.y) / rect.height;
    const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
    let { x, y, w, h } = d.box;
    const MIN = 0.12;
    if (d.kind === 'move') { x = clamp(x + dx, 0, 1 - w); y = clamp(y + dy, 0, 1 - h); }
    else {
      const x2 = x + w, y2 = y + h;
      let nx = x, ny = y, nx2 = x2, ny2 = y2;
      if (d.kind === 'nw' || d.kind === 'sw') nx = clamp(x + dx, 0, x2 - MIN);
      if (d.kind === 'ne' || d.kind === 'se') nx2 = clamp(x2 + dx, x + MIN, 1);
      if (d.kind === 'nw' || d.kind === 'ne') ny = clamp(y + dy, 0, y2 - MIN);
      if (d.kind === 'sw' || d.kind === 'se') ny2 = clamp(y2 + dy, y + MIN, 1);
      x = nx; y = ny; w = nx2 - nx; h = ny2 - ny;
    }
    setBox({ x, y, w, h });
  }
  function cropTouchEnd() { drag.current = null; }
  /** Entra no corte livre: mostra a foto inteira (sem corte) com a caixa por cima. */
  function startFreeCrop() {
    setFreeCrop(true);
    const e = { ...edit, aspect: null, box: null };
    setEdit(e);
    clearTimeout(renderTimer.current);
    const src = reviewSrc.current;
    const seq = ++renderSeq.current;
    if (src) renderEdit(src, e, false).toBlob((blob) => blob && seq === renderSeq.current && setReview((r) => (r && !r.video ? { ...r, uri: URL.createObjectURL(blob) } : r)), 'image/jpeg', 0.9);
  }
  // Os URLs de blob da pré-visualização são revogados ao serem substituídos (cada ajuste criava um JPEG retido para sempre).
  const lastUri = useRef<string | null>(null);
  useEffect(() => {
    const prev = lastUri.current;
    lastUri.current = review?.uri ?? null;
    if (prev && prev !== lastUri.current) setTimeout(() => URL.revokeObjectURL(prev), 1500);
  }, [review?.uri]);
  // O corte livre acompanha rodar o telemóvel e a barra do Safari.
  useEffect(() => {
    const on = () => setImgTick((n) => n + 1);
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  /** Sai do corte livre aplicando a caixa. */
  function endFreeCrop() {
    if (!freeCrop) return;
    setFreeCrop(false);
    changeEdit({ box: boxRef.current, aspect: null });
  }
  const renderSeq = useRef(0);
  function openReview(c: HTMLCanvasElement) {
    clearTimeout(renderTimer.current);
    renderSeq.current += 1;
    reviewSrc.current = c;
    setEdit(EDIT0);
    setTool(null);
    setFreeCrop(false);
    setBox({ x: 0.08, y: 0.08, w: 0.84, h: 0.84 });
    const seq = renderSeq.current;
    renderEdit(c, EDIT0).toBlob((blob) => blob && seq === renderSeq.current && setReview({ uri: URL.createObjectURL(blob), video: false, mime: 'image/jpeg' }), 'image/jpeg', 0.9);
  }
  function changeEdit(patch: Partial<Edit>) {
    const e = { ...edit, ...patch };
    setEdit(e);
    clearTimeout(renderTimer.current);
    renderTimer.current = setTimeout(() => {
      const src = reviewSrc.current;
      if (!src) return;
      const seq = ++renderSeq.current;
      renderEdit(src, e).toBlob((blob) => blob && seq === renderSeq.current && setReview((r) => (r && !r.video ? { ...r, uri: URL.createObjectURL(blob) } : r)), 'image/jpeg', 0.9);
    }, 60);
  }
  const [seconds, setSeconds] = useState(0);
  const full = mode === 'photo' && count >= max;
  const topPad = Math.max(insets.top, 12);

  const start = useCallback(async () => {
    setReady(false);
    setProblem(null);
    if (!navigator.mediaDevices?.getUserMedia) return setProblem('unsupported');
    try {
      const s = await acquireCamera(facing, modes.includes('video'));
      stream.current = s;
      if (video.current) {
        video.current.srcObject = s;
        await video.current.play().catch(() => undefined);
      }
      const caps = (s.getVideoTracks()[0]?.getCapabilities?.() ?? {}) as { torch?: boolean };
      setCanTorch(!!caps.torch);
      setReady(true);
      const devices = await navigator.mediaDevices.enumerateDevices().catch(() => []);
      setCanFlip(devices.filter((d) => d.kind === 'videoinput').length > 1);
    } catch (e) {
      setProblem((e as DOMException).name === 'NotAllowedError' ? 'denied' : 'failed');
    }
  }, [facing]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { void start(); }, [start]);
  useEffect(() => () => {
    releaseCamera(2_000);
    clearInterval(timer.current);
    clearInterval(countTimer.current);
    clearTimeout(renderTimer.current);
    clearTimeout(holdT.current);
    if (recorder.current?.state === 'recording') { recorder.current.onstop = null; recorder.current.stop(); }
    reviewSrc.current = null;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // No iPhone, o seletor de fotos não devolve nada enquanto a câmara está ligada: desliga-se ao abrir a galeria e religa-se quando o seletor fecha.
  useEffect(() => {
    const back = () => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      // Bloquear o telemóvel, trocar de app ou atender uma chamada mata os tracks: ao voltar, religa-se.
      const dead = !!stream.current && !stream.current.getVideoTracks().some((t) => t.readyState === 'live');
      if (!pausedForPicker.current && !dead) return;
      pausedForPicker.current = false;
      void start();
    };
    window.addEventListener('focus', back);
    document.addEventListener('visibilitychange', back);
    return () => { window.removeEventListener('focus', back); document.removeEventListener('visibilitychange', back); };
  }, [start]);
  const openGallery = () => { pausedForPicker.current = true; releaseCamera(0); setReady(false); };

  const pickLook = (n: number) => {
    setLook(n);
    setLookName(LOOKS[n].name);
    looksRow.current?.scrollTo({ x: Math.max(0, n * 78 - 120), animated: true });
    buzz(6);
  };
  const cycleLook = (dir: 1 | -1) => pickLook((look + dir + LOOKS.length) % LOOKS.length);
  useEffect(() => {
    if (lookName === null) return;
    const t = setTimeout(() => setLookName(null), 900);
    return () => clearTimeout(t);
  }, [lookName]);

  async function shoot() {
    const v = video.current;
    if (!v || !ready || full || !v.videoWidth) return;
    const vtrack = stream.current?.getVideoTracks()[0];
    let torchOn = false;
    if (light) {
      if (canTorch && vtrack) {
        try { await vtrack.applyConstraints({ advanced: [{ torch: true } as MediaTrackConstraintSet] }); torchOn = true; } catch { /* sem lanterna: ecrã aceso */ }
      }
      if (!torchOn) setLit(true);
      await new Promise((r) => setTimeout(r, 420));
    }
    const c = document.createElement('canvas');
    const g = c.getContext('2d')!;
    const cell = layout !== null ? cellRects()[cells.length] : null;
    if (cell) {
      // Layout: recorta do sensor exatamente o que a célula ativa mostra no visor (o visor é "cover" com o zoom).
      const k = Math.max(card.w / v.videoWidth, card.h / v.videoHeight) * zoom;
      const vx0 = (v.videoWidth - card.w / k) / 2, vy0 = (v.videoHeight - card.h / k) / 2;
      const sx = vx0 + (cell.x - card.x) / k, sy = vy0 + (cell.y - card.y) / k, sw = cell.w / k, sh = cell.h / k;
      c.width = Math.round(sw);
      c.height = Math.round(sh);
      if (facing === 'user') { g.translate(c.width, 0); g.scale(-1, 1); g.drawImage(v, v.videoWidth - sx - sw, sy, sw, sh, 0, 0, c.width, c.height); }
      else g.drawImage(v, sx, sy, sw, sh, 0, 0, c.width, c.height);
    } else {
      // Zoom: recorta o centro do sensor na proporção do zoom (o mesmo que se vê no visor).
      const sw = Math.round(v.videoWidth / zoom), sh = Math.round(v.videoHeight / zoom);
      c.width = sw;
      c.height = sh;
      if (facing === 'user') { g.translate(c.width, 0); g.scale(-1, 1); } // selfie: sai como a viste (espelhada)
      g.drawImage(v, (v.videoWidth - sw) / 2, (v.videoHeight - sh) / 2, sw, sh, 0, 0, sw, sh);
    }
    applyLook(c, LOOKS[look]);
    setLit(false);
    if (torchOn && vtrack) vtrack.applyConstraints({ advanced: [{ torch: false } as MediaTrackConstraintSet] }).catch(() => undefined);
    buzz(15);
    setFlash(true);
    setTimeout(() => setFlash(false), 140);
    if (cell) return addCell(c);
    openReview(c);
  }

  // ----- Layout: a moldura (4:5, centrada entre os controlos), as células em píxeis do visor, juntar tudo numa foto.
  const frame = (() => {
    const fw = Math.min(area.w - 24, 560);
    const fh = Math.min(fw * 1.25, Math.max(200, area.h - topPad - 70 - 260));
    const w = Math.min(fw, fh / 1.25);
    return { x: (area.w - w) / 2, y: topPad + 64 + Math.max(0, (area.h - topPad - 64 - 220 - w * 1.25) / 2), w, h: w * 1.25 };
  })();
  function cellRects(): { x: number; y: number; w: number; h: number }[] {
    if (layout === null) return [];
    return LAYOUTS[layout].cells.map(([cx, cy, cw, ch]) => ({ x: frame.x + cx * frame.w + GAP / 2, y: frame.y + cy * frame.h + GAP / 2, w: cw * frame.w - GAP, h: ch * frame.h - GAP }));
  }
  function addCell(c: HTMLCanvasElement) {
    const next = [...cellCanvases.current, c];
    cellCanvases.current = next;
    setCells(next.map((x) => x.toDataURL('image/jpeg', 0.7)));
    if (layout !== null && next.length >= LAYOUTS[layout].cells.length) void finishLayout(next);
  }
  function undoCell() {
    cellCanvases.current = cellCanvases.current.slice(0, -1);
    setCells((c) => c.slice(0, -1));
  }
  function leaveLayout() {
    cellCanvases.current = [];
    setCells([]);
    setLayout(null);
    setLayoutOpen(false);
  }
  async function finishLayout(list: HTMLCanvasElement[]) {
    if (layout === null) return;
    const W = 1080, H = 1350;
    const out = document.createElement('canvas');
    out.width = W;
    out.height = H;
    const g = out.getContext('2d')!;
    g.fillStyle = '#fff';
    g.fillRect(0, 0, W, H);
    const gap = Math.round((GAP / frame.w) * W);
    LAYOUTS[layout].cells.forEach(([cx, cy, cw, ch], i) => {
      if (!list[i]) return;
      const x = Math.round(cx * W + gap / 2), y = Math.round(cy * H + gap / 2), w = Math.round(cw * W - gap), h = Math.round(ch * H - gap);
      g.save();
      g.beginPath();
      g.rect(x, y, w, h);
      g.clip();
      cover(g, list[i], list[i].width, list[i].height, x, y, w, h);
      g.restore();
    });
    leaveLayout();
    buzz(20);
    openReview(out);
  }
  /** Da galeria com layout ativo: cada foto escolhida enche a célula seguinte (cortada ao tamanho dela). */
  async function fillFromFiles(files: File[]) {
    if (layout === null) return onGallery(files);
    const rects = cellRects();
    let list = cellCanvases.current;
    for (const f of files.filter((x) => x.type.startsWith('image/'))) {
      if (list.length >= rects.length) break;
      const url = URL.createObjectURL(f);
      try {
        const img = await new Promise<HTMLImageElement>((res, rej) => { const i = document.createElement('img'); i.onload = () => res(i); i.onerror = rej; i.src = url; });
        const cell = LAYOUTS[layout].cells[list.length];
        const c = document.createElement('canvas');
        // No tamanho final da célula (a composição é 1080×1350): senão a foto saía ampliada e desfocada.
        c.width = Math.round(cell[2] * 1080);
        c.height = Math.round(cell[3] * 1350);
        cover(c.getContext('2d')!, img, img.naturalWidth, img.naturalHeight, 0, 0, c.width, c.height);
        list = [...list, c];
      } catch { /* ficheiro que não é imagem legível */ } finally { URL.revokeObjectURL(url); }
    }
    cellCanvases.current = list;
    setCells(list.map((x) => x.toDataURL('image/jpeg', 0.7)));
    if (list.length >= rects.length) void finishLayout(list);
  }

  function record() {
    if (recording) return recorder.current?.stop();
    const s = stream.current;
    if (!s || !ready || typeof MediaRecorder === 'undefined') return;
    const type = recorderType();
    const r = new MediaRecorder(s, type ? { mimeType: type } : undefined);
    chunks.current = [];
    r.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
    r.onstop = () => {
      clearInterval(timer.current);
      setRecording(false);
      setSeconds(0);
      const mime = (r.mimeType || type || 'video/mp4').split(';')[0];
      const blob = new Blob(chunks.current, { type: mime });
      if (blob.size) setReview({ uri: URL.createObjectURL(blob), video: true, mime, durationMs: Date.now() - startedAt.current });
    };
    recorder.current = r;
    startedAt.current = Date.now();
    r.start(1000);
    setRecording(true);
    buzz(10);
    timer.current = setInterval(() => {
      const t = Math.floor((Date.now() - startedAt.current) / 1000);
      setSeconds(t);
      if (t >= MAX_VIDEO_S && r.state === 'recording') r.stop();
    }, 250);
  }

  const [vkey, setVkey] = useState(0);
  const lastDims = useRef('');
  const onVideoResize = () => {
    const v = video.current;
    if (!v || !v.videoWidth) return;
    const d = `${v.videoWidth}x${v.videoHeight}`;
    if (lastDims.current && lastDims.current !== d) setVkey((n) => n + 1);
    lastDims.current = d;
  };
  useEffect(() => {
    const v = video.current;
    if (vkey && v && stream.current && v.srcObject !== stream.current) { v.srcObject = stream.current; void v.play().catch(() => undefined); }
  }, [vkey]);
  const shootRef = useRef(shoot);
  shootRef.current = shoot;
  /** Toque = foto; manter premido = vídeo (começa aos 350 ms e pára ao largar). Com temporizador, o toque faz a contagem; tocar outra vez cancela. */
  const holdT = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const holding = useRef(false);
  const [hint, setHint] = useState(() => { try { return Number(localStorage.getItem('tx_cam_hint') ?? '0') < 3; } catch { return true; } });
  useEffect(() => { try { localStorage.setItem('tx_cam_hint', String(Number(localStorage.getItem('tx_cam_hint') ?? '0') + 1)); } catch { /* sem armazenamento */ } }, []);
  function pressIn() {
    holding.current = false;
    if (!ready || countdown !== null || recording || layout !== null || !modes.includes('video')) return;
    holdT.current = setTimeout(() => { holding.current = true; setHint(false); record(); }, 350);
  }
  function pressOut() {
    clearTimeout(holdT.current);
    if (holding.current) { holding.current = false; if (recorder.current?.state === 'recording') recorder.current.stop(); return; }
    press();
  }
  function press() {
    if (countdown !== null) { clearInterval(countTimer.current); return setCountdown(null); }
    if (recording) return record();
    const fire = () => void shootRef.current();
    if (!delay || recording) return fire();
    let n: number = delay;
    setCountdown(n);
    countTimer.current = setInterval(() => {
      n -= 1;
      if (n <= 0) { clearInterval(countTimer.current); setCountdown(null); fire(); } else setCountdown(n);
    }, 1000);
  }

  const mm = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  // Barra de baixo (fora do visor): galeria, modos e virar câmara, como no Instagram.
  const barH = 64 + Math.max(insets.bottom, 12);
  const card = { x: 0, y: topPad, w: area.w, h: Math.max(0, area.h - topPad - barH) };
  const mirror = facing === 'user' ? 'scaleX(-1)' : 'none';
  const fill = { position: 'absolute', left: 0, top: 0, width: '100%', height: '100%', objectFit: 'cover' };
  const botPad = barH + 18; // os controlos que ficam por cima do visor começam acima da barra de baixo

  return (
    <View style={st.root} accessibilityViewIsModal onLayout={(e: LayoutChangeEvent) => setArea({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
      <FeatureIntro id="camera" />
      {dom(
        'div',
        {
          style: { position: 'absolute', left: card.x, top: card.y, width: card.w, height: card.h, backgroundColor: '#111', touchAction: 'none', overflow: 'hidden', borderRadius: 22 },
          onTouchStart: (e: TouchEvent) => {
            if (e.touches.length === 2) {
              pinch.current = { d: Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY), z: zoom };
              swipe.current = null;
            } else swipe.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
          },
          onTouchMove: (e: TouchEvent) => {
            const p = pinch.current;
            if (p && e.touches.length === 2) {
              const d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
              setZoom(Math.min(5, Math.max(1, p.z * (d / p.d))));
            }
          },
          onTouchEnd: (e: TouchEvent) => {
            if (e.touches.length === 0) pinch.current = null;
            const s = swipe.current;
            swipe.current = null;
            if (!s || !ready || recording || pinch.current) return;
            const dx = e.changedTouches[0].clientX - s.x;
            const dy = e.changedTouches[0].clientY - s.y;
            if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) cycleLook(dx < 0 ? 1 : -1);
          },
        },
        dom('video', { key: `v${vkey}`, ref: video, playsInline: true, muted: true, autoPlay: true, onResize: onVideoResize, style: { ...fill, transform: `${mirror === 'none' ? '' : mirror + ' '}scale(${zoom})`, filter: lookCss(LOOKS[look]), visibility: ready ? 'visible' : 'hidden', transition: 'filter 180ms' } }),
        LOOKS[look].tint && dom('div', { key: 'tint', style: { position: 'absolute', inset: 0, pointerEvents: 'none', backgroundColor: `rgba(${LOOKS[look].tint!.join(',')})` } }),
        layout !== null && area.w > 0 && dom(
          'div',
          { key: 'frame', style: { position: 'absolute', left: frame.x - card.x, top: frame.y - card.y, width: frame.w, height: frame.h, pointerEvents: 'none', boxShadow: '0 0 0 9999px rgba(0,0,0,0.6)', borderRadius: 6 } },
          ...cellRects().map((r, i) =>
            dom('div', {
              key: i,
              style: {
                position: 'absolute', left: r.x - frame.x, top: r.y - frame.y, width: r.w, height: r.h, overflow: 'hidden', borderRadius: 4,
                boxSizing: 'border-box',
                border: i === cells.length ? '2px solid #d6334f' : '1px solid rgba(255,255,255,0.7)',
                backgroundColor: i < cells.length ? '#000' : i === cells.length ? 'transparent' : 'rgba(0,0,0,0.45)',
                backgroundImage: i < cells.length ? `url(${cells[i]})` : undefined, backgroundSize: 'cover', backgroundPosition: 'center',
              },
            }),
          ),
        ),
      )}
      {/* Sombras suaves em cima e em baixo, para os controlos se lerem sobre qualquer cena. */}
      <View pointerEvents="none" style={web({ position: 'absolute', left: 0, right: 0, top: card.y, height: 120, borderTopLeftRadius: 22, borderTopRightRadius: 22, backgroundImage: 'linear-gradient(to bottom, rgba(0,0,0,0.45), transparent)' })} />
      <View pointerEvents="none" style={web({ position: 'absolute', left: 0, right: 0, bottom: barH, height: 230, borderBottomLeftRadius: 22, borderBottomRightRadius: 22, backgroundImage: 'linear-gradient(to top, rgba(0,0,0,0.55), transparent)' })} />
      {/* A moldura do Txillapp: quatro cantos em coral à volta do visor e o wordmark, discreto, por cima. */}
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, { zIndex: 2 }]}>
        <View style={[st.corner, { left: 62, top: card.y + 66, borderTopWidth: 3, borderLeftWidth: 3, borderTopLeftRadius: 14 }]} />
        <View style={[st.corner, { right: 14, top: card.y + 66, borderTopWidth: 3, borderRightWidth: 3, borderTopRightRadius: 14 }]} />
        <View style={[st.corner, { left: 62, bottom: barH + 128, borderBottomWidth: 3, borderLeftWidth: 3, borderBottomLeftRadius: 14 }]} />
        <View style={[st.corner, { right: 14, bottom: barH + 128, borderBottomWidth: 3, borderRightWidth: 3, borderBottomRightRadius: 14 }]} />
        <View style={{ position: 'absolute', left: 0, right: 0, top: card.y + 22, alignItems: 'center' }}>
          <Text style={st.wordmark} accessibilityLabel="Txillapp">txill<Text style={{ color: colors.brand }}>a</Text>pp</Text>
        </View>
      </View>
      {lit ? <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: '#fff' }]} /> : null}
      {flash ? <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: '#fff' }]} /> : null}

      {/* Em cima: fechar; flash, temporizador, virar. */}
      <View style={[st.top, { paddingTop: topPad + 10 }]}>
        <Pressable onPress={onClose} style={st.round} accessibilityRole="button" accessibilityLabel="Fechar câmara"><Icon name="x" size={24} color="#fff" strokeWidth={2.2} /></Pressable>
        {recording ? <View style={st.rec}><View style={st.recDot} /><Text style={st.recText}>{mm}</Text></View> : null}
        {!recording && count > 0 && onDone && layout === null ? (
          <Pressable onPress={onDone} style={[st.doneBtn, { height: 44 }]} accessibilityRole="button" accessibilityLabel={`${doneLabel}, ${count}`}>
            <Text style={{ color: '#fff', fontWeight: '700', fontSize: 15 }}>{doneLabel}</Text>
            <View style={st.doneCount}><Text style={{ color: '#fff', fontSize: 13, fontWeight: '700' }}>{count}</Text></View>
          </Pressable>
        ) : <View style={{ width: 44 }} />}
      </View>
      {!recording && (
          <View style={[st.rail, { top: topPad + 66 }]}>
            <Pressable onPress={() => setLight((v) => !v)} style={[st.round, light && { backgroundColor: '#fcd34d' }]} accessibilityRole="button" accessibilityState={{ selected: light }} accessibilityLabel={canTorch ? 'Lanterna' : 'Flash de ecrã'}>
              <View>
                <Icon name="bolt" size={22} solid={light} color={light ? colors.zinc900 : '#fff'} />
                {!light && <View pointerEvents="none" style={{ position: 'absolute', top: 10, left: -3, height: 2, borderRadius: 1, width: 28, backgroundColor: '#fff', transform: [{ rotate: '-45deg' }] }} />}
              </View>
            </Pressable>
            {(
              <Pressable onPress={() => setDelay((d) => (d === 0 ? 3 : d === 3 ? 10 : 0))} style={[st.round, delay > 0 && { backgroundColor: '#fff' }]} accessibilityRole="button" accessibilityLabel={delay ? `Temporizador: ${delay} segundos` : 'Temporizador'}>
                <Icon name="clock" size={22} color={delay ? colors.zinc900 : '#fff'} />
                {delay > 0 && <View style={st.delayBadge}><Text style={st.delayText}>{delay}</Text></View>}
              </Pressable>
            )}
            {modes.includes('text') && onText && (
              <Pressable onPress={onText} style={st.round} accessibilityRole="button" accessibilityLabel="Só texto"><Text style={{ color: '#fff', fontWeight: '800', fontSize: 15 }}>Aa</Text></Pressable>
            )}
            {(
              <Pressable onPress={() => setLayoutOpen((v) => !v)} style={[st.round, layout !== null && { backgroundColor: '#fff' }]} accessibilityRole="button" accessibilityState={{ selected: layout !== null }} accessibilityLabel="Layout: várias fotos numa só">
                <Icon name="grid" size={22} color={layout !== null ? colors.zinc900 : '#fff'} />
              </Pressable>
            )}
          </View>
      )}

      {/* Nome do filtro ao deslizar; contagem do temporizador. */}
      {lookName ? <View pointerEvents="none" style={st.center}><Text style={st.fxName}>{lookName}</Text></View> : null}
      {zoom > 1.02 ? (
        <Pressable onPress={() => setZoom(1)} style={[st.zoomBadge, { top: topPad + 56 }]} accessibilityRole="button" accessibilityLabel="Repor zoom"><Text style={st.zoomText}>{zoom.toFixed(1)}×</Text></Pressable>
      ) : null}
      {countdown !== null ? <View pointerEvents="none" style={st.center}><Text accessibilityLiveRegion="assertive" style={st.countText}>{countdown}</Text></View> : null}

      {!ready && (
        <View style={st.center}>
          {problem === null ? (
            <Text style={{ color: 'rgba(255,255,255,0.85)', fontSize: 16 }}>A acordar a câmara…</Text>
          ) : (
            <View style={{ alignItems: 'center', paddingHorizontal: 32 }}>
              <Icon name="alert" size={48} color="rgba(255,255,255,0.7)" />
              <Text style={st.pTitle}>{problem === 'denied' ? 'Sem permissão para a câmara' : problem === 'unsupported' ? 'A câmara precisa de ligação segura' : 'Não consegui abrir a câmara'}</Text>
              <Text style={st.pSub}>{problem === 'denied' ? 'Ativa a câmara nas definições do browser, ou escolhe da galeria.' : 'Podes sempre escolher da galeria.'}</Text>
              <GalleryPick onFiles={(f) => void fillFromFiles(f)} onOpen={openGallery} style={st.open}><Text style={{ color: '#fff', fontWeight: '700', fontSize: 16 }}>Abrir galeria</Text></GalleryPick>
            </View>
          )}
        </View>
      )}

      <View style={[st.bottom, { paddingBottom: botPad }]}>
        {layoutOpen && !recording ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={st.looks} style={{ maxHeight: 52, marginBottom: 12 }} accessibilityRole="tablist" accessibilityLabel="Layout">
            <Pressable onPress={leaveLayout} style={[st.lookChip, layout === null && st.lookOn]} accessibilityRole="tab" accessibilityState={{ selected: layout === null }}>
              <Text style={[st.lookText, layout === null && { color: colors.zinc900 }]}>Sem layout</Text>
            </Pressable>
            {LAYOUTS.map((l, i) => (
              <Pressable key={l.id} onPress={() => { cellCanvases.current = []; setCells([]); setLayout(i); setLayoutOpen(false); }} style={[st.layoutChip, layout === i && st.lookOn]} accessibilityRole="tab" accessibilityState={{ selected: layout === i }} accessibilityLabel={l.name}>
                <View style={{ width: 22, height: 27, position: 'relative' }}>
                  {l.cells.map(([cx, cy, cw, ch], k) => (
                    <View key={k} style={{ position: 'absolute', left: cx * 22 + 1, top: cy * 27 + 1, width: cw * 22 - 2, height: ch * 27 - 2, borderRadius: 2, backgroundColor: layout === i ? colors.zinc900 : '#fff' }} />
                  ))}
                </View>
              </Pressable>
            ))}
          </ScrollView>
        ) : ready && !recording && (
          <ScrollView ref={looksRow} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={st.looks} style={{ maxHeight: 44, marginBottom: 12 }} accessibilityRole="tablist" accessibilityLabel="Filtros">
            {LOOKS.map((l, i) => (
              <Pressable key={l.id} onPress={() => pickLook(i)} style={[st.lookChip, look === i && st.lookOn]} accessibilityRole="tab" accessibilityState={{ selected: look === i }}>
                <Text style={[st.lookText, look === i && { color: colors.zinc900 }]}>{l.name}</Text>
              </Pressable>
            ))}
          </ScrollView>
        )}
        {thumbs && thumbs.length > 0 && !recording ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 20, gap: 6, alignItems: 'center' }} style={{ maxHeight: 54, marginBottom: 10, alignSelf: 'stretch' }} accessibilityLabel="Escolhidas">
            {thumbs.map((u, i) => (
              <View key={`${u}-${i}`} style={st.thumb}>{dom('img', { src: u, alt: '', style: { width: '100%', height: '100%', objectFit: 'cover', display: 'block' } })}</View>
            ))}
          </ScrollView>
        ) : hint && ready && !recording && count === 0 && layout === null && modes.includes('video') ? (
          <Text style={st.hint} pointerEvents="none">Toca para foto · mantém para vídeo</Text>
        ) : <View style={{ height: 26 }} />}
        <View style={st.row}>
          <View style={st.side} />
          <Pressable
            onPressIn={pressIn}
            onPressOut={pressOut}
            disabled={!ready || full}
            accessibilityRole="button"
            accessibilityLabel={countdown !== null ? 'Cancelar' : recording ? 'Parar de gravar' : 'Tirar foto; mantém premido para gravar vídeo'}
            style={[st.shutter, (!ready || full) && { opacity: 0.4 }, recording && { transform: [{ scale: 1.12 }] }]}
          >
            <View style={[st.shutterRing, recording && { borderColor: '#ef4444' }]} />
            <View style={[st.shutterIn, recording && st.shutterRec]} />
          </Pressable>
          <View style={[st.side, { alignItems: 'flex-end' }]}>
            {layout !== null ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text style={{ color: '#fff', fontWeight: '700', fontSize: 14 }}>{cells.length}/{LAYOUTS[layout].cells.length}</Text>
                <Pressable onPress={cells.length ? undoCell : leaveLayout} style={st.round} accessibilityRole="button" accessibilityLabel={cells.length ? 'Tirar a última foto do layout' : 'Sair do layout'}>
                  <Icon name={cells.length ? 'undo' : 'x'} size={20} color="#fff" strokeWidth={2.2} />
                </Pressable>
              </View>
            ) : null}
          </View>
        </View>
        {full ? <Text style={st.full} accessibilityRole="alert">Máximo de {max} fotos</Text> : null}
      </View>
      {/* Por baixo do visor: a galeria (com a última foto escolhida), os modos e o virar câmara. */}
      <View style={[st.bar, { height: barH, paddingBottom: Math.max(insets.bottom, 12) }]}>
        <View style={{ width: 44, alignItems: 'flex-start' }}>
          {!recording && (
            <GalleryPick onFiles={(f) => void fillFromFiles(f)} onOpen={openGallery} style={st.galleryThumb}>
              {thumbs && thumbs.length ? dom('img', { src: thumbs[thumbs.length - 1], alt: 'Galeria', style: { width: '100%', height: '100%', objectFit: 'cover', display: 'block', borderRadius: 9 } }) : <Icon name="images" size={22} color="#fff" strokeWidth={2} />}
            </GalleryPick>
          )}
        </View>
        {kinds && !recording ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={st.kinds} style={{ flex: 1 }} accessibilityRole="tablist">
            {kinds.map((k) => (
              <Pressable key={k.id} onPress={() => onKind?.(k.id)} accessibilityRole="tab" accessibilityState={{ selected: kind === k.id }} hitSlop={8}>
                <Text style={[st.kindText, kind === k.id && st.kindOn]}>{k.label.toUpperCase()}</Text>
              </Pressable>
            ))}
          </ScrollView>
        ) : <View style={{ flex: 1 }} />}
        <View style={{ width: 44, alignItems: 'flex-end' }}>
          {canFlip && ready && !recording ? (
            <Pressable onPress={() => setFacing((f) => (f === 'user' ? 'environment' : 'user'))} style={st.flipBtn} accessibilityRole="button" accessibilityLabel="Virar câmara"><Icon name="flip-camera" size={24} color="#fff" /></Pressable>
          ) : null}
        </View>
      </View>

      {/* Pré-visualização do que acabou de ser tirado: Repetir volta à câmara; Usar entrega a foto/vídeo. */}
      {review && (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: '#000', zIndex: 10 }]} accessibilityViewIsModal>
          {review.video
            ? dom('video', { src: review.uri, playsInline: true, autoPlay: true, loop: true, muted: true, controls: false, onClick: (ev: { currentTarget: HTMLVideoElement }) => { ev.currentTarget.muted = !ev.currentTarget.muted; void ev.currentTarget.play().catch(() => undefined); }, style: { position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain' } })
            : dom('img', { ref: imgEl, src: review.uri, alt: 'Pré-visualização', onLoad: () => setImgTick((n) => n + 1), style: { position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain' } })}
          {!review.video && freeCrop && tool === 'crop' && (() => {
            const r = imageRect();
            void imgTick;
            if (!r) return null;
            const L = r.left + box.x * r.width, T = r.top + box.y * r.height, W = box.w * r.width, H = box.h * r.height;
            const handle = (x: number, y: number) => dom('div', { key: `${x}-${y}`, style: { position: 'absolute', left: x - 14, top: y - 14, width: 28, height: 28, borderRadius: 14, background: '#fff', boxShadow: '0 1px 6px rgba(0,0,0,0.5)' } });
            return dom(
              'div',
              { style: { position: 'absolute', inset: 0, touchAction: 'none', zIndex: 2 }, onTouchStart: cropTouchStart, onTouchMove: cropTouchMove, onTouchEnd: cropTouchEnd, onTouchCancel: cropTouchEnd },
              dom('div', { key: 'box', style: { position: 'absolute', left: L, top: T, width: W, height: H, boxShadow: '0 0 0 9999px rgba(0,0,0,0.55)', border: '2px solid #fff', backgroundImage: 'linear-gradient(rgba(255,255,255,0.35) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.35) 1px, transparent 1px)', backgroundSize: `${W / 3}px ${H / 3}px` } }),
              handle(L, T), handle(L + W, T), handle(L, T + H), handle(L + W, T + H),
            );
          })()}
          <View pointerEvents="none" style={web({ position: 'absolute', left: 0, right: 0, bottom: 0, height: 200, backgroundImage: 'linear-gradient(to top, rgba(0,0,0,0.7), transparent)' })} />
          <View style={[st.top, { paddingTop: topPad }]}>
            <Pressable onPress={() => setReview(null)} style={st.round} accessibilityRole="button" accessibilityLabel="Repetir"><Icon name="x" size={24} color="#fff" strokeWidth={2.2} /></Pressable>
            {!review.video && (
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <Pressable onPress={() => changeEdit({ rot: ((edit.rot + 90) % 360) as Edit['rot'] })} style={st.round} accessibilityRole="button" accessibilityLabel="Rodar"><Icon name="repeat" size={22} color="#fff" /></Pressable>
                <Pressable onPress={() => changeEdit({ flip: !edit.flip })} style={[st.round, edit.flip && { backgroundColor: '#fff' }]} accessibilityRole="button" accessibilityLabel="Espelhar"><Icon name="flip-camera" size={22} color={edit.flip ? colors.zinc900 : '#fff'} /></Pressable>
              </View>
            )}
          </View>
          {!review.video && (
            <View style={[st.editPanel, { bottom: botPad + 62 }]}>
              {tool === 'look' && (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={st.looks} style={{ maxHeight: 44 }}>
                  {LOOKS.map((l, i) => (
                    <Pressable key={l.id} onPress={() => changeEdit({ look: i })} style={[st.lookChip, edit.look === i && st.lookOn]} accessibilityRole="tab" accessibilityState={{ selected: edit.look === i }}>
                      <Text style={[st.lookText, edit.look === i && { color: colors.zinc900 }]}>{l.name}</Text>
                    </Pressable>
                  ))}
                </ScrollView>
              )}
              {tool === 'adjust' && (
                <View style={{ paddingHorizontal: 20, gap: 6 }}>
                  {([['b', 'Brilho', 0.6, 1.4], ['c', 'Contraste', 0.6, 1.4], ['s', 'Saturação', 0, 2]] as const).map(([k, label, min, max]) => (
                    <View key={k} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                      <Text style={{ width: 78, color: '#fff', fontSize: 13, fontWeight: '700' }}>{label}</Text>
                      {dom('input', { type: 'range', min, max, step: 0.02, value: edit[k], 'aria-label': label, onInput: (ev: { target: HTMLInputElement }) => changeEdit({ [k]: Number(ev.target.value) } as Partial<Edit>), style: { flex: 1, accentColor: '#d6334f', height: 28 } })}
                    </View>
                  ))}
                </View>
              )}
              {tool === 'crop' && (
                <View style={[st.looks, { flexDirection: 'row', justifyContent: 'center' }]}>
                  <Pressable onPress={startFreeCrop} style={[st.lookChip, freeCrop && st.lookOn]} accessibilityRole="tab" accessibilityState={{ selected: freeCrop }}>
                    <Text style={[st.lookText, freeCrop && { color: colors.zinc900 }]}>Livre</Text>
                  </Pressable>
                  {freeCrop && (
                    <Pressable onPress={endFreeCrop} style={st.cropOk} accessibilityRole="button" accessibilityLabel="Concluir o recorte">
                      <Icon name="check" size={16} color="#fff" strokeWidth={3} />
                      <Text style={{ color: '#fff', fontWeight: '800', fontSize: 13 }}>Concluir</Text>
                    </Pressable>
                  )}
                  {([[null, 'Original'], [1, '1:1'], [0.8, '4:5'], [9 / 16, '9:16'], [16 / 9, '16:9']] as const).map(([a, label]) => (
                    <Pressable key={label} onPress={() => { setFreeCrop(false); changeEdit({ aspect: a, box: null }); }} style={[st.lookChip, !freeCrop && edit.aspect === a && edit.box === null && st.lookOn]} accessibilityRole="tab" accessibilityState={{ selected: !freeCrop && edit.aspect === a }}>
                      <Text style={[st.lookText, !freeCrop && edit.aspect === a && edit.box === null && { color: colors.zinc900 }]}>{label}</Text>
                    </Pressable>
                  ))}
                </View>
              )}
              <View style={st.toolRow}>
                {([['look', 'sparkles', 'Filtros'], ['adjust', 'sliders', 'Ajustar'], ['crop', 'expand', 'Cortar']] as const).map(([t, ic, label]) => (
                  <Pressable key={t} onPress={() => { endFreeCrop(); setTool((cur) => (cur === t ? null : t)); }} style={st.toolBtn} accessibilityRole="tab" accessibilityState={{ selected: tool === t }}>
                    <Icon name={ic} size={22} color={tool === t ? '#fff' : 'rgba(255,255,255,0.7)'} strokeWidth={2} />
                    <Text style={[st.toolText, tool === t && { color: '#fff' }]}>{label}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          )}
          <View style={[st.reviewBar, { paddingBottom: botPad }]}>
            <Pressable onPress={() => setReview(null)} style={st.retake} accessibilityRole="button"><Icon name="undo" size={20} color="#fff" strokeWidth={2.2} /><Text style={st.retakeText}>Repetir</Text></Pressable>
            <Pressable
              onPress={() => {
                const r = review;
                const src = reviewSrc.current;
                if (!r.video && src) {
                  const final = { ...edit, box: freeCrop ? boxRef.current : edit.box, aspect: freeCrop ? null : edit.aspect };
                  renderEdit(src, final).toBlob((blob) => { reviewSrc.current = null; setReview(null); setTool(null); setFreeCrop(false); onShot(blob ? { uri: URL.createObjectURL(blob), video: false, mime: 'image/jpeg' } : r); }, 'image/jpeg', 0.92);
                  return;
                }
                setReview(null); setTool(null); onShot(r);
              }}
              style={st.use}
              accessibilityRole="button"
            ><Text style={st.useText}>{review.video ? 'Usar vídeo' : 'Usar foto'}</Text><Icon name="check" size={20} color="#fff" strokeWidth={3} /></Pressable>
          </View>
        </View>
      )}
    </View>
  );
}

/** Botão que abre o seletor de ficheiros do browser (fotos e vídeos). */
export function GalleryPick({ onFiles, onOpen, style, children }: { onFiles: (f: File[]) => void; onOpen?: () => void; style?: object; children: ReactNode }) {
  return (
    <View style={style as never} accessibilityRole="button" accessibilityLabel="Galeria">
      {children}
      {createElement('input', {
        type: 'file',
        multiple: true,
        accept: 'image/*,video/*',
        onClick: () => onOpen?.(),
        'aria-label': 'Escolher da galeria',
        style: { position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0, cursor: 'pointer' },
        onChange: (e: { target: HTMLInputElement }) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = '';
          if (files.length) onFiles(files);
        },
      })}
    </View>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  top: { position: 'absolute', left: 0, right: 0, top: 0, zIndex: 6, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12 },
  round: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.14)', alignItems: 'center', justifyContent: 'center' },
  delayBadge: { position: 'absolute', right: -4, bottom: -4, minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 4, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  delayText: { color: '#fff', fontSize: 11, fontWeight: '800' },
  rec: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 999, backgroundColor: 'rgba(0,0,0,0.55)', paddingHorizontal: 14, paddingVertical: 8 },
  recDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#ef4444' },
  recText: { color: '#fff', fontWeight: '700', fontSize: 15, fontVariant: ['tabular-nums'] },
  center: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', zIndex: 2 },
  fxName: { color: '#fff', fontSize: 22, fontWeight: '800', textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 8, borderRadius: 999, backgroundColor: 'rgba(0,0,0,0.35)', paddingHorizontal: 18, paddingVertical: 8, overflow: 'hidden' },
  countText: { fontSize: 120, fontWeight: '900', color: '#fff', textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 20 },
  pTitle: { marginTop: 12, color: '#fff', fontSize: 18, fontWeight: '700', textAlign: 'center' },
  pSub: { marginTop: 4, color: 'rgba(255,255,255,0.7)', fontSize: 14, textAlign: 'center' },
  open: { marginTop: 20, height: 48, borderRadius: 24, backgroundColor: colors.brand, paddingHorizontal: 24, alignItems: 'center', justifyContent: 'center' },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 3, alignItems: 'center' },
  looks: { paddingHorizontal: 16, gap: 6, alignItems: 'center' },
  lookChip: { height: 30, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.14)', paddingHorizontal: 13, alignItems: 'center', justifyContent: 'center' },
  lookOn: { backgroundColor: '#fff' },
  layoutChip: { height: 40, borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.35)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.35)', paddingHorizontal: 10, alignItems: 'center', justifyContent: 'center' },
  lookText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  zoomBadge: { position: 'absolute', alignSelf: 'center', zIndex: 3, borderRadius: 999, backgroundColor: 'rgba(0,0,0,0.5)', paddingHorizontal: 12, paddingVertical: 5 },
  zoomText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  modes: { flexDirection: 'row', gap: 4, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.14)', padding: 3, marginBottom: 18 },
  mode: { borderRadius: 999, paddingHorizontal: 18, paddingVertical: 6 },
  modeText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  row: { width: '100%', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 28 },
  side: { width: 92, alignItems: 'flex-start' },
  gallery: { width: 52, height: 52, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.14)', borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.5)', alignItems: 'center', justifyContent: 'center' },
  shutter: { width: 84, height: 84, borderRadius: 42, alignItems: 'center', justifyContent: 'center' },
  shutterRing: { position: 'absolute', left: 0, top: 0, width: 84, height: 84, borderRadius: 42, borderWidth: 4, borderColor: '#fff' },
  shutterIn: { width: 66, height: 66, borderRadius: 33, backgroundColor: '#fff' },
  shutterRec: { width: 30, height: 30, borderRadius: 8, backgroundColor: '#ef4444' },
  hint: { color: 'rgba(255,255,255,0.8)', fontSize: 12, fontWeight: '600', marginBottom: 14 },
  thumb: { width: 44, height: 44, borderRadius: 8, overflow: 'hidden', borderWidth: 2, borderColor: colors.brand, backgroundColor: '#222' },
  kinds: { flexGrow: 1, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 14, paddingHorizontal: 4 },
  bar: { position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 3, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, gap: 6, backgroundColor: '#000' },
  galleryThumb: { width: 40, height: 40, borderRadius: 11, borderWidth: 2, borderColor: '#fff', overflow: 'hidden', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.12)' },
  flipBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.14)', alignItems: 'center', justifyContent: 'center' },
  rail: { position: 'absolute', left: 12, zIndex: 3, gap: 12 },
  cropOk: { height: 30, paddingHorizontal: 12, borderRadius: 15, backgroundColor: colors.brand, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  corner: { position: 'absolute', width: 30, height: 30, borderColor: colors.brand, opacity: 0.9 },
  wordmark: { color: 'rgba(255,255,255,0.8)', fontSize: 15, fontWeight: '900', letterSpacing: -0.5 },
  kindText: { color: 'rgba(255,255,255,0.55)', fontSize: 12, fontWeight: '800', letterSpacing: 0.6 },
  kindOn: { color: '#fff' },
  stopSq: { width: 32, height: 32, borderRadius: 9, backgroundColor: '#ef4444' },
  doneBtn: { height: 46, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 23, backgroundColor: colors.brand, paddingHorizontal: 16 },
  doneCount: { minWidth: 22, height: 22, borderRadius: 11, backgroundColor: 'rgba(255,255,255,0.28)', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  full: { marginTop: 10, color: '#fff', fontSize: 14, fontWeight: '600' },
  editPanel: { position: 'absolute', left: 0, right: 0, zIndex: 6, gap: 10, paddingTop: 10, paddingBottom: 6, backgroundColor: 'rgba(0,0,0,0.75)' },
  toolRow: { flexDirection: 'row', justifyContent: 'center', gap: 28 },
  toolBtn: { alignItems: 'center', gap: 3 },
  toolText: { color: 'rgba(255,255,255,0.7)', fontSize: 11, fontWeight: '700' },
  reviewBar: { zIndex: 6, position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, gap: 12 },
  retake: { height: 50, flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 25, backgroundColor: 'rgba(255,255,255,0.16)', paddingHorizontal: 20 },
  retakeText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  use: { flex: 1, height: 50, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 25, backgroundColor: colors.brand, boxShadow: '0 6px 18px rgba(214,51,79,0.45)' } as object,
  useText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
