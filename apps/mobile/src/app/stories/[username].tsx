import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Animated, Easing, PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Avatar } from '@/components/Avatar';
import { Icon } from '@/components/Icon';
import { api, type Story } from '@/lib/api';
import { abs } from '@/lib/config';
import { useAuth } from '@/lib/auth';
import { timeAgo } from '@/lib/time';

const IMAGE_MS = 5000;

function VideoStory({ url, onEnd, onDuration }: { url: string; onEnd: () => void; onDuration: (ms: number) => void }) {
  const player = useVideoPlayer(url, (p) => { p.loop = false; p.play(); });
  useEffect(() => {
    const a = player.addListener('playToEnd', onEnd);
    const b = player.addListener('statusChange', () => { if (player.duration) onDuration(player.duration * 1000); });
    return () => { a.remove(); b.remove(); };
  }, [player, onEnd, onDuration]);
  return <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="cover" nativeControls={false} />;
}

/** Ver os stories de uma pessoa: barras de progresso, toca à direita para avançar e à esquerda para recuar, arrasta para baixo para sair. */
export default function StoryViewer() {
  const { username = '' } = useLocalSearchParams<{ username: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const q = useQuery({ queryKey: ['stories', username], queryFn: () => api.storiesOf(username), retry: false });
  const tray = useQuery({ queryKey: ['stories'], queryFn: api.stories });
  const stories = q.data ?? [];
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);
  const [videoMs, setVideoMs] = useState<number | null>(null);
  const progress = useRef(new Animated.Value(0)).current;
  const cur: Story | undefined = stories[i];
  const mine = username === user?.username;
  const dy = useRef(new Animated.Value(0)).current;

  const close = () => {
    void qc.invalidateQueries({ queryKey: ['stories'] });
    router.back();
  };
  // Depois dos desta pessoa, passa à seguinte da fila (quem tem stories por ver).
  const next = () => {
    if (i + 1 < stories.length) return setI(i + 1);
    const order = (tray.data ?? []).filter((t) => !t.isMe).map((t) => t.username);
    const at = order.indexOf(username);
    const nu = at >= 0 ? order[at + 1] : undefined;
    if (nu) router.replace(`/stories/${nu}` as never);
    else close();
  };
  const prev = () => (i > 0 ? setI(i - 1) : undefined);

  useEffect(() => {
    if (!cur) return;
    setVideoMs(null);
    if (!cur.seen && !mine) void api.viewStory(cur.id).catch(() => undefined);
  }, [cur?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const ms = cur?.mediaKind === 'video' ? videoMs ?? cur.durationMs ?? IMAGE_MS : IMAGE_MS;
  useEffect(() => {
    if (!cur || paused) return;
    progress.setValue(0);
    const a = Animated.timing(progress, { toValue: 1, duration: ms, easing: Easing.linear, useNativeDriver: false });
    a.start(({ finished }) => finished && next());
    return () => a.stop();
  }, [cur?.id, paused, ms]); // eslint-disable-line react-hooks/exhaustive-deps

  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_e, g) => g.dy > 12 && Math.abs(g.dy) > Math.abs(g.dx),
      onPanResponderMove: (_e, g) => dy.setValue(Math.max(0, g.dy)),
      onPanResponderRelease: (_e, g) => (g.dy > 110 ? close() : Animated.spring(dy, { toValue: 0, useNativeDriver: false }).start()),
    }),
  ).current;

  function confirmDelete() {
    if (!cur) return;
    setPaused(true);
    Alert.alert('Apagar o story?', 'Desaparece para toda a gente.', [
      { text: 'Cancelar', style: 'cancel', onPress: () => setPaused(false) },
      { text: 'Apagar', style: 'destructive', onPress: async () => { await api.deleteStory(cur.id).catch(() => undefined); await q.refetch(); void qc.invalidateQueries({ queryKey: ['stories'] }); setPaused(false); if (stories.length <= 1) close(); } },
    ]);
  }

  if (q.isLoading) return <View style={styles.center}><ActivityIndicator color="#fff" /></View>;
  if (q.isError || !cur) {
    return (
      <View style={styles.center}>
        <Text style={{ color: '#fff', fontSize: 18, fontWeight: '700' }}>Este story já não está disponível</Text>
        <Pressable onPress={close} style={styles.btn}><Text style={{ color: '#fff', fontWeight: '700' }}>Fechar</Text></Pressable>
      </View>
    );
  }

  return (
    <Animated.View style={[styles.root, { transform: [{ translateY: dy }], opacity: dy.interpolate({ inputRange: [0, 300], outputRange: [1, 0.4], extrapolate: 'clamp' }) }]} {...pan.panHandlers}>
      <View style={StyleSheet.absoluteFill}>
        {cur.mediaKind === 'video' ? (
          <VideoStory url={abs(cur.mediaUrl) ?? ''} onEnd={next} onDuration={setVideoMs} />
        ) : (
          <Image source={{ uri: abs(cur.mediaUrl) }} style={StyleSheet.absoluteFill} contentFit="cover" />
        )}
      </View>
      <View style={styles.shade} pointerEvents="none" />

      <Pressable style={[styles.zone, { left: 0 }]} onPress={prev} onLongPress={() => setPaused(true)} onPressOut={() => setPaused(false)} delayLongPress={220} accessibilityLabel="Anterior" />
      <Pressable style={[styles.zone, { right: 0 }]} onPress={next} onLongPress={() => setPaused(true)} onPressOut={() => setPaused(false)} delayLongPress={220} accessibilityLabel="Seguinte" />

      <View style={[styles.top, { paddingTop: insets.top + 8 }]} pointerEvents="box-none">
        <View style={styles.bars}>
          {stories.map((s, n) => (
            <View key={s.id} style={styles.track}>
              <Animated.View style={[styles.fill, { width: n < i ? '100%' : n === i ? progress.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) : '0%' }]} />
            </View>
          ))}
        </View>
        <View style={styles.who}>
          <Avatar name={cur.author.displayName} username={cur.author.username} size={36} />
          <Text style={styles.name} numberOfLines={1}>{cur.author.username}</Text>
          <Text style={styles.ago}>{timeAgo(cur.createdAt)}</Text>
          {cur.audience === 'close_friends' && <View style={styles.close}><Icon name="star" size={12} color="#fff" solid /></View>}
          <View style={{ flex: 1 }} />
          {mine && <Pressable onPress={confirmDelete} hitSlop={10} style={styles.iconBtn} accessibilityLabel="Apagar o story"><Icon name="trash" size={22} color="#fff" /></Pressable>}
          <Pressable onPress={close} hitSlop={10} style={styles.iconBtn} accessibilityLabel="Fechar"><Icon name="x" size={24} color="#fff" strokeWidth={2} /></Pressable>
        </View>
      </View>

      <View style={[styles.bottom, { paddingBottom: Math.max(insets.bottom, 16) }]} pointerEvents="box-none">
        {cur.caption ? <Text style={styles.caption}>{cur.caption}</Text> : null}
        {mine && cur.viewCount != null && <View style={styles.views}><Icon name="eye" size={18} color="#fff" /><Text style={styles.viewsText}>{cur.viewCount} {cur.viewCount === 1 ? 'visualização' : 'visualizações'}</Text></View>}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  center: { flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24 },
  btn: { borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.2)', paddingHorizontal: 24, paddingVertical: 12 },
  shade: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.12)' },
  zone: { position: 'absolute', top: 96, bottom: 120, width: '40%' },
  top: { position: 'absolute', left: 0, right: 0, top: 0, paddingHorizontal: 12 },
  bars: { flexDirection: 'row', gap: 4 },
  track: { flex: 1, height: 3, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.35)', overflow: 'hidden' },
  fill: { height: 3, backgroundColor: '#fff' },
  who: { marginTop: 10, flexDirection: 'row', alignItems: 'center', gap: 8 },
  name: { color: '#fff', fontWeight: '700', fontSize: 15, flexShrink: 1 },
  ago: { color: 'rgba(255,255,255,0.8)', fontSize: 13 },
  close: { width: 20, height: 20, borderRadius: 10, backgroundColor: '#16a34a', alignItems: 'center', justifyContent: 'center' },
  iconBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 16, gap: 8 },
  caption: { color: '#fff', fontSize: 18, lineHeight: 24, fontWeight: '600', textShadowColor: 'rgba(0,0,0,0.5)', textShadowRadius: 6 },
  views: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  viewsText: { color: '#fff', fontSize: 14, fontWeight: '600' },
});
