import type React from 'react';
import { createElement, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Path } from 'react-native-svg';
import { colors } from '@/lib/theme';
import { FeatureIntro } from './FeatureIntro';
import { Icon } from './Icon';
import { acquireCamera, releaseCamera } from './zas/cameraSession';
import {
  activePill, bestMatch, browserKind, classifyCameraError, clock, coverCrop, exposureLabel, exposureValue, fallbackConstraints, ncc,
  permissionSteps, photoUpgrade, pickRecorderType, readCaps, recorderFile, retryWithFallback, sensorRatioFor, tapToPoint, videoBitrate,
  videoCropToPhoto, zoomLabel, zoomLimits, zoomPills, zoomPlan, type CamCaps, type CamProblem, type Rect,
  freshVideoFor, nextVideo, viewTransform, encodePhoto, fitLong, PHOTO_BASE, PHOTO_MAX_LONG, PHOTO_SAFE, upgradeTooSlow,
} from '@/lib/webCamera';
import { useAuth } from '@/lib/auth';
import { finalMs, musicRateWhileRecording, recordableMs, segmentBar, SPEEDS, speedLabel, TCHEKA_MAX_S } from '@/lib/tchekaRules';
import { POST_RATIO_DEFAULT, POST_RATIO_MAX, POST_RATIO_MIN } from '@/lib/postAspect';
import {
  SEAL_BLUE, SEAL_CHECK, SEAL_CHECK_WIDTH, SEAL_CORAL, SEAL_PATH, WORDMARK_BOX, WORDMARK_DOT, WORDMARK_PATHS, WORDMARK_STROKE, sealOf, sealPaint, signLayout,
  type SealTier,
} from '@/lib/wordmark';

/**
 * A câmara oficial do Txillapp no browser (publicações, status). Ecrã inteiro, com a identidade da marca:
 * obturador com anel coral em degradê, filtros de cor (carrossel e a deslizar no visor), layout (várias fotos numa só), zoom por pinça,
 * flash/lanterna, temporizador, virar câmara, foto ou vídeo (até 60 s), e a galeria lá dentro. Precisa de HTTPS ou localhost (regra dos browsers).
 * Só deve ser montada quando `liveCameraSupported()`.
 */
export const liveCameraSupported = () => Platform.OS === 'web' && typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;

/**
 * Uma foto ou vídeo pronto a usar. `signed`: já leva a assinatura do Txillapp gravada pela câmara da app (ao guardar um
 * mimo, o servidor não a volta a pôr); fotos e vídeos da galeria não a levam. `clean`: a mesma foto sem a assinatura (só
 * quando se pede `keepClean`, para o estúdio de tchekas, que assina o vídeo inteiro).
 */
export interface Shot { uri: string; video: boolean; mime: string; durationMs?: number; signed?: boolean; clean?: string; /** Num tcheka: a velocidade a que o clipe foi gravado (0,5× a 3×); o estúdio toca-o a essa velocidade. */ speed?: number; /** O instante da capa escolhido no estúdio (ms). */ posterMs?: number }

/**
 * Gravação ao estilo do TikTok (num tcheka): segurar grava e largar pára, em vários clipes, sem revisão entre eles; a
 * barra de cima mostra os clipes até 60 s; desfazer tira o último; velocidade 0,5× a 3×; o temporizador (3 s ou 10 s)
 * começa a gravar sozinho. O som escolhido toca enquanto se grava (à velocidade certa, para bater certo no fim).
 */
export interface SegmentedRec {
  /** Os clipes já feitos, em ms no vídeo final (os vídeos à velocidade deles; as fotos com a duração que levam). */
  clipsMs: number[];
  onUndo: () => void;
  musicUrl?: string | null;
  musicTitle?: string | null;
  onMusic?: () => void;
}
export type CamMode = 'photo' | 'video' | 'text';
type Problem = null | CamProblem | 'unsupported';
const MAX_VIDEO_S = 60;
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
/** O JPEG da foto final: 92 %, ou 85 % se passar do que o servidor aceita (webCamera.encodePhoto). */
const photoJpeg = (c: HTMLCanvasElement) => encodePhoto((q) => new Promise<Blob | null>((res) => c.toBlob(res, 'image/jpeg', q)));
/** Um filtro na fila: a imagem de exemplo (o que a câmara vê, ou a foto tirada) já com o filtro, e o nome por baixo. */
function LookSwatch({ look, src, on, onPress }: { look: Look; src: string | null; on: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={{ width: 58, alignItems: 'center', gap: 4 }} accessibilityRole="tab" accessibilityState={{ selected: on }} accessibilityLabel={`Filtro ${look.name}`}>
      <View style={{ width: 52, height: 52, borderRadius: 26, overflow: 'hidden', borderWidth: on ? 2.5 : 1, borderColor: on ? '#fff' : 'rgba(255,255,255,0.45)', backgroundColor: 'rgba(255,255,255,0.15)' }}>
        {src ? dom('img', { src, alt: '', style: { width: '100%', height: '100%', objectFit: 'cover', display: 'block', filter: lookCss(look) } }) : null}
        {src && look.tint ? <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: `rgba(${look.tint.join(',')})` }} /> : null}
      </View>
      <Text numberOfLines={1} style={{ color: '#fff', fontSize: 11, fontWeight: on ? '800' : '600', textShadowColor: 'rgba(0,0,0,0.5)', textShadowRadius: 3 }}>{look.name}</Text>
    </Pressable>
  );
}

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
/**
 * A assinatura do Txillapp nas fotos e tchekas: o logótipo verdadeiro em branco (o ponto do i a coral), com sombra suave,
 * em baixo à direita, e por baixo o @ de quem tirou. Conta verificada (`seal`): o selo a seguir ao @, com a mesma sombra.
 */
export function stampTxillapp(g: CanvasRenderingContext2D, W: number, H: number, username?: string | null, seal?: SealTier | null) {
  const L = signLayout(W, H, !!username, seal);
  g.save();
  g.shadowColor = 'rgba(0,0,0,0.45)';
  g.shadowBlur = L.blur;
  g.shadowOffsetY = L.s * 2;
  g.translate(L.x - WORDMARK_BOX.x * L.s, L.y - WORDMARK_BOX.y * L.s);
  g.scale(L.s, L.s);
  g.lineWidth = WORDMARK_STROKE;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.strokeStyle = '#fff';
  for (const d of WORDMARK_PATHS) g.stroke(new Path2D(d));
  g.fillStyle = '#ff5c6c';
  g.beginPath();
  g.arc(WORDMARK_DOT.cx, WORDMARK_DOT.cy, WORDMARK_DOT.r, 0, Math.PI * 2);
  g.fill();
  g.restore();
  if (username) {
    g.save();
    g.shadowColor = 'rgba(0,0,0,0.5)';
    g.shadowBlur = L.blur;
    g.font = `700 ${L.userSize}px "Inter", -apple-system, system-ui, "Helvetica Neue", Arial, sans-serif`;
    g.textAlign = 'right';
    g.textBaseline = 'alphabetic';
    g.fillStyle = 'rgba(255,255,255,0.92)';
    g.fillText(`@${username}`, L.textRight, L.userBaseline);
    g.restore();
  }
  if (L.seal) {
    // O selo: a roseta com a sombra do @ e, por cima, o visto branco (sem sombra, como no VerifiedBadge).
    const b = L.seal;
    g.save();
    g.translate(b.x, b.y);
    g.scale(b.k, b.k);
    if (sealPaint(b.tier) === 'coral') {
      const o = SEAL_CORAL;
      const grad = g.createLinearGradient(o.x0, o.y0, o.x1, o.y1);
      grad.addColorStop(0, o.from);
      grad.addColorStop(1, o.to);
      g.fillStyle = grad;
    } else {
      g.fillStyle = SEAL_BLUE;
    }
    g.shadowColor = 'rgba(0,0,0,0.5)';
    g.shadowBlur = L.blur;
    g.fill(new Path2D(SEAL_PATH));
    g.shadowColor = 'transparent';
    g.shadowBlur = 0;
    g.strokeStyle = '#fff';
    g.lineWidth = SEAL_CHECK_WIDTH;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.stroke(new Path2D(SEAL_CHECK));
    g.restore();
  }
}

export const LAYOUTS: { id: string; name: string; cells: Cell[] }[] = [
  { id: '2v', name: '2 lado a lado', cells: [[0, 0, 0.5, 1], [0.5, 0, 0.5, 1]] },
  { id: '2h', name: '2 em cima e baixo', cells: [[0, 0, 1, 0.5], [0, 0.5, 1, 0.5]] },
  { id: '3', name: '1 grande + 2', cells: [[0, 0, 0.5, 1], [0.5, 0, 0.5, 0.5], [0.5, 0.5, 0.5, 0.5]] },
  { id: '4', name: '4', cells: [[0, 0, 0.5, 0.5], [0.5, 0, 0.5, 0.5], [0, 0.5, 0.5, 0.5], [0.5, 0.5, 0.5, 0.5]] },
  { id: '6', name: '6', cells: [[0, 0, 0.5, 1 / 3], [0.5, 0, 0.5, 1 / 3], [0, 1 / 3, 0.5, 1 / 3], [0.5, 1 / 3, 0.5, 1 / 3], [0, 2 / 3, 0.5, 1 / 3], [0.5, 2 / 3, 0.5, 1 / 3]] },
];
const GAP = 3; // a linha branca entre as fotos
/** O tamanho da foto do layout (4:5). Era 1080×1350: com o stream maior cada célula tem píxeis que cheguem para 1440×1800. */
export const LAYOUT_W = 1440, LAYOUT_H = 1800;
/** Desenha `src` a preencher o retângulo (cover), cortando o que sobra. */
function cover(g: CanvasRenderingContext2D, src: CanvasImageSource, srcW: number, srcH: number, x: number, y: number, w: number, h: number) {
  const k = Math.max(w / srcW, h / srcH);
  const sw = w / k, sh = h / k;
  // Cada foto do layout é reduzida para a sua célula: com a qualidade de omissão ('low') a redução serrilha.
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  g.drawImage(src, (srcW - sw) / 2, (srcH - sh) / 2, sw, sh, x, y, w, h);
}

const buzz = (ms: number) => { try { navigator.vibrate?.(ms); } catch { /* sem vibração */ } };

// ----- Câmara a sério no browser: as partes que mexem no DOM (as contas estão em lib/webCamera).
const IOS = typeof navigator !== 'undefined' && (/iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));
const NO_CAPS: CamCaps = { zoom: null, torch: false, focus: false, focusMode: null, exposure: null, flash: false };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('timeout')), ms);
    p.then((v) => { clearTimeout(t); res(v); }, (e) => { clearTimeout(t); rej(e); });
  });
}
/** Espera pelo loadedmetadata: antes disso o videoWidth é 0 e as contas do recorte saíam mal (sobretudo no iPhone). */
function whenMeasured(v: HTMLVideoElement, ms = 4000): Promise<void> {
  if (v.readyState >= 1 && v.videoWidth) return Promise.resolve();
  return new Promise((res) => {
    const done = () => { clearTimeout(t); v.removeEventListener('loadedmetadata', done); v.removeEventListener('resize', done); res(); };
    const t = setTimeout(done, ms);
    v.addEventListener('loadedmetadata', done);
    v.addEventListener('resize', done);
  });
}
type PhotoCaps = { fillLightMode?: string[]; imageWidth?: { max?: number }; imageHeight?: { max?: number } };
type ImageCap = { takePhoto(s?: Record<string, unknown>): Promise<Blob>; getPhotoCapabilities?(): Promise<PhotoCaps> };
/** O ImageCapture (Chrome no Android): a foto com a resolução inteira do sensor. O Safari do iPhone não o tem. */
/**
 * Em alguns aparelhos (vimo-lo na câmara falsa do Chrome) criar o ImageCapture desliga a câmara. Por isso só se cria
 * ao tirar a primeira foto, e se a câmara cair logo a seguir deixa de se usar nesta sessão (fica a foto do vídeo).
 */
let icBroken = false;
let icUsedAt = 0;
function imageCaptureFor(t: MediaStreamTrack): ImageCap | null {
  if (icBroken) return null;
  const Ctor = (globalThis as { ImageCapture?: new (t: MediaStreamTrack) => ImageCap }).ImageCapture;
  try { return Ctor ? new Ctor(t) : null; } catch { return null; }
}
/** Um retângulo do vídeo, à resolução real dele (nunca ao tamanho do ecrã), espelhado como no visor se for a câmara da frente. */
function grabFrame(v: HTMLVideoElement, r: Rect, mirror: boolean): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = r.w;
  c.height = r.h;
  const g = c.getContext('2d')!;
  g.imageSmoothingQuality = 'high';
  if (mirror) { g.translate(r.w, 0); g.scale(-1, 1); }
  g.drawImage(v, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
  return c;
}
/** Quantas imagens o <video> mostrou em `ms` (requestVideoFrameCallback). Sem ele (browsers antigos): null, não se mede. */
function countFrames(v: HTMLVideoElement, ms: number): Promise<{ frames: number; ms: number } | null> {
  const rv = v as HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => number; cancelVideoFrameCallback?: (h: number) => void };
  if (typeof rv.requestVideoFrameCallback !== 'function') return Promise.resolve(null);
  return new Promise((res) => {
    let frames = 0, h = 0;
    const t0 = performance.now();
    const tick = () => { frames += 1; h = rv.requestVideoFrameCallback!(tick); };
    h = rv.requestVideoFrameCallback(tick);
    setTimeout(() => { rv.cancelVideoFrameCallback?.(h); res({ frames, ms: performance.now() - t0 }); }, ms);
  });
}
/** Miniatura cinzenta de um retângulo (para comparar a foto do ImageCapture com o que o visor mostrou). */
function grayThumb(src: CanvasImageSource, r: Rect, w: number, h: number): Float32Array {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(src, r.x, r.y, r.w, r.h, 0, 0, w, h);
  const d = g.getImageData(0, 0, w, h).data;
  const out = new Float32Array(w * h);
  for (let i = 0, j = 0; j < out.length; i += 4, j++) out[j] = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
  return out;
}
/** Prepara o contexto para desenhar a imagem (bw×bh) rodada `rot` graus (sentido do relógio) e, antes, espelhada. */
function orient(g: CanvasRenderingContext2D, bw: number, bh: number, rot: number, flip: boolean) {
  if (rot === 90) { g.translate(bh, 0); g.rotate(Math.PI / 2); }
  else if (rot === 180) { g.translate(bw, bh); g.rotate(Math.PI); }
  else if (rot === 270) { g.translate(0, bw); g.rotate(-Math.PI / 2); }
  if (flip) { g.translate(bw, 0); g.scale(-1, 1); }
}
/** Aplica valores à câmara um de cada vez, ficando sempre o último pedido (a pinça manda dezenas por segundo). */
function makePump(apply: (v: number) => Promise<unknown>) {
  let want: number | null = null, applied: number | null = null, busy = false;
  return {
    get applied() { return applied; },
    reset(v: number | null) { applied = v; want = null; },
    set(v: number) {
      want = v;
      if (busy) return;
      busy = true;
      void (async () => {
        while (want !== null && want !== applied) { const z: number = want; await apply(z).catch(() => undefined); applied = z; }
        busy = false;
      })();
    },
  };
}
/** O que dizer quando a câmara não abre (e o que fazer). */
const PROBLEM_TEXT: Record<CamProblem | 'unsupported', { title: string; sub: string }> = {
  denied: { title: 'A câmara está bloqueada', sub: 'Para tirares fotos aqui, deixa o Txillapp usar a câmara:' },
  busy: { title: 'A câmara está a ser usada', sub: 'Outra app (uma chamada, o FaceTime, outro separador) está com a câmara. Fecha-a e toca em Tentar outra vez.' },
  nocamera: { title: 'Não encontrei nenhuma câmara', sub: 'Podes escolher fotos e vídeos da galeria.' },
  insecure: { title: 'A câmara precisa de ligação segura', sub: 'Abre o Txillapp em https:// para usar a câmara. A galeria funciona na mesma.' },
  unsupported: { title: 'Este browser não dá acesso à câmara', sub: 'Experimenta o Safari ou o Chrome, ou escolhe da galeria.' },
  constraint: { title: 'Não consegui abrir a câmara', sub: 'Tenta outra vez, ou escolhe da galeria.' },
  failed: { title: 'Não consegui abrir a câmara', sub: 'Tenta outra vez, ou escolhe da galeria.' },
};
/** Que browser é este (para mostrar onde está o cadeado). */
const browserNow = () => browserKind(
  navigator.userAgent,
  (typeof matchMedia !== 'undefined' && matchMedia('(display-mode: standalone)').matches) || (navigator as { standalone?: boolean }).standalone === true,
  navigator.maxTouchPoints > 1,
);
const ORIENTS: [number, boolean][] = [[0, false], [90, false], [180, false], [270, false], [0, true], [90, true], [180, true], [270, true]];
/**
 * Foto com a resolução inteira do sensor (ImageCapture.takePhoto), recortada exatamente como o visor (`crop`, em
 * píxeis do vídeo). A orientação da foto nem sempre vem certa, por isso compara-se com a imagem do vídeo tirada no
 * mesmo instante (`ref`) e fica a orientação que bate. Se nenhuma bater, ou não for melhor do que o vídeo: null.
 */
