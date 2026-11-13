import { Canvas, ColorMatrix, FilterMode, Image as SkImageNode, ImageFormat, MipmapMode, PaintStyle, Picture, Skia, StrokeCap, StrokeJoin, TileMode, matchFont, type SkCanvas, type SkFont, type SkImage, type SkRuntimeEffect } from '@shopify/react-native-skia';
import { File, Paths } from 'expo-file-system';
import * as MediaLibrary from 'expo-media-library/legacy';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, Alert, BackHandler, PanResponder, Platform, Pressable, ScrollView, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { useAuth } from '@/lib/auth';
import { editorOutWidth } from '@/lib/photoSize';
import { POST_RATIO_DEFAULT, POST_RATIO_MAX } from '@/lib/postAspect';
import { colors } from '@/lib/theme';
import {
  SEAL_BLUE, SEAL_CHECK, SEAL_CHECK_WIDTH, SEAL_CORAL, SEAL_PATH, WORDMARK_BOX, WORDMARK_DOT, WORDMARK_PATHS, WORDMARK_STROKE, sealOf, sealPaint, signLayout,
  type SealTier,
} from '@/lib/wordmark';
import { Icon } from './Icon';

/**
 * Editor de fotos do Txillapp no telemóvel (depois de tirar a foto): filtros com intensidade, ajustes (brilho, contraste,
 * saturação, temperatura, realces, sombras, vinheta, nitidez), recorte (proporções, arrastar para enquadrar), rodar e espelhar.
 * A pré-visualização e a foto final saem do mesmo desenho (Skia), por isso o que se vê é o que se publica, já com a assinatura
 * do Txillapp.
 */

type M = number[]; // matriz de cor 4×5 (20 valores), deslocamentos de 0 a 1

const ID: M = [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0];
/** a ∘ b: aplica b e depois a. */
function mul(a: M, b: M): M {
  const out = new Array<number>(20).fill(0);
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 5; c++) {
      let v = c === 4 ? a[r * 5 + 4] : 0;
      for (let k = 0; k < 4; k++) v += a[r * 5 + k] * b[k * 5 + c];
      out[r * 5 + c] = v;
    }
  }
  return out;
}
const sat = (s: number): M => {
  const lr = 0.2126 * (1 - s), lg = 0.7152 * (1 - s), lb = 0.0722 * (1 - s);
  return [lr + s, lg, lb, 0, 0, lr, lg + s, lb, 0, 0, lr, lg, lb + s, 0, 0, 0, 0, 0, 1, 0];
};
const con = (c: number): M => { const t = (1 - c) / 2; return [c, 0, 0, 0, t, 0, c, 0, 0, t, 0, 0, c, 0, t, 0, 0, 0, 1, 0]; };
const bri = (b: number): M => [1, 0, 0, 0, b, 0, 1, 0, 0, b, 0, 0, 1, 0, b, 0, 0, 0, 1, 0];
const warm = (w: number): M => [1 + 0.12 * w, 0, 0, 0, 0.02 * w, 0, 1 + 0.02 * w, 0, 0, 0, 0, 0, 1 - 0.12 * w, 0, -0.02 * w, 0, 0, 0, 1, 0];
const SEPIA: M = [0.393, 0.769, 0.189, 0, 0, 0.349, 0.686, 0.168, 0, 0, 0.272, 0.534, 0.131, 0, 0, 0, 0, 0, 1, 0];
const mix = (a: M, b: M, t: number): M => a.map((v, i) => v * (1 - t) + b[i] * t);

interface Look { id: string; name: string; sat?: number; con?: number; bri?: number; warm?: number; sepia?: number }
const LOOKS: Look[] = [
  { id: 'normal', name: 'Normal' },
  { id: 'vivo', name: 'Vivo', sat: 1.35, con: 1.08 },
  { id: 'quente', name: 'Quente', warm: 0.7, sat: 1.1 },
  { id: 'frio', name: 'Frio', warm: -0.7, con: 1.04 },
  { id: 'praia', name: 'Praia', bri: 0.05, warm: 0.4, sat: 1.25 },
  { id: 'noite', name: 'Noite', con: 1.2, bri: -0.04, warm: -0.35, sat: 0.9 },
  { id: 'drama', name: 'Drama', con: 1.35, sat: 0.8 },
  { id: 'vintage', name: 'Vintage', sepia: 0.6, con: 0.95, bri: 0.03 },
  { id: 'pb', name: 'P&B', sat: 0, con: 1.1 },
];

/** b, c, s, w, hi, sh vão de -1 a 1 (0 é o normal); v (vinheta) e n (nitidez) vão de 0 a 1. */
interface Adjust { b: number; c: number; s: number; w: number; hi: number; sh: number; v: number; n: number }
const NO_ADJ: Adjust = { b: 0, c: 0, s: 0, w: 0, hi: 0, sh: 0, v: 0, n: 0 };
/** amt: intensidade do filtro, de 0 a 1. */
interface Edit { look: number; amt: number; adj: Adjust; aspect: number | null; rot: 0 | 90 | 180 | 270; flip: boolean; ox: number; oy: number }

/** Só o filtro, com toda a força. */
function lookMatrix(l: Look): M {
  let m = ID;
  m = mul(warm(l.warm ?? 0), m);
  m = mul(bri(l.bri ?? 0), m);
  m = mul(con(l.con ?? 1), m);
  m = mul(sat(l.sat ?? 1), m);
  if (l.sepia) m = mix(m, mul(SEPIA, m), l.sepia);
  return m;
}
/** O filtro (com a intensidade escolhida) e depois os ajustes de cor. */
function matrixOf(e: Edit): M {
  let m = mix(ID, lookMatrix(LOOKS[e.look]), e.amt);
  m = mul(warm(e.adj.w * 0.8), m);
  m = mul(bri(e.adj.b * 0.22), m);
  m = mul(con(1 + e.adj.c * 0.45), m);
  m = mul(sat(Math.max(0, 1 + e.adj.s)), m);
  return m;
}

