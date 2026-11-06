import { useInfiniteQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, Share, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BookmarkIcon } from '@/components/BookmarkIcon';
import { CommentsSheet } from '@/components/CommentsSheet';
import { Icon } from '@/components/Icon';
import { GiftSheet, PostMenuSheet, RepostSheet, postLink } from '@/components/PostSheets';
import { api, type Page, type Post } from '@/lib/api';
import { abs } from '@/lib/config';
import { useAuth } from '@/lib/auth';
import { colors } from '@/lib/theme';
import { Avatar } from '@/components/Avatar';

type SheetName = null | 'comments' | 'repost' | 'gift' | 'menu';

export function Reel({ post, active, height, muted, onMute, onChange, me }: { post: Post; active: boolean; height: number; muted: boolean; onMute: () => void; onChange: (p: Partial<Post>) => void; me?: string }) {
  const router = useRouter();
  const [sheet, setSheet] = useState<SheetName>(null);
  const [paused, setPaused] = useState(false);
  const m = post.media[0];
  const player = useVideoPlayer(abs(m.url) ?? '', (p) => {
    p.loop = true;
    p.muted = muted;
  });
  useEffect(() => {
    player.muted = muted;
  }, [muted, player]);
  useEffect(() => {
    if (active && !paused) player.play();
    else player.pause();
  }, [active, paused, player]);

  const mine = post.author.id === me;
  async function cheer() {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onChange({ cheered: !post.cheered, cheers: post.cheers + (post.cheered ? -1 : 1) });
    try {
      onChange(await api.cheer(post.id));
    } catch {
      onChange({ cheered: post.cheered, cheers: post.cheers });
    }
  }
  async function save() {
    const next = !post.saved;
    onChange({ saved: next });
    try {
      await (next ? api.savePost(post.id) : api.unsavePost(post.id));
    } catch {
      onChange({ saved: !next });
    }
  }
  const Rail = ({ icon, label, on, onPress, tone }: { icon: React.ReactNode; label?: string | number; on?: boolean; onPress: () => void; tone?: string }) => (
    <Pressable onPress={onPress} style={styles.rail} accessibilityRole="button">
      <View style={[styles.circle, on && { backgroundColor: tone ?? 'rgba(255,255,255,0.9)' }]}>{icon}</View>
      {label !== undefined ? <Text style={styles.railText}>{label}</Text> : null}
    </Pressable>
  );

  return (
    <View style={{ height, backgroundColor: '#000' }}>
      <Pressable style={StyleSheet.absoluteFill} onPress={() => setPaused((p) => !p)} accessibilityLabel="Tocar ou pausar">
        <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="cover" nativeControls={false} />
        {m.posterUrl && !active ? <Image source={{ uri: abs(m.posterUrl) }} style={StyleSheet.absoluteFill} contentFit="cover" /> : null}
      </Pressable>
      {paused && <View style={styles.pauseWrap} pointerEvents="none"><View style={styles.pause}><Icon name="play" size={34} color="#fff" solid /></View></View>}

      <View style={styles.info} pointerEvents="box-none">
        <Pressable onPress={() => router.push(`/u/${post.author.username}` as never)} style={styles.author}>
          <Avatar name={post.author.displayName} username={post.author.username} size={40} />
          <Text style={styles.authorName} numberOfLines={1}>{post.author.displayName}</Text>
        </Pressable>
        {post.body ? <Text style={styles.body} numberOfLines={3}>{post.body}</Text> : null}
        {post.locationLabel ? (
          <View style={styles.loc}><Icon name="map-pin" size={14} color="rgba(255,255,255,0.9)" /><Text style={styles.locText}>{post.locationLabel}</Text></View>
        ) : null}
      </View>

      <View style={styles.rails}>
        <Rail on={post.cheered} tone="rgba(255,255,255,0.9)" onPress={() => void cheer()} label={post.cheers} icon={<Icon name="cheers" size={26} color={post.cheered ? colors.brand : '#fff'} />} />
        <Rail onPress={() => setSheet('comments')} label={post.comments} icon={<Icon name="comment" size={26} color="#fff" />} />
        <Rail on={post.reposted} tone="rgba(16,185,129,0.9)" onPress={() => setSheet('repost')} label={post.reposts} icon={<Icon name="repeat" size={26} color="#fff" />} />
        <Rail onPress={() => void Share.share({ message: postLink(post), url: postLink(post) }).catch(() => undefined)} icon={<Icon name="share" size={26} color="#fff" />} />
        {!mine && post.canGift && <Rail onPress={() => setSheet('gift')} icon={<Icon name="gift" size={26} color="#fff" />} />}
        <Rail on={!!post.saved} onPress={() => void save()} icon={<BookmarkIcon on={!!post.saved} size={26} color={post.saved ? colors.zinc900 : '#fff'} />} />
        <Rail onPress={() => setSheet('menu')} icon={<Icon name="more" size={26} color="#fff" strokeWidth={3} />} />
        <Rail onPress={onMute} icon={<Icon name={muted ? 'volume-off' : 'volume'} size={24} color="#fff" />} />
      </View>

      {sheet === 'comments' && <CommentsSheet post={post} onClose={() => setSheet(null)} onDelta={(d) => onChange({ comments: Math.max(0, post.comments + d) })} onGift={() => setSheet('gift')} />}
      {sheet === 'repost' && <RepostSheet post={post} onChange={onChange} onClose={() => setSheet(null)} />}
      {sheet === 'gift' && <GiftSheet postId={post.id} recipient={post.author} onClose={() => setSheet(null)} />}
      {sheet === 'menu' && <PostMenuSheet post={post} mine={mine} onClose={() => setSheet(null)} onSaved={(saved) => onChange({ saved })} />}
    </View>
  );
}

