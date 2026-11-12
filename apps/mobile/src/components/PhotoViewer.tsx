import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Animated, FlatList, PanResponder, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Modal } from '@/components/Modal';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Badged } from '@/lib/api';
import type { PhotoTag } from '@/lib/api.feed';
import { sized } from '@/lib/config';
import { colors } from '@/lib/theme';
import { CheersPour } from './CheersPour';
import { SoundWaves } from './SoundWaves';
import type { Track } from '@/lib/api.music';
import { trackColors } from '@/lib/musicLook';
import { sharedPlayer, useMusicMuted, useUrlLive } from '@/lib/musicPlayer';
import { Icon } from './Icon';
import { NameWithBadge } from './NameWithBadge';
import { RichText } from './RichText';
import { clampRectPan, finePointer, rectZoomAt, type RectZoom } from '@/lib/desktopKeys';
import { useViewerKeys } from '@/lib/desktopHooks';
import { wheelFactor } from '@/lib/zoomMath';

export interface ViewerPhoto { url: string; width?: number | null; height?: number | null; tags?: PhotoTag[] }

/** Foto inteira (sem cortes) com as etiquetas das pessoas nas posições certas. */
/**
 * Computador (rato): a roda amplia à volta do cursor (1× a 5×), arrastar move a foto ampliada e o duplo clique alterna.
 * Mexe só no `transform` do elemento (sem novos renders). Volta a 1× quando `active` deixa de ser esta foto.
 */
function useDeskZoom(active: boolean, photo: { w: number; h: number }, view: { w: number; h: number }) {
  const ref = useRef<HTMLElement | null>(null);
  const size = useRef({ photo, view });
  size.current = { photo, view };
  const on = active && finePointer();
  useEffect(() => {
    const el = ref.current;
    if (!on || !el || typeof el.addEventListener !== 'function') return;
    let z: RectZoom = { scale: 1, x: 0, y: 0 };
    let drag: { x: number; y: number; zx: number; zy: number; id: number } | null = null;
    const paint = (n: RectZoom, ease: boolean) => {
      z = n;
      el.style.transition = ease ? 'transform 200ms cubic-bezier(0.2, 0.8, 0.2, 1)' : 'none';
      el.style.transform = `translate(${n.x}px, ${n.y}px) scale(${n.scale})`;
      el.style.cursor = n.scale > 1 ? (drag ? 'grabbing' : 'grab') : 'zoom-in';
    };
    const rel = (cx: number, cy: number) => {
      const r = (el.parentElement ?? el).getBoundingClientRect();
      return { x: cx - (r.left + r.width / 2), y: cy - (r.top + r.height / 2) };
    };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const f = rel(e.clientX, e.clientY);
      paint(rectZoomAt(z, wheelFactor(e.deltaY, e.deltaMode, e.ctrlKey), f.x, f.y, size.current.photo, size.current.view), false);
    };
    const dbl = (e: MouseEvent) => {
      const f = rel(e.clientX, e.clientY);
      paint(z.scale > 1 ? { scale: 1, x: 0, y: 0 } : rectZoomAt(z, 2.5, f.x, f.y, size.current.photo, size.current.view), true);
    };
    const down = (e: PointerEvent) => {
      if (z.scale <= 1 || e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      drag = { x: e.clientX, y: e.clientY, zx: z.x, zy: z.y, id: e.pointerId };
      try { el.setPointerCapture(e.pointerId); } catch { /* sem captura */ }
      paint(z, false);
    };
    const move = (e: PointerEvent) => {
      if (!drag || e.pointerId !== drag.id) return;
      e.preventDefault();
      e.stopPropagation();
      paint(clampRectPan({ scale: z.scale, x: drag.zx + e.clientX - drag.x, y: drag.zy + e.clientY - drag.y }, size.current.photo, size.current.view), false);
    };
    const up = () => { if (drag) { drag = null; paint(z, false); } };
    const noDrag = (e: Event) => e.preventDefault();
    paint(z, false);
    el.addEventListener('wheel', wheel, { passive: false });
    el.addEventListener('dblclick', dbl);
    el.addEventListener('pointerdown', down, { capture: true });
    el.addEventListener('pointermove', move, { capture: true });
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('dragstart', noDrag);
    return () => {
      el.removeEventListener('wheel', wheel);
      el.removeEventListener('dblclick', dbl);
      el.removeEventListener('pointerdown', down, { capture: true });
      el.removeEventListener('pointermove', move, { capture: true });
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      el.removeEventListener('dragstart', noDrag);
      el.style.transform = '';
      el.style.transition = '';
      el.style.cursor = '';
    };
  }, [on]);
  return ref;
}

