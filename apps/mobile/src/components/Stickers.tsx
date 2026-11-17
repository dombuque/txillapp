import { Image } from 'expo-image';
import { useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, PanResponder, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type GestureResponderEvent } from 'react-native';
import Animated, { Easing, cancelAnimation, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import { SvgXml } from 'react-native-svg';
import { TXILLAPP_GIF_WHITE } from '@/lib/gifs';
import { STICKERS, STICKER_CATS, stickerById, type MimoLayer, type StickerAnim, type StickerDef } from '@/lib/stickers';
import { TEXT_S, isTextLayer, layerFonts, normTextLayer } from '@/lib/textLayers';
import { useTextFonts } from '@/lib/useTextFonts';
import { colors } from '@/lib/theme';
import { Icon, type IconName } from './Icon';
import { Sheet } from './Sheet';
import { TextBox, TextLayerView, useTextLayer } from './TextLayers';
import type { TextLayer } from '@/lib/textLayers';
import { t } from '@/lib/i18n';

/** Duração de um ciclo de cada animação (ms). */
const DUR: Record<StickerAnim, number> = { none: 0, pulse: 700, bounce: 520, wiggle: 600, spin: 6000, swing: 1400, float: 1600, shake: 160, flicker: 260, twinkle: 900, pop: 800 };
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** O autocolante «Txillapp» (o GIF da marca): por cima de fotos e vídeos mostra-se o GIF animado com as letras brancas. */
export const BRAND_STICKER_ID = 'm-txillapp';

/**
 * Um sticker desenhado (e a mexer-se, se for animado). `size` é a largura. `onMedia`: pousado sobre a foto ou o vídeo de um
 * mimo; aí o «Txillapp» é o GIF animado branco (o mesmo enquadramento do desenho; com «Reduzir movimento», a última imagem).
 */
export function StickerArt({ def, size, animate = true, onMedia = false }: { def: StickerDef; size: number; animate?: boolean; onMedia?: boolean }) {
  if (onMedia && animate && def.id === BRAND_STICKER_ID) return <BrandSticker size={size} ratio={def.ratio} />;
  return <DrawnSticker def={def} size={size} animate={animate} />;
}

function BrandSticker({ size, ratio }: { size: number; ratio: number }) {
  const reduce = useReducedMotion();
  return <Image source={{ uri: reduce ? TXILLAPP_GIF_WHITE.still : TXILLAPP_GIF_WHITE.url }} autoplay={!reduce} style={{ width: size, height: Math.round(size * ratio) }} contentFit="contain" accessibilityLabel="Txillapp" accessibilityIgnoresInvertColors />;
}

function DrawnSticker({ def, size, animate }: { def: StickerDef; size: number; animate: boolean }) {
  const anim = animate ? def.anim : 'none';
  const h = Math.round(size * def.ratio);
  const t = useSharedValue(0);
  useEffect(() => {
    if (anim === 'none') return;
    t.value = 0;
    t.value = anim === 'spin'
      ? withRepeat(withTiming(1, { duration: DUR[anim], easing: Easing.linear }), -1, false)
      : withRepeat(withTiming(1, { duration: DUR[anim], easing: Easing.inOut(Easing.quad) }), -1, true);
    return () => cancelAnimation(t);
  }, [anim, t]);
  const style = useAnimatedStyle(() => {
    const v = t.value;
    switch (anim) {
      case 'pulse': return { transform: [{ scale: 1 + 0.12 * v }] };
      case 'bounce': return { transform: [{ translateY: -0.12 * size * v }, { scaleX: 1 + 0.05 * v }, { scaleY: 1 - 0.05 * v }] };
      case 'wiggle': return { transform: [{ rotate: `${-9 + 18 * v}deg` }] };
      case 'spin': return { transform: [{ rotate: `${360 * v}deg` }] };
      // Pendurada pelo fio: roda à volta do topo.
      case 'swing': return { transform: [{ translateY: -h / 2 }, { rotate: `${-10 + 20 * v}deg` }, { translateY: h / 2 }] };
      case 'float': return { transform: [{ translateY: (0.5 - v) * 0.12 * size }, { rotate: `${-4 + 8 * v}deg` }] };
      case 'shake': return { transform: [{ translateX: (v - 0.5) * 0.08 * size }, { rotate: `${-2 + 4 * v}deg` }] };
      // A chama estica a partir da base.
      case 'flicker': return { transform: [{ translateY: h / 2 }, { scaleY: 1 + 0.1 * v }, { scaleX: 1 - 0.05 * v }, { translateY: -h / 2 }] };
      case 'twinkle': return { opacity: 0.8 + 0.2 * v, transform: [{ scale: 0.9 + 0.18 * v }, { rotate: `${-10 + 20 * v}deg` }] };
      case 'pop': return { transform: [{ scale: 0.95 + 0.1 * v }, { rotate: `${-5 + 10 * v}deg` }] };
      default: return {};
    }
  }, [anim, size, h]);
  return (
    <Animated.View style={[{ width: size, height: h }, style]}>
      <SvgXml xml={def.svg} width={size} height={h} />
    </Animated.View>
  );
}

/** Os stickers e os textos de um mimo pousados sobre a foto ou o vídeo (só para ver). `width`/`height` é o ecrã do mimo. */
export function StickerLayer({ stickers, width, height, animate = true }: { stickers?: readonly MimoLayer[] | null; width: number; height: number; animate?: boolean }) {
  useTextFonts(layerFonts(stickers));
  if (!width || !height || !stickers?.length) return null;
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { overflow: 'hidden' }]}>
      {stickers.map((p, i) => {
        if (isTextLayer(p)) {
          const t = normTextLayer(p);
          return t ? <TextLayerView key={`t-${i}`} layer={t} width={width} height={height} /> : null;
        }
        const def = stickerById(p.id);
        if (!def) return null;
        const w = p.s * width, h = w * def.ratio;
        return (
          <View key={`${p.id}-${i}`} style={{ position: 'absolute', left: p.x * width - w / 2, top: p.y * height - h / 2, width: w, height: h, transform: [{ rotate: `${p.r}deg` }] }}>
            <StickerArt def={def} size={w} animate={animate} onMedia />
          </View>
        );
      })}
    </View>
  );
}

