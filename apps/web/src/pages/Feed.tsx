import { useInfiniteQuery } from '@tanstack/react-query';
import { Fragment } from 'react';
import { Link } from 'react-router-dom';
import PostCard from '../components/PostCard';
import StoriesTray from '../components/Stories';
import Suggestions from '../components/Suggestions';
import { btnGhost } from '../components/ui';
import { api } from '../lib/api';

function Skeleton() {
  return (
    <div className="mx-4 mb-6 animate-pulse rounded-[28px] bg-white p-5 shadow-[0_2px_16px_rgba(0,0,0,0.09)]" aria-hidden>
      <div className="flex items-center gap-3">
        <div className="h-[52px] w-[52px] rounded-full bg-zinc-200" />
        <div className="flex-1 space-y-2">
          <div className="h-4 w-1/2 rounded-full bg-zinc-200" />
          <div className="h-3 w-1/3 rounded-full bg-zinc-100" />
        </div>
      </div>
      <div className="mt-5 h-4 w-3/4 rounded-full bg-zinc-200" />
      <div className="mt-4 h-40 rounded-xl bg-zinc-100" />
    </div>
  );
}

export default function Feed() {
  const q = useInfiniteQuery({
    queryKey: ['feed'],
    queryFn: ({ pageParam }) => api.feed(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const posts = q.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <div className="pt-1">
      <StoriesTray />
      {q.isLoading && (
        <>
          <Skeleton />
          <Skeleton />
        </>
      )}
      {q.isError && (
        <div role="alert" className="mx-6 mt-10 text-center">
          <p className="text-lg">Ups, a vibe falhou 😅</p>
          <button onClick={() => q.refetch()} className={`${btnGhost} mt-4`}>
            Tentar outra vez
          </button>
        </div>
      )}
      {q.isSuccess && posts.length === 0 && (
        <div className="mx-6 mt-16 text-center">
          <p className="text-6xl">🍻</p>
          <p className="mt-4 text-2xl font-extrabold">Ainda ninguém brindou por aqui</p>
          <p className="mt-2 text-lg font-light text-zinc-600">Sê tu a começar a festa!</p>
          <Link to="/new" className="mt-6 inline-block rounded-full bg-brand px-8 py-3.5 font-semibold text-white active:scale-95">
            Faz a primeira publicação
          </Link>
        </div>
      )}
      {posts.map((p, i) => (
        <Fragment key={p.id}>
          <PostCard post={p} />
          {i === 1 && <Suggestions />}
        </Fragment>
      ))}
      {q.isSuccess && posts.length <= 1 && <Suggestions />}
      {q.hasNextPage && (
        <div className="mb-6 text-center">
          <button onClick={() => q.fetchNextPage()} disabled={q.isFetchingNextPage} className={btnGhost}>
            {q.isFetchingNextPage ? 'A buscar mais vibe…' : 'Mais vibe 🔥'}
          </button>
        </div>
      )}
    </div>
  );
}