async function capturePhoto(ic: ImageCap, settings: Record<string, unknown>, crop: Rect, vw: number, vh: number, ref: Float32Array, tw: number, th: number, mirror: boolean): Promise<HTMLCanvasElement | null> {
  let blob: Blob;
  try { blob = await withTimeout(ic.takePhoto(settings), 5000); } catch {
    try { blob = await withTimeout(ic.takePhoto(), 5000); } catch { return null; }
  }
  const bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' }).catch(() => null);
  if (!bmp) return null;
  try {
    const bw = bmp.width, bh = bmp.height;
    const s = 256 / Math.max(bw, bh);
    const scores = ORIENTS.map(([rot, flip]) => {
      const turned = rot % 180 !== 0;
      const small = document.createElement('canvas');
      small.width = Math.max(1, Math.round((turned ? bh : bw) * s));
      small.height = Math.max(1, Math.round((turned ? bw : bh) * s));
      const g = small.getContext('2d')!;
      g.scale(s, s);
      orient(g, bw, bh, rot, flip);
      g.drawImage(bmp, 0, 0);
      return ncc(ref, grayThumb(small, videoCropToPhoto(crop, vw, vh, small.width, small.height), tw, th));
    });
    const best = bestMatch(scores);
    if (best < 0) return null;
    const [rot, flip] = ORIENTS[best];
    const turned = rot % 180 !== 0;
    const pw = turned ? bh : bw, ph = turned ? bw : bh;
    const r = videoCropToPhoto(crop, vw, vh, pw, ph);
    if (r.w * r.h < crop.w * crop.h * 1.2) return null; // não ganha nada ao vídeo
    // Até PHOTO_MAX_LONG no lado maior (antes ia até 16 MP: com sensores de 12–50 MP o JPEG passava dos 8 MB que o
    // servidor aceita e a edição pesava; o ecrã nunca recebe mais de 1600 de largura).
    const fit = fitLong(r.w, r.h, PHOTO_MAX_LONG);
    const k = fit.k;
    const out = document.createElement('canvas');
    out.width = fit.w;
    out.height = fit.h;
    const g = out.getContext('2d')!;
    g.imageSmoothingQuality = 'high';
    if (mirror) { g.translate(out.width, 0); g.scale(-1, 1); }
    g.scale(k, k);
    g.translate(-r.x, -r.y);
    orient(g, bw, bh, rot, flip);
    g.drawImage(bmp, 0, 0);
    return out;
  } finally {
    bmp.close();
  }
}


// ----- Edição depois de tirar: filtro (com intensidade), luz e cor, vinheta, corte e rotação.
type Box = { x: number; y: number; w: number; h: number };
/** b/c/s são multiplicadores (1 = sem mexer); t, hl e sh vão de -100 a 100; vig e k (intensidade do filtro) de 0 a 100. */
type Edit = { rot: 0 | 90 | 180 | 270; flip: boolean; aspect: number | null; box: Box | null; look: number; b: number; c: number; s: number; t: number; hl: number; sh: number; vig: number; k: number };
const EDIT0: Edit = { rot: 0, flip: false, aspect: null, box: null, look: 0, b: 1, c: 1, s: 1, t: 0, hl: 0, sh: 0, vig: 0, k: 100 };
/** Proporções do recorte: num mimo/tcheka todas; numa publicação só as do Instagram (1:1, 4:5 e 1,91:1). */
const ALL_ASPECTS: readonly (readonly [number | null, string])[] = [[null, 'Original'], [1, '1:1'], [0.8, '4:5'], [9 / 16, '9:16'], [16 / 9, '16:9']];
const POST_ASPECTS: readonly (readonly [number | null, string])[] = [[1, '1:1'], [POST_RATIO_DEFAULT, '4:5'], [POST_RATIO_MAX, '1,91:1']];
/**
 * Numa publicação, o corte livre fica entre 4:5 e 1,91:1 (como no Instagram). `ir` é a proporção da foto já rodada;
 * a caixa só encolhe (nunca sai da foto), do lado do canto que se está a arrastar.
 */
function fitPostBox(b: Box, ir: number, kind: 'nw' | 'ne' | 'sw' | 'se' | 'move'): Box {
  const r = (b.w / b.h) * ir;
  if (r > POST_RATIO_MAX) {
    const w = (POST_RATIO_MAX * b.h) / ir;
    const x = kind === 'nw' || kind === 'sw' ? b.x + (b.w - w) : kind === 'move' ? b.x + (b.w - w) / 2 : b.x;
    return { ...b, x, w };
  }
  if (r < POST_RATIO_MIN) {
    const h = (b.w * ir) / POST_RATIO_MIN;
    const y = kind === 'nw' || kind === 'ne' ? b.y + (b.h - h) : kind === 'move' ? b.y + (b.h - h) / 2 : b.y;
    return { ...b, y, h };
  }
  return b;
}
type AdjKey = 'b' | 'c' | 's' | 't' | 'hl' | 'sh' | 'vig' | 'k';
type Tool = 'look' | 'crop' | AdjKey;
/** Cada ajuste no slider único: o valor que se vê (inteiro) e como passa para a edição. */
const ADJ: Record<AdjKey, { label: string; min: number; max: number; def: number; get: (e: Edit) => number; set: (v: number) => Partial<Edit> }> = {
  b: { label: 'Brilho', min: -100, max: 100, def: 0, get: (e) => Math.round((e.b - 1) * 250), set: (v) => ({ b: 1 + v / 250 }) },
  c: { label: 'Contraste', min: -100, max: 100, def: 0, get: (e) => Math.round((e.c - 1) * 250), set: (v) => ({ c: 1 + v / 250 }) },
  s: { label: 'Saturação', min: -100, max: 100, def: 0, get: (e) => Math.round((e.s - 1) * 100), set: (v) => ({ s: 1 + v / 100 }) },
  t: { label: 'Temperatura', min: -100, max: 100, def: 0, get: (e) => e.t, set: (v) => ({ t: v }) },
  hl: { label: 'Realces', min: -100, max: 100, def: 0, get: (e) => e.hl, set: (v) => ({ hl: v }) },
  sh: { label: 'Sombras', min: -100, max: 100, def: 0, get: (e) => e.sh, set: (v) => ({ sh: v }) },
  vig: { label: 'Vinheta', min: 0, max: 100, def: 0, get: (e) => e.vig, set: (v) => ({ vig: v }) },
  k: { label: 'Intensidade', min: 0, max: 100, def: 100, get: (e) => e.k, set: (v) => ({ k: v }) },
};
const TOOLS: { id: Tool; label: string; a11y?: string }[] = [
  { id: 'look', label: 'Filtros' }, { id: 'b', label: 'Brilho' }, { id: 'c', label: 'Contraste' }, { id: 's', label: 'Saturação' },
  { id: 't', label: 'Temperatura' }, { id: 'hl', label: 'Realces' }, { id: 'sh', label: 'Sombras' }, { id: 'vig', label: 'Vinheta' },
  { id: 'k', label: 'Intensidade', a11y: 'Intensidade do filtro' }, { id: 'crop', label: 'Recortar' },
];
const fmtAdj = (k: AdjKey, v: number) => (k === 'vig' || k === 'k' || v <= 0 ? String(v) : `+${v}`);

/** As contas de um look (as mesmas do applyLook): matriz de cor, brilho×contraste e a tinta. */
function lookParts(l: Look) {
  const sv = l.s, sp = 1 - l.sep, gr = 1 - l.g;
  const S = [0.213 + 0.787 * sv, 0.715 - 0.715 * sv, 0.072 - 0.072 * sv, 0.213 - 0.213 * sv, 0.715 + 0.285 * sv, 0.072 - 0.072 * sv, 0.213 - 0.213 * sv, 0.715 - 0.715 * sv, 0.072 + 0.928 * sv];
  const P = [0.393 + 0.607 * sp, 0.769 - 0.769 * sp, 0.189 - 0.189 * sp, 0.349 - 0.349 * sp, 0.686 + 0.314 * sp, 0.168 - 0.168 * sp, 0.272 - 0.272 * sp, 0.534 - 0.534 * sp, 0.131 + 0.869 * sp];
  const G = [0.2126 + 0.7874 * gr, 0.7152 - 0.7152 * gr, 0.0722 - 0.0722 * gr, 0.2126 - 0.2126 * gr, 0.7152 + 0.2848 * gr, 0.0722 - 0.0722 * gr, 0.2126 - 0.2126 * gr, 0.7152 - 0.7152 * gr, 0.0722 + 0.9278 * gr];
  const mul = (A: number[], B: number[]) => [0, 1, 2].flatMap((i) => [0, 1, 2].map((j) => A[i * 3] * B[j] + A[i * 3 + 1] * B[3 + j] + A[i * 3 + 2] * B[6 + j]));
  return { M: mul(G, mul(P, S)), bc: l.b * l.c, off: 128 * (1 - l.c), tint: l.tint ?? ([0, 0, 0, 0] as [number, number, number, number]) };
}

/**
 * Toda a edição de cor numa só passagem pelos pixels: o filtro (misturado com o original pela intensidade),
 * depois brilho, contraste e saturação, temperatura, realces e sombras, e por fim a vinheta.
 * A pré-visualização e o JPEG final saem os dois daqui, por isso ficam iguais.
 */
function applyEdit(cv: HTMLCanvasElement, look: Look, e: Edit) {
  const lookOn = look.id !== 'normal' && e.k > 0;
  const userOn = e.b !== 1 || e.c !== 1 || e.s !== 1;
  if (!lookOn && !userOn && !e.t && !e.hl && !e.sh && !e.vig) return;
  const W = cv.width, H = cv.height;
  const g = cv.getContext('2d')!;
  const img = g.getImageData(0, 0, W, H);
  const d = img.data;
  const L = lookParts(look);
  const LM = L.M, lbc = L.bc, loff = L.off, [tr, tg, tb, ta] = L.tint;
  const mix = e.k / 100;
  const U = lookParts({ id: 'u', name: '', b: e.b, c: e.c, s: e.s, sep: 0, g: 0 });
  const UM = U.M, ubc = U.bc, uoff = U.off;
  const tk = e.t * 0.28; // até ±28 níveis: mais quente puxa ao vermelho, mais fresco ao azul
  const hk = (e.hl / 100) * 70, sk = (e.sh / 100) * 70;
  const vk = (e.vig / 100) * 0.8;
  // A vinheta depende da distância ao centro: as colunas calculam-se uma vez só.
  const dx2 = new Float32Array(W);
  for (let x = 0; x < W; x++) { const u = ((x + 0.5) / W) * 2 - 1; dx2[x] = u * u; }
  for (let y = 0; y < H; y++) {
    const v = ((y + 0.5) / H) * 2 - 1, dy2 = v * v;
    let i = y * W * 4;
    for (let x = 0; x < W; x++, i += 4) {
      let r = d[i], gg = d[i + 1], b = d[i + 2];
      if (lookOn) {
        const r0 = r * lbc + loff, g0 = gg * lbc + loff, b0 = b * lbc + loff;
        let R = LM[0] * r0 + LM[1] * g0 + LM[2] * b0, Gc = LM[3] * r0 + LM[4] * g0 + LM[5] * b0, B = LM[6] * r0 + LM[7] * g0 + LM[8] * b0;
        if (ta) { R += (tr - R) * ta; Gc += (tg - Gc) * ta; B += (tb - B) * ta; }
        R = R < 0 ? 0 : R > 255 ? 255 : R; Gc = Gc < 0 ? 0 : Gc > 255 ? 255 : Gc; B = B < 0 ? 0 : B > 255 ? 255 : B;
        r += (R - r) * mix; gg += (Gc - gg) * mix; b += (B - b) * mix;
      }
      if (userOn) {
        const r0 = r * ubc + uoff, g0 = gg * ubc + uoff, b0 = b * ubc + uoff;
        r = UM[0] * r0 + UM[1] * g0 + UM[2] * b0; gg = UM[3] * r0 + UM[4] * g0 + UM[5] * b0; b = UM[6] * r0 + UM[7] * g0 + UM[8] * b0;
      }
      if (tk) { r += tk; gg += tk * 0.15; b -= tk; }
      if (hk || sk) {
        let l = (0.2126 * r + 0.7152 * gg + 0.0722 * b) / 255;
        l = l < 0 ? 0 : l > 1 ? 1 : l;
        const wh = l > 0.45 ? ((l - 0.45) / 0.55) ** 2 : 0, ws = l < 0.55 ? ((0.55 - l) / 0.55) ** 2 : 0;
        const add = hk * wh + sk * ws;
        r += add; gg += add; b += add;
      }
      if (vk) {
        const dn = Math.sqrt((dx2[x] + dy2) / 2);
        if (dn > 0.35) { const t = Math.min(1, (dn - 0.35) / 0.65); const f = 1 - vk * t * t * (3 - 2 * t); r *= f; gg *= f; b *= f; }
      }
      d[i] = r < 0 ? 0 : r > 255 ? 255 : r; d[i + 1] = gg < 0 ? 0 : gg > 255 ? 255 : gg; d[i + 2] = b < 0 ? 0 : b > 255 ? 255 : b;
    }
  }
  g.putImageData(img, 0, 0);
}

