import { Canvas, ImageFormat, PaintStyle, Picture, Skia, StrokeCap, StrokeJoin, matchFont, type SkCanvas, type SkFont, type SkImage } from '@shopify/react-native-skia';
import { File, Paths } from 'expo-file-system';
import * as MediaLibrary from 'expo-media-library/legacy';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, BackHandler, PanResponder, Platform, Pressable, ScrollView, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@/lib/auth';
import { colors } from '@/lib/theme';
import { WORDMARK_BOX, WORDMARK_DOT, WORDMARK_PATHS, WORDMARK_STROKE, signLayout } from '@/lib/wordmark';
import { Icon } from './Icon';

/**
 * Editor de fotos do Txillapp no telemóvel (depois de tirar a foto): filtros, ajustes (brilho, contraste, saturação, calor),
 * recorte (proporções, arrastar para enquadrar), rodar e espelhar. A pré-visualização e a foto final saem do mesmo desenho
 * (Skia), por isso o que se vê é o que se publica, já com a assinatura do Txillapp.
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

interface Adjust { b: number; c: number; s: number; w: number } // cada um de -1 a 1
interface Edit { look: number; adj: Adjust; aspect: number | null; rot: 0 | 90 | 180 | 270; flip: boolean; ox: number; oy: number }

function matrixOf(e: Edit): M {
  const l = LOOKS[e.look];
  let m = ID;
  m = mul(warm((l.warm ?? 0) + e.adj.w * 0.8), m);
  m = mul(bri((l.bri ?? 0) + e.adj.b * 0.22), m);
  m = mul(con((l.con ?? 1) * (1 + e.adj.c * 0.45)), m);
  m = mul(sat(Math.max(0, (l.sat ?? 1) * (1 + e.adj.s))), m);
  if (l.sepia) m = mix(m, mul(SEPIA, m), l.sepia);
  return m;
}

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

/**
 * Fotos do telemóvel têm 12 a 50 MP: guardá-las inteiras e redesenhá-las a cada filtro esgota a memória no Android
 * (a app fecha). A foto final sai com no máximo 1920 px, por isso basta trabalhar com o lado maior a 2560 px.
 */
const MAX_SIDE = 2560;
function shrink(img: SkImage): SkImage {
  const w = img.width(), h = img.height();
  const k = MAX_SIDE / Math.max(w, h);
  if (k >= 1) return img;
  const W = Math.round(w * k), H = Math.round(h * k);
  const surface = Skia.Surface.MakeOffscreen(W, H) ?? Skia.Surface.Make(W, H);
  if (!surface) return img;
  const paint = Skia.Paint();
  surface.getCanvas().drawImageRect(img, Skia.XYWHRect(0, 0, w, h), Skia.XYWHRect(0, 0, W, H), paint);
  surface.flush();
  // Cópia em memória normal (não presa à superfície da GPU), e a original larga-se.
  const small = surface.makeImageSnapshot().makeNonTextureImage() ?? surface.makeImageSnapshot();
  img.dispose?.();
  return small;
}

/** Desenha a foto editada num retângulo W×H (pré-visualização ou foto final), com a assinatura. */
function drawEdit(canvas: SkCanvas, img: SkImage, e: Edit, W: number, H: number, font: SkFont | null, username?: string | null) {
  const { cw, ch, cx, cy } = cropOf(img, e);
  const w0 = img.width(), h0 = img.height();
  const paint = Skia.Paint();
  paint.setColorFilter(Skia.ColorFilter.MakeMatrix(matrixOf(e)));
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
  canvas.drawImage(img, 0, 0, paint);
  canvas.restore();
  drawSign(canvas, W, H, font, username);
}

/** Logótipo em caminhos Skia (feito uma vez). */
let markPaths: ReturnType<typeof Skia.Path.MakeFromSVGString>[] | null = null;
const marks = () => (markPaths ??= WORDMARK_PATHS.map((d) => Skia.Path.MakeFromSVGString(d)));