/**
 * O resto dos ajustes corre num shader (SkSL), píxel a píxel, por esta ordem:
 * nitidez (máscara de desfocagem leve: o píxel menos a média dos 4 vizinhos, somado de volta), matriz de cor (filtro e ajustes),
 * e realces/sombras (clarear ou escurecer só as zonas claras ou só as escuras, pesadas pela luminância).
 * A vinheta é um gradiente radial por cima, no espaço da foto final.
 */
const SKSL = `
uniform shader image;
uniform float4 r0;
uniform float4 r1;
uniform float4 r2;
uniform float4 r3;
uniform float4 off;
uniform float sharp;
uniform float rad;
uniform float hi;
uniform float sh;

half4 main(float2 p) {
  float4 c = float4(image.eval(p));
  if (sharp > 0.0) {
    float4 b = float4(image.eval(p + float2(rad, 0.0)) + image.eval(p - float2(rad, 0.0)) + image.eval(p + float2(0.0, rad)) + image.eval(p - float2(0.0, rad))) * 0.25;
    c.rgb = clamp(c.rgb + (c.rgb - b.rgb) * sharp, 0.0, c.a);
  }
  if (c.a > 0.0) c.rgb /= c.a;
  float3 o = clamp(float3(dot(r0, c), dot(r1, c), dot(r2, c)) + off.rgb, 0.0, 1.0);
  float a = clamp(dot(r3, c) + off.a, 0.0, 1.0);
  float L = dot(o, float3(0.2126, 0.7152, 0.0722));
  float wS = 1.0 - smoothstep(0.0, 0.55, L);
  float wH = smoothstep(0.45, 1.0, L);
  o = clamp(o + sh * 0.3 * wS + hi * 0.3 * wH, 0.0, 1.0);
  return half4(half3(o * a), half(a));
}`;
let fxCache: SkRuntimeEffect | null | undefined;
const fx = () => {
  if (fxCache === undefined) {
    try { fxCache = Skia.RuntimeEffect.Make(SKSL); } catch { fxCache = null; }
  }
  return fxCache;
};

/** A parte da foto (já rodada) que fica no recorte. */
function cropOf(img: SkImage, e: Edit) {
  const turned = e.rot === 90 || e.rot === 270;
  const iw = turned ? img.height() : img.width();
  const ih = turned ? img.width() : img.height();
  const a = e.aspect ?? iw / ih;
  const cw = Math.min(iw, ih * a), ch = cw / a;
  const cx = (iw - cw) / 2 + (e.ox * (iw - cw)) / 2;
  const cy = (ih - ch) / 2 + (e.oy * (ih - ch)) / 2;
  return { iw, ih, a, cw, ch, cx, cy };
}

/** Cópia da foto com o lado maior a `max` px (ou a própria, se já for mais pequena). Não larga a original. */
function resized(img: SkImage, max: number): SkImage {
  const w = img.width(), h = img.height();
  const k = max / Math.max(w, h);
  if (k >= 1) return img;
  const W = Math.round(w * k), H = Math.round(h * k);
  // Superfície em CPU: a foto grande descodifica-se uma vez em memória normal, sem subir inteira para a GPU,
  // e a cópia pequena fica em memória normal. A superfície larga-se logo (o GC do JS não vê a memória nativa).
  const surface = Skia.Surface.Make(W, H) ?? Skia.Surface.MakeOffscreen(W, H);
  if (!surface) return img;
  try {
    surface.getCanvas().drawImageRectOptions(img, Skia.XYWHRect(0, 0, w, h), Skia.XYWHRect(0, 0, W, H), FilterMode.Linear, w * h <= 16e6 ? MipmapMode.Linear : MipmapMode.None, Skia.Paint());
    surface.flush();
    // Cópia em memória normal (se a superfície for da GPU, por não haver em CPU), e a do ecrã larga-se.
    const snap = surface.makeImageSnapshot();
    const raster = snap.makeNonTextureImage();
    if (raster) { snap.dispose?.(); return raster; }
    return snap;
  } finally {
    surface.dispose?.();
  }
}

/**
 * Fotos do telemóvel têm 12 a 50 MP: guardá-las inteiras e redesenhá-las a cada filtro esgota a memória no Android
 * (a app fecha). A foto final sai com no máximo 1920 px de largura (1440 ao alto, até 2560 de altura), por isso basta
 * trabalhar com o lado maior a 2560 px.
 */
const MAX_SIDE = 2560;
function shrink(img: SkImage): SkImage {
  const small = resized(img, MAX_SIDE);
  if (small !== img) img.dispose?.(); // a original larga-se
  return small;
}
/** A pré-visualização desenha a partir de uma cópia do tamanho do ecrã (mais leve a cada mexida na barra). */
const PREVIEW_SIDE = 1600;

