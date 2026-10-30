import { PostSkeleton } from '../components/Loading';
import Icon from '../components/Icon';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Fragment, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import PostCard from '../components/PostCard';
import StoriesTray from '../components/Stories';
import Suggestions from '../components/Suggestions';
import { btnGhost } from '../components/ui';
import { api, type Post } from '../lib/api';
import { trackSeen } from '../lib/seen';

/** Regista a publicação como vista quando está pelo menos 60% no ecrã durante 1 segundo. */
function Impression({ id, children }: { id: string; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const io = new IntersectionObserver(
      ([e]) => {
        clearTimeout(timer);
        if (e.isIntersecting) timer = setTimeout(() => trackSeen(id), 1000);
      },
      { threshold: 0.6 },
    );
    io.observe(el);
    return () => {
      clearTimeout(timer);
      io.disconnect();
    };
  }, [id]);
  return <div ref={ref}>{children}</div>;
}

export default function Feed() {
  const q = useInfiniteQuery({
    queryKey: ['feed'],
    queryFn: ({ pageParam }) => api.feed(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  // O mesmo post pode aparecer em duas páginas se a ordem mudou entre pedidos: mostra-se uma vez.
  const seenIds = new Set<string>();
  const posts = (q.data?.pages.flatMap((p) => p.items) ?? []).filter((p) => !seenIds.has(p.id) && !!seenIds.add(p.id));
  const firstSeen = posts.findIndex((p: Post) => p.feed?.seen);


  return (
    <div className="pt-1">
      <StoriesTray />
      {q.isLoading && (
        <>
          <PostSkeleton />
          <PostSkeleton />
        </>
      )}
      {q.isError && (
        <div role="alert" className="mx-6 mt-10 text-center">
          <p className="text-lg">Ups, a vibe falhou</p>
          <button onClick={() => q.refetch()} className={`${btnGhost} mt-4`}>
            Tentar outra vez
          </button>
        </div>
      )}
      {q.isSuccess && posts.length === 0 && (
        <div className="mx-6 mt-16 text-center">
          <p className="text-zinc-300" aria-hidden><Icon name="cheers" size={52} className="mx-auto" /></p>
          <p className="mt-4 text-2xl font-extrabold">Ainda ninguém brindou por aqui</p>
          <p className="mt-2 text-lg font-light text-zinc-600">Sê tu a começar a festa!</p>
          <Link to="/new" className="mt-6 inline-block rounded-full bg-brand px-8 py-3.5 font-semibold text-white active:scale-95">
            Faz a primeira publicação
          </Link>
        </div>
      )}
      {posts.map((p, i) => (
        <Fragment key={p.id}>
          {i === firstSeen && firstSeen > 0 && (
            <div className="mx-6 mb-6 mt-2 text-center" role="note">
              <p className="text-lg font-extrabold">Estás em dia</p>
              <p className="text-sm text-zinc-600">Daqui para baixo são publicações que já viste.</p>
            </div>
          )}
          <Impression id={p.id}>
            {p.feed?.source === 'discover' && (
              <p className="mx-6 mb-1.5 text-sm font-semibold text-zinc-500">
                <span aria-hidden><Icon name="sparkles" size={16} className="inline align-[-3px]" /></span> Sugestão para ti
              </p>
            )}
            <PostCard post={p} />
          </Impression>
          {i === 1 && <Suggestions />}
        </Fragment>
      ))}
      {q.isSuccess && posts.length <= 1 && <Suggestions />}
      {q.hasNextPage && (
        <div className="mb-6 text-center">
          <button onClick={() => q.fetchNextPage()} disabled={q.isFetchingNextPage} className={btnGhost}>
            {q.isFetchingNextPage ? 'A buscar mais vibe…' : 'Mais vibe'}
          </button>
        </div>
      )}
    </div>
  );
}