/** Ícones que não existem na biblioteca Tx, desenhados no mesmo traço e grelha 24×24. */
function Glyph({ name, color, size = 22 }: { name: 'contrast' | 'drop' | 'thermo' | 'highlights' | 'vignette' | 'crop' | 'thirds'; color: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      {name === 'contrast' && <><Circle cx={12} cy={12} r={8.5} /><Path d="M12 3.5a8.5 8.5 0 0 1 0 17z" fill={color} /></>}
      {name === 'drop' && <Path d="M12 3.5c3.2 4 5.6 7.1 5.6 10.1a5.6 5.6 0 0 1-11.2 0c0-3 2.4-6.1 5.6-10.1z" />}
      {name === 'thermo' && <><Path d="M10 14.3V5.2a2 2 0 0 1 4 0v9.1a4 4 0 1 1-4 0z" /><Path d="M12 9v7.4" /></>}
      {name === 'highlights' && <><Path d="M3.5 17h17" /><Path d="M7 17a5 5 0 0 1 10 0" /><Path d="M12 6.5v2M5.8 9.6l1.4 1.4M18.2 9.6 16.8 11M8 20.5h8" /></>}
      {name === 'vignette' && <><Path d="M6.5 5h11a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3h-11a3 3 0 0 1-3-3V8a3 3 0 0 1 3-3z" /><Circle cx={12} cy={12} r={4} /></>}
      {name === 'crop' && <><Path d="M6 2.5V18h15.5" /><Path d="M2.5 6H18v15.5" /></>}
      {name === 'thirds' && <Path d="M9 3.5v17M15 3.5v17M3.5 9h17M3.5 15h17" />}
    </Svg>
  );
}
function toolIcon(t: Tool, color: string) {
  switch (t) {
    case 'look': return <Icon name="sparkles" size={22} color={color} strokeWidth={2} />;
    case 'b': return <Icon name="sun" size={22} color={color} strokeWidth={2} />;
    case 'c': return <Glyph name="contrast" color={color} />;
    case 's': return <Glyph name="drop" color={color} />;
    case 't': return <Glyph name="thermo" color={color} />;
    case 'hl': return <Glyph name="highlights" color={color} />;
    case 'sh': return <Icon name="moon" size={22} color={color} strokeWidth={2} />;
    case 'vig': return <Glyph name="vignette" color={color} />;
    case 'k': return <Icon name="sliders" size={22} color={color} strokeWidth={2} />;
    default: return <Glyph name="crop" color={color} />;
  }
}

/** Um botão da barra de cima da câmara (temporizador, grelha, layout, texto): sempre à vista, branco quando ligado. */
function TopTool({ on, label, onPress, children }: { on?: boolean; label: string; onPress: () => void; children: ReactNode }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [st.round, st.tool, on && { backgroundColor: '#fff' }, pressed && { opacity: 0.7 }]} accessibilityRole="button" accessibilityState={{ selected: !!on }} accessibilityLabel={label}>
      {children}
    </Pressable>
  );
}