function Photo({ photo, w, h, index, total, onTag, active = false }: { photo: ViewerPhoto; w: number; h: number; index: number; total: number; onTag: (username: string) => void; /** É a foto à vista (no computador, a que amplia com a roda). */ active?: boolean }) {
  const [nat, setNat] = useState<{ w: number; h: number } | null>(photo.width && photo.height ? { w: photo.width, h: photo.height } : null);
  const ratio = nat ? nat.w / nat.h : 1;
  // A foto ocupa o maior retângulo que cabe no ecrã (object-contain).
  const bw = nat ? Math.min(w, h * ratio) : w;
  const bh = nat ? Math.min(h, w / ratio) : h;
  const tags = (photo.tags ?? []).filter((t) => typeof t.x === 'number' && typeof t.y === 'number');
  const zoomRef = useDeskZoom(active, { w: bw, h: bh }, { w, h });
  return (
    <View style={{ width: w, height: h, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
      <View ref={zoomRef as never} style={{ width: bw, height: bh }}>
        <Image
          source={{ uri: sized(photo.url, 1600) }}
          style={StyleSheet.absoluteFill}
          contentFit="contain"
          onLoad={(e) => !nat && e.source?.width && e.source?.height && setNat({ w: e.source.width, h: e.source.height })}
          accessibilityLabel={`Foto ${index + 1} de ${total}`}
          accessibilityIgnoresInvertColors
        />
        {tags.map((t, i) => {
          const x = t.x as number;
          const y = t.y as number;
          const left = x * bw;
          // Perto das margens a etiqueta alinha para dentro, para não sair do ecrã.
          const align = x < 0.22 ? { left, alignItems: 'flex-start' as const } : x > 0.78 ? { right: bw - left, alignItems: 'flex-end' as const } : { left: left - 110, alignItems: 'center' as const };
          return (
            <View key={`${t.username}-${i}`} pointerEvents="box-none" style={[styles.tagBox, { top: y * bh + 10 }, align]}>
              <Pressable onPress={() => onTag(t.username)} style={styles.tag} accessibilityRole="link" accessibilityLabel={`Perfil de ${t.displayName ?? t.username}`}>
                <NameWithBadge name={t.displayName ?? t.username} who={t} style={styles.tagText} />
              </Pressable>
            </View>
          );
        })}
      </View>
    </View>
  );
}

/**
 * Foto em ecrã completo, como no X: fundo preto, deslizar entre as fotos, fechar com o X ou arrastando para baixo;
 * por baixo o autor, o texto e a barra de ações (`footer`).
 */
export function PhotoViewer({ photos, start = 0, author, body, footer, burst = 0, music, onClose }: { photos: ViewerPhoto[]; start?: number; author: { displayName: string; username: string } & Badged; body?: string; footer?: ReactNode; /** Muda a cada brinde: os copos aparecem no meio da foto, como no feed. */ burst?: number; /** A música da publicação: enquanto toca (com som), as ondas atravessam a foto. */ music?: Track | null; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { width, height } = useWindowDimensions();
  const [i, setI] = useState(start);
  const [pagerH, setPagerH] = useState(Math.round(height * 0.6));
  const [footH, setFootH] = useState(96);
  const list = useRef<FlatList<ViewerPhoto>>(null);
  const drag = useRef(new Animated.Value(0)).current;
  const n = photos.length;

  useEffect(() => {
    if (start > 0) setTimeout(() => list.current?.scrollToIndex({ index: start, animated: false }), 0);
  }, [start]);

  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_e, g) => g.dy > 10 && g.dy > Math.abs(g.dx) * 1.5,
      onPanResponderMove: (_e, g) => drag.setValue(Math.max(0, g.dy)),
      onPanResponderRelease: (_e, g) => {
        if (g.dy > 110 || g.vy > 1) onClose();
        else Animated.spring(drag, { toValue: 0, useNativeDriver: false, bounciness: 0 }).start();
      },
      onPanResponderTerminate: () => Animated.spring(drag, { toValue: 0, useNativeDriver: false, bounciness: 0 }).start(),
    }),
  ).current;

  // Computador: ←/→ mudam de foto (Esc fecha: é do Modal); setas ‹ › nos lados. Sem arrastar com o rato para fechar.
  const mouse = finePointer();
  const go = (k: number) => {
    const t = Math.max(0, Math.min(n - 1, k));
    if (t === i) return;
    list.current?.scrollToIndex({ index: t, animated: true });
    setI(t);
  };
  useViewerKeys(true, { prev: () => go(i - 1), next: () => go(i + 1) });
  const bg = drag.interpolate({ inputRange: [0, 500], outputRange: ['rgba(0,0,0,1)', 'rgba(0,0,0,0.35)'], extrapolate: 'clamp' });
  const openTag = (u: string) => {
    onClose();
    router.push(`/u/${u}` as never);
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <Animated.View style={[styles.root, { backgroundColor: bg }]} accessibilityViewIsModal accessibilityLabel={`Fotos de ${author.displayName}`}>
        <View style={[styles.top, { paddingTop: Math.max(insets.top, 8) }]}>
          <Pressable onPress={onClose} style={styles.close} accessibilityRole="button" accessibilityLabel="Fechar" {...(mouse ? ({ dataSet: { tip: 'Fechar (Esc)' } } as object) : null)}>
            <Icon name="x" size={22} color="#fff" strokeWidth={2.4} />
          </Pressable>
          {n > 1 ? (
            <View style={styles.count}>
              <Text style={styles.countText}>{i + 1}/{n}</Text>
            </View>
          ) : null}
          <View style={{ width: 44 }} />
        </View>

        <Animated.View style={{ flex: 1, transform: [{ translateY: drag }] }} onLayout={(e) => setPagerH(e.nativeEvent.layout.height)} {...(mouse ? {} : pan.panHandlers)}>
          <FlatList
            ref={list}
            data={photos}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            keyExtractor={(p) => p.url}
            getItemLayout={(_d, k) => ({ length: width, offset: width * k, index: k })}
            initialScrollIndex={start}
            onScroll={(e) => { const k = Math.round(e.nativeEvent.contentOffset.x / Math.max(1, width)); if (k >= 0 && k < n) setI(k); }}
            scrollEventThrottle={32}
            renderItem={({ item, index }) => <Photo photo={item} w={width} h={pagerH} index={index} total={n} onTag={openTag} active={index === i} />}
            extraData={i}
          />
          {music ? <ViewerWaves music={music} /> : null}
        </Animated.View>
        {mouse && n > 1 ? (
          <>
            {i > 0 ? (
              <Pressable onPress={() => go(i - 1)} style={(st) => [styles.side, { left: 16 }, (st as { hovered?: boolean }).hovered && styles.sideHover]} accessibilityRole="button" accessibilityLabel="Foto anterior" {...({ dataSet: { tip: 'Foto anterior (←)' } } as object)}>
                <Icon name="chevron-left" size={26} color="#fff" strokeWidth={2.4} />
              </Pressable>
            ) : null}
            {i < n - 1 ? (
              <Pressable onPress={() => go(i + 1)} style={(st) => [styles.side, { right: 16 }, (st as { hovered?: boolean }).hovered && styles.sideHover]} accessibilityRole="button" accessibilityLabel="Foto seguinte" {...({ dataSet: { tip: 'Foto seguinte (→)' } } as object)}>
                <Icon name="chevron-right" size={26} color="#fff" strokeWidth={2.4} />
              </Pressable>
            ) : null}
          </>
        ) : null}

        <CheersPour n={burst} size={Math.min(240, width * 0.6)} />
        {footer ? <View style={[styles.rail, { bottom: footH + 12 }]} pointerEvents="box-none">{footer}</View> : null}
        <View style={[styles.foot, { paddingBottom: Math.max(insets.bottom, 8) + 56 }]} onLayout={(e) => setFootH(Math.round(e.nativeEvent.layout.height))}>
          <NameWithBadge name={author.displayName} who={author} style={styles.who} gap={4}>
            <Text style={[styles.who, styles.handle, { flexShrink: 1 }]} numberOfLines={1}>@{author.username}</Text>
          </NameWithBadge>
          {body ? (
            <Text numberOfLines={5} style={styles.body}>
              <RichText text={body} style={{ color: '#f4f4f5', fontSize: 14 }} />
            </Text>
          ) : null}
        </View>
      </Animated.View>
    </Modal>
  );
}