/** Desenha a foto editada num retângulo W×H (pré-visualização ou foto final), com a assinatura. */
function drawEdit(canvas: SkCanvas, img: SkImage, e: Edit, W: number, H: number, font: SkFont | null, username?: string | null, seal?: SealTier | null, sign = true) {
  const { cw, ch, cx, cy } = cropOf(img, e);
  const w0 = img.width(), h0 = img.height();
  const m = matrixOf(e);
  const effect = fx();
  const paint = Skia.Paint();
  if (effect) {
    // Raio da nitidez: uma fração fixa da foto final (≈1,6 px numa foto de 1440), passada para píxeis da imagem de origem,
    // para a pré-visualização e o ficheiro ficarem iguais seja qual for o tamanho.
    const rad = (Math.max(W, H) / 900) * (cw / W);
    const image = img.makeShaderOptions(TileMode.Clamp, TileMode.Clamp, FilterMode.Linear, MipmapMode.None);
    paint.setShader(effect.makeShaderWithChildren(
      [m[0], m[1], m[2], m[3], m[5], m[6], m[7], m[8], m[10], m[11], m[12], m[13], m[15], m[16], m[17], m[18], m[4], m[9], m[14], m[19], e.adj.n * 1.6, rad, e.adj.hi, e.adj.sh],
      [image],
    ));
  } else {
    paint.setColorFilter(Skia.ColorFilter.MakeMatrix(m)); // sem shader: só filtro e ajustes de cor
  }
  canvas.save();
  canvas.clipRect(Skia.XYWHRect(0, 0, W, H), 1, true);
  canvas.scale(W / cw, H / ch);
  canvas.translate(-cx, -cy);
  // Espaço da foto rodada → espaço da foto original.
  const turned = e.rot === 90 || e.rot === 270;
  const iw = turned ? h0 : w0;
  if (e.flip) { canvas.translate(iw, 0); canvas.scale(-1, 1); }
  if (e.rot === 90) { canvas.translate(h0, 0); canvas.rotate(90, 0, 0); }
  else if (e.rot === 180) { canvas.translate(w0, h0); canvas.rotate(180, 0, 0); }
  else if (e.rot === 270) { canvas.translate(0, w0); canvas.rotate(270, 0, 0); }
  if (effect) canvas.drawRect(Skia.XYWHRect(0, 0, w0, h0), paint);
  else canvas.drawImage(img, 0, 0, paint);
  canvas.restore();
  if (e.adj.v > 0) {
    // Vinheta: elipse que acompanha a forma da foto, transparente no meio e a escurecer para os cantos.
    const vg = Skia.Paint();
    const lm = Skia.Matrix().translate(W / 2, H / 2).scale((W / 2) * Math.SQRT2, (H / 2) * Math.SQRT2);
    vg.setShader(Skia.Shader.MakeRadialGradient({ x: 0, y: 0 }, 1, [Skia.Color('rgba(0,0,0,0)'), Skia.Color(`rgba(0,0,0,${(0.8 * e.adj.v).toFixed(3)})`)], [0.45, 1], TileMode.Clamp, lm));
    canvas.drawRect(Skia.XYWHRect(0, 0, W, H), vg);
  }
  if (sign) drawSign(canvas, W, H, font, username, seal);
}

/** Logótipo em caminhos Skia (feito uma vez). */
let markPaths: ReturnType<typeof Skia.Path.MakeFromSVGString>[] | null = null;
const marks = () => (markPaths ??= WORDMARK_PATHS.map((d) => Skia.Path.MakeFromSVGString(d)));
/** O selo de verificado em caminhos Skia (o mesmo desenho do VerifiedBadge, na caixa de 24). */
let sealPaths: { seal: ReturnType<typeof Skia.Path.MakeFromSVGString>; check: ReturnType<typeof Skia.Path.MakeFromSVGString> } | null = null;
const sealMarks = () => (sealPaths ??= { seal: Skia.Path.MakeFromSVGString(SEAL_PATH), check: Skia.Path.MakeFromSVGString(SEAL_CHECK) });

/**
 * A assinatura (igual à do site): o logótipo em branco com o ponto do i a coral e sombra suave, e por baixo o @.
 * Conta verificada (`seal`): o selo a seguir ao @, com a mesma sombra.
 */
function drawSign(canvas: SkCanvas, W: number, H: number, font: SkFont | null, username?: string | null, seal?: SealTier | null) {
  const L = signLayout(W, H, !!username && !!font, seal);
  const shadow = Skia.ImageFilter.MakeDropShadow(0, L.s * 2, L.blur / 2, L.blur / 2, Skia.Color('rgba(0,0,0,0.45)'), null);
  const stroke = Skia.Paint();
  stroke.setStyle(PaintStyle.Stroke);
  stroke.setStrokeWidth(WORDMARK_STROKE);
  stroke.setStrokeCap(StrokeCap.Round);
  stroke.setStrokeJoin(StrokeJoin.Round);
  stroke.setColor(Skia.Color('#ffffff'));
  stroke.setAntiAlias(true);
  stroke.setImageFilter(shadow);
  canvas.save();
  canvas.translate(L.x - WORDMARK_BOX.x * L.s, L.y - WORDMARK_BOX.y * L.s);
  canvas.scale(L.s, L.s);
  for (const p of marks()) if (p) canvas.drawPath(p, stroke);
  const dot = Skia.Paint();
  dot.setColor(Skia.Color('#ff5c6c'));
  dot.setAntiAlias(true);
  canvas.drawCircle(WORDMARK_DOT.cx, WORDMARK_DOT.cy, WORDMARK_DOT.r, dot);
  canvas.restore();
  if (username && font) {
    const t = `@${username}`;
    const p = Skia.Paint();
    p.setColor(Skia.Color('rgba(255,255,255,0.92)'));
    p.setAntiAlias(true);
    p.setImageFilter(Skia.ImageFilter.MakeDropShadow(0, 1, L.blur / 2, L.blur / 2, Skia.Color('rgba(0,0,0,0.5)'), null));
    canvas.drawText(t, L.textRight - font.getTextWidth(t), L.userBaseline, p, font);
  }
  const { seal: sp, check } = L.seal ? sealMarks() : { seal: null, check: null };
  if (L.seal && sp && check) {
    // O selo na caixa de 24 (escala k): a roseta com a sombra do @ (desfeita a escala, para ficar igual à do texto) e,
    // por cima, o visto branco sem sombra.
    const b = L.seal;
    canvas.save();
    canvas.translate(b.x, b.y);
    canvas.scale(b.k, b.k);
    const fill = Skia.Paint();
    fill.setAntiAlias(true);
    if (sealPaint(b.tier) === 'coral') {
      const o = SEAL_CORAL;
      fill.setShader(Skia.Shader.MakeLinearGradient({ x: o.x0, y: o.y0 }, { x: o.x1, y: o.y1 }, [Skia.Color(o.from), Skia.Color(o.to)], [0, 1], TileMode.Clamp));
    } else {
      fill.setColor(Skia.Color(SEAL_BLUE));
    }
    fill.setImageFilter(Skia.ImageFilter.MakeDropShadow(0, 1 / b.k, L.blur / 2 / b.k, L.blur / 2 / b.k, Skia.Color('rgba(0,0,0,0.5)'), null));
    canvas.drawPath(sp, fill);
    const tick = Skia.Paint();
    tick.setStyle(PaintStyle.Stroke);
    tick.setStrokeWidth(SEAL_CHECK_WIDTH);
    tick.setStrokeCap(StrokeCap.Round);
    tick.setStrokeJoin(StrokeJoin.Round);
    tick.setColor(Skia.Color('#ffffff'));
    tick.setAntiAlias(true);
    canvas.drawPath(check, tick);
    canvas.restore();
  }
}

