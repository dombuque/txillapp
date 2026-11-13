import { Image } from 'expo-image';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import { GestureDetector, usePanGesture, usePinchGesture, useRotationGesture, useSimultaneousGestures, useTapGesture } from 'react-native-gesture-handler';
import { paletteById } from '@/lib/studio/capulana';
import {
  animState, contrastOn, fontById, SAFE, snapAngle, snapMove, timeLabel, visibleChars,
  type AnimFrame, type Overlay, type StickerOverlay, type TextOverlay,
} from '@/lib/studio/effects';
import { nativeFontStyle } from '@/lib/studio/nativeFonts';
import { stickerById } from '@/lib/stickers';
import { Icon } from '../../Icon';
import { StickerArt } from '../../Stickers';
import { CapulanaSticker } from '../CapulanaSticker';
import { CapulanaSwatch } from '../CapulanaSwatch';
import type { ClockStore } from './clockStore';

const CORAL = '#d6334f';
const HIDDEN: AnimFrame = { visible: false, alpha: 0, dx: 0, dy: 0, scale: 1, rot: 0, chars: 1, glow: 0, wave: 0 };

/** Mistura uma cor com branco (o miolo do néon). */
function mixWhite(hex: string, k: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return '#ffffff';
  const n = parseInt(m[1], 16);
  const ch = (s: number) => Math.round(((n >> s) & 255) * (1 - k) + 255 * k).toString(16).padStart(2, '0');
  return `#${ch(16)}${ch(8)}${ch(0)}`;
}

/** O desenho de um texto (sem posição): as mesmas medidas do canvas do site, em px do ecrã (`k` = largura / 1080). */
function TextBody({ o, f, k, t }: { o: TextOverlay; f: AnimFrame; k: number; t: number }) {
  const fd = fontById(o.font);
  const fs = Math.max(6, o.size * fd.k * k);
  const shown = o.text.slice(0, visibleChars(o.text.length, f.chars));
  const pano = o.pano ? paletteById(o.pano.palette).colors : null;
  const color = o.bg === 'cheio' ? contrastOn(o.color) : o.neon ? mixWhite(o.color, 0.7) : pano && o.bg !== 'pano' ? pano[1] : o.color;
  const shadow = o.neon
    ? { textShadowColor: o.color, textShadowRadius: fs * 0.6, textShadowOffset: { width: 0, height: 0 } }
    : o.outline
      ? { textShadowColor: contrastOn(o.color), textShadowRadius: Math.max(1, fs * 0.09), textShadowOffset: { width: 0, height: 0 } }
      : o.shadow && o.bg !== 'cheio'
        ? { textShadowColor: 'rgba(0,0,0,0.55)', textShadowRadius: fs * 0.22, textShadowOffset: { width: 0, height: fs * 0.05 } }
        : null;
  const glow = f.glow > 0.01 ? { textShadowColor: '#ffffff', textShadowRadius: fs * 1.2 * f.glow, textShadowOffset: { width: 0, height: 0 } } : null;
  const wave = f.wave > 0 ? Math.sin(t * 9) * fs * 0.35 * f.wave : 0;
  return (
    <View style={[
      o.bg === 'cheio' && { backgroundColor: o.color, borderRadius: fs * 0.28, paddingHorizontal: fs * 0.3, paddingVertical: fs * 0.08 },
      o.bg === 'suave' && { backgroundColor: 'rgba(8,8,12,0.55)', borderRadius: fs * 0.28, paddingHorizontal: fs * 0.3, paddingVertical: fs * 0.08 },
      pano && o.bg !== 'pano' && { borderBottomWidth: Math.max(2, fs * 0.08), borderBottomColor: pano[3] },
      wave ? { transform: [{ translateY: wave }] } : null,
    ]}>
      <Text style={[{ color, fontSize: fs, lineHeight: fs * 1.22, textAlign: o.align }, nativeFontStyle(o.font), shadow, glow]}>
        {shown || ' '}
        {f.chars < 1 && Math.floor(t * 3) % 2 === 0 ? '|' : ''}
      </Text>
    </View>
  );
}

/** Uma etiqueta (menção, local, hora): o comprimido com as cores do estilo. */
function Pill({ o, k, children, h }: { o: StickerOverlay; k: number; children: React.ReactNode; h: number }) {
  const bg = o.variant === 'coral' ? CORAL : o.variant === 'escuro' ? 'rgba(12,12,18,0.78)' : '#ffffff';
  return (
    <View style={{ minHeight: h * k, borderRadius: Math.min(h / 2, 44) * k, backgroundColor: bg, paddingHorizontal: 30 * k, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 10 * k, borderWidth: o.variant === 'escuro' ? 3 * k : 0, borderColor: 'rgba(255,255,255,0.28)', boxShadow: '0 4px 12px rgba(0,0,0,0.35)' } as object}>
      {children}
    </View>
  );
}

