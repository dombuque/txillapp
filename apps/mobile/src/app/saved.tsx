import { useInfiniteQuery } from '@tanstack/react-query';
import { FlatList, Text, View } from 'react-native';
import { ActivityIndicator } from '@/components/PontoLoader';
import { Empty } from '@/components/Empty';
import { PostCard } from '@/components/PostCard';
import { StackPage } from '@/components/StackPage';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { colors } from '@/lib/theme';

/** As publicações que guardaste (só tu as vês). */
export default function Saved() {
  const { user } = useAuth();
  const q = useInfiniteQuery({
    queryKey: ['saved'],
    queryFn: ({ pageParam }) => api.savedPosts(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (l) => l.nextCursor ?? undefined,
    retry: false,
  });
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <StackPage title="Guardados">
      <FlatList
        data={items}
        keyExtractor={(p) => p.id}
        onEndReached={() => q.hasNextPage && !q.isFetchingNextPage && void q.fetchNextPage()}
        ListHeaderComponent={<Text style={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 12, fontSize: 14, color: colors.zinc600 }}>Só tu vês os teus guardados.</Text>}
        ListEmptyComponent={q.isLoading ? <ActivityIndicator style={{ marginTop: 48 }} color={colors.brand} /> : q.isError ? <Empty icon="search" title="Não consegui ver os guardados agora" /> : <Empty icon="bookmark" title="Ainda não guardaste nada" text="Toca no marcador de uma publicação para a guardares aqui." />}
        ListFooterComponent={<View style={{ height: 32 }} />}
        renderItem={({ item }) => <PostCard post={item} me={user?.id} />}
      />
    </StackPage>
  );
}