const signFont = (size: number) => {
  try {
    return matchFont({ fontFamily: Platform.select({ ios: 'Helvetica Neue', default: 'sans-serif' }), fontSize: size, fontWeight: 'bold' });
  } catch {
    return null;
  }
};

/** As ferramentas da fila de baixo, pela ordem em que aparecem. */
type AdjKey = keyof Adjust;
type ToolId = 'look' | 'amt' | AdjKey | 'crop';
interface ToolDef { id: ToolId; label: string; kind: 'look' | 'crop' | 'both' | 'up' | 'pct' }
const TOOLS: ToolDef[] = [
  { id: 'look', label: 'Filtros', kind: 'look' },
  { id: 'amt', label: 'Intensidade', kind: 'pct' },
  { id: 'b', label: 'Brilho', kind: 'both' },
  { id: 'c', label: 'Contraste', kind: 'both' },
  { id: 's', label: 'Saturação', kind: 'both' },
  { id: 'w', label: 'Temperatura', kind: 'both' },
  { id: 'hi', label: 'Realces', kind: 'both' },
  { id: 'sh', label: 'Sombras', kind: 'both' },
  { id: 'v', label: 'Vinheta', kind: 'up' },
  { id: 'n', label: 'Nitidez', kind: 'up' },
  { id: 'crop', label: 'Recortar', kind: 'crop' },
];

/** Ícone de cada ferramenta: os do Txillapp quando existem, os outros desenhados aqui no mesmo traço. */
function ToolGlyph({ id, color }: { id: ToolId; color: string }) {
  if (id === 'amt') return <Icon name="sliders" size={22} color={color} />;
  if (id === 'b') return <Icon name="sun" size={22} color={color} />;
  if (id === 'hi') return <Icon name="sparkles" size={22} color={color} />;
  if (id === 'sh') return <Icon name="moon" size={22} color={color} />;
  let body: ReactNode = null;
  if (id === 'look') body = <><Circle cx={12} cy={8.6} r={4.6} /><Circle cx={8.6} cy={14.6} r={4.6} /><Circle cx={15.4} cy={14.6} r={4.6} /></>;
  else if (id === 'c') body = <><Circle cx={12} cy={12} r={8.5} /><Path d="M12 3.5a8.5 8.5 0 0 1 0 17Z" fill={color} /></>;
  else if (id === 's') body = <Path d="M12 3.2c3.2 3.9 5.8 7.2 5.8 10.4a5.8 5.8 0 0 1-11.6 0c0-3.2 2.6-6.5 5.8-10.4Z" />;
  else if (id === 'w') body = <><Path d="M10 14.2V5.6a2 2 0 0 1 4 0v8.6a4 4 0 1 1-4 0Z" /><Path d="M12 9.5v6.5" /></>;
  else if (id === 'v') body = <><Rect x={3} y={5} width={18} height={14} rx={3.5} /><Circle cx={12} cy={12} r={3.6} /></>;
  else if (id === 'n') body = <><Path d="M12 3.8 20.6 19.6H3.4Z" /><Path d="M12 3.8v15.8H3.4Z" fill={color} /></>;
  else if (id === 'crop') body = <><Path d="M6.5 2.5v15h15" /><Path d="M2.5 6.5h15v15" /></>;
  return (
    <Svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      {body}
    </Svg>
  );
}

/** Como se mostra o valor: de -5 a 5 com uma casa (ex.: "1.5"), de 0 a 5 na vinheta e nitidez, e em % na intensidade. */
function fmt(kind: ToolDef['kind'], v: number) {
  if (kind === 'pct') return `${Math.round(v * 100)}%`;
  const x = Math.round(v * 50) / 10;
  return x === 0 ? '0' : x.toFixed(1);
}

/**
 * A barra única por cima da fila de ferramentas. Arrastar mexe no valor a partir de onde está (não salta para o dedo);
 * nas ferramentas para os dois lados o meio é o 0 e prende lá perto. Tocar no número repõe.
 */
