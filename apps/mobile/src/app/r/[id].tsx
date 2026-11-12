import { useInfiniteQuery, useQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { useIsFocused, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, Platform, Pressable, StyleSheet, Text, View, type LayoutChangeEvent, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BackButton } from '@/components/BackButton';
import { Icon } from '@/components/Icon';
import { ActivityIndicator } from '@/components/PontoLoader';
import { useDesktop } from '@/lib/desktop';
import { api, isTcheka, type Page, type Post } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { enterImmersive, leaveImmersive } from '@/lib/immersive';
import { isGone } from '@/lib/postCache';
import { createOnce } from '@/lib/tapGuard';
import { Reel } from '../(tabs)/reels';

const isWeb = Platform.OS === 'web';

/**
 * Uma tcheka aberta a partir de uma publicação, ligação, partilha ou story: ecrã inteiro, a tocar.
 * Arrastar para cima passa à próxima tcheka sugerida; na primeira, arrastar para baixo volta à publicação.
 */
export default function ReelPage() {
  useEffect(() => { enterImmersive(); return () => leaveImmersive(); }, []);
  const { id = '' } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const focused = useIsFocused();
  const desktop = useDesktop();
  const [height, setHeight] = useState(0);
  const [active, setActive] = useState(0);
  const activeRef = useRef(0);
  activeRef.current = active;
  const offsetY = useRef(0);
  const list = useRef<FlatList<Post>>(null);

  const q = useQuery({ queryKey: ['post', id], queryFn: () => api.getPost(id), retry: false });
  const opened = q.data ? (q.data.kind === 'repost' && q.data.repostOf ? q.data.repostOf : q.data) : null;
  const isVideo = isTcheka(opened);
  // As sugestões que se seguem (o mesmo algoritmo da Tcheka), sem repetir a que abriste.
  const more = useInfiniteQuery({
    queryKey: ['reels'],
    queryFn: ({ pageParam }) => api.reels(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (l) => l.nextCursor ?? undefined,
    enabled: !!opened && !!isVideo,
  });
  const seen = new Set<string>();
  const items: Post[] = (opened && isVideo ? [opened, ...(more.data?.pages.flatMap((p) => p.items) ?? [])] : []).filter((p) => isTcheka(p) && !seen.has(p.id) && !!seen.add(p.id));

  const patch = (pid: string, c: Partial<Post>) => {
    if (opened && pid === opened.id) qc.setQueryData(['post', id], (d: Post | undefined) => (d ? { ...d, ...c } : d));
    qc.setQueryData<InfiniteData<Page<Post>>>(['reels'], (d) => d && { ...d, pages: d.pages.map((pg) => ({ ...pg, items: pg.items.map((i) => (i.id === pid ? { ...i, ...c } : i)) })) });
  };
  // Fecha uma vez só: puxar para baixo no iPhone dá vários eventos de scroll seguidos já depois do limite, e cada um
  // fazia router.back() — tirava também o ecrã de trás (a publicação, o perfil…).
  const closing = useRef(createOnce()).current;
  const close = () => { closing.run(() => (router.canGoBack() ? router.back() : router.replace('/'))); };

  // Uma publicação que não é tcheka (fotos, texto, ou fotos e vídeos juntos) abre como publicação normal.
  useEffect(() => {
    if (opened && !isVideo) router.replace(`/p/${opened.id}` as never);
  }, [opened, isVideo, router]);

  const viewable = useRef(({ viewableItems }: { viewableItems: { index?: number | null }[] }) => {
    const i = viewableItems[0]?.index;
    if (i != null) setActive(i);
  }).current;
  const viewConfig = useRef({ itemVisiblePercentThreshold: 70 }).current;

  useEffect(() => {
    if (height > 0 && activeRef.current > 0) list.current?.scrollToOffset({ offset: activeRef.current * height, animated: false });
  }, [height]);
  useEffect(() => {
    if (items.length > 0 && active >= items.length - 2 && more.hasNextPage && !more.isFetchingNextPage) void more.fetchNextPage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, items.length, more.hasNextPage, more.isFetchingNextPage]);

  const goNext = useCallback((index: number) => {
    const next = index + 1;
    if (next < items.length) list.current?.scrollToIndex({ index: next, animated: true });
    else if (more.hasNextPage) void more.fetchNextPage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items.length, more.hasNextPage]);

  // Na primeira tcheka, arrastar para baixo volta à publicação. Na web não há "bounce": lê-se o gesto do dedo.
  const closeRef = useRef(close);
  closeRef.current = close;
  // Os toques são lidos no document: com outro ecrã por cima (ex.: o perfil do autor), este fica montado por baixo e não
  // pode fechar-se (o router.back() tirava o ecrã de cima).
  const focusedRef = useRef(focused);
  focusedRef.current = focused;
  useEffect(() => {
    if (!isWeb || typeof document === 'undefined') return;
    let s: { y: number; x: number; t: number } | null = null;
    const down = (e: TouchEvent) => { const t = e.touches[0]; s = focusedRef.current && activeRef.current === 0 && offsetY.current <= 2 ? { y: t.clientY, x: t.clientX, t: Date.now() } : null; };
    const up = (e: TouchEvent) => {
      if (!s) return;
      const t = e.changedTouches[0];
      const dy = t.clientY - s.y;
      const dx = Math.abs(t.clientX - s.x);
      const quick = Date.now() - s.t < 800;
      s = null;
      if (quick && dy > 90 && dy > dx * 1.5 && activeRef.current === 0 && offsetY.current <= 2) closeRef.current();
    };
    document.addEventListener('touchstart', down, { passive: true });
    document.addEventListener('touchend', up, { passive: true });
    return () => { document.removeEventListener('touchstart', down); document.removeEventListener('touchend', up); };
  }, []);
  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    offsetY.current = e.nativeEvent.contentOffset.y;
    // No telemóvel (com bounce), puxar bem para baixo na primeira também volta.
    if (!isWeb && activeRef.current === 0 && e.nativeEvent.contentOffset.y < -70) closeRef.current();
  };

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      {q.isLoading && <View style={st.center}><ActivityIndicator color="#fff" /></View>}
      {q.isError && isGone(q.error) && (
        <View style={st.center}>
          <Icon name="film" size={48} color="rgba(255,255,255,0.7)" />
          <Text style={st.title}>Esta tcheka já não está disponível</Text>
          <Text style={{ marginTop: 4, color: 'rgba(255,255,255,0.75)', textAlign: 'center' }}>Pode ter sido apagada, ou a conta passou a privada.</Text>
          <Pressable onPress={() => router.replace('/reels' as never)} style={st.cta} accessibilityRole="button"><Text style={{ color: '#fff', fontWeight: '700' }}>Ver outras tchekas</Text></Pressable>
        </View>
      )}
      {q.isError && !isGone(q.error) && (
        // Sem rede (ou o servidor falhou): a tcheka pode estar lá; deixa tentar outra vez.
        <View style={st.center} accessibilityRole="alert">
          <Icon name="film" size={48} color="rgba(255,255,255,0.7)" />
          <Text style={st.title}>Ups, a tcheka não carregou</Text>
          <Text style={{ marginTop: 4, color: 'rgba(255,255,255,0.75)', textAlign: 'center' }}>Verifica a ligação e tenta outra vez.</Text>
          <Pressable onPress={() => void q.refetch()} style={st.cta} accessibilityRole="button"><Text style={{ color: '#fff', fontWeight: '700' }}>Tentar outra vez</Text></Pressable>
        </View>
      )}
      {items.length > 0 && (
        <View style={[st.column, desktop && height > 0 && { maxWidth: Math.min(576, Math.round((height * 9) / 16)) }]} onLayout={(e: LayoutChangeEvent) => { const h = Math.round(e.nativeEvent.layout.height); if (h > 0) setHeight((o) => (Math.abs(o - h) >= 1 ? h : o)); }}>
          {height > 0 && (
            <FlatList
              ref={list}
              style={[{ flex: 1 }, isWeb ? ({ scrollSnapType: 'y mandatory', overscrollBehavior: 'contain' } as object) : null]}
              data={items}
              extraData={`${height}|${active}|${focused}`}
              keyExtractor={(p) => p.id}
              pagingEnabled
              snapToInterval={height}
              snapToAlignment="start"
              decelerationRate="fast"
              disableIntervalMomentum
              bounces={!isWeb}
              showsVerticalScrollIndicator={false}
              getItemLayout={(_, i) => ({ length: height, offset: height * i, index: i })}
              onViewableItemsChanged={viewable}
              viewabilityConfig={viewConfig}
              onScroll={onScroll}
              scrollEventThrottle={32}
              windowSize={3}
              initialNumToRender={1}
              maxToRenderPerBatch={2}
              onScrollToIndexFailed={(info) => list.current?.scrollToOffset({ offset: info.index * height, animated: true })}
              renderItem={({ item, index }) => (
                <Reel post={item} active={index === active} onScreen={focused} height={height} onChange={(c) => patch(item.id, c)} me={user?.id} onMore={() => goNext(index)} bottomInset={insets.bottom} />
              )}
              onEndReached={() => { if (more.hasNextPage && !more.isFetchingNextPage) void more.fetchNextPage(); }}
              onEndReachedThreshold={1}
            />
          )}
        </View>
      )}
      <View style={[st.top, { paddingTop: Math.max(insets.top, 12) }]} pointerEvents="box-none">
        <BackButton onPress={close} color="#fff" />
        <Text style={st.head}>Tcheka</Text>
        <View style={{ width: 44 }} />
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  column: { flex: 1, width: '100%', maxWidth: 576, alignSelf: 'center', backgroundColor: '#000' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  title: { marginTop: 16, fontSize: 20, fontWeight: '800', color: '#fff', textAlign: 'center' },
  cta: { marginTop: 24, borderRadius: 999, backgroundColor: '#d6334f', paddingHorizontal: 28, paddingVertical: 12 },
  top: { position: 'absolute', left: 0, right: 0, top: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 8 },
  head: { fontSize: 18, fontWeight: '800', color: '#fff', textShadowColor: 'rgba(0,0,0,0.4)', textShadowRadius: 4 },
});