/** Posição dos dedos (ou do rato): quantos, o centro, a distância e o ângulo entre os dois primeiros. */
function metrics(e: GestureResponderEvent) {
  const t = e.nativeEvent.touches;
  if (!t || t.length === 0) return { n: 1, x: e.nativeEvent.pageX, y: e.nativeEvent.pageY, d: 0, a: 0 };
  if (t.length === 1) return { n: 1, x: t[0].pageX, y: t[0].pageY, d: 0, a: 0 };
  const [a, b] = t;
  const dx = b.pageX - a.pageX, dy = b.pageY - a.pageY;
  return { n: 2, x: (a.pageX + b.pageX) / 2, y: (a.pageY + b.pageY) / 2, d: Math.hypot(dx, dy), a: (Math.atan2(dy, dx) * 180) / Math.PI };
}

/** Até onde se pode encolher e esticar: stickers (largura) e textos (tamanho da letra), em fração da largura do ecrã. */
const STICKER_RANGE: readonly [number, number] = [0.06, 1.5];
const TEXT_RANGE: readonly [number, number] = [TEXT_S.min, TEXT_S.max];
export const layerRange = (l: MimoLayer) => (isTextLayer(l) ? TEXT_RANGE : STICKER_RANGE);

/**
 * Um sticker ou um texto no editor: arrasta-se com um dedo; com dois, cresce e roda. Um toque sem arrastar (num texto)
 * chama `onTap` (reescrever). `box`: o tamanho do sticker; sem ele (texto), a vista toma o tamanho do que leva dentro.
 */