function ToolSlider({ kind, value, def, label, onChange }: { kind: 'both' | 'up' | 'pct'; value: number; def: number; label: string; onChange: (v: number) => void }) {
  const [w, setW] = useState(0);
  const start = useRef(0);
  const ref = useRef({ w, value, onChange, kind });
  ref.current = { w, value, onChange, kind };
  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => { start.current = ref.current.value; },
      onPanResponderMove: (_e, g) => {
        const { w: ww, kind: k } = ref.current;
        if (ww <= 0) return;
        const lo = k === 'both' ? -1 : 0;
        let v = Math.max(lo, Math.min(1, start.current + (g.dx / ww) * (1 - lo)));
        if (k === 'both' && Math.abs(v) < 0.025) v = 0;
        ref.current.onChange(v);
      },
    }),
  ).current;
  const lo = kind === 'both' ? -1 : 0;
  const pos = ((value - lo) / (1 - lo)) * w;
  const zero = kind === 'both' ? w / 2 : 0;
  const changed = Math.abs(value - def) > 0.001;
  return (
    <View style={{ paddingHorizontal: 28 }}>
      <Pressable onPress={() => onChange(def)} hitSlop={10} style={st.valueBox} accessibilityRole="button" accessibilityLabel={`${label}: ${fmt(kind, value)}. Toca para repor`}>
        <Text style={[st.value, changed && { color: '#fff' }]}>{fmt(kind, value)}</Text>
      </Pressable>
      <View style={st.track} onLayout={(e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width)} {...pan.panHandlers} accessibilityRole="adjustable" accessibilityLabel={label}>
        <View style={st.trackLine} />
        {kind === 'both' ? <View style={st.trackMid} /> : null}
        <View style={[st.trackFill, { left: Math.min(pos, zero), width: Math.abs(pos - zero) }]} />
        <View style={[st.knob, { left: pos - 11 }]} />
      </View>
    </View>
  );
}