function StickerBody({ o, k }: { o: StickerOverlay; k: number }) {
  const s = o.sticker;
  const ink = o.variant === 'branco' ? CORAL : '#ffffff';
  const label = { color: ink, fontWeight: '800' as const, ...nativeFontStyle('classica') };
  switch (s.type) {
    case 'emoji': return <Text style={{ fontSize: 230 * k, lineHeight: 230 * k * 1.12 }}>{s.emoji}</Text>;
    case 'txill': { const def = stickerById(s.id); return def ? <StickerArt def={def} size={400 * k} /> : null; }
    case 'gif': {
      const w = 440 * k;
      return <Image source={{ uri: s.url }} autoplay style={{ width: w, height: w * (s.w > 0 ? s.h / s.w : 1) }} contentFit="contain" recyclingKey={s.id} />;
    }
    case 'mention': return <Pill o={o} k={k} h={105}><Text style={[label, { fontSize: 60 * k }]}>@{s.username}</Text></Pill>;
    case 'location': return (
      <Pill o={o} k={k} h={97}>
        <Icon name="map-pin" size={54 * k} color={ink} solid />
        <Text style={[label, { fontSize: 54 * k, color: o.variant === 'branco' ? CORAL : '#fff' }]}>{s.name.toUpperCase()}</Text>
      </Pill>
    );
    case 'time': {
      const lines = timeLabel(s.format, s.at);
      const big = s.format !== 'data';
      return (
        <Pill o={o} k={k} h={big ? (lines[1] ? 250 : 180) : 120}>
          <View style={{ alignItems: 'center' }}>
            <Text style={[label, big ? { fontSize: 120 * k, ...nativeFontStyle('futuro') } : { fontSize: 64 * k }]}>{lines[0]}</Text>
            {lines[1] ? <Text style={[label, { fontSize: 46 * k, color: o.variant === 'branco' ? '#18181b' : '#fff' }]}>{lines[1]}</Text> : null}
          </View>
        </Pill>
      );
    }
    case 'capulana': return <CapulanaSticker shape={s.shape} spec={s.pano} size={396 * k} />;
  }
}

interface Drag { dx: number; dy: number; ds: number; dr: number }
const NO_DRAG: Drag = { dx: 0, dy: 0, ds: 1, dr: 0 };

/** Uma camada no palco: o desenho, na posição e com a animação do instante `t`, e os gestos para a mexer. */
function OverlayItem({ o, f, t, W, H, selected, locked, onSelect, onEdit, onCommit, onGuides }: {
  o: Overlay; f: AnimFrame; t: number; W: number; H: number; selected: boolean; locked: boolean;
  onSelect: (id: string) => void; onEdit: (id: string) => void; onCommit: (o: Overlay) => void; onGuides: (g: { vx: number | null; hy: number | null } | null) => void;
}) {
  const k = W / 1080;
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [drag, setDrag] = useState<Drag>(NO_DRAG);
  const live = useRef(NO_DRAG);
  const cur = useRef(o);
  cur.current = o;
  const box = () => ({ hw: (size.w * o.scale) / 2 / Math.max(1, W), hh: (size.h * o.scale) / 2 / Math.max(1, H) });
  const placed = (d: Drag) => {
    const b = box();
    return snapMove(cur.current.x + d.dx / Math.max(1, W), cur.current.y + d.dy / Math.max(1, H), { hw: b.hw * d.ds, hh: b.hh * d.ds });
  };
  const update = (p: Partial<Drag>) => { live.current = { ...live.current, ...p }; setDrag(live.current); const s = placed(live.current); onGuides({ vx: s.vx, hy: s.hy }); };
  const finish = () => {
    const d = live.current;
    live.current = NO_DRAG;
    setDrag(NO_DRAG);
    onGuides(null);
    if (d.dx === 0 && d.dy === 0 && d.ds === 1 && d.dr === 0) return;
    const s = placed(d);
    const base = cur.current;
    onCommit({ ...base, x: Math.round(s.x * 10000) / 10000, y: Math.round(s.y * 10000) / 10000, scale: Math.round(Math.max(0.1, Math.min(8, base.scale * d.ds)) * 1000) / 1000, rot: Math.round(snapAngle(base.rot + d.dr) * 1000) / 1000 } as Overlay);
  };
  const pan = usePanGesture({ runOnJS: true, minDistance: 4, onBegin: () => { if (!locked) onSelect(cur.current.id); }, onUpdate: (e) => { if (!locked) update({ dx: e.translationX, dy: e.translationY }); }, onFinalize: () => finish() });
  const pinch = usePinchGesture({ runOnJS: true, onUpdate: (e) => { if (!locked) update({ ds: e.scale }); }, onFinalize: () => finish() });
  const rotation = useRotationGesture({ runOnJS: true, onUpdate: (e) => { if (!locked) update({ dr: (e.rotation * 180) / Math.PI }); }, onFinalize: () => finish() });
  const tap = useTapGesture({ runOnJS: true, onActivate: () => { if (locked) return; if (selected && cur.current.kind === 'text') onEdit(cur.current.id); else onSelect(cur.current.id); } });
  const gestures = useSimultaneousGestures(pan, pinch, rotation, tap);

  const band = o.kind === 'text' && o.bg === 'pano' && o.pano;
  const onLayout = (e: LayoutChangeEvent) => { const { width, height } = e.nativeEvent.layout; if (Math.abs(width - size.w) > 0.5 || Math.abs(height - size.h) > 0.5) setSize({ w: width, h: height }); };
  const pos = drag === NO_DRAG ? { x: o.x, y: o.y } : placed(drag);
  const scale = Math.max(0.05, o.scale * f.scale * drag.ds);
  const body = (
    <View
      onLayout={onLayout}
      style={[st.item, {
        left: pos.x * W, top: pos.y * H, opacity: f.alpha,
        maxWidth: o.kind === 'text' ? (0.84 * W) / Math.max(0.2, o.scale) : undefined,
        transform: [{ translateX: -size.w / 2 + f.dx * k }, { translateY: -size.h / 2 + f.dy * k }, { rotate: `${o.rot + f.rot + drag.dr}deg` }, { scale }],
      }, selected && !locked && st.selected]}
      accessibilityRole="button"
      accessibilityLabel={o.kind === 'text' ? `Texto: ${o.text}` : 'Sticker'}
      accessibilityHint="Arrasta para mudar de sítio; com dois dedos, roda e muda o tamanho"
    >
      {o.kind === 'text' ? <TextBody o={o} f={f} k={k} t={t} /> : <StickerBody o={o} k={k} />}
    </View>
  );
  return (
    <>
      {band ? (
        <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: o.y * H + f.dy * k - (o.size * 1.3 * o.scale * k), height: o.size * 2.6 * o.scale * k, opacity: Math.min(1, f.alpha * 1.4) }}>
          <CapulanaSwatch spec={o.pano!} tile={Math.max(16, 48 * k * 2)} style={StyleSheet.absoluteFill} />
        </View>
      ) : null}
      {locked ? body : <GestureDetector gesture={gestures}>{body}</GestureDetector>}
    </>
  );
}