/** A assinatura (igual à do site): o logótipo em branco com o ponto do i a coral e sombra suave, e por baixo o @. */
function drawSign(canvas: SkCanvas, W: number, H: number, font: SkFont | null, username?: string | null) {
  const L = signLayout(W, H, !!username && !!font);
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
    canvas.drawText(t, L.right - font.getTextWidth(t), L.userBaseline, p, font);
  }
}

const signFont = (size: number) => {
  try {
    return matchFont({ fontFamily: Platform.select({ ios: 'Helvetica Neue', default: 'sans-serif' }), fontSize: size, fontWeight: 'bold' });
  } catch {
    return null;
  }
};

/** Barra para um ajuste de -1 a 1 (o meio é o normal). Dois toques repõem. */
function Slider({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  const [w, setW] = useState(0);
  const start = useRef(0);
  const last = useRef(0);
  const ref = useRef({ w, value, onChange });
  ref.current = { w, value, onChange };
  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (e) => {
        const now = Date.now();
        if (now - last.current < 280) { ref.current.onChange(0); last.current = 0; return; }
        last.current = now;
        const { w: ww } = ref.current;
        if (ww <= 0) return;
        const v = Math.max(-1, Math.min(1, (e.nativeEvent.locationX / ww) * 2 - 1));
        start.current = v;
        ref.current.onChange(v);
      },
      onPanResponderMove: (_e, g) => {
        const { w: ww } = ref.current;
        if (ww <= 0) return;
        ref.current.onChange(Math.max(-1, Math.min(1, start.current + (g.dx / ww) * 2)));
      },
    }),
  ).current;
  const pos = ((value + 1) / 2) * w;
  return (
    <View style={{ marginBottom: 14 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 }}>
        <Text style={st.adjLabel}>{label}</Text>
        <Text style={st.adjValue}>{value > 0 ? '+' : ''}{Math.round(value * 100)}</Text>
      </View>
      <View style={st.track} onLayout={(e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width)} {...pan.panHandlers} accessibilityRole="adjustable" accessibilityLabel={label}>
        <View style={st.trackLine} />
        <View style={[st.trackMid]} />
        <View style={[st.trackFill, { left: Math.min(pos, w / 2), width: Math.abs(pos - w / 2) }]} />
        <View style={[st.knob, { left: pos - 11 }]} />
      </View>
    </View>
  );
}

