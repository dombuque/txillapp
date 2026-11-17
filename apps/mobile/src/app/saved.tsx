import { useInfiniteQuery } from '@tanstack/react-query';
import { FlatList, Text, View } from 'react-native';
import { PageLoader } from '@/components/PontoLoader';
import { EmptyState } from '@/components/Empty';
import { LoadMore } from '@/components/LoadMore';
import { PostCard } from '@/components/PostCard';
import { PullView, usePullToRefresh } from '@/components/PullToRefresh';
import { StackPage } from '@/components/StackPage';
import { ErrorState } from '@/components/ui/ErrorState';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { onPostsViewable, postViewability } from '@/lib/visiblePosts';
import { colors } from '@/lib/theme';
import { t } from '@/lib/i18n';

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
  const loadMore = () => { if (q.hasNextPage && !q.isFetchingNextPage) void q.fetchNextPage(); };
  const pull = usePullToRefresh(() => q.refetch());
  return (
    <StackPage title={t('Guardados')}>
      <PullView pull={pull}>
      <FlatList
        data={items}
        keyExtractor={(p) => p.id}
        onEndReached={loadMore}
        onEndReachedThreshold={1.5}
        onScroll={pull.onScroll}
        scrollEventThrottle={16}
        refreshControl={pull.control}
        ListHeaderComponent={<Text style={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 12, fontSize: 14, color: colors.zinc600 }}>{t('Só tu vês os teus guardados.')}</Text>}
        ListEmptyComponent={q.isLoading ? <PageLoader /> : q.isError ? <ErrorState what={t('os guardados')} onRetry={() => void q.refetch()} /> : <EmptyState icon="bookmark" title={t('Ainda não guardaste nada')} text={t('Toca no marcador de uma publicação para a guardares aqui.')} />}
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