/** As ondas da música por cima da foto (por baixo dos botões e do texto), enquanto a faixa da publicação toca com som. */
function ViewerWaves({ music }: { music: Track }) {
  const live = useUrlLive(music.url);
  const [muted] = useMusicMuted();
  return <SoundWaves active={live && !muted} colors={trackColors(music)} player={live ? sharedPlayer() : null} band={0.34} />;
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 8, paddingBottom: 4 },
  side: { position: 'absolute', top: '45%', width: 48, height: 48, borderRadius: 24, backgroundColor: 'rgba(255,255,255,0.16)', alignItems: 'center', justifyContent: 'center', zIndex: 6 },
  sideHover: { backgroundColor: 'rgba(255,255,255,0.3)' },
  close: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.4)' },
  count: { borderRadius: 999, backgroundColor: 'rgba(0,0,0,0.5)', paddingHorizontal: 12, paddingVertical: 4 },
  countText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  // Autor e descrição: bem acima do fundo (como na Tcheka), com espaço para a fila de ações à direita.
  foot: { backgroundColor: 'rgba(0,0,0,0.6)', paddingHorizontal: 16, paddingRight: 84, paddingTop: 14, minHeight: 64 },
  rail: { position: 'absolute', right: 10, zIndex: 5 },
  who: { color: '#fff', fontSize: 15, fontWeight: '700' },
  handle: { color: colors.zinc300, fontWeight: '400' },
  body: { marginTop: 4, color: '#f4f4f5', fontSize: 15, lineHeight: 21 },
  tagBox: { position: 'absolute', width: 220 },
  tag: { maxWidth: 220, borderRadius: 8, backgroundColor: 'rgba(0,0,0,0.8)', paddingHorizontal: 10, paddingVertical: 4 },
  tagText: { color: '#fff', fontSize: 14, fontWeight: '600' },
});
