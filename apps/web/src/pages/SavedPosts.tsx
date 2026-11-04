import { useInfiniteQuery } from '@tanstack/react-query';
import { BookmarkIcon } from '../components/PostCard';
import { LoadingBlock } from '../components/Loading';
import PostCard from '../components/PostCard';
import StackPage from '../components/StackPage';
import { btnGhost } from '../components/ui';
import { api } from '../lib/api';
import { tr } from '../lib/i18n';

/** As publicações que guardaste (só tu as vês). */
export default function SavedPosts() {
  const q = useInfiniteQuery({
    queryKey: ['saved'],
    queryFn: ({ pageParam }) => api.savedPosts(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (l) => l.nextCursor ?? undefined,
    retry: false,
  });
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <StackPage title={tr('Guardados')}>
      <p className="px-4 pt-3 text-sm text-zinc-600">{tr('Só tu vês os teus guardados.')}</p>
      {q.isLoading && <LoadingBlock className="py-16" />}
      {q.isError && <p role="alert" className="py-16 text-center text-zinc-600">{tr('Não consegui ver os guardados agora')}</p>}
      {q.isSuccess && items.length === 0 && (
        <div className="px-8 py-16 text-center">
          <p className="text-zinc-300" aria-hidden><span className="mx-auto block w-fit"><BookmarkIcon on={false} size={44} /></span></p>
          <p className="mt-3 text-xl font-bold">{tr('Ainda não guardaste nada')}</p>
          <p className="mt-1 text-zinc-600">{tr('Toca no marcador de uma publicação para a guardares aqui.')}</p>
        </div>
      )}
      <div className="pt-3">
        {items.map((p) => (
          <PostCard key={p.id} post={p} />
        ))}
      </div>
      {q.hasNextPage && (
        <div className="mb-6 text-center">
          <button onClick={() => q.fetchNextPage()} disabled={q.isFetchingNextPage} className={btnGhost}>
            {q.isFetchingNextPage ? tr('A buscar…') : tr('Mais')}
          </button>
        </div>
      )}
    </StackPage>
  );
}
