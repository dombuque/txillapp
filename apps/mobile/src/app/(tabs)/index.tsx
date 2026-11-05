import { useInfiniteQuery } from '@tanstack/react-query';
import { useCallback } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PostCard } from '@/components/PostCard';
import { api, type Post } from '@/lib/api';
import { colors } from '@/lib/theme';

/** Início: as publicações de quem segues e do que o Txillapp descobre para ti. */
export default function Feed() {
  const insets = useSafeAreaInsets();
  const q = useInfiniteQuery({
    queryKey: ['feed'],
    queryFn: ({ pageParam }) => api.feed(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

  // Sem duplicados entre páginas.
  const seen = new Set<string>();
  const items: Post[] = (q.data?.pages.flatMap((p) => p.items) ?? []).filter((p) => !seen.has(p.id) && !!seen.add(p.id));

  const onEnd = useCallback(() => {
    if (q.hasNextPage && !q.isFetchingNextPage) void q.fetchNextPage();
  }, [q]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.white, paddingTop: insets.top }}>
      <Text style={styles.brand}>txillapp</Text>
      {q.isLoading ? (
        <View style={styles.center}><ActivityIndicator color={colors.brand} /></View>
      ) : q.isError ? (
        <View style={styles.center}>
          <Text style={styles.empty}>Não foi possível carregar o feed.</Text>
          <Text style={styles.link} onPress={() => void q.refetch()}>Tentar outra vez</Text>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(p) => p.id}
          renderItem={({ item }) => <PostCard post={item} />}
          onEndReached={onEnd}
          onEndReachedThreshold={0.6}
          refreshControl={<RefreshControl refreshing={q.isRefetching && !q.isFetchingNextPage} onRefresh={() => void q.refetch()} tintColor={colors.brand} colors={[colors.brand]} />}
          ListEmptyComponent={<Text style={[styles.empty, { marginTop: 60 }]}>Ainda não há publicações. Segue malta para encheres o feed.</Text>}
          ListFooterComponent={<View style={{ height: 40, justifyContent: 'center' }}>{q.isFetchingNextPage ? <ActivityIndicator color={colors.brand} /> : null}</View>}
          windowSize={7}
          initialNumToRender={3}
          maxToRenderPerBatch={4}
          removeClippedSubviews
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  brand: { fontSize: 26, fontWeight: '800', color: colors.brand, letterSpacing: -0.5, paddingHorizontal: 14, paddingVertical: 10 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 },
  empty: { fontSize: 15, color: colors.muted, textAlign: 'center', paddingHorizontal: 32 },
  link: { fontSize: 15, color: colors.brand, fontWeight: '700' },
});