function Placed({ item, width, height, label, onSelect, onChange, onDragging, onDrop, onTap, style, children }: {
  item: MimoLayer; width: number; height: number; label: string;
  onSelect: () => void; onChange: (p: MimoLayer) => void; onDragging: (on: boolean) => void; onDrop: (p: MimoLayer) => void; onTap?: () => void;
  style: object; children: React.ReactNode;
}) {
  const ref = useRef({ item, width, height, onSelect, onChange, onDragging, onDrop, onTap });
  ref.current = { item, width, height, onSelect, onChange, onDragging, onDrop, onTap };
  const last = useRef<ReturnType<typeof metrics> | null>(null);
  // Para saber se foi um toque: onde e quando começou, e se chegou a andar ou a usar dois dedos.
  const start = useRef({ x: 0, y: 0, t: 0, moved: false });
  const pan = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: (e) => {
      ref.current.onSelect();
      last.current = metrics(e);
      start.current = { x: last.current.x, y: last.current.y, t: Date.now(), moved: false };
      ref.current.onDragging(true);
    },
    onPanResponderMove: (e) => {
      const m = metrics(e);
      const l = last.current;
      const { item: it, width: W, height: H } = ref.current;
      if (m.n > 1 || Math.hypot(m.x - start.current.x, m.y - start.current.y) > 8) start.current.moved = true;
      // Mudou o número de dedos: recomeça a contar a partir daqui (sem salto).
      if (!l || l.n !== m.n) { last.current = m; return; }
      // O centro fica dentro do que o servidor aceita (−0,5 a 1,5 do ecrã; fora disso o mimo dava 400).
      let next: MimoLayer = { ...it, x: clamp(it.x + (m.x - l.x) / W, -0.5, 1.5), y: clamp(it.y + (m.y - l.y) / H, -0.5, 1.5) };
      if (m.n >= 2 && l.d > 0) {
        let da = m.a - l.a;
        if (da > 180) da -= 360;
        if (da < -180) da += 360;
        const [lo, hi] = layerRange(it);
        next = { ...next, s: clamp(it.s * (m.d / l.d), lo, hi), r: (it.r + da) % 360 };
      }
      last.current = m;
      ref.current.onChange(next);
    },
    onPanResponderRelease: () => {
      const tap = !start.current.moved && Date.now() - start.current.t < 400;
      ref.current.onDragging(false);
      if (tap && ref.current.onTap) ref.current.onTap();
      else ref.current.onDrop(ref.current.item);
      last.current = null;
    },
    onPanResponderTerminate: () => { ref.current.onDragging(false); last.current = null; },
  }), []);
  return (
    <View
      {...pan.panHandlers}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={[style, { touchAction: 'none', userSelect: 'none', cursor: 'grab' } as object]}
    >
      {children}
    </View>
  );
}

/** Um texto no editor: medido (lib/textLayers, `textLayout`) e pousado como um sticker, com a caixa a `s × largura`. */
function PlacedText({ item, width, height, selected, ...rest }: Omit<Parameters<typeof Placed>[0], 'item' | 'style' | 'children'> & { item: TextLayer; selected: boolean }) {
  const { L, ready, measure } = useTextLayer(item, width);
  return (
    <>
      {measure}
      <Placed item={item} width={width} height={height} {...rest} style={{ position: 'absolute', left: item.x * width - L.w / 2, top: item.y * height - L.h / 2, width: L.w, height: L.h, opacity: ready ? 1 : 0, transform: [{ rotate: `${item.r}deg` }] }}>
        <TextBox layer={item} L={L} />
        {selected && <View pointerEvents="none" style={st.selBox} />}
      </Placed>
    </>
  );
}

/**
 * O editor de stickers e textos por cima do mimo: mover, pinçar, rodar; largar em baixo, no caixote, apaga. Tocar num texto
 * chama `onEdit` (reescrever). `hidden`: o que se está a reescrever não aparece por baixo do editor de texto.
 */
