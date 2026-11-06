import type React from 'react';
import { createElement, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '@/lib/theme';
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
  count, max, modes = ['photo', 'video', 'text'], onShot, onGallery, onClose, onDone, onText, doneLabel = 'Feito',
}: {
  count: number; max: number; modes?: CamMode[]; onShot: (s: Shot) => void; onGallery: (files: File[]) => void; onClose: () => void; onDone?: () => void; onText?: () => void; doneLabel?: string;
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
  type Edit = { rot: 0 | 90 | 180 | 270; flip: boolean; aspect: number | null; look: number; b: number; c: number; s: number };
  const EDIT0: Edit = { rot: 0, flip: false, aspect: null, look: 0, b: 1, c: 1, s: 1 };
  const [edit, setEdit] = useState<Edit>(EDIT0);
  const [tool, setTool] = useState<null | 'look' | 'adjust' | 'crop'>(null);
  const renderTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  function renderEdit(src: HTMLCanvasElement, e: Edit): HTMLCanvasElement {
    const turned = e.rot === 90 || e.rot === 270;
    const w = turned ? src.height : src.width, h = turned ? src.width : src.height;
    // Corte ao centro na proporção pedida.
    let cw = w, ch = h;
    if (e.aspect) { if (w / h > e.aspect) cw = Math.round(h * e.aspect); else ch = Math.round(w / e.aspect); }
    const out = document.createElement('canvas');
    out.width = cw;
    out.height = ch;
    const g = out.getContext('2d')!;
    g.translate(cw / 2, ch / 2);
    g.rotate((e.rot * Math.PI) / 180);
    if (e.flip) g.scale(-1, 1);
    g.drawImage(src, -src.width / 2, -src.height / 2);
    const base = LOOKS[e.look];
    const l: Look = { ...base, id: base.id === 'normal' && e.b === 1 && e.c === 1 && e.s === 1 ? 'normal' : 'edit', b: base.b * e.b, c: base.c * e.c, s: base.s * e.s };
    applyLook(out, l);
    return out;
  }
  function openReview(c: HTMLCanvasElement) {
    reviewSrc.current = c;
    setEdit(EDIT0);
    setTool(null);
    c.toBlob((blob) => blob && setReview({ uri: URL.createObjectURL(blob), video: false, mime: 'image/jpeg' }), 'image/jpeg', 0.9);
  }
  function changeEdit(patch: Partial<Edit>) {
    const e = { ...edit, ...patch };
    setEdit(e);
    clearTimeout(renderTimer.current);
    renderTimer.current = setTimeout(() => {
      const src = reviewSrc.current;
      if (!src) return;
      renderEdit(src, e).toBlob((blob) => blob && setReview((r) => (r && !r.video ? { ...r, uri: URL.createObjectURL(blob) } : r)), 'image/jpeg', 0.9);
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
      const s = await acquireCamera(facing, mode === 'video');
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
  }, [facing, mode]);

  useEffect(() => { void start(); }, [start]);
  useEffect(() => () => {
    releaseCamera(2_000);
    clearInterval(timer.current);
    clearInterval(countTimer.current);
    if (recorder.current?.state === 'recording') recorder.current.stop();
  }, []);
  // No iPhone, o seletor de fotos não devolve nada enquanto a câmara está ligada: desliga-se ao abrir a galeria e religa-se quando o seletor fecha.
  useEffect(() => {
    const back = () => {
      if (!pausedForPicker.current) return;
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
      const k = Math.max(area.w / v.videoWidth, area.h / v.videoHeight) * zoom;
      const vx0 = (v.videoWidth - area.w / k) / 2, vy0 = (v.videoHeight - area.h / k) / 2;
      const sx = vx0 + cell.x / k, sy = vy0 + cell.y / k, sw = cell.w / k, sh = cell.h / k;
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
    const fh = Math.min(fw * 1.25, Math.max(200, area.h - topPad - 70 - 220));
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
        const r = rects[list.length];
        const c = document.createElement('canvas');
        const k = Math.min(1, 1400 / Math.max(r.w, r.h));
        c.width = Math.round(r.w * 2 * k);
        c.height = Math.round(r.h * 2 * k);
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
      if (t >= MAX_VIDEO_S) r.stop();
    }, 250);
  }

  /** Obturador: com temporizador faz a contagem e só depois dispara; tocar outra vez cancela. */
  function press() {
    if (countdown !== null) { clearInterval(countTimer.current); return setCountdown(null); }
    const fire = () => (mode === 'photo' ? void shoot() : record());
    if (!delay || recording) return fire();
    let n: number = delay;
    setCountdown(n);
    countTimer.current = setInterval(() => {
      n -= 1;
      if (n <= 0) { clearInterval(countTimer.current); setCountdown(null); fire(); } else setCountdown(n);
    }, 1000);
  }

  const mm = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  const mirror = facing === 'user' ? 'scaleX(-1)' : 'none';
  const fill = { position: 'absolute', left: 0, top: 0, width: '100%', height: '100%', objectFit: 'cover' };
  const botPad = Math.max(insets.bottom, 20);

  return (
    <View style={st.root} accessibilityViewIsModal onLayout={(e: LayoutChangeEvent) => setArea({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
      {dom(
        'div',
        {
          style: { position: 'absolute', inset: 0, backgroundColor: '#000', touchAction: 'none', overflow: 'hidden' },
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
        dom('video', { ref: video, playsInline: true, muted: true, autoPlay: true, style: { ...fill, transform: `${mirror === 'none' ? '' : mirror + ' '}scale(${zoom})`, filter: lookCss(LOOKS[look]), visibility: ready ? 'visible' : 'hidden', transition: 'filter 180ms' } }),
        LOOKS[look].tint && dom('div', { key: 'tint', style: { position: 'absolute', inset: 0, pointerEvents: 'none', backgroundColor: `rgba(${LOOKS[look].tint!.join(',')})` } }),
        layout !== null && area.w > 0 && dom(
          'div',
          { key: 'frame', style: { position: 'absolute', left: frame.x, top: frame.y, width: frame.w, height: frame.h, pointerEvents: 'none', boxShadow: '0 0 0 9999px rgba(0,0,0,0.6)', borderRadius: 6 } },
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
      <View pointerEvents="none" style={web({ position: 'absolute', left: 0, right: 0, top: 0, height: 140, backgroundImage: 'linear-gradient(to bottom, rgba(0,0,0,0.55), transparent)' })} />
      <View pointerEvents="none" style={web({ position: 'absolute', left: 0, right: 0, bottom: 0, height: 260, backgroundImage: 'linear-gradient(to top, rgba(0,0,0,0.7), transparent)' })} />
      {lit ? <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: '#fff' }]} /> : null}
      {flash ? <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: '#fff' }]} /> : null}

      {/* Em cima: fechar; flash, temporizador, virar. */}
      <View style={[st.top, { paddingTop: topPad }]}>
        <Pressable onPress={onClose} style={st.round} accessibilityRole="button" accessibilityLabel="Fechar câmara"><Icon name="x" size={24} color="#fff" strokeWidth={2.2} /></Pressable>
        {recording ? (
          <View style={st.rec}><View style={st.recDot} /><Text style={st.recText}>{mm}</Text></View>
        ) : (
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Pressable onPress={() => setLight((v) => !v)} style={[st.round, light && { backgroundColor: '#fcd34d' }]} accessibilityRole="button" accessibilityState={{ selected: light }} accessibilityLabel={canTorch ? 'Lanterna' : 'Flash de ecrã'}>
              <View>
                <Icon name="bolt" size={22} solid={light} color={light ? colors.zinc900 : '#fff'} />
                {!light && <View pointerEvents="none" style={{ position: 'absolute', top: 10, left: -3, height: 2, borderRadius: 1, width: 28, backgroundColor: '#fff', transform: [{ rotate: '-45deg' }] }} />}
              </View>
            </Pressable>
            {mode !== 'text' && (
              <Pressable onPress={() => setDelay((d) => (d === 0 ? 3 : d === 3 ? 10 : 0))} style={[st.round, delay > 0 && { backgroundColor: '#fff' }]} accessibilityRole="button" accessibilityLabel={delay ? `Temporizador: ${delay} segundos` : 'Temporizador'}>
                <Icon name="clock" size={22} color={delay ? colors.zinc900 : '#fff'} />
                {delay > 0 && <View style={st.delayBadge}><Text style={st.delayText}>{delay}</Text></View>}
              </Pressable>
            )}
            {mode === 'photo' && (
              <Pressable onPress={() => setLayoutOpen((v) => !v)} style={[st.round, layout !== null && { backgroundColor: '#fff' }]} accessibilityRole="button" accessibilityState={{ selected: layout !== null }} accessibilityLabel="Layout: várias fotos numa só">
                <Icon name="grid" size={22} color={layout !== null ? colors.zinc900 : '#fff'} />
              </Pressable>
            )}
            {canFlip && ready ? (
              <Pressable onPress={() => setFacing((f) => (f === 'user' ? 'environment' : 'user'))} style={st.round} accessibilityRole="button" accessibilityLabel="Virar câmara"><Icon name="flip-camera" size={22} color="#fff" /></Pressable>
            ) : null}
          </View>
        )}
      </View>

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
        {layoutOpen && !recording && mode === 'photo' ? (
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
        ) : ready && !recording && mode !== 'text' && (
          <ScrollView ref={looksRow} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={st.looks} style={{ maxHeight: 44, marginBottom: 12 }} accessibilityRole="tablist" accessibilityLabel="Filtros">
            {LOOKS.map((l, i) => (
              <Pressable key={l.id} onPress={() => pickLook(i)} style={[st.lookChip, look === i && st.lookOn]} accessibilityRole="tab" accessibilityState={{ selected: look === i }}>
                <Text style={[st.lookText, look === i && { color: colors.zinc900 }]}>{l.name}</Text>
              </Pressable>
            ))}
          </ScrollView>
        )}
        {!recording && modes.length > 1 ? (
          <View style={st.modes} accessibilityRole="tablist">
            {modes.map((m) => (
              <Pressable key={m} onPress={() => (m === 'text' ? onText?.() : setMode(m))} style={[st.mode, mode === m && { backgroundColor: 'rgba(255,255,255,0.92)' }]} accessibilityRole="tab" accessibilityState={{ selected: mode === m }}>
                <Text style={[st.modeText, mode === m && { color: colors.zinc900 }]}>{m === 'photo' ? 'Foto' : m === 'video' ? 'Vídeo' : 'Texto'}</Text>
              </Pressable>
            ))}
          </View>
        ) : <View style={{ height: 34 }} />}
        <View style={st.row}>
          <View style={st.side}>
            {!recording && (
              <GalleryPick onFiles={(f) => void fillFromFiles(f)} onOpen={openGallery} style={st.gallery}><Icon name="images" size={24} color="#fff" strokeWidth={2} /></GalleryPick>
            )}
          </View>
          <Pressable
            onPress={press}
            disabled={!ready || full}
            accessibilityRole="button"
            accessibilityLabel={countdown !== null ? 'Cancelar' : mode === 'photo' ? 'Tirar foto' : recording ? 'Parar de gravar' : 'Gravar vídeo'}
            style={({ pressed }) => [st.shutter, (!ready || full) && { opacity: 0.4 }, pressed && { transform: [{ scale: 0.92 }] }]}
          >
            <View style={web({ position: 'absolute', inset: 0, borderRadius: 44, padding: 4, backgroundImage: recording ? 'conic-gradient(#ef4444, #ff8a80, #ef4444)' : 'conic-gradient(from 200deg, #d6334f, #ff9a5b, #ffd166, #d6334f)' })}>
              <View style={{ flex: 1, borderRadius: 40, backgroundColor: 'rgba(0,0,0,0.65)' }} />
            </View>
            {recording ? (
              <View style={st.stopSq} />
            ) : (
              <View style={[st.shutterIn, mode === 'video' && { backgroundColor: colors.brand }]} />
            )}
          </Pressable>
          <View style={[st.side, { alignItems: 'flex-end' }]}>
            {layout !== null ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text style={{ color: '#fff', fontWeight: '700', fontSize: 14 }}>{cells.length}/{LAYOUTS[layout].cells.length}</Text>
                <Pressable onPress={cells.length ? undoCell : leaveLayout} style={st.round} accessibilityRole="button" accessibilityLabel={cells.length ? 'Tirar a última foto do layout' : 'Sair do layout'}>
                  <Icon name={cells.length ? 'undo' : 'x'} size={20} color="#fff" strokeWidth={2.2} />
                </Pressable>
              </View>
            ) : count > 0 && onDone && !recording ? (
              <Pressable onPress={onDone} style={st.doneBtn} accessibilityRole="button" accessibilityLabel={`${doneLabel}, ${count}`}>
                <Text style={{ color: '#fff', fontWeight: '700', fontSize: 15 }}>{doneLabel}</Text>
                <View style={st.doneCount}><Text style={{ color: '#fff', fontSize: 13, fontWeight: '700' }}>{count}</Text></View>
              </Pressable>
            ) : null}
          </View>
        </View>
        {full ? <Text style={st.full} accessibilityRole="alert">Máximo de {max} fotos</Text> : null}
      </View>

      {/* Pré-visualização do que acabou de ser tirado: Repetir volta à câmara; Usar entrega a foto/vídeo. */}
      {review && (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: '#000', zIndex: 10 }]} accessibilityViewIsModal>
          {review.video
            ? dom('video', { src: review.uri, playsInline: true, autoPlay: true, loop: true, muted: false, controls: false, style: { position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain' } })
            : dom('img', { src: review.uri, alt: 'Pré-visualização', style: { position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain' } })}
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
                  {([[null, 'Original'], [1, '1:1'], [0.8, '4:5'], [9 / 16, '9:16'], [16 / 9, '16:9']] as const).map(([a, label]) => (
                    <Pressable key={label} onPress={() => changeEdit({ aspect: a })} style={[st.lookChip, edit.aspect === a && st.lookOn]} accessibilityRole="tab" accessibilityState={{ selected: edit.aspect === a }}>
                      <Text style={[st.lookText, edit.aspect === a && { color: colors.zinc900 }]}>{label}</Text>
                    </Pressable>
                  ))}
                </View>
              )}
              <View style={st.toolRow}>
                {([['look', 'sparkles', 'Filtros'], ['adjust', 'sliders', 'Ajustar'], ['crop', 'expand', 'Cortar']] as const).map(([t, ic, label]) => (
                  <Pressable key={t} onPress={() => setTool((cur) => (cur === t ? null : t))} style={st.toolBtn} accessibilityRole="tab" accessibilityState={{ selected: tool === t }}>
                    <Icon name={ic} size={22} color={tool === t ? '#fff' : 'rgba(255,255,255,0.7)'} strokeWidth={2} />
                    <Text style={[st.toolText, tool === t && { color: '#fff' }]}>{label}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          )}
          <View style={[st.reviewBar, { paddingBottom: botPad }]}>
            <Pressable onPress={() => setReview(null)} style={st.retake} accessibilityRole="button"><Icon name="undo" size={20} color="#fff" strokeWidth={2.2} /><Text style={st.retakeText}>Repetir</Text></Pressable>
            <Pressable onPress={() => { const r = review; setReview(null); setTool(null); onShot(r); }} style={st.use} accessibilityRole="button"><Text style={st.useText}>{review.video ? 'Usar vídeo' : 'Usar foto'}</Text><Icon name="check" size={20} color="#fff" strokeWidth={3} /></Pressable>
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
  top: { position: 'absolute', left: 0, right: 0, top: 0, zIndex: 3, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12 },
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
  lookChip: { height: 34, borderRadius: 999, backgroundColor: 'rgba(0,0,0,0.35)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.35)', paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center' },
  lookOn: { backgroundColor: '#fff', borderColor: '#fff' },
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
  shutter: { width: 88, height: 88, borderRadius: 44, alignItems: 'center', justifyContent: 'center' },
  shutterIn: { width: 64, height: 64, borderRadius: 32, backgroundColor: '#fff' },
  stopSq: { width: 32, height: 32, borderRadius: 9, backgroundColor: '#ef4444' },
  doneBtn: { height: 46, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 23, backgroundColor: colors.brand, paddingHorizontal: 16 },
  doneCount: { minWidth: 22, height: 22, borderRadius: 11, backgroundColor: 'rgba(255,255,255,0.28)', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  full: { marginTop: 10, color: '#fff', fontSize: 14, fontWeight: '600' },
  editPanel: { position: 'absolute', left: 0, right: 0, gap: 10, paddingTop: 10, paddingBottom: 6, backgroundColor: 'rgba(0,0,0,0.55)' },
  toolRow: { flexDirection: 'row', justifyContent: 'center', gap: 28 },
  toolBtn: { alignItems: 'center', gap: 3 },
  toolText: { color: 'rgba(255,255,255,0.7)', fontSize: 11, fontWeight: '700' },
  reviewBar: { position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, gap: 12 },
  retake: { height: 50, flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 25, backgroundColor: 'rgba(255,255,255,0.16)', paddingHorizontal: 20 },
  retakeText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  use: { flex: 1, height: 50, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 25, backgroundColor: colors.brand, boxShadow: '0 6px 18px rgba(214,51,79,0.45)' } as object,
  useText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