/** Reels: vídeos curtos em ecrã inteiro, um de cada vez. Desliza para cima para o seguinte. */
export default function Reels() {
  const router = useRouter();
  const qc = useQueryClient();
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const [height, setHeight] = useState(0);
  const [active, setActive] = useState(0);
  const [muted, setMuted] = useState(true);

  const q = useInfiniteQuery({
    queryKey: ['reels'],
    queryFn: ({ pageParam }) => api.reels(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (l) => l.nextCursor ?? undefined,
  });
  const seen = new Set<string>();
  const items = (q.data?.pages.flatMap((p) => p.items) ?? []).filter((p) => p.media[0]?.kind === 'video' && !seen.has(p.id) && !!seen.add(p.id));

  function patch(id: string, p: Partial<Post>) {
    qc.setQueryData<InfiniteData<Page<Post>>>(['reels'], (d) => d && { ...d, pages: d.pages.map((pg) => ({ ...pg, items: pg.items.map((i) => (i.id === id ? { ...i, ...p } : i)) })) });
  }
  const viewable = useRef(({ viewableItems }: { viewableItems: { index?: number | null }[] }) => {
    const i = viewableItems[0]?.index;
    if (i != null) setActive(i);
  }).current;

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }} onLayout={(e: LayoutChangeEvent) => setHeight(e.nativeEvent.layout.height)}>
      {height > 0 && (
        <FlatList
          data={items}
          keyExtractor={(p) => p.id}
          pagingEnabled
          snapToInterval={height}
          decelerationRate="fast"
          showsVerticalScrollIndicator={false}
          getItemLayout={(_, i) => ({ length: height, offset: height * i, index: i })}
          onViewableItemsChanged={viewable}
          viewabilityConfig={{ itemVisiblePercentThreshold: 70 }}
          windowSize={3}
          initialNumToRender={1}
          maxToRenderPerBatch={1}
          renderItem={({ item, index }) => <Reel post={item} active={index === active} height={height} muted={muted} onMute={() => setMuted((v) => !v)} onChange={(c) => patch(item.id, c)} me={user?.id} />}
          onEndReached={() => { if (q.hasNextPage && !q.isFetchingNextPage) void q.fetchNextPage(); }}
          ListEmptyComponent={
            q.isLoading ? <View style={[styles.center, { height }]}><ActivityIndicator color="#fff" /></View> : q.isError ? (
              <View style={[styles.center, { height }]}><Text style={{ color: 'rgba(255,255,255,0.8)' }}>Ups, falhou</Text></View>
            ) : (
              <View style={[styles.center, { height, paddingHorizontal: 32 }]}>
                <Icon name="film" size={52} color="rgba(255,255,255,0.7)" />
                <Text style={styles.emptyTitle}>Ainda sem reels</Text>
                <Text style={styles.emptySub}>Sê tu a começar: grava um vídeo até 60 segundos.</Text>
                <Pressable onPress={() => router.push('/new' as never)} style={styles.cta}><Text style={styles.ctaText}>Publicar um vídeo</Text></Pressable>
              </View>
            )
          }
        />
      )}
      <View style={[styles.top, { paddingTop: Math.max(insets.top, 12) }]} pointerEvents="box-none">
        <Pressable onPress={() => router.push('/new' as never)} style={styles.topBtn} accessibilityRole="button" accessibilityLabel="Novo reel"><Icon name="plus" size={26} color="#fff" strokeWidth={2.4} /></Pressable>
        <Text style={styles.topTitle}>Reels</Text>
        <Pressable onPress={() => router.push('/reels/filtros' as never)} style={styles.topBtn} accessibilityRole="button" accessibilityLabel="Filtros dos reels"><Icon name="sliders" size={22} color="#fff" /></Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center' },
  pauseWrap: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
  pause: { width: 72, height: 72, borderRadius: 36, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center', paddingLeft: 6 },
  info: { position: 'absolute', left: 16, right: 84, bottom: 24 },
  author: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  authorName: { flexShrink: 1, color: '#fff', fontWeight: '700', fontSize: 16 },
  body: { marginTop: 8, color: '#fff', fontSize: 15, lineHeight: 21 },
  loc: { marginTop: 4, flexDirection: 'row', alignItems: 'center', gap: 4 },
  locText: { color: 'rgba(255,255,255,0.9)', fontSize: 14 },
  rails: { position: 'absolute', right: 12, bottom: 24, alignItems: 'center', gap: 12 },
  rail: { alignItems: 'center' },
  circle: { width: 48, height: 48, borderRadius: 24, backgroundColor: 'rgba(0,0,0,0.35)', alignItems: 'center', justifyContent: 'center' },
  railText: { marginTop: 2, color: '#fff', fontSize: 13, fontWeight: '600' },
  top: { position: 'absolute', left: 0, right: 0, top: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12 },
  topBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(0,0,0,0.35)', alignItems: 'center', justifyContent: 'center' },
  topTitle: { color: '#fff', fontSize: 18, fontWeight: '800' },
  emptyTitle: { marginTop: 16, color: '#fff', fontSize: 24, fontWeight: '800' },
  emptySub: { marginTop: 8, color: 'rgba(255,255,255,0.75)', textAlign: 'center' },
  cta: { marginTop: 24, borderRadius: 999, backgroundColor: colors.brand, paddingHorizontal: 32, paddingVertical: 14 },
  ctaText: { color: '#fff', fontWeight: '700' },
});