export function PhotoEditor({ uri, aspect, onCancel, onDone }: { uri: string; aspect: number; onCancel: () => void; onDone: (fileUri: string) => void }) {
  const insets = useSafeAreaInsets();
  const username = useAuth().user?.username ?? null;
  const [img, setImg] = useState<SkImage | null>(null);
  const [failed, setFailed] = useState(false);
  const [edit, setEdit] = useState<Edit>({ look: 0, adj: { b: 0, c: 0, s: 0, w: 0 }, aspect, rot: 0, flip: false, ox: 0, oy: 0 });
  const [tool, setTool] = useState<'look' | 'adjust' | 'crop'>('look');
  const [area, setArea] = useState({ w: 0, h: 0 });
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);

  const [failWhy, setFailWhy] = useState('');
  useEffect(() => {
    let alive = true;
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
      if (!alive) return;
      if (i) i = shrink(i);
      if (i) setImg(i);
      else { setFailWhy(why); setFailed(true); }
    })();
    return () => { alive = false; };
  }, [uri]);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { onCancel(); return true; });
    return () => sub.remove();
  }, [onCancel]);

  // Tamanho da pré-visualização: a proporção do recorte, a caber na área livre.
  const crop = img ? cropOf(img, edit) : null;
  const pw = crop && area.w ? Math.min(area.w - 24, (area.h - 24) * crop.a) : 0;
  const ph = crop ? pw / crop.a : 0;
  const previewFont = useMemo(() => (pw ? signFont(Math.max(8, Math.round(Math.min(pw, ph) * 0.028))) : null), [pw, ph]);
  const picture = useMemo(() => {
    if (!img || !pw) return null;
    const rec = Skia.PictureRecorder();
    const c = rec.beginRecording(Skia.XYWHRect(0, 0, pw, ph));
    drawEdit(c, img, edit, pw, ph, previewFont, username);
    return rec.finishRecordingAsPicture();
  }, [img, edit, pw, ph, previewFont, username]);

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
    const outW = Math.round(Math.min(cr.cw, cr.a >= 1 ? 1920 : 1080));
    const outH = Math.round(outW / cr.a);
    const surface = Skia.Surface.MakeOffscreen(outW, outH) ?? Skia.Surface.Make(outW, outH);
    if (!surface) return null;
    drawEdit(surface.getCanvas(), img, edit, outW, outH, signFont(Math.round(Math.min(outW, outH) * 0.028)), username);
    surface.flush();
    const bytes = surface.makeImageSnapshot().encodeToBytes(ImageFormat.JPEG, 92);
    const file = new File(Paths.cache, `txillapp-${Date.now()}.jpg`);
    file.create({ overwrite: true });
    file.write(bytes);
    return file.uri;
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
  const ASPECTS: { label: string; v: number | null }[] = [{ label: 'Original', v: null }, { label: '1:1', v: 1 }, { label: '4:5', v: 4 / 5 }, { label: '9:16', v: 9 / 16 }, { label: '16:9', v: 16 / 9 }];

  return (
    <View style={[StyleSheet.absoluteFill, st.root]}>
      <View style={[st.top, { paddingTop: insets.top + 8 }]}>
        <Pressable onPress={onCancel} style={st.round} accessibilityRole="button" accessibilityLabel="Voltar à câmara"><Icon name="x" size={22} color="#fff" strokeWidth={2.2} /></Pressable>
        <Text style={st.title}>Editar</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Pressable onPress={() => void saveLocal()} disabled={!img || saving} style={[st.round, (!img || saving) && { opacity: 0.5 }]} accessibilityRole="button" accessibilityLabel="Guardar na galeria">
            {saving ? <ActivityIndicator color="#fff" /> : <Icon name="download" size={20} color="#fff" />}
          </Pressable>
          <Pressable onPress={() => void finish()} disabled={!img || busy} style={[st.next, (!img || busy) && { opacity: 0.5 }]} accessibilityRole="button">
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={st.nextText}>Seguinte</Text>}
          </Pressable>
        </View>
      </View>

      <View style={st.stage} onLayout={(e: LayoutChangeEvent) => setArea({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
        {failed ? (
          <Text style={st.fail}>Não consegui abrir a foto para editar.{failWhy ? `\n${failWhy}` : ''}</Text>
        ) : !picture ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <View style={{ width: pw, height: ph, borderRadius: 14, overflow: 'hidden' }} {...(tool === 'crop' ? pan.panHandlers : tool === 'look' ? swipe.panHandlers : {})}>
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

      <View style={[st.panel, { paddingBottom: Math.max(insets.bottom, 12) + 6 }]}>
        {tool === 'look' && (
          <ScrollView ref={looksRow} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingHorizontal: 16 }}>
            {LOOKS.map((l, i) => (
              <Pressable key={l.id} onPress={() => set({ look: i })} onLayout={(e) => { chipX.current[i] = e.nativeEvent.layout.x; }} style={[st.chip, edit.look === i && st.chipOn]} accessibilityRole="button" accessibilityState={{ selected: edit.look === i }}>
                <Text style={[st.chipText, edit.look === i && st.chipTextOn]}>{l.name}</Text>
              </Pressable>
            ))}
          </ScrollView>
        )}
        {tool === 'adjust' && (
          <View style={{ paddingHorizontal: 20 }}>
            <Slider label="Brilho" value={edit.adj.b} onChange={(v) => setAdj({ b: v })} />
            <Slider label="Contraste" value={edit.adj.c} onChange={(v) => setAdj({ c: v })} />
            <Slider label="Saturação" value={edit.adj.s} onChange={(v) => setAdj({ s: v })} />
            <Slider label="Calor" value={edit.adj.w} onChange={(v) => setAdj({ w: v })} />
          </View>
        )}
        {tool === 'crop' && (
          <View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingHorizontal: 16 }}>
              {ASPECTS.map((a) => {
                const on = a.v === null ? edit.aspect === null : edit.aspect !== null && Math.abs(edit.aspect - a.v) < 0.01;
                return (
                  <Pressable key={a.label} onPress={() => set({ aspect: a.v, ox: 0, oy: 0 })} style={[st.chip, on && st.chipOn]} accessibilityRole="button" accessibilityState={{ selected: on }}>
                    <Text style={[st.chipText, on && st.chipTextOn]}>{a.label}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
            <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 14, marginTop: 14 }}>
              <Pressable onPress={() => set({ rot: ((edit.rot + 90) % 360) as Edit['rot'], ox: 0, oy: 0 })} style={st.toolBtn} accessibilityRole="button"><Icon name="repeat" size={18} color="#fff" /><Text style={st.toolText}>Rodar</Text></Pressable>
              <Pressable onPress={() => set({ flip: !edit.flip })} style={st.toolBtn} accessibilityRole="button"><Icon name="flip-camera" size={18} color="#fff" /><Text style={st.toolText}>Espelhar</Text></Pressable>
            </View>
            <Text style={st.cropHint}>Arrasta a foto para escolher o enquadramento.</Text>
          </View>
        )}
        <View style={st.tabs}>
          {([['look', 'Filtros'], ['adjust', 'Ajustar'], ['crop', 'Recortar']] as const).map(([id, label]) => (
            <Pressable key={id} onPress={() => setTool(id)} style={st.tab} accessibilityRole="tab" accessibilityState={{ selected: tool === id }}>
              <Text style={[st.tabText, tool === id && st.tabOn]}>{label}</Text>
            </Pressable>
          ))}
        </View>
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  root: { backgroundColor: '#000', zIndex: 30 },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingBottom: 8 },
  round: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center' },
  title: { color: '#fff', fontSize: 17, fontWeight: '800' },
  next: { height: 40, minWidth: 104, borderRadius: 20, paddingHorizontal: 18, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  nextText: { color: '#fff', fontSize: 15, fontWeight: '800' },
  stage: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  fail: { color: 'rgba(255,255,255,0.8)', fontSize: 15, textAlign: 'center', paddingHorizontal: 32 },
  grid: { position: 'absolute', top: 0, bottom: 0, width: 1, backgroundColor: 'rgba(255,255,255,0.35)' },
  gridH: { position: 'absolute', left: 0, right: 0, height: 1, backgroundColor: 'rgba(255,255,255,0.35)' },
  panel: { paddingTop: 14, backgroundColor: '#0b0b0c', borderTopLeftRadius: 22, borderTopRightRadius: 22 },
  chip: { height: 40, borderRadius: 20, paddingHorizontal: 16, backgroundColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center' },
  chipOn: { backgroundColor: '#fff' },
  chipText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  chipTextOn: { color: colors.zinc900 },
  adjLabel: { color: '#fff', fontSize: 14, fontWeight: '700' },
  adjValue: { color: 'rgba(255,255,255,0.6)', fontSize: 13, fontWeight: '700', fontVariant: ['tabular-nums'] },
  track: { height: 28, justifyContent: 'center' },
  trackLine: { height: 3, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.18)' },
  trackMid: { position: 'absolute', left: '50%', width: 2, height: 12, marginLeft: -1, backgroundColor: 'rgba(255,255,255,0.45)' },
  trackFill: { position: 'absolute', height: 3, borderRadius: 2, backgroundColor: colors.brand },
  knob: { position: 'absolute', width: 22, height: 22, borderRadius: 11, backgroundColor: '#fff' },
  toolBtn: { height: 40, flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 20, paddingHorizontal: 16, backgroundColor: 'rgba(255,255,255,0.1)' },
  toolText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  cropHint: { marginTop: 10, color: 'rgba(255,255,255,0.55)', fontSize: 12, textAlign: 'center' },
  tabs: { flexDirection: 'row', justifyContent: 'center', gap: 26, marginTop: 16, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(255,255,255,0.12)' },
  tab: { paddingVertical: 6, paddingHorizontal: 4 },
  tabText: { color: 'rgba(255,255,255,0.5)', fontSize: 14, fontWeight: '800', letterSpacing: 0.3 },
  tabOn: { color: '#fff' },
});
