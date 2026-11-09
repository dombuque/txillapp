import type React from 'react';
import { createElement, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Path } from 'react-native-svg';
import { colors } from '@/lib/theme';
import { FeatureIntro } from './FeatureIntro';
import { Icon } from './Icon';
import { acquireCamera, releaseCamera } from './zas/cameraSession';
import { useAuth } from '@/lib/auth';
import { WORDMARK_BOX, WORDMARK_DOT, WORDMARK_PATHS, WORDMARK_STROKE, signLayout } from '@/lib/wordmark';

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
 * em baixo à direita, e por baixo o @ de quem tirou.
 */
export function stampTxillapp(g: CanvasRenderingContext2D, W: number, H: number, username?: string | null) {
  const L = signLayout(W, H, !!username);
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
    g.fillText(`@${username}`, L.right, L.userBaseline);
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
/** Desenha `src` a preencher o retângulo (cover), cortando o que sobra. */
function cover(g: CanvasRenderingContext2D, src: CanvasImageSource, srcW: number, srcH: number, x: number, y: number, w: number, h: number) {
  const k = Math.max(w / srcW, h / srcH);
  const sw = w / k, sh = h / k;
  g.drawImage(src, (srcW - sw) / 2, (srcH - sh) / 2, sw, sh, x, y, w, h);
}

const buzz = (ms: number) => { try { navigator.vibrate?.(ms); } catch { /* sem vibração */ } };

// ----- Edição depois de tirar: filtro (com intensidade), luz e cor, vinheta, corte e rotação.
type Box = { x: number; y: number; w: number; h: number };
/** b/c/s são multiplicadores (1 = sem mexer); t, hl e sh vão de -100 a 100; vig e k (intensidade do filtro) de 0 a 100. */
type Edit = { rot: 0 | 90 | 180 | 270; flip: boolean; aspect: number | null; box: Box | null; look: number; b: number; c: number; s: number; t: number; hl: number; sh: number; vig: number; k: number };
const EDIT0: Edit = { rot: 0, flip: false, aspect: null, box: null, look: 0, b: 1, c: 1, s: 1, t: 0, hl: 0, sh: 0, vig: 0, k: 100 };
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

/** Uma linha do painel de opções da câmara: ícone, nome e o estado atual. */
function OptRow({ icon, label, value, on, onPress }: { icon: ReactNode; label: string; value?: string; on?: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [st.optRow, pressed && { opacity: 0.7 }]} accessibilityRole="button" accessibilityState={{ selected: !!on }} accessibilityLabel={value ? `${label}: ${value}` : label}>
      <View style={[st.optIcon, on && { backgroundColor: '#fff' }]}>{icon}</View>
      <Text style={[st.optValue, on && { color: '#fff' }]} numberOfLines={1}>{value ?? label}</Text>
    </Pressable>
  );
}