export function TxCamera({
  count, max, modes = ['photo', 'video', 'text'], onShot, onGallery, onClose, onDone, onText, doneLabel = 'Feito', thumbs, kinds, kind, onKind, aspect = 9 / 16, keepClean = false, segmented,
}: {
  count: number; max: number; modes?: CamMode[]; onShot: (s: Shot) => void; onGallery: (files: File[]) => void; onClose: () => void; onDone?: () => void; onText?: () => void; doneLabel?: string;
  /** Miniaturas do que já foi escolhido (a fila de "recentes", como no Instagram). */
  thumbs?: string[];
  /** A barra de baixo com o que se vai criar (Publicação · Tcheka · Zás · Mimo): tocar noutro chama onKind. */
  kinds?: { id: string; label: string }[]; kind?: string; onKind?: (id: string) => void;
  /** Proporção da foto (largura/altura): 4:5 numa publicação, 9:16 num mimo ou tcheka. A moldura mostra exatamente o que sai. */
  aspect?: number;
  /** Num tcheka: cada foto traz também a cópia sem assinatura (`clean`), que é a que entra no estúdio. */
  keepClean?: boolean;
  /** Num tcheka: gravação por clipes (ver SegmentedRec). */
  segmented?: SegmentedRec;
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
  const [mode] = useState<CamMode>(modes.includes('photo') ? 'photo' : modes[0]);
  const [facing, setFacing] = useState<'environment' | 'user'>('environment');
  const [ready, setReady] = useState(false);
  const [problem, setProblem] = useState<Problem>(null);
  const [canFlip, setCanFlip] = useState(false);
  /** O que esta câmara deixa fazer (zoom do aparelho, lanterna, foco no ponto, exposição, flash): lido das getCapabilities(). */
  const [caps, setCaps] = useState<CamCaps>(NO_CAPS);
  const canTorch = caps.torch;
  /** Uma câmara aberta pelo plano B (fora da sessão partilhada): é desta câmara que a desligamos. */
  const ownStream = useRef<MediaStream | null>(null);
  /** A track a que esta câmara subiu a resolução da foto: ao sair volta ao pedido normal (o Zás usa a mesma câmara). */
  const upgradedTrack = useRef<MediaStreamTrack | null>(null);
  const startSeq = useRef(0);
  const imageCap = useRef<ImageCap | null>(null);
  const photoCaps = useRef<PhotoCaps | null>(null);
  const torchOn = useRef(false);
  /** A gravação vai sem som (o microfone não está disponível): aviso por cima do tempo. */
  const [mute, setMute] = useState(false);
  /** Compensação de exposição (-1 a 1 no deslize) e se o deslize está à vista (aparece depois de tocar para focar). */
  const [expo, setExpo] = useState(0);
  const [expoOn, setExpoOn] = useState(false);
  const expoTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  /** A foto em alta (ImageCapture) que ainda está a chegar para a revisão aberta. */
  const hqJob = useRef<{ id: number; p: Promise<HTMLCanvasElement | null> } | null>(null);
  const shotId = useRef(0);
  const [light, setLight] = useState(false);
  const [lit, setLit] = useState(false);
  /** Conta as fotos tiradas: cada uma relança a animação do clarão. */
  const [shotK, setShotK] = useState(0);
  const [delay, setDelay] = useState<0 | 3 | 10>(0);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [look, setLook] = useState(0);
  const [lookName, setLookName] = useState<string | null>(null);
  const [area, setArea] = useState({ w: 0, h: 0 });
  // O painel de opções (temporizador, grelha, layout, só texto) e a grelha dos terços, que fica lembrada neste aparelho.
  const [grid, setGrid] = useState(() => { try { return localStorage.getItem('tx_cam_grid') === '1'; } catch { return false; } });
  const toggleGrid = () => setGrid((v) => { try { localStorage.setItem('tx_cam_grid', v ? '0' : '1'); } catch { /* sem armazenamento */ } return !v; });
  // Layout: qual (ou nenhum), o seletor aberto, e as fotos já tiradas (uma por célula).
  const [layout, setLayout] = useState<number | null>(null);
  const [layoutOpen, setLayoutOpen] = useState(false);
  const [cells, setCells] = useState<string[]>([]);
  const cellCanvases = useRef<HTMLCanvasElement[]>([]);
  const [zoom, setZoom] = useState(1);
  const [recording, setRecording] = useState(false);
  /** Velocidade da gravação por clipes (só num tcheka). */
  const [speed, setSpeed] = useState<number>(1);
  const recSpeed = useRef(1);
  /** O som que toca enquanto se grava (num tcheka com música ou som escolhido). */
  const recAudio = useRef<HTMLAudioElement | null>(null);
  useEffect(() => () => { recAudio.current?.pause(); recAudio.current = null; }, []);
  const usedFinalMs = segmented ? segmented.clipsMs.reduce((n, x) => n + x, 0) : 0;
  /** Milissegundos de gravação (o anel do obturador enche até aos 60 s). */
  const [recMs, setRecMs] = useState(0);
  /** Onde se tocou para focar (círculo que aparece e some). */
  const [focusAt, setFocusAt] = useState<{ x: number; y: number; k: number } | null>(null);
  const lastTap = useRef(0);
  const focusTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // Depois de tirar: a pré-visualização, com Repetir, Guardar ou Usar.
  const [review, setReview] = useState<Shot | null>(null);
  const reviewSrc = useRef<HTMLCanvasElement | null>(null);
  /** Cópia mais pequena do original só para a pré-visualização (os ajustes respondem depressa); o JPEG final usa o original. */
  const previewSrc = useRef<HTMLCanvasElement | null>(null);
  const swipeX = useRef<number | null>(null);
  const editLooksRow = useRef<React.ComponentRef<typeof ScrollView> | null>(null);
  // A miniatura dos filtros é a foto tirada, sem filtro (senão cada exemplo levava o filtro escolhido por cima).
  const [swatchSrc, setSwatchSrc] = useState<string | null>(null);
  const { user } = useAuth();
  const stamp = (g: CanvasRenderingContext2D, w: number, h: number) => stampTxillapp(g, w, h, user?.username, sealOf(user));
  /** Publicação: a câmara foi aberta em 4:5 (mimo e tcheka abrem em 9:16). Só 1:1, 4:5 e 1,91:1, a começar em 4:5. */
  const isPost = Math.abs(aspect - POST_RATIO_DEFAULT) < 0.01;
  const edit0: Edit = isPost ? { ...EDIT0, aspect: POST_RATIO_DEFAULT } : EDIT0;
  const [edit, setEdit] = useState<Edit>(edit0);
  const editRef = useRef(edit);
  editRef.current = edit;
  const [tool, setTool] = useState<Tool | null>(null);
  function renderEdit(src: HTMLCanvasElement, e: Edit, sign = true): HTMLCanvasElement {
    const turned = e.rot === 90 || e.rot === 270;
    const w = turned ? src.height : src.width, h = turned ? src.width : src.height;
    // Corte: livre (caixa escolhida à mão) ou ao centro na proporção pedida.
    let cx = 0, cy = 0, cw = w, ch = h;
    if (e.box) {
      cx = Math.round(e.box.x * w); cy = Math.round(e.box.y * h); cw = Math.max(16, Math.round(e.box.w * w)); ch = Math.max(16, Math.round(e.box.h * h));
      // Publicação: a caixa nunca sai do intervalo 4:5–1,91:1 (corta ao centro o que sobrar).
      if (isPost && cw / ch > POST_RATIO_MAX) { const n = Math.floor(ch * POST_RATIO_MAX); cx += Math.round((cw - n) / 2); cw = n; }
      else if (isPost && cw / ch < POST_RATIO_MIN) { const n = Math.floor(cw / POST_RATIO_MIN); cy += Math.round((ch - n) / 2); ch = n; }
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
    applyEdit(out, LOOKS[e.look], e);
    if (sign) stamp(out.getContext('2d')!, cw, ch);
    return out;
  }
  // Corte livre: a caixa (frações da imagem já rodada) arrasta-se pelos cantos ou pelo meio, por cima da foto inteira.
  const [freeCrop, setFreeCrop] = useState(false);
  const freeCropRef = useRef(false);
  freeCropRef.current = freeCrop;
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
    const corners: ['nw' | 'ne' | 'sw' | 'se', number, number][] = [
      ['nw', b.x * rect.width, b.y * rect.height], ['ne', (b.x + b.w) * rect.width, b.y * rect.height],
      ['sw', b.x * rect.width, (b.y + b.h) * rect.height], ['se', (b.x + b.w) * rect.width, (b.y + b.h) * rect.height],
    ];
    let kind: 'nw' | 'ne' | 'sw' | 'se' | 'move' = 'move';
    for (const [k, x, y] of corners) if (Math.hypot(px - x, py - y) < 34) { kind = k; break; }
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
    setBox(isPost ? fitPostBox({ x, y, w, h }, rect.width / rect.height, d.kind) : { x, y, w, h });
  }
  /** Proporção da foto já rodada (a que o corte livre mostra inteira). */
  function turnedRatio(rot: Edit['rot']): number {
    const src = previewSrc.current ?? reviewSrc.current;
    if (!src || !src.width || !src.height) return 1;
    return rot === 90 || rot === 270 ? src.height / src.width : src.width / src.height;
  }
  function cropTouchEnd() { drag.current = null; }

  // A pré-visualização redesenha-se sempre com a última edição pedida: uma de cada vez, sem fila (o slider fica fluido).
  const renderSeq = useRef(0);
  const pending = useRef<{ e: Edit; sign: boolean } | null>(null);
  const busy = useRef(false);
  function pump() {
    if (busy.current || !pending.current) return;
    const src = previewSrc.current ?? reviewSrc.current;
    if (!src) { pending.current = null; return; }
    const { e, sign } = pending.current;
    pending.current = null;
    busy.current = true;
    const seq = ++renderSeq.current;
    renderEdit(src, e, sign).toBlob((blob) => {
      busy.current = false;
      if (blob && seq === renderSeq.current) {
        const uri = URL.createObjectURL(blob);
        setReview((r) => (r && !r.video ? { ...r, uri } : r));
      }
      pump();
    }, 'image/jpeg', 0.9);
  }
  function paint(e: Edit, sign = true) { pending.current = { e, sign }; pump(); }
  function changeEdit(patch: Partial<Edit>) {
    const e = { ...editRef.current, ...patch };
    editRef.current = e;
    setEdit(e);
    paint(e);
  }
  /** Entra no corte livre: mostra a foto inteira (sem corte) com a caixa por cima. */
  function startFreeCrop() {
    setFreeCrop(true);
    const e = { ...editRef.current, aspect: null, box: null };
    editRef.current = e;
    setEdit(e);
    if (isPost) setBox((b) => fitPostBox(b, turnedRatio(e.rot), 'move'));
    paint(e, false);
  }
  /** Rodar: no corte livre de uma publicação, a caixa volta a caber no intervalo 4:5–1,91:1. */
  function rotate() {
    const rot = ((editRef.current.rot + 90) % 360) as Edit['rot'];
    if (freeCrop && isPost) setBox((b) => fitPostBox(b, turnedRatio(rot), 'move'));
    changeEdit({ rot });
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
  /** O original da revisão, a cópia pequena para a pré-visualização e a miniatura dos filtros. */
  function setSource(c: HTMLCanvasElement) {
    reviewSrc.current = c;
    // Pré-visualização até 1600 px no lado maior: chega para o ecrã e mantém os ajustes rápidos.
    const long = Math.max(c.width, c.height);
    if (long > 1600) {
      const k = 1600 / long;
      const p = document.createElement('canvas');
      p.width = Math.round(c.width * k);
      p.height = Math.round(c.height * k);
      const pg = p.getContext('2d')!;
      pg.imageSmoothingQuality = 'high';
      pg.drawImage(c, 0, 0, p.width, p.height);
      previewSrc.current = p;
    } else previewSrc.current = c;
    // Miniatura quadrada da foto tirada (sem filtro), para o exemplo de cada filtro.
    try {
      const m = document.createElement('canvas');
      m.width = m.height = 112;
      const side = Math.min(c.width, c.height);
      m.getContext('2d')!.drawImage(c, (c.width - side) / 2, (c.height - side) / 2, side, side, 0, 0, 112, 112);
      setSwatchSrc(m.toDataURL('image/jpeg', 0.75));
    } catch { setSwatchSrc(null); }
  }
  /** Chegou a foto em alta (ImageCapture) da revisão aberta: passa a ser o original, e a pré-visualização refaz-se. */
  function upgradeSource(id: number, c: HTMLCanvasElement) {
    if (id !== shotId.current || !reviewSrc.current) return;
    setSource(c);
    const free = freeCropRef.current;
    paint(free ? { ...editRef.current, aspect: null, box: null } : editRef.current, !free);
  }
  /** Espera (pouco) pela foto em alta antes de exportar; se não chegar a tempo, sai a do vídeo. */
  async function settleHq() {
    const job = hqJob.current;
    if (!job) return;
    hqJob.current = null;
    const c = await withTimeout(job.p, 6000).catch(() => null);
    if (c && job.id === shotId.current && reviewSrc.current && reviewSrc.current !== c) setSource(c);
  }
  function openReview(c: HTMLCanvasElement) {
    renderSeq.current += 1;
    pending.current = null;
    shotId.current += 1;
    hqJob.current = null;
    setSource(c);
    // Publicação: começa já cortada em 4:5 (a moldura da câmara é 4:5; isto garante-o mesmo sem moldura medida).
    editRef.current = edit0;
    setEdit(edit0);
    setTool('look'); // os filtros aparecem logo depois de tirar a foto
    setFreeCrop(false);
    setBox({ x: 0.08, y: 0.08, w: 0.84, h: 0.84 });
    const seq = renderSeq.current;
    renderEdit(previewSrc.current ?? c, edit0).toBlob((blob) => blob && seq === renderSeq.current && setReview({ uri: URL.createObjectURL(blob), video: false, mime: 'image/jpeg' }), 'image/jpeg', 0.9);
  }
  // A fila de filtros acompanha o escolhido (sobretudo quando se troca a deslizar sobre a foto).
  useEffect(() => {
    if (tool !== 'look') return;
    editLooksRow.current?.scrollTo({ x: Math.max(0, edit.look * 64 - 96), animated: true });
  }, [edit.look, tool]);
  const [seconds, setSeconds] = useState(0);
  const full = mode === 'photo' && count >= max;
  const topPad = Math.max(insets.top, 12);

  /** Formato pedido ao sensor: 3:4 inteiro numa publicação (4:5), 16:9 num mimo ou tcheka (9:16). */
  const ratio = sensorRatioFor(aspect);
  const wantsAudio = modes.includes('video');
  const stopOwn = () => { ownStream.current?.getTracks().forEach((t) => t.stop()); ownStream.current = null; };
  const track = () => stream.current?.getVideoTracks()[0];
  /** Liga ou desliga a lanterna (só quando a câmara a tem). */
  async function setTorch(on: boolean) {
    const t = track();
    if (!t || !caps.torch || torchOn.current === on) return;
    torchOn.current = on;
    await t.applyConstraints({ advanced: [{ torch: on } as MediaTrackConstraintSet] }).catch(() => { torchOn.current = false; });
  }
  // Zoom e exposição: aplicados à câmara um de cada vez, sempre com o último valor pedido (a pinça manda dezenas por segundo).
  const zoomPump = useRef(makePump((z) => track()?.applyConstraints({ advanced: [{ zoom: z } as MediaTrackConstraintSet] }) ?? Promise.resolve())).current;
  const expoPump = useRef(makePump((v) => track()?.applyConstraints({ advanced: [{ exposureCompensation: v } as MediaTrackConstraintSet] }) ?? Promise.resolve())).current;

  /** Plano B: a sessão partilhada não abriu a câmara; tenta-se com restrições cada vez mais simples. */
  async function openFallback(): Promise<MediaStream> {
    let last: unknown = null;
    for (const c of fallbackConstraints(facing, ratio)) {
      try {
        const s = await navigator.mediaDevices.getUserMedia({ video: c, audio: false });
        if (wantsAudio) {
          try { (await navigator.mediaDevices.getUserMedia({ audio: true })).getAudioTracks().forEach((t) => s.addTrack(t)); } catch { /* grava sem som */ }
        }
        return s;
      } catch (e) {
        last = e;
        const p = classifyCameraError(e as DOMException);
        if (p === 'denied' || p === 'nocamera') break;
      }
    }
    throw last;
  }

  /** O visor ficou lento com a resolução maior (aparelho mais velho)? Então volta a 1440×1920, como antes. */
  async function checkSmooth(seq: number, t: MediaStreamTrack, v: HTMLVideoElement) {
    await sleep(700); // a câmara assenta depois de mudar de tamanho
    if (seq !== startSeq.current) return;
    const n = await countFrames(v, 1200);
    // Só se decide com a medida limpa: a mesma câmara, o mesmo <video>, à vista, e sem gravar (mudar de tamanho a meio estragava o vídeo).
    if (!n || seq !== startSeq.current || video.current !== v || document.visibilityState !== 'visible' || t.readyState !== 'live' || recorder.current?.state === 'recording') return;
    if (upgradeTooSlow(n.frames, n.ms)) await t.applyConstraints(PHOTO_SAFE).catch(() => undefined);
  }

  const starting = useRef(false);
  /** Tentativas que faltam para religar a câmara depois de ela cair sozinha. */
  const afterEnded = useRef(0);
  const startRef = useRef<() => Promise<void>>(async () => undefined);
  const start = useCallback(async () => {
    const seq = ++startSeq.current;
    starting.current = true;
    setReady(false);
    setProblem(null);
    stopOwn();
    const fail = (p: Problem) => {
      if (seq !== startSeq.current) return;
      setProblem(p);
      starting.current = false;
      // Depois de a câmara cair sozinha, o aparelho pode demorar a libertá-la: tenta-se mais umas vezes.
      if (afterEnded.current > 0 && p !== 'denied') { afterEnded.current -= 1; setTimeout(() => { if (seq === startSeq.current) void startRef.current(); }, 1500); }
    };
    if (typeof window !== 'undefined' && window.isSecureContext === false) return fail('insecure');
    if (!navigator.mediaDevices?.getUserMedia) return fail('unsupported');
    let s: MediaStream;
    try {
      s = await acquireCamera(facing, wantsAudio, ratio === '3:4');
    } catch (e) {
      const p = classifyCameraError(e as DOMException);
      if (!retryWithFallback(p)) return fail(p);
      try {
        s = await openFallback();
        ownStream.current = s;
      } catch (e2) {
        return fail(classifyCameraError((e2 ?? e) as DOMException));
      }
    }
    if (seq !== startSeq.current) { if (ownStream.current === s) stopOwn(); return; }
    stream.current = s;
    const t = s.getVideoTracks()[0];
    // Foto numa publicação: mais resolução, se o sensor der (lido das getCapabilities()). No iPhone a foto é um frame
    // deste vídeo (o Safari não tem ImageCapture), por isso é isto que decide a resolução da foto (webCamera.photoUpgrade).
    let upgraded = false;
    try {
      const up = t ? photoUpgrade(t.getCapabilities?.() as never, t.getSettings?.(), ratio) : null;
      if (up && t) { await t.applyConstraints(up); upgraded = true; }
    } catch { /* o aparelho não aceita: fica como está */ }
    if (upgraded) upgradedTrack.current = t ?? null;
    let v = video.current;
    // Outra câmara (virar para a frontal, ou o plano B): um <video> novo em vez de trocar o srcObject do mesmo. O Safari do
    // iPhone guardava no elemento o tamanho e a rotação do vídeo anterior (a frontal aparecia pequena, ao meio).
    if (v && freshVideoFor(v.srcObject, s)) {
      lastDims.current = '';
      setVkey((n) => n + 1);
      v = await nextVideo(() => video.current, v);
      if (seq !== startSeq.current) return;
    }
    if (v) {
      if (v.srcObject !== s) v.srcObject = s;
      const playing = v.play().catch(() => undefined);
      await whenMeasured(v); // só depois do loadedmetadata se mede (videoWidth/videoHeight)
      await playing;
    }
    if (seq !== startSeq.current) return;
    const settings = (t?.getSettings?.() ?? {}) as MediaTrackSettings & { zoom?: number; exposureCompensation?: number };
    zoomPump.reset(settings.zoom ?? null);
    expoPump.reset(settings.exposureCompensation ?? null);
    torchOn.current = false;
    setZoom(1);
    setExpo(0);
    setExpoOn(false);
    const supported = (navigator.mediaDevices.getSupportedConstraints?.() ?? {}) as Record<string, unknown>;
    const trackCaps = (t?.getCapabilities?.() ?? {}) as Record<string, unknown>;
    setCaps(readCaps(trackCaps, supported, null));
    if (t) {
      // A câmara caiu (iPhone: chamada, Siri, outra app): fecha a gravação sem fim preto e volta a ligar quando der.
      t.onended = () => {
        if (seq !== startSeq.current) return;
        if (Date.now() - icUsedAt < 4000) icBroken = true;
        imageCap.current = null;
        if (recorder.current?.state === 'recording') recorder.current.stop();
        setReady(false);
        afterEnded.current = 2;
        if (document.visibilityState === 'visible') setTimeout(() => { if (seq === startSeq.current) void startRef.current(); }, 400);
      };
      t.onmute = () => {
        setTimeout(() => { if (seq === startSeq.current && t.muted && recorder.current?.state === 'recording') recorder.current.stop(); }, 700);
      };
    }
    setReady(true);
    starting.current = false;
    afterEnded.current = 0;
    // Subiu a resolução: confere-se se o visor continua fluido; se não, volta ao tamanho de antes (1440×1920).
    if (upgraded && t && v) void checkSmooth(seq, t, v);
    // O ImageCapture (foto inteira do sensor e flash a sério) só se cria ao tirar a primeira foto (ver icBroken).
    imageCap.current = null;
    photoCaps.current = null;
    const devices = await navigator.mediaDevices.enumerateDevices().catch(() => []);
    if (seq === startSeq.current) setCanFlip(devices.filter((d) => d.kind === 'videoinput').length > 1);
  }, [facing, ratio]); // eslint-disable-line react-hooks/exhaustive-deps
  startRef.current = start;

  useEffect(() => { void start(); }, [start]);
  useEffect(() => () => {
    startSeq.current += 1;
    const t = track();
    if (t) {
      t.onended = null;
      t.onmute = null;
      // A câmara fica uns instantes ligada para o ecrã seguinte: sem a lanterna acesa nem o zoom que se deu aqui.
      if (torchOn.current) t.applyConstraints({ advanced: [{ torch: false } as MediaTrackConstraintSet] }).catch(() => undefined);
      if (zoomPump.applied !== null && zoomPump.applied !== 1) t.applyConstraints({ advanced: [{ zoom: 1 } as MediaTrackConstraintSet] }).catch(() => undefined);
      if (expoPump.applied) t.applyConstraints({ advanced: [{ exposureCompensation: 0 } as MediaTrackConstraintSet] }).catch(() => undefined);
    }
    // A resolução maior da foto é só para aqui: o ecrã seguinte (o Zás) recebe a câmara no tamanho normal dela.
    const up = upgradedTrack.current;
    upgradedTrack.current = null;
    if (up && up.readyState === 'live') up.applyConstraints(PHOTO_BASE).catch(() => undefined);
    stopOwn();
    releaseCamera(2_000);
    clearInterval(timer.current);
    clearInterval(countTimer.current);
    clearTimeout(holdT.current);
    clearTimeout(expoTimer.current);
    if (recorder.current?.state === 'recording') { recorder.current.onstop = null; recorder.current.stop(); }
    reviewSrc.current = null;
    previewSrc.current = null;
    pending.current = null;
    hqJob.current = null;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const problemRef = useRef<Problem>(null);
  problemRef.current = problem;
  useEffect(() => {
    // Em segundo plano (trocar de app, bloquear): a gravação fecha-se já, com o que se gravou (sem o fim preto),
    // e a câmara desliga-se (a sessão partilhada desliga a dela; a do plano B é desligada aqui).
    const away = () => {
      if (document.visibilityState === 'visible') return;
      if (recorder.current?.state === 'recording') { try { recorder.current.stop(); } catch { /* já parou */ } }
      clearInterval(countTimer.current);
      setCountdown(null);
      stopOwn();
      torchOn.current = false;
      setReady(false);
    };
    // Ao voltar: religa-se. No iPhone, o seletor de fotos não devolve nada enquanto a câmara está ligada: desliga-se
    // ao abrir a galeria e religa-se quando o seletor fecha.
    const back = (ev: Event) => {
      if (document.visibilityState !== 'visible' || starting.current) return;
      if (pausedForPicker.current) { pausedForPicker.current = false; return void start(); }
      const s = stream.current;
      const dead = !s || !s.getVideoTracks().some((x) => x.readyState === 'live');
      if (!dead) { if (!problemRef.current && video.current?.videoWidth) setReady(true); return; }
      // Depois de um erro (ex.: permissão negada), só se tenta outra vez ao voltar à app (as definições podem ter mudado).
      if (problemRef.current && ev.type !== 'visibilitychange') return;
      void start();
    };
    const pageHide = () => away();
    window.addEventListener('focus', back);
    document.addEventListener('visibilitychange', back);
    document.addEventListener('visibilitychange', away);
    window.addEventListener('pagehide', pageHide);
    return () => {
      window.removeEventListener('focus', back);
      document.removeEventListener('visibilitychange', back);
      document.removeEventListener('visibilitychange', away);
      window.removeEventListener('pagehide', pageHide);
    };
  }, [start]); // eslint-disable-line react-hooks/exhaustive-deps
  const openGallery = () => { pausedForPicker.current = true; releaseCamera(0); stopOwn(); setReady(false); };

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

  // ----- Zoom: o do aparelho quando o browser o dá (Android, alguns iPhone); senão digital (escala do vídeo + recorte).
  const zl = zoomLimits(caps.zoom);
  const plan = zoomPlan(zoom, caps.zoom);
  const digital = plan.digital;
  const pills = zoomPills(caps.zoom);
  const setZoomC = (z: number) => setZoom(Math.min(zl.max, Math.max(zl.min, z)));
  const zoomRef = useRef({ caps, zl });
  zoomRef.current = { caps, zl };
  useEffect(() => { if (plan.hw !== null) zoomPump.set(plan.hw); }, [plan.hw]); // eslint-disable-line react-hooks/exhaustive-deps

  async function shoot() {
    const v = video.current;
    if (!v || !ready || full || !v.videoWidth) return;
    const t = track();
    const front = facing === 'user';
    // Foto inteira do sensor (ImageCapture, Chrome no Android). No layout não vale a pena: a composição é LAYOUT_W×LAYOUT_H.
    let ic: ImageCap | null = null;
    if (layout === null && t && !icBroken) {
      if (!imageCap.current) { imageCap.current = imageCaptureFor(t); icUsedAt = Date.now(); }
      ic = imageCap.current;
    }
    const realFlash = light && !!ic && caps.flash && !front;
    let torch = false, screen = false;
    if (light && !realFlash) {
      if (caps.torch && t) { await setTorch(true); torch = torchOn.current; }
      if (!torch && front) { setLit(true); screen = true; } // sem lanterna, a câmara da frente usa o ecrã como flash
      if (torch || screen) await sleep(420);
    }
    // O que o visor mostra (a moldura, ou a célula ativa do layout), em píxeis reais do vídeo: cover + zoom + espelho.
    const vw = v.videoWidth, vh = v.videoHeight;
    const view = card.w > 0 ? card : { x: 0, y: 0, w: vw, h: vh };
    const cell = layout !== null ? cellRects()[cells.length] : null;
    const crop = coverCrop(vw, vh, view, cell ?? view, digital, front);
    const c = grabFrame(v, crop, front);
    // Para conferir a foto em alta: o mesmo retângulo do vídeo, pequeno e cinzento (sem espelho nem filtro).
    const tw = 32, th = Math.max(8, Math.min(96, Math.round((32 * crop.h) / crop.w)));
    const ref = ic && !screen ? grayThumb(v, crop, tw, th) : null;
    setLit(false);
    buzz(15);
    setShotK((n) => n + 1);
    const lk = LOOKS[look];
    let job: Promise<HTMLCanvasElement | null> | null = null;
    if (ic && ref) {
      const cam = ic;
      job = (async () => {
        // As capacidades da foto (resolução máxima, flash): lidas uma vez, na primeira foto.
        if (!photoCaps.current && cam.getPhotoCapabilities) {
          photoCaps.current = await withTimeout(cam.getPhotoCapabilities(), 2000).catch(() => null);
          const fl = !!photoCaps.current?.fillLightMode?.includes('flash');
          setCaps((c) => (c.flash === fl ? c : { ...c, flash: fl }));
        }
        icUsedAt = Date.now();
        const pc = photoCaps.current;
        const set: Record<string, unknown> = {};
        if (pc?.imageWidth?.max && pc?.imageHeight?.max) { set.imageWidth = pc.imageWidth.max; set.imageHeight = pc.imageHeight.max; }
        if (pc?.fillLightMode?.length) set.fillLightMode = realFlash ? 'flash' : pc.fillLightMode.includes('off') ? 'off' : pc.fillLightMode[0];
        return capturePhoto(cam, set, crop, vw, vh, ref, tw, th, front);
      })()
        .then((hq) => { if (hq) applyLook(hq, lk); return hq; })
        .catch(() => null)
        .finally(() => { if (torch) void setTorch(false); });
    } else if (torch) void setTorch(false);
    applyLook(c, lk);
    if (layout !== null) return addCell(c);
    openReview(c);
    if (job) {
      const id = shotId.current;
      hqJob.current = { id, p: job };
      void job.then((hq) => { if (hq) upgradeSource(id, hq); });
    }
  }

  // ----- Geometria do ecrã: a moldura fica entre a barra de cima e os controlos de baixo quando cabe.
  const ctrlH = 84 + 44 + (kinds ? 46 : 0) + Math.max(insets.bottom, 14) + 6;
  const zoneTop = topPad + 56, zoneBot = Math.max(zoneTop + 120, area.h - ctrlH);
  const cap = (() => {
    if (!area.w || !area.h) return { x: 0, y: 0, w: 0, h: 0 };
    let fw = area.w, fh = fw / aspect;
    if (fh <= zoneBot - zoneTop) return { x: 0, y: zoneTop + (zoneBot - zoneTop - fh) / 2, w: fw, h: fh };
    // Não cabe entre os controlos (ex.: 9:16 no telemóvel): ocupa o ecrã e os controlos ficam por cima, como num Mimo.
    if (fh > area.h) { fh = area.h; fw = fh * aspect; }
    return { x: (area.w - fw) / 2, y: (area.h - fh) / 2, w: fw, h: fh };
  })();
  // ----- Layout: a moldura (4:5, centrada entre os controlos), as células em píxeis do visor, juntar tudo numa foto.
  const frame = (() => {
    const w = Math.max(120, Math.min(area.w - 24, 560, (zoneBot - zoneTop - 16) / 1.25));
    return { x: (area.w - w) / 2, y: zoneTop + Math.max(0, (zoneBot - zoneTop - w * 1.25) / 2), w, h: w * 1.25 };
  })();
  // O visor é a própria moldura: o vídeo cobre-a (object-fit: cover), por isso a foto sai com a resolução inteira do
  // vídeo (antes o vídeo cobria o ecrã todo e a moldura só apanhava o meio dele).
  const card = layout !== null && area.w > 0 ? frame : cap.w > 0 ? cap : { x: 0, y: 0, w: area.w, h: area.h };
  const inset = card.w < area.w - 1 || card.h < area.h - 1;
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
    const W = LAYOUT_W, H = LAYOUT_H;
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
        // No tamanho final da célula (a composição é LAYOUT_W×LAYOUT_H): senão a foto saía ampliada e desfocada.
        c.width = Math.round(cell[2] * LAYOUT_W);
        c.height = Math.round(cell[3] * LAYOUT_H);
        cover(c.getContext('2d')!, img, img.naturalWidth, img.naturalHeight, 0, 0, c.width, c.height);
        list = [...list, c];
      } catch { /* ficheiro que não é imagem legível */ } finally { URL.revokeObjectURL(url); }
    }
    cellCanvases.current = list;
    setCells(list.map((x) => x.toDataURL('image/jpeg', 0.7)));
    if (list.length >= rects.length) void finishLayout(list);
  }

  /**
   * Foca (e mede a luz) no ponto tocado, se a câmara e o browser o permitirem. O ponto passa do visor para o sensor
   * com as mesmas contas do recorte (cover + zoom + espelho). Sem suporte fica só o quadrado.
   */
  function focusAtPoint(x: number, y: number, w: number, h: number) {
    const t = track();
    const v = video.current;
    if (!t || !v?.videoWidth || !caps.focus) return;
    const p = tapToPoint(x, y, w, h, v.videoWidth, v.videoHeight, digital, facing === 'user');
    const set: Record<string, unknown> = { pointsOfInterest: [p] };
    if (caps.focusMode) set.focusMode = caps.focusMode;
    void t.applyConstraints({ advanced: [set as MediaTrackConstraintSet] }).catch(() => undefined);
  }
  /** O deslize da exposição fica à vista uns segundos depois de cada toque. */
  function showExpo() {
    if (!caps.exposure) return;
    setExpoOn(true);
    clearTimeout(expoTimer.current);
    expoTimer.current = setTimeout(() => setExpoOn(false), 3500);
  }
  function changeExpo(tv: number) {
    setExpo(tv);
    showExpo();
    if (caps.exposure) expoPump.set(exposureValue(tv, caps.exposure));
  }

  /** O dedo ainda quer gravar (largar o obturador enquanto o microfone acorda cancela a gravação). */
  const recWanted = useRef(false);
  function stopRec() {
    recWanted.current = false;
    const r = recorder.current;
    if (r && r.state !== 'inactive') { try { r.stop(); } catch { /* já parou */ } }
  }
  async function record() {
    if (recording || recorder.current?.state === 'recording') return stopRec();
    const s = stream.current;
    if (!s || !ready || typeof MediaRecorder === 'undefined') return;
    // Num tcheka: só se grava até o vídeo final chegar aos 60 s (à velocidade escolhida).
    const sp = segmented ? speed : 1;
    const limitMs = segmented ? recordableMs(usedFinalMs, sp) : MAX_VIDEO_S * 1000;
    if (limitMs < 300) return;
    recSpeed.current = sp;
    recWanted.current = true;
    // O som: se o microfone caiu (chamada, outra app, voltar de segundo plano), pede-se outra vez; sem ele grava-se sem som, com aviso.
    if (!s.getAudioTracks().some((x) => x.readyState === 'live')) {
      s.getAudioTracks().forEach((x) => s.removeTrack(x));
      try { (await withTimeout(navigator.mediaDevices.getUserMedia({ audio: true }), 2500)).getAudioTracks().forEach((x) => s.addTrack(x)); } catch { /* sem microfone */ }
      if (!recWanted.current || stream.current !== s) return;
    }
    const hasAudio = s.getAudioTracks().some((x) => x.readyState === 'live');
    // O zoom digital não entra no vídeo (é só a escala do visor): volta a 1× para o que se vê ser o que se grava.
    if (!caps.zoom && zoom > 1) setZoom(1);
    if (light && caps.torch) void setTorch(true);
    const type = pickRecorderType((t) => MediaRecorder.isTypeSupported(t), IOS);
    const vs = s.getVideoTracks()[0]?.getSettings?.() ?? {};
    const opts: MediaRecorderOptions = { videoBitsPerSecond: videoBitrate(vs.width, vs.height, vs.frameRate) };
    if (hasAudio) opts.audioBitsPerSecond = 128_000;
    if (type) opts.mimeType = type;
    // Se o browser recusar alguma opção, tenta com menos (no fim, as escolhas dele): gravar nunca pode falhar por isto.
    let made: MediaRecorder | null = null;
    for (const o of [opts, type ? { mimeType: type } : null, { videoBitsPerSecond: opts.videoBitsPerSecond }, undefined]) {
      if (o === null) continue;
      try { made = new MediaRecorder(s, o); break; } catch { /* a seguinte */ }
    }
    if (!made) return;
    const r = made;
    chunks.current = [];
    r.ondataavailable = (e) => { if (e.data.size) chunks.current.push(e.data); };
    r.onstop = () => {
      clearInterval(timer.current);
      setRecording(false);
      setSeconds(0);
      setRecMs(0);
      setMute(false);
      if (torchOn.current) void setTorch(false);
      const mime = recorderFile(r.mimeType || type).type;
      const blob = new Blob(chunks.current, { type: mime });
      chunks.current = [];
      recAudio.current?.pause();
      const durationMs = Date.now() - startedAt.current;
      if (!blob.size) return;
      // Num tcheka, o clipe junta-se logo (sem revisão), como no TikTok: grava-se o seguinte de seguida.
      if (segmented) { if (durationMs >= 250) onShot({ uri: URL.createObjectURL(blob), video: true, mime, durationMs, speed: recSpeed.current }); return; }
      setReview({ uri: URL.createObjectURL(blob), video: true, mime, durationMs });
    };
    recorder.current = r;
    try { r.start(1000); } catch { recorder.current = null; return; }
    startedAt.current = Date.now();
    setMute(!hasAudio);
    setRecording(true);
    buzz(10);
    // O som escolhido toca a partir de onde o vídeo final vai (a 3× ouve-se devagar; no fim fica a tempo).
    if (segmented?.musicUrl) {
      try {
        const a = recAudio.current ?? new Audio(segmented.musicUrl);
        if (a.src !== new URL(segmented.musicUrl, location.href).href) a.src = segmented.musicUrl;
        recAudio.current = a;
        a.playbackRate = musicRateWhileRecording(sp);
        const d = Number.isFinite(a.duration) && a.duration > 0 ? a.duration : 0;
        a.currentTime = d ? (usedFinalMs / 1000) % d : usedFinalMs / 1000;
        void a.play().catch(() => undefined);
      } catch { /* sem som a acompanhar */ }
    }
    timer.current = setInterval(() => {
      const ms = Date.now() - startedAt.current;
      setSeconds(Math.floor(ms / 1000));
      setRecMs(ms);
      if (ms >= limitMs && r.state === 'recording') r.stop();
    }, 100);
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
  const recordRef = useRef(record);
  recordRef.current = record;
  /** Toque = foto; manter premido = vídeo (começa aos 350 ms e pára ao largar). Com temporizador, o toque faz a contagem; tocar outra vez cancela. */
  const holdT = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const holding = useRef(false);
  const [hint, setHint] = useState(() => { try { return Number(localStorage.getItem('tx_cam_hint') ?? '0') < 3; } catch { return true; } });
  useEffect(() => { try { localStorage.setItem('tx_cam_hint', String(Number(localStorage.getItem('tx_cam_hint') ?? '0') + 1)); } catch { /* sem armazenamento */ } }, []);
  /** Ao gravar com o dedo no obturador: deslizar para cima aproxima, para baixo afasta. */
  const slide = useRef<{ y: number; z: number } | null>(null);
  const onSlide = useRef((ev: TouchEvent | PointerEvent) => {
    const sl = slide.current;
    if (!sl || !holding.current) return;
    const y = 'touches' in ev ? ev.touches[0]?.clientY : (ev as PointerEvent).clientY;
    if (typeof y !== 'number') return;
    // Só com o zoom do aparelho (o digital não entra no vídeo).
    const { caps: c, zl: l } = zoomRef.current;
    if (!c.zoom) return;
    setZoom(Math.min(l.max, Math.max(l.min, sl.z + (sl.y - y) / 90)));
  }).current;
  const stopSlide = () => {
    slide.current = null;
    window.removeEventListener('touchmove', onSlide);
    window.removeEventListener('pointermove', onSlide);
  };
  useEffect(() => () => { stopSlide(); clearTimeout(focusTimer.current); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  function pressIn(e?: { nativeEvent?: { pageY?: number } }) {
    holding.current = false;
    if (!ready || countdown !== null || recording || layout !== null || !modes.includes('video')) return;
    slide.current = { y: e?.nativeEvent?.pageY ?? 0, z: zoom };
    window.addEventListener('touchmove', onSlide, { passive: true });
    window.addEventListener('pointermove', onSlide);
    holdT.current = setTimeout(() => { holding.current = true; setHint(false); void record(); }, 350);
  }
  function pressOut() {
    clearTimeout(holdT.current);
    stopSlide();
    if (holding.current) { holding.current = false; stopRec(); return; }
    press();
  }
  function press() {
    if (countdown !== null) { clearInterval(countTimer.current); return setCountdown(null); }
    if (recording) return stopRec();
    // Num tcheka, o temporizador conta e começa a gravar sozinho (toca outra vez para parar).
    const fire = segmented && delay ? () => { setHint(false); void recordRef.current(); } : () => void shootRef.current();
    if (!delay || recording) return fire();
    let n: number = delay;
    setCountdown(n);
    countTimer.current = setInterval(() => {
      n -= 1;
      if (n <= 0) { clearInterval(countTimer.current); setCountdown(null); fire(); } else setCountdown(n);
    }, 1000);
  }

  /** A edição final (com a caixa do corte livre, se ainda estiver aberta). */
  const finalEdit = (): Edit => ({ ...editRef.current, box: freeCrop ? boxRef.current : editRef.current.box, aspect: freeCrop ? null : editRef.current.aspect });
  /** Guardar no aparelho antes de publicar: a foto editada (com a assinatura) ou o vídeo gravado. */
  async function saveReview() {
    const r = review;
    if (!r) return;
    if (!r.video) await settleHq();
    const src = reviewSrc.current;
    const blob: Blob | null = !r.video && src
      ? await photoJpeg(renderEdit(src, finalEdit()))
      : await (await fetch(r.uri)).blob();
    if (!blob) return;
    const f = new File([blob], `txillapp-${Date.now()}.${r.video ? recorderFile(r.mime).ext : 'jpg'}`, { type: blob.type || r.mime });
    try {
      if (navigator.canShare?.({ files: [f] })) { await navigator.share({ files: [f] }); return; }
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(f);
    a.download = f.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 8000);
  }
  /** Usar: a foto sai do original em tamanho inteiro, com as mesmas contas da pré-visualização. */
  const [saving, setSaving] = useState(false);
  async function acceptReview() {
    const r = review;
    if (!r || saving) return;
    if (!r.video && hqJob.current) { setSaving(true); await settleHq(); setSaving(false); }
    const src = reviewSrc.current;
    if (!r.video && src) {
      const e = finalEdit();
      // Do original (reviewSrc), nunca da cópia de 1600 px da pré-visualização.
      const jpeg = (sign: boolean) => photoJpeg(renderEdit(src, e, sign));
      const blob = await jpeg(true);
      // Num tcheka, também a mesma foto sem a assinatura: o estúdio assina o vídeo inteiro (senão ficavam duas).
      const plain = blob && keepClean ? await jpeg(false) : null;
      reviewSrc.current = null; previewSrc.current = null; pending.current = null;
      setReview(null); setTool(null); setFreeCrop(false);
      // A foto sai com a assinatura gravada (signed): ao guardar o mimo, o servidor não a volta a pôr.
      onShot(blob ? { uri: URL.createObjectURL(blob), video: false, mime: 'image/jpeg', signed: true, ...(plain ? { clean: URL.createObjectURL(plain) } : {}) } : r);
      return;
    }
    setReview(null); setTool(null); onShot(r);
  }
  const retake = () => { pending.current = null; renderSeq.current += 1; shotId.current += 1; hqJob.current = null; setReview(null); setFreeCrop(false); };

  const left = MAX_VIDEO_S - seconds;
  const fill = { position: 'absolute', left: 0, top: 0, width: '100%', height: '100%', objectFit: 'cover' };
  /** A caixa do visor à volta do <video>: é ela que leva o espelho, o zoom digital e o filtro. */
  const VIEW_BOX = { position: 'absolute', left: 0, top: 0, width: '100%', height: '100%', overflow: 'hidden' };
  const bottomPad = Math.max(insets.bottom, 14) + 6;
  // Flash a sério (ImageCapture), lanterna, ou, na câmara da frente, o ecrã como flash. Sem nada disto, não aparece.
  const showFlash = canTorch || facing === 'user' || caps.flash;
  const flashLabel = caps.flash && facing !== 'user' ? 'Flash' : canTorch ? 'Lanterna' : 'Flash de ecrã';
  const guide = layout !== null ? frame : cap; // onde fica a grelha dos terços
  // Na edição: o painel de baixo (área do slider/filtros + fila de ferramentas) e o espaço da foto por cima.
  const panelH = 10 + 88 + 78 + Math.max(insets.bottom, 10);
  const adj = tool && tool !== 'look' && tool !== 'crop' ? tool : null;

  /** O <video> do visor: muted e playsinline também como atributos (o React só põe a propriedade, e o iPhone olha para o atributo). */
  const videoRef = useCallback((el: HTMLVideoElement | null) => {
    video.current = el;
    if (!el) return;
    el.muted = true;
    el.defaultMuted = true;
    el.setAttribute('muted', '');
    el.setAttribute('playsinline', '');
    el.setAttribute('webkit-playsinline', '');
  }, []);

  return (
    <View style={st.root} accessibilityViewIsModal onLayout={(e: LayoutChangeEvent) => setArea({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
      <FeatureIntro id="camera" />
      {dom(
        'div',
        {
          style: { position: 'absolute', left: card.x, top: card.y, width: card.w, height: card.h, backgroundColor: '#111', touchAction: 'none', overflow: 'hidden', borderRadius: inset && layout === null ? 12 : 0 },
          onTouchStart: (e: TouchEvent) => {
            if (e.touches.length === 2) {
              pinch.current = { d: Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY), z: zoom };
              swipe.current = null;
            } else swipe.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
          },
          onTouchMove: (e: TouchEvent) => {
            const p = pinch.current;
            // A gravar, só o zoom do aparelho (o digital não fica no vídeo).
            if (p && e.touches.length === 2 && !(recording && !caps.zoom)) {
              const d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
              setZoomC(p.z * (d / p.d));
            }
          },
          onTouchEnd: (e: TouchEvent & { currentTarget: HTMLElement }) => {
            if (e.touches.length === 0) pinch.current = null;
            const s = swipe.current;
            swipe.current = null;
            if (!s || !ready || pinch.current) return;
            const dx = e.changedTouches[0].clientX - s.x;
            const dy = e.changedTouches[0].clientY - s.y;
            if (!recording && Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) return cycleLook(dx < 0 ? 1 : -1);
            if (Math.abs(dx) > 10 || Math.abs(dy) > 10 || layout !== null) return;
            // Toque: dois seguidos viram a câmara (como no Instagram); um só foca naquele ponto.
            const now = Date.now();
            if (now - lastTap.current < 300 && canFlip && !recording) {
              lastTap.current = 0;
              setFocusAt(null);
              buzz(8);
              return setFacing((f) => (f === 'user' ? 'environment' : 'user'));
            }
            lastTap.current = now;
            const b = e.currentTarget.getBoundingClientRect();
            const x = e.changedTouches[0].clientX - b.left, y = e.changedTouches[0].clientY - b.top;
            focusAtPoint(x, y, b.width, b.height);
            setFocusAt({ x, y, k: now });
            showExpo();
            clearTimeout(focusTimer.current);
            focusTimer.current = setTimeout(() => setFocusAt(null), 1200);
          },
        },
        // playsinline + muted (iPhone: sem isto o vídeo abre em ecrã inteiro ou não arranca); cover a encher o visor.
        // O espelho (câmara da frente), o zoom digital e o filtro ficam numa caixa à volta do <video>, não nele: no iPhone,
        // com o vídeo da frontal (que chega rodado) transformado, o Safari deixava de aplicar o object-fit: cover e a imagem
        // ficava num retângulo pequeno ao meio (~56%), com preto à volta.
        dom(
          'div',
          { key: 'vbox', style: { ...VIEW_BOX, ...viewTransform(facing === 'user', digital), filter: lookCss(LOOKS[look]), visibility: ready ? 'visible' : 'hidden', transition: 'filter 180ms' } },
          dom('video', {
            key: `v${vkey}`, ref: videoRef, playsInline: true, muted: true, autoPlay: true, disablePictureInPicture: true, onResize: onVideoResize, 'aria-hidden': true,
            style: fill,
          }),
        ),
        // O quadrado do foco (amarelo, como na câmara do iPhone): encolhe até ao ponto e apaga-se.
        focusAt && dom('div', { key: `f${focusAt.k}`, style: { position: 'absolute', left: focusAt.x - 38, top: focusAt.y - 38, width: 76, height: 76, borderRadius: 4, border: '1.5px solid #ffd60a', boxShadow: '0 0 0 1px rgba(0,0,0,0.2)', pointerEvents: 'none', zIndex: 3, animation: 'txfocus 1200ms ease-out forwards' } }),
        focusAt && dom('style', { key: 'fk' }, '@keyframes txfocus{0%{transform:scale(1.45);opacity:0}14%{transform:scale(1);opacity:1}24%{transform:scale(1.04)}34%{transform:scale(1)}75%{opacity:1}100%{opacity:0}}'),
        LOOKS[look].tint && dom('div', { key: 'tint', style: { position: 'absolute', inset: 0, pointerEvents: 'none', backgroundColor: `rgba(${LOOKS[look].tint!.join(',')})` } }),
        layout !== null && area.w > 0 && dom(
          'div',
          { key: 'frame', style: { position: 'absolute', left: frame.x - card.x, top: frame.y - card.y, width: frame.w, height: frame.h, pointerEvents: 'none', borderRadius: 6 } },
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
      <View pointerEvents="none" style={web({ position: 'absolute', left: 0, right: 0, top: 0, height: topPad + 90, backgroundImage: 'linear-gradient(to bottom, rgba(0,0,0,0.5), transparent)', zIndex: 1 })} />
      <View pointerEvents="none" style={web({ position: 'absolute', left: 0, right: 0, bottom: 0, height: ctrlH + 90, backgroundImage: 'linear-gradient(to top, rgba(0,0,0,0.6), transparent)', zIndex: 1 })} />
      {/* A grelha dos terços, se ligada (o visor já é a moldura: o que se vê é o que sai). */}
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, { zIndex: 2 }]}>
        {grid && ready && guide.w > 0 ? (
          <View style={{ position: 'absolute', left: guide.x, top: guide.y, width: guide.w, height: guide.h }}>
            {[1, 2].map((n) => <View key={`v${n}`} style={[st.gridLine, { left: (guide.w * n) / 3, top: 0, bottom: 0, width: StyleSheet.hairlineWidth * 2 }]} />)}
            {[1, 2].map((n) => <View key={`h${n}`} style={[st.gridLine, { top: (guide.h * n) / 3, left: 0, right: 0, height: StyleSheet.hairlineWidth * 2 }]} />)}
          </View>
        ) : null}
      </View>
      {lit ? <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: '#fff', zIndex: 11 }]} /> : null}
      {/* O clarão de cada foto: acende e apaga-se depressa (relança-se com a chave). */}
      {shotK > 0 ? dom('div', { key: `shot${shotK}`, style: { position: 'absolute', inset: 0, backgroundColor: '#fff', pointerEvents: 'none', zIndex: 12, opacity: 0, animation: 'txshot 220ms ease-out' } }) : null}
      {shotK > 0 ? dom('style', { key: 'shotk' }, '@keyframes txshot{0%{opacity:.85}100%{opacity:0}}') : null}

      {/* Num tcheka: a barra dos clipes (até 60 s), como no TikTok; o clipe a gravar cresce a coral. */}
      {segmented && (segmented.clipsMs.length > 0 || recording) ? (() => {
        const bar = segmentBar(segmented.clipsMs, recording ? finalMs(recMs, recSpeed.current) : 0);
        return (
          <View style={[st.segBar, { top: topPad }]} pointerEvents="none" accessibilityRole="progressbar" accessibilityLabel={`${Math.round(bar.used * TCHEKA_MAX_S)} de ${TCHEKA_MAX_S} segundos`}>
            {bar.segments.map((g, i) => <View key={i} style={[st.segPart, { left: `${g.start * 100}%`, width: `${g.width * 100}%` }]} />)}
            {bar.live ? <View style={[st.segPart, st.segLive, { left: `${bar.live.start * 100}%`, width: `${bar.live.width * 100}%` }]} /> : null}
          </View>
        );
      })() : null}
      {segmented && !recording && segmented.onMusic && ready && !review ? (
        <View style={[st.segMusicWrap, { top: topPad + 62 }]} pointerEvents="box-none">
          <Pressable onPress={segmented.onMusic} style={st.segMusic} accessibilityRole="button" accessibilityLabel={segmented.musicTitle ? `Som: ${segmented.musicTitle}. Trocar` : 'Escolher um som'}>
            <Icon name="music" size={15} color="#fff" />
            <Text style={st.segMusicText} numberOfLines={1}>{segmented.musicTitle || 'Escolher som'}</Text>
          </Pressable>
        </View>
      ) : null}

      {/* Em cima, só o essencial: fechar à esquerda; à direita o Feito, o flash e as opções. */}
      <View style={[st.top, { paddingTop: topPad + 6 }]}>
        <Pressable onPress={onClose} style={st.round} accessibilityRole="button" accessibilityLabel="Fechar câmara"><Icon name="x" size={24} color="#fff" strokeWidth={2.2} /></Pressable>
        {recording ? (
          <View style={{ alignItems: 'center', gap: 6 }}>
            <View style={[st.rec, left <= 5 && { backgroundColor: 'rgba(239,68,68,0.85)' }]} accessibilityRole="timer" accessibilityLabel={`A gravar: ${seconds} de ${MAX_VIDEO_S} segundos`}>
              <View style={[st.recDot, left <= 5 && { backgroundColor: '#fff' }]} />
              <Text style={st.recText}>{segmented ? clock(Math.floor((usedFinalMs + finalMs(recMs, recSpeed.current)) / 1000)) : clock(seconds)}<Text style={{ color: 'rgba(255,255,255,0.6)' }}> / {clock(MAX_VIDEO_S)}</Text></Text>
            </View>
            {mute ? <Text style={st.recNote}>Sem som: o microfone não está disponível</Text> : null}
          </View>
        ) : null}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          {!recording && count > 0 && onDone && layout === null ? (
            <Pressable onPress={onDone} style={[st.doneBtn, { height: 44 }]} accessibilityRole="button" accessibilityLabel={`${doneLabel}, ${count}`}>
              <Text style={{ color: '#fff', fontWeight: '700', fontSize: 15 }}>{doneLabel}</Text>
              <View style={st.doneCount}><Text style={{ color: '#fff', fontSize: 13, fontWeight: '700' }}>{count}</Text></View>
            </Pressable>
          ) : null}
          {(recording ? canTorch : showFlash) ? (
            <Pressable onPress={() => { const on = !light; setLight(on); if (recording) void setTorch(on); }} style={[st.round, light && { backgroundColor: '#fcd34d' }]} accessibilityRole="button" accessibilityState={{ selected: light }} accessibilityLabel={recording ? 'Lanterna' : flashLabel}>
              <View>
                <Icon name="bolt" size={22} solid={light} color={light ? colors.zinc900 : '#fff'} />
                {!light && <View pointerEvents="none" style={{ position: 'absolute', top: 10, left: -3, height: 2, borderRadius: 1, width: 28, backgroundColor: '#fff', transform: [{ rotate: '-45deg' }] }} />}
              </View>
            </Pressable>
          ) : null}
          {!recording ? (
            <>
              <TopTool on={delay > 0} label={delay ? `Temporizador: ${delay} s` : 'Temporizador'} onPress={() => setDelay((d) => (d === 0 ? 3 : d === 3 ? 10 : 0))}>
                <Icon name="clock" size={20} color={delay ? colors.zinc900 : '#fff'} />
                {delay > 0 ? <View style={st.delayBadge}><Text style={st.delayText}>{delay}</Text></View> : null}
              </TopTool>
              <TopTool on={grid} label="Grelha" onPress={toggleGrid}><Glyph name="thirds" size={20} color={grid ? colors.zinc900 : '#fff'} /></TopTool>
              <TopTool on={layout !== null} label={layout !== null ? `Layout: ${LAYOUTS[layout].name}` : 'Layout'} onPress={() => setLayoutOpen((v) => !v)}>
                <Icon name="grid" size={20} color={layout !== null ? colors.zinc900 : '#fff'} />
              </TopTool>
              {modes.includes('text') && onText && !(count > 0 && onDone) ? (
                <TopTool label="Só texto" onPress={onText}><Text style={{ color: '#fff', fontWeight: '800', fontSize: 14 }}>Aa</Text></TopTool>
              ) : null}
            </>
          ) : null}
        </View>
      </View>

      {/* Nome do filtro ao deslizar; contagem do temporizador. */}
      {lookName ? <View pointerEvents="none" style={st.center}><Text style={st.fxName}>{lookName}</Text></View> : null}
      {countdown !== null ? <View pointerEvents="none" style={st.center}><Text accessibilityLiveRegion="assertive" style={st.countText}>{countdown}</Text></View> : null}

      {!ready && (
        <View style={st.center}>
          {problem === null ? (
            <Text style={{ color: 'rgba(255,255,255,0.85)', fontSize: 16 }} accessibilityLiveRegion="polite">A acordar a câmara…</Text>
          ) : (
            <View style={{ alignItems: 'center', paddingHorizontal: 28, maxWidth: 440 }}>
              <Icon name={problem === 'denied' ? 'lock' : 'alert'} size={44} color="rgba(255,255,255,0.75)" />
              <Text style={st.pTitle} accessibilityRole="header">{PROBLEM_TEXT[problem].title}</Text>
              <Text style={st.pSub}>{PROBLEM_TEXT[problem].sub}</Text>
              {problem === 'denied' ? (
                <View style={st.steps}>
                  {permissionSteps(browserNow()).map((t, i) => (
                    <View key={i} style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
                      <View style={st.stepN}><Text style={{ color: '#fff', fontSize: 12, fontWeight: '800' }}>{i + 1}</Text></View>
                      <Text style={st.stepText}>{t}</Text>
                    </View>
                  ))}
                </View>
              ) : null}
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 10, marginTop: 20 }}>
                {problem !== 'nocamera' && problem !== 'unsupported' && problem !== 'insecure' ? (
                  <Pressable onPress={() => void start()} style={st.retry} accessibilityRole="button" accessibilityLabel="Tentar outra vez">
                    <Icon name="repeat" size={18} color="#fff" />
                    <Text style={{ color: '#fff', fontWeight: '700', fontSize: 16 }}>Tentar outra vez</Text>
                  </Pressable>
                ) : null}
                <GalleryPick onFiles={(f) => void fillFromFiles(f)} onOpen={openGallery} style={st.open}><Text style={{ color: '#fff', fontWeight: '700', fontSize: 16 }}>Abrir galeria</Text></GalleryPick>
              </View>
            </View>
          )}
        </View>
      )}

      {/* A exposição (só quando a câmara a deixa mexer): aparece depois de tocar para focar. */}
      {expoOn && caps.exposure && ready && !review ? (
        <View style={[st.expo, { bottom: ctrlH + 4 }]}>
          <Icon name="sun" size={18} color="#ffd60a" strokeWidth={2} />
          {dom('input', {
            type: 'range', min: -100, max: 100, step: 1, value: Math.round(expo * 100), 'aria-label': 'Exposição',
            'aria-valuetext': exposureLabel(exposureValue(expo, caps.exposure)),
            onChange: (ev: { target: HTMLInputElement }) => changeExpo(Number(ev.target.value) / 100),
            onDoubleClick: () => changeExpo(0),
            style: { flex: 1, minWidth: 0, accentColor: '#ffd60a', height: 44, margin: 0, cursor: 'pointer', touchAction: 'pan-x' },
          })}
          <Pressable onPress={() => changeExpo(0)} style={st.expoVal} accessibilityRole="button" accessibilityLabel={`Exposição ${exposureLabel(exposureValue(expo, caps.exposure))}. Toca para repor`}>
            <Text style={{ color: '#ffd60a', fontWeight: '800', fontSize: 13, fontVariant: ['tabular-nums'] }}>{exposureLabel(exposureValue(expo, caps.exposure))}</Text>
          </Pressable>
        </View>
      ) : null}

      {/* Em baixo: layout (se aberto), escolhidas, zoom, os modos e a fila galeria · obturador · virar. */}
      <View style={[st.bottom, { paddingBottom: bottomPad }]}>
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
        ) : null}
        {thumbs && thumbs.length > 0 && !recording && !segmented ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 20, gap: 6, alignItems: 'center' }} style={{ maxHeight: 54, marginBottom: 10, alignSelf: 'stretch' }} accessibilityLabel="Escolhidas">
            {thumbs.map((u, i) => (
              <View key={`${u}-${i}`} style={st.thumb}>{dom('img', { src: u, alt: '', style: { width: '100%', height: '100%', objectFit: 'cover', display: 'block' } })}</View>
            ))}
          </ScrollView>
        ) : hint && ready && !recording && count === 0 && layout === null && modes.includes('video') ? (
          <Text style={st.hint} pointerEvents="none">Toca para foto · mantém para vídeo</Text>
        ) : null}
        {full ? <Text style={st.full} accessibilityRole="alert">Máximo de {max} fotos</Text> : null}
        {segmented && !recording && ready && layout === null ? (
          <View style={st.speedRow} accessibilityRole="radiogroup" accessibilityLabel="Velocidade">
            {SPEEDS.map((s) => (
              <Pressable key={s} onPress={() => setSpeed(s)} style={[st.speedBtn, speed === s && st.speedOn]} accessibilityRole="radio" accessibilityState={{ selected: speed === s }} accessibilityLabel={`Velocidade ${speedLabel(s)}`}>
                <Text style={[st.speedText, speed === s && { color: colors.zinc900 }]}>{speedLabel(s)}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44 }}>
          {layout !== null && !recording ? (
            <View style={st.layoutPill}>
              <Text style={{ color: '#fff', fontWeight: '700', fontSize: 13 }}>{cells.length}/{LAYOUTS[layout].cells.length}</Text>
              <Pressable onPress={cells.length ? undoCell : leaveLayout} style={st.pillBtn} accessibilityRole="button" accessibilityLabel={cells.length ? 'Tirar a última foto do layout' : 'Sair do layout'}>
                <Icon name={cells.length ? 'undo' : 'x'} size={18} color="#fff" strokeWidth={2.2} />
              </Pressable>
            </View>
          ) : null}
          {/* Pílulas do zoom (1×, 2×; 0,5× com grande-angular): a acesa mostra o zoom exato, como no iPhone. A gravar sem zoom do aparelho, escondem-se. */}
          {ready && !(recording && !caps.zoom) ? (
            <View style={st.zoomRow} accessibilityRole="radiogroup" accessibilityLabel="Zoom">
              {pills.map((p) => {
                const on = activePill(zoom, pills) === p;
                return (
                  <Pressable key={p} onPress={() => { setZoomC(p); buzz(6); }} style={st.zoomBtn} accessibilityRole="radio" accessibilityState={{ selected: on }} accessibilityLabel={`Zoom ${zoomLabel(on ? zoom : p)}`}>
                    <View style={[st.zoomPill, on && st.zoomPillOn]}>
                      <Text style={[st.zoomText, !on && { color: '#fff' }]}>{on ? zoomLabel(zoom) : zoomLabel(p).replace('×', '')}</Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>
          ) : null}
        </View>
        {kinds ? (
          <View style={{ height: 44, marginBottom: 2, alignSelf: 'stretch' }}>
            {!recording ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={st.kinds} accessibilityRole="tablist">
                {kinds.map((k) => (
                  <Pressable key={k.id} onPress={() => onKind?.(k.id)} style={st.kindChip} accessibilityRole="tab" accessibilityState={{ selected: kind === k.id }} accessibilityLabel={k.label}>
                    <Text style={[st.kindText, kind === k.id && st.kindOn]}>{k.label.toUpperCase()}</Text>
                    <View style={[st.kindDot, kind !== k.id && { opacity: 0 }]} />
                  </Pressable>
                ))}
              </ScrollView>
            ) : null}
          </View>
        ) : null}
        <View style={st.row}>
          <View style={st.side}>
            {!recording && (
              <GalleryPick onFiles={(f) => void fillFromFiles(f)} onOpen={openGallery} style={st.galleryThumb}>
                {thumbs && thumbs.length ? dom('img', { src: thumbs[thumbs.length - 1], alt: 'Galeria', style: { width: '100%', height: '100%', objectFit: 'cover', display: 'block' } }) : <Icon name="images" size={22} color="#fff" strokeWidth={2} />}
              </GalleryPick>
            )}
          </View>
          <Pressable
            onPressIn={pressIn}
            onPressOut={pressOut}
            disabled={!ready || full}
            accessibilityRole="button"
            accessibilityLabel={countdown !== null ? 'Cancelar' : recording ? 'Parar de gravar' : modes.includes('video') && layout === null ? 'Tirar foto; mantém premido para gravar vídeo' : 'Tirar foto'}
            style={({ pressed }) => [st.shutter, (!ready || full) && { opacity: 0.4 }, recording ? { transform: [{ scale: 1.12 }] } : pressed ? { transform: [{ scale: 0.93 }] } : null]}
          >
            <View style={[st.shutterRing, recording && { borderColor: 'rgba(255,255,255,0.35)' }]} />
            {recording ? (
              <Svg width={84} height={84} style={StyleSheet.absoluteFill} pointerEvents="none">
                <Circle cx={42} cy={42} r={40} stroke={colors.brand} strokeWidth={4} fill="none" strokeLinecap="round"
                  strokeDasharray={`${2 * Math.PI * 40}`} strokeDashoffset={2 * Math.PI * 40 * (1 - Math.min(1, (segmented ? usedFinalMs + finalMs(recMs, recSpeed.current) : recMs) / (MAX_VIDEO_S * 1000)))}
                  transform="rotate(-90 42 42)" />
              </Svg>
            ) : null}
            <View style={[st.shutterIn, recording && st.shutterRec]} />
          </Pressable>
          <View style={[st.side, { alignItems: 'flex-end' }, segmented ? { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, width: 104, marginLeft: -40 } : null]}>
            {segmented && segmented.clipsMs.length > 0 && !recording ? (
              <Pressable onPress={segmented.onUndo} style={st.flipBtn} accessibilityRole="button" accessibilityLabel="Desfazer o último clipe"><Icon name="undo" size={22} color="#fff" strokeWidth={2.2} /></Pressable>
            ) : null}
            {canFlip && ready && !recording ? (
              <Pressable onPress={() => setFacing((f) => (f === 'user' ? 'environment' : 'user'))} style={st.flipBtn} accessibilityRole="button" accessibilityLabel="Virar câmara"><Icon name="flip-camera" size={24} color="#fff" /></Pressable>
            ) : null}
          </View>
        </View>
      </View>

      {/* Depois de tirar: ✕ volta à câmara, guardar no aparelho, ✓ usa a foto ou o vídeo; ferramentas em baixo. */}
      {review && (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: '#000', zIndex: 10 }]} accessibilityViewIsModal>
          <View style={[st.top, { paddingTop: topPad + 6 }]}>
            <Pressable onPress={retake} style={st.round} accessibilityRole="button" accessibilityLabel="Repetir"><Icon name="x" size={24} color="#fff" strokeWidth={2.2} /></Pressable>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <Pressable onPress={() => void saveReview()} style={st.round} accessibilityRole="button" accessibilityLabel="Guardar no aparelho"><Icon name="download" size={22} color="#fff" strokeWidth={2.2} /></Pressable>
              <Pressable onPress={() => void acceptReview()} disabled={saving} style={[st.okBtn, saving && { opacity: 0.7 }]} accessibilityRole="button" accessibilityState={{ busy: saving }} accessibilityLabel={review.video ? 'Usar vídeo' : saving ? 'A preparar a foto' : 'Usar foto'}><Icon name={saving ? 'loader' : 'check'} size={24} color="#fff" strokeWidth={3} /></Pressable>
            </View>
          </View>
          <View style={{ position: 'absolute', left: 0, right: 0, top: topPad + 62, bottom: review.video ? Math.max(insets.bottom, 16) : panelH }}>
            {review.video
              ? dom('video', { src: review.uri, playsInline: true, autoPlay: true, loop: true, muted: true, controls: false, onClick: (ev: { currentTarget: HTMLVideoElement }) => { ev.currentTarget.muted = !ev.currentTarget.muted; void ev.currentTarget.play().catch(() => undefined); }, style: { position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain' } })
              : dom('img', {
                  ref: imgEl, src: review.uri, alt: 'Pré-visualização', onLoad: () => setImgTick((n) => n + 1),
                  // Deslizar sobre a foto troca o filtro: para a esquerda o seguinte, para a direita o anterior.
                  onTouchStart: (ev: TouchEvent) => { swipeX.current = ev.touches[0]?.clientX ?? null; },
                  onTouchEnd: (ev: TouchEvent) => {
                    const x0 = swipeX.current; swipeX.current = null;
                    const x1 = ev.changedTouches[0]?.clientX;
                    if (x0 == null || x1 == null || freeCrop) return;
                    const dx = x1 - x0;
                    if (Math.abs(dx) < 45) return;
                    const cur = editRef.current.look;
                    const next = Math.max(0, Math.min(LOOKS.length - 1, cur + (dx < 0 ? 1 : -1)));
                    if (next !== cur) { endFreeCrop(); setTool('look'); changeEdit({ look: next }); }
                  },
                  style: { position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain', touchAction: 'pan-y' },
                })}
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
          </View>
          {!review.video && (
            <View style={[st.editPanel, { height: panelH, paddingBottom: Math.max(insets.bottom, 10) }]}>
              <View style={{ height: 88, justifyContent: 'center' }}>
                {tool === 'look' && (
                  <ScrollView ref={editLooksRow} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={st.looks} style={{ maxHeight: 82 }} accessibilityRole="tablist" accessibilityLabel="Filtros">
                    {LOOKS.map((l, i) => <LookSwatch key={l.id} look={l} src={swatchSrc} on={edit.look === i} onPress={() => changeEdit({ look: i })} />)}
                  </ScrollView>
                )}
                {adj && (adj === 'k' && edit.look === 0 ? (
                  <Text style={st.adjNote}>Escolhe um filtro primeiro e depois afina a intensidade aqui.</Text>
                ) : (() => {
                  const spec = ADJ[adj];
                  const v = spec.get(edit);
                  const changed = v !== spec.def;
                  return (
                    <View style={{ alignItems: 'center', gap: 8, paddingHorizontal: 24 }}>
                      <Pressable onPress={() => changed && changeEdit(spec.set(spec.def))} style={[st.valPill, changed && { backgroundColor: colors.brand }]} accessibilityRole="button" accessibilityLabel={changed ? `${spec.label}: ${fmtAdj(adj, v)}. Toca para repor` : `${spec.label}: ${fmtAdj(adj, v)}`}>
                        <Text style={st.valText}>{fmtAdj(adj, v)}</Text>
                      </Pressable>
                      {dom('input', {
                        type: 'range', min: spec.min, max: spec.max, step: 1, value: v, 'aria-label': spec.label,
                        onChange: (ev: { target: HTMLInputElement }) => changeEdit(spec.set(Number(ev.target.value))),
                        style: { width: '100%', maxWidth: 520, accentColor: '#d6334f', height: 28, margin: 0, cursor: 'pointer' },
                      })}
                    </View>
                  );
                })())}
                {tool === 'crop' && (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={[st.looks, { flexGrow: 1, justifyContent: 'center' }]}>
                    <Pressable onPress={rotate} style={st.cropIcon} accessibilityRole="button" accessibilityLabel="Rodar"><Icon name="repeat" size={18} color="#fff" /></Pressable>
                    <Pressable onPress={() => changeEdit({ flip: !editRef.current.flip })} style={[st.cropIcon, edit.flip && { backgroundColor: '#fff' }]} accessibilityRole="button" accessibilityState={{ selected: edit.flip }} accessibilityLabel="Espelhar"><Icon name="flip-camera" size={18} color={edit.flip ? colors.zinc900 : '#fff'} /></Pressable>
                    <Pressable onPress={startFreeCrop} style={[st.lookChip, freeCrop && st.lookOn]} accessibilityRole="tab" accessibilityState={{ selected: freeCrop }}>
                      <Text style={[st.lookText, freeCrop && { color: colors.zinc900 }]}>Livre</Text>
                    </Pressable>
                    {freeCrop && (
                      <Pressable onPress={endFreeCrop} style={st.cropOk} accessibilityRole="button" accessibilityLabel="Concluir o recorte">
                        <Icon name="check" size={16} color="#fff" strokeWidth={3} />
                        <Text style={{ color: '#fff', fontWeight: '800', fontSize: 13 }}>Concluir</Text>
                      </Pressable>
                    )}
                    {(isPost ? POST_ASPECTS : ALL_ASPECTS).map(([a, label]) => (
                      <Pressable key={label} onPress={() => { setFreeCrop(false); changeEdit({ aspect: a, box: null }); }} style={[st.lookChip, !freeCrop && edit.aspect === a && edit.box === null && st.lookOn]} accessibilityRole="tab" accessibilityState={{ selected: !freeCrop && edit.aspect === a }}>
                        <Text style={[st.lookText, !freeCrop && edit.aspect === a && edit.box === null && { color: colors.zinc900 }]}>{label}</Text>
                      </Pressable>
                    ))}
                  </ScrollView>
                )}
              </View>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={st.toolRow} style={{ maxHeight: 78 }} accessibilityRole="tablist" accessibilityLabel="Ferramentas">
                {TOOLS.map((t) => {
                  const on = tool === t.id;
                  const touched = t.id === 'look' ? edit.look !== 0
                    : t.id === 'crop' ? edit.rot !== 0 || edit.flip || edit.aspect !== edit0.aspect || edit.box !== null
                    : ADJ[t.id].get(edit) !== ADJ[t.id].def;
                  return (
                    <Pressable key={t.id} onPress={() => { if (t.id !== 'crop') endFreeCrop(); setTool(t.id); }} style={st.toolBtn} accessibilityRole="tab" accessibilityState={{ selected: on }} accessibilityLabel={t.a11y ?? t.label}>
                      <View style={[st.toolCircle, on && { backgroundColor: '#fff', borderColor: '#fff' }]}>
                        {toolIcon(t.id, on ? colors.zinc900 : '#fff')}
                        {touched ? <View style={st.toolDot} /> : null}
                      </View>
                      <Text numberOfLines={1} style={[st.toolText, on && { color: '#fff' }]}>{t.label}</Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            </View>
          )}
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
  round: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(0,0,0,0.32)', alignItems: 'center', justifyContent: 'center' },
  okBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 14px rgba(214,51,79,0.45)' } as object,
  delayBadge: { position: 'absolute', right: -4, bottom: -4, minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 4, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  delayText: { color: '#fff', fontSize: 11, fontWeight: '800' },
  rec: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 999, backgroundColor: 'rgba(0,0,0,0.55)', paddingHorizontal: 14, paddingVertical: 8 },
  recNote: { color: '#fff', fontSize: 12, fontWeight: '700', backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, overflow: 'hidden' },
  recDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#ef4444' },
  recText: { color: '#fff', fontWeight: '700', fontSize: 15, fontVariant: ['tabular-nums'] },
  center: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', zIndex: 2 },
  fxName: { color: '#fff', fontSize: 22, fontWeight: '800', textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 8, borderRadius: 999, backgroundColor: 'rgba(0,0,0,0.35)', paddingHorizontal: 18, paddingVertical: 8, overflow: 'hidden' },
  countText: { fontSize: 120, fontWeight: '900', color: '#fff', textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 20 },
  pTitle: { marginTop: 12, color: '#fff', fontSize: 18, fontWeight: '700', textAlign: 'center' },
  pSub: { marginTop: 6, color: 'rgba(255,255,255,0.75)', fontSize: 14, lineHeight: 20, textAlign: 'center' },
  steps: { marginTop: 16, gap: 10, alignSelf: 'stretch', backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 14, padding: 14 },
  stepN: { width: 22, height: 22, borderRadius: 11, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  stepText: { flex: 1, color: '#fff', fontSize: 14, lineHeight: 20 },
  retry: { height: 48, borderRadius: 24, backgroundColor: 'rgba(255,255,255,0.16)', paddingHorizontal: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  expo: { position: 'absolute', left: 24, right: 24, zIndex: 4, height: 48, flexDirection: 'row', alignItems: 'center', gap: 10, alignSelf: 'center', maxWidth: 420, borderRadius: 24, backgroundColor: 'rgba(0,0,0,0.5)', paddingLeft: 14 },
  expoVal: { width: 56, height: 44, alignItems: 'center', justifyContent: 'center' },
  open: { height: 48, borderRadius: 24, backgroundColor: colors.brand, paddingHorizontal: 24, alignItems: 'center', justifyContent: 'center' },
  tool: { width: 44, height: 44, borderRadius: 22 },
  gridLine: { position: 'absolute', backgroundColor: 'rgba(255,255,255,0.45)' },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 3, alignItems: 'center' },
  looks: { paddingHorizontal: 16, gap: 6, alignItems: 'center' },
  lookChip: { height: 44, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.14)', paddingHorizontal: 13, alignItems: 'center', justifyContent: 'center' },
  lookOn: { backgroundColor: '#fff' },
  layoutChip: { height: 44, borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.35)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.35)', paddingHorizontal: 10, alignItems: 'center', justifyContent: 'center' },
  layoutPill: { height: 44, flexDirection: 'row', alignItems: 'center', gap: 2, borderRadius: 22, backgroundColor: 'rgba(0,0,0,0.45)', paddingLeft: 14 },
  pillBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  lookText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  zoomRow: { flexDirection: 'row', alignItems: 'center', borderRadius: 22, backgroundColor: 'rgba(0,0,0,0.3)', paddingHorizontal: 2 },
  zoomBtn: { minWidth: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  zoomPill: { minWidth: 30, height: 30, borderRadius: 15, backgroundColor: 'rgba(0,0,0,0.35)', paddingHorizontal: 4, alignItems: 'center', justifyContent: 'center' },
  zoomPillOn: { minWidth: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(0,0,0,0.6)' },
  zoomText: { color: '#fcd34d', fontSize: 12, fontWeight: '800' },
  row: { width: '100%', maxWidth: 520, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 28 },
  side: { width: 64, alignItems: 'flex-start' },
  shutter: { width: 84, height: 84, borderRadius: 42, alignItems: 'center', justifyContent: 'center' },
  shutterRing: { position: 'absolute', left: 0, top: 0, width: 84, height: 84, borderRadius: 42, borderWidth: 4, borderColor: '#fff' },
  shutterIn: { width: 66, height: 66, borderRadius: 33, backgroundColor: '#fff' },
  shutterRec: { width: 30, height: 30, borderRadius: 8, backgroundColor: '#ef4444' },
  hint: { color: 'rgba(255,255,255,0.8)', fontSize: 12, fontWeight: '600', marginBottom: 10 },
  thumb: { width: 44, height: 44, borderRadius: 8, overflow: 'hidden', borderWidth: 2, borderColor: colors.brand, backgroundColor: '#222' },
  kinds: { flexGrow: 1, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 6, paddingHorizontal: 12 },
  kindChip: { height: 44, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center', gap: 4 },
  kindDot: { width: 4, height: 4, borderRadius: 2, backgroundColor: colors.brand },
  galleryThumb: { width: 48, height: 48, borderRadius: 24, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.38)' },
  segBar: { position: 'absolute', left: 10, right: 10, height: 5, zIndex: 7, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.28)', overflow: 'hidden' },
  segPart: { position: 'absolute', top: 0, bottom: 0, backgroundColor: '#fff', borderRightWidth: 2, borderRightColor: 'rgba(0,0,0,0.55)' },
  segLive: { backgroundColor: colors.brand, borderRightWidth: 0 },
  segMusicWrap: { position: 'absolute', left: 0, right: 0, zIndex: 6, alignItems: 'center' },
  segMusic: { flexDirection: 'row', alignItems: 'center', gap: 6, maxWidth: 240, height: 34, paddingHorizontal: 14, borderRadius: 17, backgroundColor: 'rgba(0,0,0,0.45)' },
  segMusicText: { color: '#fff', fontSize: 13, fontWeight: '700', flexShrink: 1 },
  speedRow: { flexDirection: 'row', gap: 4, padding: 3, borderRadius: 999, backgroundColor: 'rgba(0,0,0,0.42)', marginBottom: 10 },
  speedBtn: { minWidth: 46, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 },
  speedOn: { backgroundColor: '#fff' },
  speedText: { color: '#fff', fontWeight: '800', fontSize: 13 },
  flipBtn: { width: 48, height: 48, borderRadius: 24, backgroundColor: 'rgba(0,0,0,0.38)', alignItems: 'center', justifyContent: 'center' },
  cropOk: { height: 44, paddingHorizontal: 14, borderRadius: 22, backgroundColor: colors.brand, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  cropIcon: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.14)', alignItems: 'center', justifyContent: 'center' },
  kindText: { color: 'rgba(255,255,255,0.6)', fontSize: 12, fontWeight: '700', letterSpacing: 0.8, textShadowColor: 'rgba(0,0,0,0.45)', textShadowRadius: 4 },
  kindOn: { color: '#fff' },
  doneBtn: { height: 46, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 23, backgroundColor: colors.brand, paddingHorizontal: 16 },
  doneCount: { minWidth: 22, height: 22, borderRadius: 11, backgroundColor: 'rgba(255,255,255,0.28)', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  full: { marginBottom: 10, color: '#fff', fontSize: 14, fontWeight: '600' },
  editPanel: { position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 6, paddingTop: 10, backgroundColor: '#000' },
  toolRow: { flexGrow: 1, flexDirection: 'row', justifyContent: 'center', gap: 4, paddingHorizontal: 10 },
  toolBtn: { width: 70, alignItems: 'center', gap: 5 },
  toolCircle: { width: 48, height: 48, borderRadius: 24, borderWidth: 1, borderColor: 'rgba(255,255,255,0.28)', backgroundColor: 'rgba(255,255,255,0.08)', alignItems: 'center', justifyContent: 'center' },
  toolDot: { position: 'absolute', top: 3, right: 3, width: 8, height: 8, borderRadius: 4, backgroundColor: colors.brand },
  toolText: { color: 'rgba(255,255,255,0.7)', fontSize: 11, fontWeight: '700' },
  valPill: { minWidth: 56, height: 44, borderRadius: 22, paddingHorizontal: 12, backgroundColor: 'rgba(255,255,255,0.14)', alignItems: 'center', justifyContent: 'center' },
  valText: { color: '#fff', fontSize: 14, fontWeight: '800', fontVariant: ['tabular-nums'] },
  adjNote: { color: 'rgba(255,255,255,0.75)', fontSize: 13, fontWeight: '600', textAlign: 'center', paddingHorizontal: 32 },
});
