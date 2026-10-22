import { useInfiniteQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import PostCard from '../components/PostCard';
import { api } from '../lib/api';

export default function Feed() {
  const q = useInfiniteQuery({
    queryKey: ['feed'],
    queryFn: ({ pageParam }) => api.feed(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const posts = q.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <div className="space-y-4 px-3 py-3">
      {q.isLoading && <p className="p-6 text-center text-zinc-400">A carregar…</p>}
      {q.isError && <p role="alert" className="p-6 text-center text-red-600">Não foi possível carregar o feed.</p>}
      {q.isSuccess && posts.length === 0 && (
        <div className="p-10 text-center text-zinc-500">
          Ainda ninguém brindou por aqui 🍻{' '}
          <Link to="/new" className="font-semibold text-violet-700 underline">
            Faz a primeira!
          </Link>
        </div>
      )}
      {posts.map((p) => (
        <PostCard key={p.id} post={p} />
      ))}
      {q.hasNextPage && (
        <button
          onClick={() => q.fetchNextPage()}
          disabled={q.isFetchingNextPage}
          className="w-full rounded-xl bg-white py-3 font-medium text-zinc-600 shadow-sm"
        >
          {q.isFetchingNextPage ? 'A carregar…' : 'Ver mais'}
        </button>
      )}
    </div>
  );
}