export function TxCamera({
  count, max, modes = ['photo', 'video', 'text'], onShot, onGallery, onClose, onDone, onText, doneLabel = 'Feito', thumbs, kinds, kind, onKind, aspect = 9 / 16,
}: {
  count: number; max: number; modes?: CamMode[]; onShot: (s: Shot) => void; onGallery: (files: File[]) => void; onClose: () => void; onDone?: () => void; onText?: () => void; doneLabel?: string;
  /** Miniaturas do que já foi escolhido (a fila de "recentes", como no Instagram). */
  thumbs?: string[];
  /** A barra de baixo com o que se vai criar (Publicação · Tcheka · Zás · Mimo): tocar noutro chama onKind. */
  kinds?: { id: string; label: string }[]; kind?: string; onKind?: (id: string) => void;
  /** Proporção da foto (largura/altura): 4:5 numa publicação, 9:16 num mimo ou tcheka. A moldura mostra exatamente o que sai. */
  aspect?: number;
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
  const [canTorch, setCanTorch] = useState(false);
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
  const [optsOpen, setOptsOpen] = useState(false);
  const [grid, setGrid] = useState(() => { try { return localStorage.getItem('tx_cam_grid') === '1'; } catch { return false; } });
  const toggleGrid = () => setGrid((v) => { try { localStorage.setItem('tx_cam_grid', v ? '0' : '1'); } catch { /* sem armazenamento */ } return !v; });
  // Layout: qual (ou nenhum), o seletor aberto, e as fotos já tiradas (uma por célula).
  const [layout, setLayout] = useState<number | null>(null);
  const [layoutOpen, setLayoutOpen] = useState(false);
  const [cells, setCells] = useState<string[]>([]);
  const cellCanvases = useRef<HTMLCanvasElement[]>([]);
  const [zoom, setZoom] = useState(1);
  const [recording, setRecording] = useState(false);
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
  const stamp = (g: CanvasRenderingContext2D, w: number, h: number) => stampTxillapp(g, w, h, user?.username);
  const [edit, setEdit] = useState<Edit>(EDIT0);
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
    setBox({ x, y, w, h });
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
    paint(e, false);
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
  function openReview(c: HTMLCanvasElement) {
    renderSeq.current += 1;
    pending.current = null;
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
    editRef.current = EDIT0;
    setEdit(EDIT0);
    setTool('look'); // os filtros aparecem logo depois de tirar a foto
    setFreeCrop(false);
    setBox({ x: 0.08, y: 0.08, w: 0.84, h: 0.84 });
    // Miniatura quadrada da foto tirada (sem filtro), para o exemplo de cada filtro.
    try {
      const m = document.createElement('canvas');
      m.width = m.height = 112;
      const side = Math.min(c.width, c.height);
      m.getContext('2d')!.drawImage(c, (c.width - side) / 2, (c.height - side) / 2, side, side, 0, 0, 112, 112);
      setSwatchSrc(m.toDataURL('image/jpeg', 0.75));
    } catch { setSwatchSrc(null); }
    const seq = renderSeq.current;
    renderEdit(previewSrc.current, EDIT0).toBlob((blob) => blob && seq === renderSeq.current && setReview({ uri: URL.createObjectURL(blob), video: false, mime: 'image/jpeg' }), 'image/jpeg', 0.9);
  }
  // A fila de filtros acompanha o escolhido (sobretudo quando se troca a deslizar sobre a foto).
  useEffect(() => {
    if (tool !== 'look') return;
    editLooksRow.current?.scrollTo({ x: Math.max(0, edit.look * 64 - 96), animated: true });
  }, [edit.look, tool]);
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
    clearTimeout(holdT.current);
    if (recorder.current?.state === 'recording') { recorder.current.onstop = null; recorder.current.stop(); }
    reviewSrc.current = null;
    previewSrc.current = null;
    pending.current = null;
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
    const cell = layout !== null ? cellRects()[cells.length] : cap.w > 0 ? cap : null;
    if (cell) {
      // Recorta do sensor exatamente o que a moldura (ou a célula ativa do layout) mostra no visor (o visor é "cover" com o zoom).
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
    setShotK((n) => n + 1);
    if (layout !== null) return addCell(c);
    openReview(c);
  }

  // ----- Geometria do ecrã: visor inteiro; a moldura fica entre a barra de cima e os controlos de baixo quando cabe.
  const card = { x: 0, y: 0, w: area.w, h: area.h };
  const ctrlH = 84 + 40 + (kinds ? 46 : 0) + Math.max(insets.bottom, 14) + 6;
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

  /** Foca no ponto tocado (0–1 no visor), se a câmara e o browser o permitirem. Sem suporte, fica só o círculo. */
  function focusOn(nx: number, ny: number) {
    const t = stream.current?.getVideoTracks()[0];
    if (!t?.getCapabilities) return;
    const caps = t.getCapabilities() as MediaTrackCapabilities & { focusMode?: string[]; pointsOfInterest?: unknown };
    if (!caps.focusMode?.length) return;
    const x = facing === 'user' ? 1 - nx : nx;
    const fm = caps.focusMode.includes('single-shot') ? 'single-shot' : caps.focusMode.includes('continuous') ? 'continuous' : null;
    if (!fm) return;
    void t.applyConstraints({ advanced: [{ focusMode: fm, pointsOfInterest: [{ x, y: ny }] } as unknown as MediaTrackConstraintSet] }).catch(() => undefined);
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
      setRecMs(0);
      const mime = (r.mimeType || type || 'video/mp4').split(';')[0];
      const blob = new Blob(chunks.current, { type: mime });
      if (blob.size) setReview({ uri: URL.createObjectURL(blob), video: true, mime, durationMs: Date.now() - startedAt.current });
    };
    recorder.current = r;
    startedAt.current = Date.now();
    r.start(1000);
    setRecording(true);
    setOptsOpen(false);
    buzz(10);
    timer.current = setInterval(() => {
      const t = Math.floor((Date.now() - startedAt.current) / 1000);
      setSeconds(t);
      setRecMs(Date.now() - startedAt.current);
      if (t >= MAX_VIDEO_S && r.state === 'recording') r.stop();
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
    setZoom(Math.min(5, Math.max(1, sl.z + (sl.y - y) / 90)));
  }).current;
  const stopSlide = () => {
    slide.current = null;
    window.removeEventListener('touchmove', onSlide);
    window.removeEventListener('pointermove', onSlide);
  };
  useEffect(() => () => { stopSlide(); clearTimeout(focusTimer.current); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  function pressIn(e?: { nativeEvent?: { pageY?: number } }) {
    holding.current = false;
    setOptsOpen(false);
    if (!ready || countdown !== null || recording || layout !== null || !modes.includes('video')) return;
    slide.current = { y: e?.nativeEvent?.pageY ?? 0, z: zoom };
    window.addEventListener('touchmove', onSlide, { passive: true });
    window.addEventListener('pointermove', onSlide);
    holdT.current = setTimeout(() => { holding.current = true; setHint(false); record(); }, 350);
  }
  function pressOut() {
    clearTimeout(holdT.current);
    stopSlide();
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

  /** A edição final (com a caixa do corte livre, se ainda estiver aberta). */
  const finalEdit = (): Edit => ({ ...editRef.current, box: freeCrop ? boxRef.current : editRef.current.box, aspect: freeCrop ? null : editRef.current.aspect });
  /** Guardar no aparelho antes de publicar: a foto editada (com a assinatura) ou o vídeo gravado. */
  async function saveReview() {
    const r = review;
    if (!r) return;
    const src = reviewSrc.current;
    const blob: Blob | null = !r.video && src
      ? await new Promise<Blob | null>((res) => renderEdit(src, finalEdit()).toBlob(res, 'image/jpeg', 0.92))
      : await (await fetch(r.uri)).blob();
    if (!blob) return;
    const f = new File([blob], `txillapp-${Date.now()}.${r.video ? (r.mime.includes('webm') ? 'webm' : 'mp4') : 'jpg'}`, { type: blob.type || r.mime });
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
  function acceptReview() {
    const r = review;
    if (!r) return;
    const src = reviewSrc.current;
    if (!r.video && src) {
      renderEdit(src, finalEdit()).toBlob((blob) => {
        reviewSrc.current = null; previewSrc.current = null; pending.current = null;
        setReview(null); setTool(null); setFreeCrop(false);
        onShot(blob ? { uri: URL.createObjectURL(blob), video: false, mime: 'image/jpeg' } : r);
      }, 'image/jpeg', 0.92);
      return;
    }
    setReview(null); setTool(null); onShot(r);
  }
  const retake = () => { pending.current = null; renderSeq.current += 1; setReview(null); setFreeCrop(false); };

  const mm = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  const mirror = facing === 'user' ? 'scaleX(-1)' : 'none';
  const fill = { position: 'absolute', left: 0, top: 0, width: '100%', height: '100%', objectFit: 'cover' };
  const bottomPad = Math.max(insets.bottom, 14) + 6;
  const showFlash = canTorch || facing === 'user'; // sem lanterna, a câmara da frente usa o ecrã como flash
  const guide = layout !== null ? frame : cap; // onde fica a grelha dos terços
  // Na edição: o painel de baixo (área do slider/filtros + fila de ferramentas) e o espaço da foto por cima.
  const panelH = 10 + 88 + 78 + Math.max(insets.bottom, 10);
  const adj = tool && tool !== 'look' && tool !== 'crop' ? tool : null;

  return (
    <View style={st.root} accessibilityViewIsModal onLayout={(e: LayoutChangeEvent) => setArea({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
      <FeatureIntro id="camera" />
      {dom(
        'div',
        {
          style: { position: 'absolute', left: card.x, top: card.y, width: card.w, height: card.h, backgroundColor: '#111', touchAction: 'none', overflow: 'hidden' },
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
            focusOn(x / b.width, y / b.height);
            setFocusAt({ x, y, k: now });
            clearTimeout(focusTimer.current);
            focusTimer.current = setTimeout(() => setFocusAt(null), 900);
          },
        },
        dom('video', { key: `v${vkey}`, ref: video, playsInline: true, muted: true, autoPlay: true, onResize: onVideoResize, style: { ...fill, transform: `${mirror === 'none' ? '' : mirror + ' '}scale(${zoom})`, filter: lookCss(LOOKS[look]), visibility: ready ? 'visible' : 'hidden', transition: 'filter 180ms' } }),
        focusAt && dom('div', { key: `f${focusAt.k}`, style: { position: 'absolute', left: focusAt.x - 36, top: focusAt.y - 36, width: 72, height: 72, borderRadius: 36, border: '2px solid #fff', boxShadow: '0 0 0 1px rgba(0,0,0,0.25)', pointerEvents: 'none', zIndex: 3, animation: 'txfocus 900ms ease-out forwards' } }),
        focusAt && dom('style', { key: 'fk' }, '@keyframes txfocus{0%{transform:scale(1.5);opacity:0}15%{transform:scale(1);opacity:1}70%{opacity:1}100%{transform:scale(.92);opacity:0}}'),
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
      <View pointerEvents="none" style={web({ position: 'absolute', left: 0, right: 0, top: 0, height: topPad + 90, backgroundImage: 'linear-gradient(to bottom, rgba(0,0,0,0.5), transparent)', zIndex: 1 })} />
      <View pointerEvents="none" style={web({ position: 'absolute', left: 0, right: 0, bottom: 0, height: ctrlH + 90, backgroundImage: 'linear-gradient(to top, rgba(0,0,0,0.6), transparent)', zIndex: 1 })} />
      {/* O que a foto vai apanhar: fora da moldura fica escurecido; a grelha dos terços, se ligada. */}
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, { zIndex: 2 }]}>
        {layout === null && cap.w > 0 && (cap.w < area.w - 1 || cap.h < area.h - 1) ? (
          <>
            <View style={web({ position: 'absolute', left: cap.x, top: cap.y, width: cap.w, height: cap.h, borderRadius: 12, boxShadow: '0 0 0 9999px rgba(0,0,0,0.42)' })} />
          </>
        ) : null}
        {grid && ready && guide.w > 0 ? (
          <View style={{ position: 'absolute', left: guide.x, top: guide.y, width: guide.w, height: guide.h }}>
            {[1, 2].map((n) => <View key={`v${n}`} style={[st.gridLine, { left: (guide.w * n) / 3, top: 0, bottom: 0, width: StyleSheet.hairlineWidth * 2 }]} />)}
            {[1, 2].map((n) => <View key={`h${n}`} style={[st.gridLine, { top: (guide.h * n) / 3, left: 0, right: 0, height: StyleSheet.hairlineWidth * 2 }]} />)}
          </View>
        ) : null}
      </View>
      {lit ? <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: '#fff', zIndex: 11 }]} /> : null}
      {/* O clarão de cada foto: acende e apaga-se depressa (relança-se com a chave). */}
      {shotK > 0 ? dom('div', { key: `shot${shotK}`, style: { position: 'absolute', inset: 0, backgroundColor: '#fff', pointerEvents: 'none', zIndex: 12, opacity: 0, animation: 'txshot 340ms ease-out' } }) : null}
      {shotK > 0 ? dom('style', { key: 'shotk' }, '@keyframes txshot{0%{opacity:.9}100%{opacity:0}}') : null}

      {/* Em cima, só o essencial: fechar à esquerda; à direita o Feito, o flash e as opções. */}
      <View style={[st.top, { paddingTop: topPad + 6 }]}>
        <Pressable onPress={onClose} style={st.round} accessibilityRole="button" accessibilityLabel="Fechar câmara"><Icon name="x" size={24} color="#fff" strokeWidth={2.2} /></Pressable>
        {recording ? <View style={st.rec}><View style={st.recDot} /><Text style={st.recText}>{mm}</Text></View> : null}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          {!recording && count > 0 && onDone && layout === null ? (
            <Pressable onPress={onDone} style={[st.doneBtn, { height: 44 }]} accessibilityRole="button" accessibilityLabel={`${doneLabel}, ${count}`}>
              <Text style={{ color: '#fff', fontWeight: '700', fontSize: 15 }}>{doneLabel}</Text>
              <View style={st.doneCount}><Text style={{ color: '#fff', fontSize: 13, fontWeight: '700' }}>{count}</Text></View>
            </Pressable>
          ) : null}
          {!recording && showFlash ? (
            <Pressable onPress={() => setLight((v) => !v)} style={[st.round, light && { backgroundColor: '#fcd34d' }]} accessibilityRole="button" accessibilityState={{ selected: light }} accessibilityLabel={canTorch ? 'Lanterna' : 'Flash de ecrã'}>
              <View>
                <Icon name="bolt" size={22} solid={light} color={light ? colors.zinc900 : '#fff'} />
                {!light && <View pointerEvents="none" style={{ position: 'absolute', top: 10, left: -3, height: 2, borderRadius: 1, width: 28, backgroundColor: '#fff', transform: [{ rotate: '-45deg' }] }} />}
              </View>
            </Pressable>
          ) : null}
          {!recording ? (
            <Pressable onPress={() => setOptsOpen((v) => !v)} style={[st.round, optsOpen && { backgroundColor: 'rgba(255,255,255,0.28)' }]} accessibilityRole="button" accessibilityState={{ expanded: optsOpen }} accessibilityLabel="Opções da câmara">
              <Icon name="more" size={22} color="#fff" />
              {delay > 0 && !optsOpen ? <View style={st.delayBadge}><Text style={st.delayText}>{delay}</Text></View> : null}
            </Pressable>
          ) : null}
        </View>
      </View>

      {/* Painel de opções: o que não precisa de estar sempre à vista. */}
      {optsOpen && !recording ? (
        <>
          <Pressable onPress={() => setOptsOpen(false)} style={[StyleSheet.absoluteFill, { zIndex: 7 }]} accessibilityLabel="Fechar opções" />
          <View style={[st.opts, { top: topPad + 58 }]}>
            <OptRow icon={<Icon name="clock" size={20} color={delay ? colors.zinc900 : '#fff'} />} label="Temporizador" value={delay ? `${delay} s` : 'Tempo'} on={delay > 0}
              onPress={() => setDelay((d) => (d === 0 ? 3 : d === 3 ? 10 : 0))} />
            <OptRow icon={<Glyph name="thirds" size={20} color={grid ? colors.zinc900 : '#fff'} />} label="Grelha" value="Grelha" on={grid} onPress={toggleGrid} />
            <OptRow icon={<Icon name="grid" size={20} color={layout !== null ? colors.zinc900 : '#fff'} />} label="Layout" value={layout !== null ? LAYOUTS[layout].name : 'Layout'} on={layout !== null}
              onPress={() => { setLayoutOpen((v) => !v); setOptsOpen(false); }} />
            {modes.includes('text') && onText ? (
              <OptRow icon={<Text style={{ color: '#fff', fontWeight: '800', fontSize: 14 }}>Aa</Text>} label="Só texto" value="Texto" onPress={() => { setOptsOpen(false); onText(); }} />
            ) : null}
          </View>
        </>
      ) : null}

      {/* Nome do filtro ao deslizar; contagem do temporizador. */}
      {lookName ? <View pointerEvents="none" style={st.center}><Text style={st.fxName}>{lookName}</Text></View> : null}
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
        {thumbs && thumbs.length > 0 && !recording ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 20, gap: 6, alignItems: 'center' }} style={{ maxHeight: 54, marginBottom: 10, alignSelf: 'stretch' }} accessibilityLabel="Escolhidas">
            {thumbs.map((u, i) => (
              <View key={`${u}-${i}`} style={st.thumb}>{dom('img', { src: u, alt: '', style: { width: '100%', height: '100%', objectFit: 'cover', display: 'block' } })}</View>
            ))}
          </ScrollView>
        ) : hint && ready && !recording && count === 0 && layout === null && modes.includes('video') ? (
          <Text style={st.hint} pointerEvents="none">Toca para foto · mantém para vídeo</Text>
        ) : null}
        {full ? <Text style={st.full} accessibilityRole="alert">Máximo de {max} fotos</Text> : null}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10, minHeight: 30 }}>
          {layout !== null && !recording ? (
            <View style={st.layoutPill}>
              <Text style={{ color: '#fff', fontWeight: '700', fontSize: 13 }}>{cells.length}/{LAYOUTS[layout].cells.length}</Text>
              <Pressable onPress={cells.length ? undoCell : leaveLayout} hitSlop={8} accessibilityRole="button" accessibilityLabel={cells.length ? 'Tirar a última foto do layout' : 'Sair do layout'}>
                <Icon name={cells.length ? 'undo' : 'x'} size={18} color="#fff" strokeWidth={2.2} />
              </Pressable>
            </View>
          ) : null}
          {ready ? (
            <Pressable onPress={() => setZoom((z) => (z > 1.02 ? 1 : 2))} style={st.zoomPill} accessibilityRole="button" accessibilityLabel={zoom > 1.02 ? 'Repor zoom' : 'Aproximar 2 vezes'}>
              <Text style={st.zoomText}>{zoom > 1.02 ? `${zoom.toFixed(1)}×` : '1×'}</Text>
            </Pressable>
          ) : null}
        </View>
        {kinds ? (
          <View style={{ height: 34, marginBottom: 12, alignSelf: 'stretch' }}>
            {!recording ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={st.kinds} accessibilityRole="tablist">
                {kinds.map((k) => (
                  <Pressable key={k.id} onPress={() => onKind?.(k.id)} style={st.kindChip} accessibilityRole="tab" accessibilityState={{ selected: kind === k.id }} hitSlop={6}>
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
                  strokeDasharray={`${2 * Math.PI * 40}`} strokeDashoffset={2 * Math.PI * 40 * (1 - Math.min(1, recMs / (MAX_VIDEO_S * 1000)))}
                  transform="rotate(-90 42 42)" />
              </Svg>
            ) : null}
            <View style={[st.shutterIn, recording && st.shutterRec]} />
          </Pressable>
          <View style={[st.side, { alignItems: 'flex-end' }]}>
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
              <Pressable onPress={acceptReview} style={st.okBtn} accessibilityRole="button" accessibilityLabel={review.video ? 'Usar vídeo' : 'Usar foto'}><Icon name="check" size={24} color="#fff" strokeWidth={3} /></Pressable>
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
                    <Pressable onPress={() => changeEdit({ rot: ((editRef.current.rot + 90) % 360) as Edit['rot'] })} style={st.cropIcon} accessibilityRole="button" accessibilityLabel="Rodar"><Icon name="repeat" size={18} color="#fff" /></Pressable>
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
                    {([[null, 'Original'], [1, '1:1'], [0.8, '4:5'], [9 / 16, '9:16'], [16 / 9, '16:9']] as const).map(([a, label]) => (
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
                    : t.id === 'crop' ? edit.rot !== 0 || edit.flip || edit.aspect !== null || edit.box !== null
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
  recDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#ef4444' },
  recText: { color: '#fff', fontWeight: '700', fontSize: 15, fontVariant: ['tabular-nums'] },
  center: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', zIndex: 2 },
  fxName: { color: '#fff', fontSize: 22, fontWeight: '800', textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 8, borderRadius: 999, backgroundColor: 'rgba(0,0,0,0.35)', paddingHorizontal: 18, paddingVertical: 8, overflow: 'hidden' },
  countText: { fontSize: 120, fontWeight: '900', color: '#fff', textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 20 },
  pTitle: { marginTop: 12, color: '#fff', fontSize: 18, fontWeight: '700', textAlign: 'center' },
  pSub: { marginTop: 4, color: 'rgba(255,255,255,0.7)', fontSize: 14, textAlign: 'center' },
  open: { marginTop: 20, height: 48, borderRadius: 24, backgroundColor: colors.brand, paddingHorizontal: 24, alignItems: 'center', justifyContent: 'center' },
  opts: { position: 'absolute', right: 12, zIndex: 8, flexDirection: 'row', gap: 2, borderRadius: 22, paddingVertical: 8, paddingHorizontal: 6, backgroundColor: 'rgba(24,24,27,0.9)', boxShadow: '0 10px 30px rgba(0,0,0,0.45)' } as object,
  optRow: { width: 62, alignItems: 'center', gap: 5 },
  optIcon: { width: 34, height: 34, borderRadius: 17, backgroundColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center' },
  optLabel: { flex: 1, color: '#fff', fontSize: 14, fontWeight: '700' },
  optValue: { color: 'rgba(255,255,255,0.72)', fontSize: 11, fontWeight: '700' },
  gridLine: { position: 'absolute', backgroundColor: 'rgba(255,255,255,0.45)' },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 3, alignItems: 'center' },
  looks: { paddingHorizontal: 16, gap: 6, alignItems: 'center' },
  lookChip: { height: 30, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.14)', paddingHorizontal: 13, alignItems: 'center', justifyContent: 'center' },
  lookOn: { backgroundColor: '#fff' },
  layoutChip: { height: 40, borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.35)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.35)', paddingHorizontal: 10, alignItems: 'center', justifyContent: 'center' },
  layoutPill: { height: 30, flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 15, backgroundColor: 'rgba(0,0,0,0.45)', paddingHorizontal: 12 },
  lookText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  zoomPill: { minWidth: 40, height: 30, borderRadius: 15, backgroundColor: 'rgba(0,0,0,0.45)', paddingHorizontal: 10, alignItems: 'center', justifyContent: 'center' },
  zoomText: { color: '#fcd34d', fontSize: 13, fontWeight: '800' },
  row: { width: '100%', maxWidth: 520, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 28 },
  side: { width: 64, alignItems: 'flex-start' },
  shutter: { width: 84, height: 84, borderRadius: 42, alignItems: 'center', justifyContent: 'center' },
  shutterRing: { position: 'absolute', left: 0, top: 0, width: 84, height: 84, borderRadius: 42, borderWidth: 4, borderColor: '#fff' },
  shutterIn: { width: 66, height: 66, borderRadius: 33, backgroundColor: '#fff' },
  shutterRec: { width: 30, height: 30, borderRadius: 8, backgroundColor: '#ef4444' },
  hint: { color: 'rgba(255,255,255,0.8)', fontSize: 12, fontWeight: '600', marginBottom: 10 },
  thumb: { width: 44, height: 44, borderRadius: 8, overflow: 'hidden', borderWidth: 2, borderColor: colors.brand, backgroundColor: '#222' },
  kinds: { flexGrow: 1, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 6, paddingHorizontal: 12 },
  kindChip: { height: 34, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center', gap: 4 },
  kindDot: { width: 4, height: 4, borderRadius: 2, backgroundColor: colors.brand },
  galleryThumb: { width: 48, height: 48, borderRadius: 24, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.38)' },
  flipBtn: { width: 48, height: 48, borderRadius: 24, backgroundColor: 'rgba(0,0,0,0.38)', alignItems: 'center', justifyContent: 'center' },
  cropOk: { height: 30, paddingHorizontal: 12, borderRadius: 15, backgroundColor: colors.brand, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  cropIcon: { width: 34, height: 34, borderRadius: 17, backgroundColor: 'rgba(255,255,255,0.14)', alignItems: 'center', justifyContent: 'center' },
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
  valPill: { minWidth: 52, height: 28, borderRadius: 14, paddingHorizontal: 12, backgroundColor: 'rgba(255,255,255,0.14)', alignItems: 'center', justifyContent: 'center' },
  valText: { color: '#fff', fontSize: 14, fontWeight: '800', fontVariant: ['tabular-nums'] },
  adjNote: { color: 'rgba(255,255,255,0.75)', fontSize: 13, fontWeight: '600', textAlign: 'center', paddingHorizontal: 32 },
});
