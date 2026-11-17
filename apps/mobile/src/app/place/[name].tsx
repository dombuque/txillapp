import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { ActivityIndicator } from '@/components/PontoLoader';
import { Empty } from '@/components/Empty';
import { ErrorState } from '@/components/ui/ErrorState';
import { Icon } from '@/components/Icon';
import { PostCard } from '@/components/PostCard';
import { LoadMore } from '@/components/LoadMore';
import { SegmentedTabs } from '@/components/ui/SegmentedTabs';
import { PullView, usePullToRefresh } from '@/components/PullToRefresh';
import { StackPage } from '@/components/StackPage';
import { locaisApi } from '@/lib/api.locais';
import { onPostsViewable, postViewability } from '@/lib/visiblePosts';
import { useAuth } from '@/lib/auth';
import { colors } from '@/lib/theme';
import { t } from '@/lib/i18n';

/** Publicações de um sítio: "Neste sítio" (o mesmo nome) e "Perto" (até 10 km). */
export default function PlaceScreen() {
  const { name = '' } = useLocalSearchParams<{ name: string }>();
  const router = useRouter();
  const { user } = useAuth();
  let label = name;
  try {
    label = decodeURIComponent(name);
  } catch {
    /* já vem descodificado */
  }
  const [mode, setMode] = useState<'at' | 'near'>('at');
  const q = useInfiniteQuery({
    queryKey: ['place', label.toLowerCase(), mode],
    queryFn: ({ pageParam }) => locaisApi.placePosts(label, mode, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (l) => l.nextCursor ?? undefined,
    retry: false,
  });
  const venue = useQuery({ queryKey: ['venue-by-name', label.toLowerCase()], queryFn: () => locaisApi.findVenue(label), staleTime: 5 * 60_000, retry: false });
  const first = q.data?.pages[0];
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  const loadMore = () => { if (q.hasNextPage && !q.isFetchingNextPage) void q.fetchNextPage(); };
  const pull = usePullToRefresh(() => q.refetch());
  const vd = venue.data;

  const head = (
    <View style={{ paddingHorizontal: 16, paddingTop: 12 }}>
      {vd && (
        <Pressable onPress={() => router.push({ pathname: '/v/[slug]', params: { slug: vd.slug } })} style={st.venue} accessibilityRole="link">
          <Icon name="check-circle" size={22} color="#fff" />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={{ fontSize: 16, fontWeight: '700', color: '#fff' }}>{t('Página do local')}{vd.verified ? (' ' + t('· Verificado')) : ''}</Text>
            <Text style={{ fontSize: 14, lineHeight: 20, color: 'rgba(255,255,255,0.7)' }}>{vd.checkins} check-ins</Text>
          </View>
          <Icon name="chevron-right" size={20} color="rgba(255,255,255,0.6)" />
        </Pressable>
      )}
      {/* «Perto» sem posições: fica em «Neste sítio» (e a frase por baixo explica porquê). */}
      <SegmentedTabs tabs={[{ value: 'at', label: t('Neste sítio') }, { value: 'near', label: t('Perto') }]} value={mode} onChange={(k) => { if (k === 'near' && first && !first.hasNear) return; setMode(k); }} style={{ marginVertical: 16 }} />
      {first && !first.hasNear && <Text style={{ marginBottom: 12, fontSize: 14, lineHeight: 20, color: colors.zinc500 }}>{t('Ainda não há publicações com a posição deste sítio, por isso não dá para ver o que há por perto.')}</Text>}
    </View>
  );

  return (
    <StackPage title={label}>
      <PullView pull={pull}>
      <FlatList
        data={items}
        keyExtractor={(p) => p.id}
        ListHeaderComponent={head}
        onEndReached={loadMore}
        onEndReachedThreshold={1.5}
        onScroll={pull.onScroll}
        scrollEventThrottle={16}
        refreshControl={pull.control}
        ListEmptyComponent={
          q.isLoading ? <ActivityIndicator style={{ marginTop: 48 }} color={colors.brand} /> : q.isError ? (
            <ErrorState what={t('este sítio')} onRetry={() => void q.refetch()} />
          ) : (
            <Empty icon="map-pin" title={mode === 'at' ? t('Ainda ninguém publicou aqui') : t('Nada por perto, por agora')} />
          )
        }
        // Carrega sozinha ao chegar ao fim (também no PWA do iPhone, com o LoadMore).
        ListFooterComponent={q.hasNextPage && items.length > 0 ? <LoadMore onLoad={loadMore} loading={q.isFetchingNextPage} /> : <View style={{ height: 32 }} />}
        onViewableItemsChanged={onPostsViewable}
        viewabilityConfig={postViewability}
        renderItem={({ item }) => <PostCard post={item} me={user?.id} />}
      />
      </PullView>
    </StackPage>
  );
}

const st = StyleSheet.create({
  venue: { marginBottom: 12, flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 16, backgroundColor: colors.zinc900, paddingHorizontal: 16, paddingVertical: 12 },
  tab: { flex: 1, borderRadius: 999, backgroundColor: colors.zinc100, paddingVertical: 10, alignItems: 'center' },
});