export function PhotoEditor({ uri, aspect, onCancel, onDone, sign = true }: { uri: string; aspect: number; onCancel: () => void; onDone: (fileUri: string) => void; /** false: sem a assinatura (uma foto que vai para o estúdio das tchekas, que assina o vídeo inteiro). */ sign?: boolean }) {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const username = user?.username ?? null;
  const seal = sealOf(user);
  /** Publicação: quem abre o editor pede 4:5 (mimo e tcheka pedem 9:16). */
  const isPost = Math.abs(aspect - POST_RATIO_DEFAULT) < 0.01;
  const [img, setImg] = useState<SkImage | null>(null);
  const [failed, setFailed] = useState(false);
  const [edit, setEdit] = useState<Edit>({ look: 0, amt: 1, adj: NO_ADJ, aspect, rot: 0, flip: false, ox: 0, oy: 0 });
  const [tool, setTool] = useState<ToolId>('look');
  const [area, setArea] = useState({ w: 0, h: 0 });
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);

  const [failWhy, setFailWhy] = useState('');
  useEffect(() => {
    let alive = true;
    // Ao sair do editor (ou trocar de foto) a cópia de trabalho sai logo da memória nativa.
    let loaded: SkImage | null = null;
    void (async () => {
      // 1) A Skia lê o caminho directamente; 2) se não conseguir (content:// do Android, nomes estranhos), lemos os bytes nós e damos-lhos.
      let i: SkImage | null = null;
      let why = '';
      try {
        i = Skia.Image.MakeImageFromEncoded(await Skia.Data.fromURI(uri));
      } catch (e) { why = (e as Error).message; }
      if (!i) {
        try {
          const bytes = await new File(uri).bytes();
          i = Skia.Image.MakeImageFromEncoded(Skia.Data.fromBytes(bytes));
          if (!i) why = 'formato de imagem não suportado';
        } catch (e) { why = why || (e as Error).message; }
      }
      if (!alive) { i?.dispose?.(); return; }
      if (i) {
        // Reduzir pode falhar com fotos enormes (memória): mostra-se o erro do editor em vez de a app fechar.
        try { i = shrink(i); } catch (e) { i.dispose?.(); i = null; why = (e as Error).message || 'foto grande demais'; }
      }
      if (i && !alive) { i.dispose?.(); return; }
      if (i) { loaded = i; setImg(i); }
      else { setFailWhy(why); setFailed(true); }
    })();
    return () => { alive = false; const l = loaded; loaded = null; setTimeout(() => l?.dispose?.(), 0); };
  }, [uri]);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { onCancel(); return true; });
    return () => sub.remove();
  }, [onCancel]);

  // Cópia leve para a pré-visualização (a foto inteira só se usa ao gravar).
  const pv = useMemo(() => (img ? resized(img, PREVIEW_SIDE) : null), [img]);
  // A cópia da pré-visualização larga-se quando muda ou ao sair (a original larga-se no efeito de cima).
  useEffect(() => () => { if (pv && pv !== img) setTimeout(() => pv.dispose?.(), 0); }, [pv, img]);

  // Tamanho da pré-visualização: a proporção do recorte, a caber na área livre.
  const crop = pv ? cropOf(pv, edit) : null;
  const pw = crop && area.w ? Math.min(area.w - 24, (area.h - 24) * crop.a) : 0;
  const ph = crop ? pw / crop.a : 0;
  const previewFont = useMemo(() => (pw ? signFont(Math.max(8, Math.round(Math.min(pw, ph) * 0.028))) : null), [pw, ph]);
  const picture = useMemo(() => {
    if (!pv || !pw) return null;
    const rec = Skia.PictureRecorder();
    const c = rec.beginRecording(Skia.XYWHRect(0, 0, pw, ph));
    drawEdit(c, pv, edit, pw, ph, previewFont, username, seal, sign);
    return rec.finishRecordingAsPicture();
  }, [pv, edit, pw, ph, previewFont, username, seal, sign]);

  // Arrastar a foto para escolher o enquadramento (quando o recorte é mais pequeno do que a foto).
  const drag = useRef<{ ox: number; oy: number } | null>(null);
  const live = useRef({ edit, crop, pw });
  live.current = { edit, crop, pw };
  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) + Math.abs(g.dy) > 4,
      onPanResponderGrant: () => { drag.current = { ox: live.current.edit.ox, oy: live.current.edit.oy }; },
      onPanResponderMove: (_e, g) => {
        const d = drag.current, cr = live.current.crop, w = live.current.pw;
        if (!d || !cr || !w) return;
        const k = cr.cw / w; // píxeis da foto por píxel do ecrã
        const sx = (cr.iw - cr.cw) / 2, sy = (cr.ih - cr.ch) / 2;
        setEdit((e) => ({
          ...e,
          ox: sx > 1 ? Math.max(-1, Math.min(1, d.ox - (g.dx * k) / sx)) : 0,
          oy: sy > 1 ? Math.max(-1, Math.min(1, d.oy - (g.dy * k) / sy)) : 0,
        }));
      },
      onPanResponderRelease: () => { drag.current = null; },
    }),
  ).current;

  // Miniatura quadrada da foto (uma vez), para o exemplo de cada filtro.
  const thumb = useMemo(() => {
    if (!pv) return null;
    const side = Math.min(pv.width(), pv.height());
    const surface = Skia.Surface.MakeOffscreen(112, 112) ?? Skia.Surface.Make(112, 112);
    if (!surface) return null;
    surface.getCanvas().drawImageRect(pv, Skia.XYWHRect((pv.width() - side) / 2, (pv.height() - side) / 2, side, side), Skia.XYWHRect(0, 0, 112, 112), Skia.Paint());
    surface.flush();
    return surface.makeImageSnapshot().makeNonTextureImage() ?? surface.makeImageSnapshot();
  }, [pv]);
  const lookMats = useMemo(() => LOOKS.map(lookMatrix), []);

  // A fila de filtros acompanha o filtro escolhido (quando se troca a deslizar sobre a foto).
  const looksRow = useRef<React.ComponentRef<typeof ScrollView> | null>(null);
  const chipX = useRef<number[]>([]);
  useEffect(() => {
    if (tool !== 'look') return;
    looksRow.current?.scrollTo({ x: Math.max(0, (chipX.current[edit.look] ?? 0) - 48), animated: true });
  }, [edit.look, tool]);

  // Nos filtros, deslizar sobre a foto troca de filtro (esquerda = seguinte, direita = anterior), como no Instagram.
  const swipe = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) > 12 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
      onPanResponderTerminationRequest: () => false,
      onPanResponderRelease: (_e, g) => {
        if (Math.abs(g.dx) < 40) return;
        const dir = g.dx < 0 ? 1 : -1;
        setEdit((e) => ({ ...e, look: Math.max(0, Math.min(LOOKS.length - 1, e.look + dir)) }));
      },
    }),
  ).current;

  /** Desenha a foto final (recorte, filtro, ajustes e assinatura) num JPEG na cache e devolve o caminho. */
  function renderFile(): string | null {
    if (!img) return null;
    const cr = cropOf(img, edit);
    // Ao alto até 1440 de largura (antes 1080: o recorte 4:5 tinha 1440 e deitava-se fora um quarto da foto).
    const outW = editorOutWidth(cr.cw, cr.a);
    const outH = Math.round(outW / cr.a);
    const surface = Skia.Surface.MakeOffscreen(outW, outH) ?? Skia.Surface.Make(outW, outH);
    if (!surface) return null;
    try {
      drawEdit(surface.getCanvas(), img, edit, outW, outH, signFont(Math.round(Math.min(outW, outH) * 0.028)), username, seal, sign);
      surface.flush();
      const snap = surface.makeImageSnapshot();
      const bytes = snap.encodeToBytes(ImageFormat.JPEG, 92);
      snap.dispose?.();
      if (!bytes?.length) return null;
      const file = new File(Paths.cache, `txillapp-${Date.now()}.jpg`);
      file.create({ overwrite: true });
      file.write(bytes);
      return file.uri;
    } finally {
      surface.dispose?.(); // a superfície final (até 1920 × 1920 ou 1440 × 2560) sai logo da memória
    }
  }
  async function finish() {
    if (!img || busy) return;
    setBusy(true);
    try {
      const uri = renderFile();
      if (!uri) throw new Error('sem superfície');
      onDone(uri);
    } catch {
      setBusy(false);
      setFailed(true);
    }
  }
  /** Guarda a foto editada na galeria do telemóvel (sempre com a assinatura), e fica no editor para continuar. */
  async function saveLocal() {
    if (!img || saving) return;
    setSaving(true);
    try {
      const perm = await MediaLibrary.requestPermissionsAsync(true);
      if (!perm.granted) { Alert.alert('Sem acesso à galeria', 'Dá acesso às fotos nas definições do telemóvel para guardar.'); return; }
      const uri = renderFile();
      if (!uri) throw new Error('Não consegui desenhar a foto');
      await MediaLibrary.saveToLibraryAsync(uri);
      Alert.alert('Guardada', 'A foto está na tua galeria, com a assinatura do Txillapp.');
    } catch (e) {
      Alert.alert('Não consegui guardar', (e as Error).message || 'Tenta outra vez.');
    } finally {
      setSaving(false);
    }
  }

  const set = (p: Partial<Edit>) => setEdit((e) => ({ ...e, ...p }));
  const setAdj = (p: Partial<Adjust>) => setEdit((e) => ({ ...e, adj: { ...e.adj, ...p } }));
  // Numa publicação (aspect 4:5) só as proporções do Instagram: 1:1, 4:5 e 1,91:1. Em mimo/tcheka, todas.
  const ASPECTS: { label: string; v: number | null }[] = isPost
    ? [{ label: '1:1', v: 1 }, { label: '4:5', v: 4 / 5 }, { label: '1,91:1', v: POST_RATIO_MAX }]
    : [{ label: 'Original', v: null }, { label: '1:1', v: 1 }, { label: '4:5', v: 4 / 5 }, { label: '9:16', v: 9 / 16 }, { label: '16:9', v: 16 / 9 }];
  const cur = TOOLS.find((t) => t.id === tool) ?? TOOLS[0];
  /** A ferramenta já mexeu na foto (põe um pontinho coral por baixo do ícone). */
  const touched = (t: ToolDef) => {
    if (t.id === 'look') return edit.look !== 0;
    if (t.id === 'amt') return edit.look !== 0 && edit.amt < 0.999;
    if (t.id === 'crop') return edit.rot !== 0 || edit.flip || edit.aspect !== aspect || edit.ox !== 0 || edit.oy !== 0;
    return edit.adj[t.id] !== 0;
  };

  let controls: ReactNode = null;
  if (cur.kind === 'look') {
    controls = (
      <ScrollView ref={looksRow} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingHorizontal: 16 }}>
        {LOOKS.map((l, i) => (
          // Cada filtro mostra a própria foto com esse filtro (como no site), e o nome por baixo.
          <Pressable key={l.id} onPress={() => set({ look: i })} onLayout={(e) => { chipX.current[i] = e.nativeEvent.layout.x; }} style={st.swatch} accessibilityRole="button" accessibilityState={{ selected: edit.look === i }} accessibilityLabel={`Filtro ${l.name}`}>
            <View style={[st.swatchImg, edit.look === i && st.swatchOn]}>
              {thumb ? (
                <Canvas style={{ width: 56, height: 56 }}>
                  <SkImageNode image={thumb} x={0} y={0} width={56} height={56} fit="cover">
                    <ColorMatrix matrix={lookMats[i]} />
                  </SkImageNode>
                </Canvas>
              ) : null}
            </View>
            <Text style={[st.swatchText, edit.look === i && { color: '#fff', fontWeight: '800' }]} numberOfLines={1}>{l.name}</Text>
          </Pressable>
        ))}
      </ScrollView>
    );
  } else if (cur.kind === 'crop') {
    controls = (
      <View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingHorizontal: 16 }}>
          <Pressable onPress={() => set({ rot: ((edit.rot + 90) % 360) as Edit['rot'], ox: 0, oy: 0 })} style={st.toolBtn} accessibilityRole="button" accessibilityLabel="Rodar"><Icon name="repeat" size={18} color="#fff" /><Text style={st.chipText}>Rodar</Text></Pressable>
          <Pressable onPress={() => set({ flip: !edit.flip })} style={[st.toolBtn, edit.flip && st.chipOn]} accessibilityRole="button" accessibilityLabel="Espelhar" accessibilityState={{ selected: edit.flip }}><Icon name="flip-camera" size={18} color={edit.flip ? colors.zinc900 : '#fff'} /><Text style={[st.chipText, edit.flip && st.chipTextOn]}>Espelhar</Text></Pressable>
          <View style={st.sep} />
          {ASPECTS.map((a) => {
            const on = a.v === null ? edit.aspect === null : edit.aspect !== null && Math.abs(edit.aspect - a.v) < 0.01;
            return (
              <Pressable key={a.label} onPress={() => set({ aspect: a.v, ox: 0, oy: 0 })} style={[st.chip, on && st.chipOn]} accessibilityRole="button" accessibilityState={{ selected: on }}>
                <Text style={[st.chipText, on && st.chipTextOn]}>{a.label}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
        <Text style={st.cropHint}>Arrasta a foto para escolher o enquadramento.</Text>
      </View>
    );
  } else if (cur.kind === 'pct' && edit.look === 0) {
    controls = <Text style={st.cropHint}>Escolhe primeiro um filtro, depois afinas a força aqui.</Text>;
  } else if (cur.kind === 'pct') {
    controls = <ToolSlider kind="pct" label={cur.label} value={edit.amt} def={1} onChange={(v) => set({ amt: v })} />;
  } else {
    const k = cur.id as AdjKey;
    controls = <ToolSlider kind={cur.kind} label={cur.label} value={edit.adj[k]} def={0} onChange={(v) => setAdj({ [k]: v })} />;
  }

  return (
    <View style={[StyleSheet.absoluteFill, st.root]}>
      <View style={[st.top, { paddingTop: insets.top + 8 }]}>
        <Pressable onPress={onCancel} style={st.round} accessibilityRole="button" accessibilityLabel="Voltar à câmara"><Icon name="x" size={22} color="#fff" strokeWidth={2.2} /></Pressable>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Pressable onPress={() => void saveLocal()} disabled={!img || saving} style={[st.round, (!img || saving) && { opacity: 0.5 }]} accessibilityRole="button" accessibilityLabel="Guardar na galeria">
            {saving ? <ActivityIndicator color="#fff" /> : <Icon name="download" size={20} color="#fff" />}
          </Pressable>
          <Pressable onPress={() => void finish()} disabled={!img || busy} style={[st.round, st.done, (!img || busy) && { opacity: 0.5 }]} accessibilityRole="button" accessibilityLabel="Feito">
            {busy ? <ActivityIndicator color="#fff" /> : <Icon name="check" size={22} color="#fff" strokeWidth={2.4} />}
          </Pressable>
        </View>
      </View>

      <View style={st.stage} onLayout={(e: LayoutChangeEvent) => setArea({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
        {failed ? (
          <Text style={st.fail}>Não consegui abrir a foto para editar.{failWhy ? `\n${failWhy}` : ''}</Text>
        ) : !picture ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <View style={{ width: pw, height: ph, borderRadius: 14, overflow: 'hidden' }} {...(tool === 'crop' ? pan.panHandlers : tool === 'look' || tool === 'amt' ? swipe.panHandlers : {})}>
            <Canvas style={{ width: pw, height: ph }}>
              <Picture picture={picture} />
            </Canvas>
            {tool === 'crop' ? (
              <View pointerEvents="none" style={StyleSheet.absoluteFill}>
                <View style={[st.grid, { left: pw / 3 }]} /><View style={[st.grid, { left: (2 * pw) / 3 }]} />
                <View style={[st.gridH, { top: ph / 3 }]} /><View style={[st.gridH, { top: (2 * ph) / 3 }]} />
              </View>
            ) : null}
          </View>
        )}
      </View>

      <View style={[st.panel, { paddingBottom: Math.max(insets.bottom, 12) + 4 }]}>
        <View style={st.controls}>{controls}</View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={st.tools}>
          {TOOLS.map((t) => {
            const on = tool === t.id;
            return (
              <Pressable key={t.id} onPress={() => setTool(t.id)} style={st.tool} accessibilityRole="tab" accessibilityState={{ selected: on }} accessibilityLabel={t.label}>
                <View style={[st.toolIcon, on && st.toolIconOn]}><ToolGlyph id={t.id} color={on ? colors.zinc900 : '#fff'} /></View>
                <Text style={[st.toolLabel, on && st.toolLabelOn]} numberOfLines={1}>{t.label}</Text>
                <View style={[st.dot, !touched(t) && { opacity: 0 }]} />
              </Pressable>
            );
          })}
        </ScrollView>
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  root: { backgroundColor: '#000', zIndex: 30 },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingBottom: 8 },
  round: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center' },
  done: { backgroundColor: colors.brand },
  stage: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  fail: { color: 'rgba(255,255,255,0.8)', fontSize: 15, textAlign: 'center', paddingHorizontal: 32 },
  grid: { position: 'absolute', top: 0, bottom: 0, width: 1, backgroundColor: 'rgba(255,255,255,0.35)' },
  gridH: { position: 'absolute', left: 0, right: 0, height: 1, backgroundColor: 'rgba(255,255,255,0.35)' },
  panel: { paddingTop: 12, backgroundColor: '#0b0b0c', borderTopLeftRadius: 22, borderTopRightRadius: 22 },
  // Altura fixa: a foto não salta ao trocar de ferramenta.
  controls: { height: 92, justifyContent: 'center' },
  swatch: { width: 64, alignItems: 'center', gap: 5 },
  swatchImg: { width: 56, height: 56, borderRadius: 28, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(255,255,255,0.35)', backgroundColor: 'rgba(255,255,255,0.1)' },
  swatchOn: { borderWidth: 2.5, borderColor: '#fff' },
  swatchText: { fontSize: 12, fontWeight: '600', color: 'rgba(255,255,255,0.75)' },
  chip: { height: 40, borderRadius: 20, paddingHorizontal: 16, backgroundColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center' },
  chipOn: { backgroundColor: '#fff' },
  chipText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  chipTextOn: { color: colors.zinc900 },
  toolBtn: { height: 40, flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 20, paddingHorizontal: 16, backgroundColor: 'rgba(255,255,255,0.1)' },
  sep: { width: StyleSheet.hairlineWidth, height: 24, alignSelf: 'center', backgroundColor: 'rgba(255,255,255,0.25)', marginHorizontal: 2 },
  cropHint: { marginTop: 10, color: 'rgba(255,255,255,0.55)', fontSize: 12, textAlign: 'center', paddingHorizontal: 24 },
  valueBox: { alignSelf: 'center', paddingHorizontal: 12, paddingVertical: 2, marginBottom: 8 },
  value: { color: 'rgba(255,255,255,0.7)', fontSize: 17, fontWeight: '800', fontVariant: ['tabular-nums'] },
  track: { height: 32, justifyContent: 'center' },
  trackLine: { height: 3, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.18)' },
  trackMid: { position: 'absolute', left: '50%', width: 2, height: 14, marginLeft: -1, backgroundColor: 'rgba(255,255,255,0.45)' },
  trackFill: { position: 'absolute', height: 3, borderRadius: 2, backgroundColor: colors.brand },
  knob: { position: 'absolute', width: 22, height: 22, borderRadius: 11, backgroundColor: '#fff' },
  tools: { gap: 4, paddingHorizontal: 10, paddingTop: 10 },
  tool: { width: 72, alignItems: 'center', gap: 5 },
  toolIcon: { width: 50, height: 50, borderRadius: 25, backgroundColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center' },
  toolIconOn: { backgroundColor: '#fff' },
  toolLabel: { color: 'rgba(255,255,255,0.6)', fontSize: 11.5, fontWeight: '700' },
  toolLabelOn: { color: '#fff' },
  dot: { width: 4, height: 4, borderRadius: 2, backgroundColor: colors.brand },
});
