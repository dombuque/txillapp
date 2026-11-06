import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Animated, FlatList, Modal, PanResponder, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { PhotoTag } from '@/lib/api.feed';
import { sized } from '@/lib/config';
import { colors } from '@/lib/theme';
import { Icon } from './Icon';
import { RichText } from './RichText';

export interface ViewerPhoto { url: string; width?: number | null; height?: number | null; tags?: PhotoTag[] }

/** Foto inteira (sem cortes) com as etiquetas das pessoas nas posições certas. */
function Photo({ photo, w, h, index, total, onTag }: { photo: ViewerPhoto; w: number; h: number; index: number; total: number; onTag: (username: string) => void }) {
  const [nat, setNat] = useState<{ w: number; h: number } | null>(photo.width && photo.height ? { w: photo.width, h: photo.height } : null);
  const ratio = nat ? nat.w / nat.h : 1;
  // A foto ocupa o maior retângulo que cabe no ecrã (object-contain).
  const bw = nat ? Math.min(w, h * ratio) : w;
  const bh = nat ? Math.min(h, w / ratio) : h;
  const tags = (photo.tags ?? []).filter((t) => typeof t.x === 'number' && typeof t.y === 'number');
  return (
    <View style={{ width: w, height: h, alignItems: 'center', justifyContent: 'center' }}>
      <View style={{ width: bw, height: bh }}>
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
                <Text style={styles.tagText} numberOfLines={1}>{t.displayName ?? t.username}</Text>
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
export function PhotoViewer({ photos, start = 0, author, body, footer, onClose }: { photos: ViewerPhoto[]; start?: number; author: { displayName: string; username: string }; body?: string; footer?: ReactNode; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { width, height } = useWindowDimensions();
  const [i, setI] = useState(start);
  const [pagerH, setPagerH] = useState(Math.round(height * 0.6));
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

  const bg = drag.interpolate({ inputRange: [0, 500], outputRange: ['rgba(0,0,0,1)', 'rgba(0,0,0,0.35)'], extrapolate: 'clamp' });
  const openTag = (u: string) => {
    onClose();
    router.push(`/u/${u}` as never);
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <Animated.View style={[styles.root, { backgroundColor: bg }]} accessibilityViewIsModal accessibilityLabel={`Fotos de ${author.displayName}`}>
        <View style={[styles.top, { paddingTop: Math.max(insets.top, 8) }]}>
          <Pressable onPress={onClose} style={styles.close} accessibilityRole="button" accessibilityLabel="Fechar">
            <Icon name="x" size={22} color="#fff" strokeWidth={2.4} />
          </Pressable>
          {n > 1 ? (
            <View style={styles.count}>
              <Text style={styles.countText}>{i + 1}/{n}</Text>
            </View>
          ) : null}
          <View style={{ width: 44 }} />
        </View>

        <Animated.View style={{ flex: 1, transform: [{ translateY: drag }] }} onLayout={(e) => setPagerH(e.nativeEvent.layout.height)} {...pan.panHandlers}>
          <FlatList
            ref={list}
            data={photos}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            keyExtractor={(p) => p.url}
            getItemLayout={(_d, k) => ({ length: width, offset: width * k, index: k })}
            initialScrollIndex={start}
            onMomentumScrollEnd={(e) => setI(Math.round(e.nativeEvent.contentOffset.x / width))}
            renderItem={({ item, index }) => <Photo photo={item} w={width} h={pagerH} index={index} total={n} onTag={openTag} />}
          />
        </Animated.View>

        <View style={[styles.foot, { paddingBottom: Math.max(insets.bottom, 8) }]}>
          <Text style={styles.who}>
            {author.displayName} <Text style={styles.handle}>@{author.username}</Text>
          </Text>
          {body ? (
            <Text numberOfLines={2} style={styles.body}>
              <RichText text={body} style={{ color: '#f4f4f5', fontSize: 14 }} />
            </Text>
          ) : null}
          {footer}
        </View>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 8, paddingBottom: 4 },
  close: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.4)' },
  count: { borderRadius: 999, backgroundColor: 'rgba(0,0,0,0.5)', paddingHorizontal: 12, paddingVertical: 4 },
  countText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  foot: { backgroundColor: 'rgba(0,0,0,0.6)', paddingHorizontal: 16, paddingTop: 12 },
  who: { color: '#fff', fontSize: 14, fontWeight: '600' },
  handle: { color: colors.zinc300, fontWeight: '400' },
  body: { marginTop: 2, color: '#f4f4f5', fontSize: 14 },
  tagBox: { position: 'absolute', width: 220 },
  tag: { maxWidth: 220, borderRadius: 8, backgroundColor: 'rgba(0,0,0,0.8)', paddingHorizontal: 10, paddingVertical: 4 },
  tagText: { color: '#fff', fontSize: 14, fontWeight: '600' },
});
