import Icon from '../components/Icon';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useParams } from 'react-router-dom';
import PostCard from '../components/PostCard';
import StackPage from '../components/StackPage';
import { btnGhost } from '../components/ui';
import { api } from '../lib/api';

/** Página de uma #hashtag: quantas publicações e as publicações, recentes ou mais reagidas. */
export default function TagPage() {
  const { tag = '' } = useParams();
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
      <div className="px-4 pt-3">
        {first && (
          <p className="mb-3 text-zinc-600">
            <b className="text-zinc-900">{first.posts}</b> {first.posts === 1 ? 'publicação' : 'publicações'} · <b className="text-zinc-900">{first.authors}</b> {first.authors === 1 ? 'pessoa' : 'pessoas'}
          </p>
        )}
        <div role="tablist" aria-label="Ordem" className="mb-4 flex gap-2">
          {([['recent', 'Recentes'], ['top', 'Mais reagidas']] as const).map(([k, label]) => (
            <button key={k} role="tab" aria-selected={sort === k} onClick={() => setSort(k)} className={`flex-1 rounded-full py-2.5 text-sm font-bold transition ${sort === k ? 'bg-zinc-900 text-white' : 'bg-zinc-100 text-zinc-700'}`}>
              {label}
            </button>
          ))}
        </div>
      </div>
      {q.isLoading && <p className="py-16 text-center text-zinc-500">A carregar…</p>}
      {q.isError && <p role="alert" className="py-16 text-center text-zinc-600">Esta hashtag não existe</p>}
      {q.isSuccess && items.length === 0 && (
        <div className="py-16 text-center">
          <p className="text-zinc-300" aria-hidden><Icon name="tag" size={44} className="mx-auto" /></p>
          <p className="mt-3 text-xl font-bold">Ainda ninguém usou esta hashtag</p>
        </div>
      )}
      {items.map((p) => (
        <PostCard key={p.id} post={p} />
      ))}
      {q.hasNextPage && (
        <div className="mb-6 text-center">
          <button onClick={() => q.fetchNextPage()} disabled={q.isFetchingNextPage} className={btnGhost}>
            {q.isFetchingNextPage ? 'A buscar…' : 'Mais'}
          </button>
        </div>
      )}
    </StackPage>
  );
}