export function StickerCanvas({ stickers, onChange, width, height, selected, onSelect, onEdit, hidden = null }: {
  stickers: MimoLayer[]; onChange: (s: MimoLayer[]) => void; width: number; height: number; selected: number | null; onSelect: (i: number | null) => void;
  onEdit?: (i: number) => void; hidden?: number | null;
}) {
  const [dragging, setDragging] = useState(false);
  const [overTrash, setOverTrash] = useState(false);
  useTextFonts(layerFonts(stickers));
  if (!width || !height) return null;
  const inTrash = (p: MimoLayer) => p.y > 0.86 && Math.abs(p.x - 0.5) < 0.2;
  const common = (i: number) => ({
    width,
    height,
    onSelect: () => onSelect(i),
    onChange: (np: MimoLayer) => { const next = stickers.slice(); next[i] = np; onChange(next); setOverTrash(inTrash(np)); },
    onDragging: (on: boolean) => { setDragging(on); if (!on) setOverTrash(false); },
    onDrop: (np: MimoLayer) => { if (inTrash(np)) { onChange(stickers.filter((_, k) => k !== i)); onSelect(null); } },
  });
  return (
    <View pointerEvents="box-none" style={[StyleSheet.absoluteFill, { overflow: 'hidden' }]}>
      {stickers.map((p, i) => {
        if (i === hidden) return null;
        if (isTextLayer(p)) {
          return <PlacedText key={`t-${i}`} item={p} {...common(i)} selected={selected === i} onTap={onEdit ? () => onEdit(i) : undefined} label={t('Texto «{text}»: toca para reescrever, arrasta para mover, pinça para mudar o tamanho', { text: p.text })} />;
        }
        const def = stickerById(p.id);
        if (!def) return null;
        const w = p.s * width, h = w * def.ratio;
        return (
          <Placed
            key={`${p.id}-${i}`}
            item={p}
            {...common(i)}
            label={t('Sticker {text}: arrasta para mover, pinça para mudar o tamanho', { text: def.text })}
            style={{ position: 'absolute', left: p.x * width - w / 2, top: p.y * height - h / 2, width: w, height: h, transform: [{ rotate: `${p.r}deg` }] }}
          >
            <StickerArt def={def} size={w} onMedia />
            {selected === i && <View pointerEvents="none" style={st.selBox} />}
          </Placed>
        );
      })}
      {dragging && (
        <View pointerEvents="none" style={[st.trash, overTrash && st.trashOn]}>
          <Icon name="trash" size={26} color="#fff" strokeWidth={2.2} />
        </View>
      )}
    </View>
  );
}

/**
 * Botões do sticker ou do texto escolhido (para quem não pinça, e no computador): menor, maior, rodar, apagar e pronto (um
 * texto reescreve-se tocando nele).
 */
export function StickerToolbar<T extends MimoLayer>({ item, onChange, onDelete, onDone }: { item: T; onChange: (p: T) => void; onDelete: () => void; onDone: () => void }) {
  const [lo, hi] = layerRange(item);
  const btn = (label: string, run: () => void, icon?: IconName, glyph?: string) => (
    <Pressable key={label} onPress={run} style={st.tb} hitSlop={3} accessibilityRole="button" accessibilityLabel={label}>
      {icon ? <Icon name={icon} size={20} color="#fff" strokeWidth={2.2} /> : <Text style={st.tbGlyph}>{glyph}</Text>}
    </Pressable>
  );
  return (
    <View style={st.toolbar}>
      {btn(t('Mais pequeno'), () => onChange({ ...item, s: clamp(item.s / 1.15, lo, hi) }), undefined, '−')}
      {btn(t('Maior'), () => onChange({ ...item, s: clamp(item.s * 1.15, lo, hi) }), undefined, '+')}
      {btn(t('Rodar'), () => onChange({ ...item, r: (item.r + 15) % 360 }), 'repeat')}
      {btn(t('Apagar'), onDelete, 'trash')}
      {btn(t('Pronto'), onDone, 'check')}
    </View>
  );
}