/**
 * Os textos e stickers por cima da pré-visualização nativa: cada um na posição, com a escala, a rotação e a animação do
 * instante do relógio (as contas do `animState`, as mesmas do site e do servidor). Mexe-se com o dedo: arrastar, e com dois
 * dedos rodar e mudar o tamanho; cola às guias da zona segura (`snapMove`, `snapAngle`). O gesto inteiro é um passo só.
 */
export function NativeOverlays({ overlays, clock, W, H, selId, locked, showSafe, onSelect, onEdit, onChange }: {
  overlays: readonly Overlay[];
  clock: ClockStore;
  W: number;
  H: number;
  selId: string | null;
  locked: boolean;
  showSafe: boolean;
  onSelect: (id: string | null) => void;
  onEdit: (id: string) => void;
  onChange: (o: Overlay) => void;
}) {
  const [t, setT] = useState(() => clock.time());
  const [guides, setGuides] = useState<{ vx: number | null; hy: number | null } | null>(null);
  useEffect(() => {
    let last = 0;
    return clock.subscribe((now, playing) => {
      const ms = Date.now();
      if (playing && ms - last < 33) return;
      last = ms;
      setT(now);
    });
  }, [clock]);
  if (!(W > 0 && H > 0)) return null;
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents={locked ? 'none' : 'box-none'}>
      {showSafe ? (
        <View pointerEvents="none" style={[st.safe, { left: SAFE.left * W, top: SAFE.top * H, right: SAFE.right * W, bottom: SAFE.bottom * H }]} />
      ) : null}
      {guides?.vx != null ? <View pointerEvents="none" style={[st.guideV, { left: guides.vx * W }]} /> : null}
      {guides?.hy != null ? <View pointerEvents="none" style={[st.guideH, { top: guides.hy * H }]} /> : null}
      {overlays.map((o) => {
        const f = animState(o, t);
        // A camada escolhida vê-se sempre em pausa (para se poder mexer nela), mesmo fora do tempo dela.
        const frame = f.visible ? f : o.id === selId && !clock.playing() ? { ...HIDDEN, visible: true, alpha: 0.55 } : null;
        if (!frame) return null;
        return <OverlayItem key={o.id} o={o} f={frame} t={t} W={W} H={H} selected={o.id === selId} locked={locked} onSelect={onSelect} onEdit={onEdit} onCommit={onChange} onGuides={setGuides} />;
      })}
    </View>
  );
}

const st = StyleSheet.create({
  item: { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
  selected: { borderWidth: 1.5, borderColor: '#ff5c6c', borderStyle: 'dashed', borderRadius: 8 },
  safe: { position: 'absolute', borderWidth: 1, borderColor: 'rgba(255,255,255,0.45)', borderStyle: 'dashed', borderRadius: 6 },
  guideV: { position: 'absolute', top: 0, bottom: 0, width: 1, backgroundColor: '#ffd60a' },
  guideH: { position: 'absolute', left: 0, right: 0, height: 1, backgroundColor: '#ffd60a' },
});
