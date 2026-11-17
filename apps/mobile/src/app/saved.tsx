import { useInfiniteQuery } from '@tanstack/react-query';
import { FlatList, Text, View } from 'react-native';
import { ActivityIndicator, PageLoader } from '@/components/PontoLoader';
import { EmptyState } from '@/components/Empty';
import { PostCard } from '@/components/PostCard';
import { StackPage } from '@/components/StackPage';
import { ErrorState } from '@/components/ui/ErrorState';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { onPostsViewable, postViewability } from '@/lib/visiblePosts';
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
        onRefresh={() => void q.refetch()}
        refreshing={q.isRefetching && !q.isFetchingNextPage}
        ListHeaderComponent={<Text style={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 12, fontSize: 14, color: colors.zinc600 }}>Só tu vês os teus guardados.</Text>}
        ListEmptyComponent={q.isLoading ? <PageLoader /> : q.isError ? <ErrorState what="os guardados" onRetry={() => void q.refetch()} /> : <EmptyState icon="bookmark" title="Ainda não guardaste nada" text="Toca no marcador de uma publicação para a guardares aqui." />}
        ListFooterComponent={q.isFetchingNextPage ? <ActivityIndicator style={{ marginVertical: 16 }} /> : <View style={{ height: 32 }} />}
        onViewableItemsChanged={onPostsViewable}
        viewabilityConfig={postViewability}
        renderItem={({ item }) => <PostCard post={item} me={user?.id} />}
      />
    </StackPage>
  );
}