/** Escolher um sticker: os animados primeiro, depois a biblioteca do chat por categoria, com pesquisa. */
export function StickerPicker({ onPick, onClose }: { onPick: (id: string) => void; onClose: () => void }) {
  const [cat, setCat] = useState('animados');
  const [q, setQ] = useState('');
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (t) return STICKERS.filter((s) => s.text.toLowerCase().includes(t) || s.id.includes(t)).slice(0, 80);
    return STICKERS.filter((s) => s.cat === cat);
  }, [cat, q]);
  return (
    <Sheet title={t('Stickers')} onClose={onClose}>
      <View style={st.searchRow}>
        <View style={st.search}>
          <Icon name="search" size={18} color={colors.zinc500} />
          <TextInput value={q} onChangeText={setQ} placeholder={t('Procurar um sticker')} placeholderTextColor={colors.zinc500} accessibilityLabel={t('Procurar um sticker')} autoCapitalize="none" autoCorrect={false} style={st.input} />
        </View>
      </View>
      {!q.trim() && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={st.cats}>
          {STICKER_CATS.map((c) => (
            <Pressable key={c.id} onPress={() => setCat(c.id)} style={[st.cat, { backgroundColor: cat === c.id ? colors.brand : colors.zinc100 }]} accessibilityRole="tab" accessibilityState={{ selected: cat === c.id }}>
              <Text style={{ fontSize: 13, fontWeight: '600', color: cat === c.id ? '#fff' : colors.zinc700 }}>{c.label}</Text>
            </Pressable>
          ))}
        </ScrollView>
      )}
      <FlatList
        data={shown}
        numColumns={4}
        keyExtractor={(s) => s.id}
        style={{ maxHeight: 300 }}
        contentContainerStyle={{ padding: 8 }}
        ListEmptyComponent={<Text style={st.none}>{t('Nenhum sticker com esse nome')}</Text>}
        renderItem={({ item }) => (
          <Pressable onPress={() => onPick(item.id)} style={({ pressed }) => [st.cell, pressed && { transform: [{ scale: 0.9 }] }]} accessibilityRole="button" accessibilityLabel={t('Sticker {text}', { text: item.text })}>
            <StickerArt def={item} size={64} />
          </Pressable>
        )}
      />
    </Sheet>
  );
}

const st = StyleSheet.create({
  selBox: { position: 'absolute', left: -6, right: -6, top: -6, bottom: -6, borderWidth: 1.5, borderStyle: 'dashed', borderColor: 'rgba(255,255,255,0.9)', borderRadius: 10 },
  trash: { position: 'absolute', bottom: 28, alignSelf: 'center', width: 56, height: 56, borderRadius: 28, backgroundColor: 'rgba(0,0,0,0.55)', borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.7)', alignItems: 'center', justifyContent: 'center' },
  trashOn: { backgroundColor: colors.brand, transform: [{ scale: 1.15 }] },
  toolbar: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 999, backgroundColor: 'rgba(0,0,0,0.55)', padding: 4 },
  tb: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  tbGlyph: { color: '#fff', fontSize: 22, fontWeight: '700', lineHeight: 26 },
  searchRow: { paddingHorizontal: 12, paddingBottom: 8 },
  search: { height: 42, flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 999, backgroundColor: colors.zinc100, paddingHorizontal: 14 },
  input: { flex: 1, minWidth: 0, fontSize: 16, color: colors.zinc900, outlineStyle: 'none' as never },
  cats: { gap: 4, paddingHorizontal: 12, paddingBottom: 4 },
  cat: { height: 32, borderRadius: 16, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center' },
  cell: { flex: 1 / 4, margin: 2, height: 84, alignItems: 'center', justifyContent: 'center', borderRadius: 16 },
  none: { paddingVertical: 32, textAlign: 'center', fontSize: 15, color: colors.zinc500 },
});
