import { useInfiniteQuery } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { ActivityIndicator } from '@/components/PontoLoader';
import { Empty } from '@/components/Empty';
import { PostCard } from '@/components/PostCard';
import { StackPage } from '@/components/StackPage';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { colors } from '@/lib/theme';

/** Página de uma #hashtag: quantas publicações e as publicações, recentes ou mais reagidas. */
export default function TagScreen() {
  const { tag = '' } = useLocalSearchParams<{ tag: string }>();
  const { user } = useAuth();
  const [sort, setSort] = useState<'recent' | 'top'>('recent');
  const q = useInfiniteQuery({
    queryKey: ['tag', tag.toLowerCase(), sort],
    queryFn: ({ pageParam }) => api.tagPage(tag, sort, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (l) => l.nextCursor ?? undefined,
    retry: false,
  });
  const first = q.data?.pages[0];
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <StackPage title={`#${first?.tag ?? tag}`}>
      <FlatList
        data={items}
        keyExtractor={(p) => p.id}
        onEndReached={() => q.hasNextPage && !q.isFetchingNextPage && void q.fetchNextPage()}
        ListHeaderComponent={
          <View style={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 12 }}>
            {first && (
              <Text style={{ color: colors.zinc600, marginBottom: 12, fontSize: 16 }}>
                <Text style={st.b}>{first.posts}</Text> {first.posts === 1 ? 'publicação' : 'publicações'} · <Text style={st.b}>{first.authors}</Text> {first.authors === 1 ? 'pessoa' : 'pessoas'}
              </Text>
            )}
            <View style={{ flexDirection: 'row', gap: 8 }} accessibilityRole="tablist">
              {([['recent', 'Recentes'], ['top', 'Mais reagidas']] as const).map(([k, label]) => (
                <Pressable key={k} onPress={() => setSort(k)} style={[st.pill, sort === k && { backgroundColor: colors.brand }]} accessibilityRole="tab" accessibilityState={{ selected: sort === k }}>
                  <Text style={[st.pillText, sort === k && { color: '#fff' }]}>{label}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        }
        ListEmptyComponent={q.isLoading ? <ActivityIndicator style={{ marginTop: 48 }} color={colors.brand} /> : q.isError ? <Empty icon="search" title="Esta hashtag não existe" /> : <Empty icon="tag" title="Ainda ninguém usou esta hashtag" />}
        ListFooterComponent={q.isFetchingNextPage ? <ActivityIndicator style={{ margin: 16 }} color={colors.brand} /> : <View style={{ height: 32 }} />}
        renderItem={({ item }) => <PostCard post={item} me={user?.id} />}
      />
    </StackPage>
  );
}
const st = StyleSheet.create({
  b: { fontWeight: '700', color: colors.zinc900 },
  pill: { flex: 1, borderRadius: 999, backgroundColor: colors.zinc100, paddingVertical: 10, alignItems: 'center' },
  pillText: { fontSize: 14, fontWeight: '700', color: colors.zinc800 },
});
