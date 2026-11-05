import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { lazy, Suspense, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import Icon from '../components/Icon';
import { LoadingBlock } from '../components/Loading';
import PostCard from '../components/PostCard';
import StackPage from '../components/StackPage';
import { btnGhost } from '../components/ui';
import { api } from '../lib/api';
import { tr } from '../lib/i18n';

const PlacePostsMap = lazy(() => import('../components/PlacePostsMap'));

/** Publicações de um sítio: "Neste sítio" (o mesmo nome) e "Perto" (até 10 km), com mapa. */
export default function PlacePage() {
  const { name = '' } = useParams();
  const label = decodeURIComponent(name);
  const [mode, setMode] = useState<'at' | 'near'>('at');
  const q = useInfiniteQuery({
    queryKey: ['place', label.toLowerCase(), mode],
    queryFn: ({ pageParam }) => api.placePosts(label, mode, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (l) => l.nextCursor ?? undefined,
    retry: false,
  });
  const venue = useQuery({ queryKey: ['venue-by-name', label.toLowerCase()], queryFn: () => api.findVenue(label), staleTime: 5 * 60_000, retry: false });
  const first = q.data?.pages[0];
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  const center = first?.center ?? null;
  return (
    <StackPage title={label}>
      <div className="px-4 pt-3">
        {venue.data && (
          <Link to={`/v/${venue.data.slug}`} className="mb-3 flex items-center gap-3 rounded-2xl bg-zinc-900 px-4 py-3 text-white active:scale-[0.99]">
            <Icon name="check-circle" size={22} />
            <span className="min-w-0 flex-1"><span className="block font-bold">{tr('Página do local')}{venue.data.verified ? ` · ${tr('Verificado')}` : ''}</span><span className="block text-sm text-white/70">{venue.data.checkins} {tr('check-ins')}</span></span>
            <span aria-hidden className="text-xl text-white/60">›</span>
          </Link>
        )}
        {center && (
          <Suspense fallback={<div className="h-56 w-full animate-pulse rounded-3xl bg-zinc-100" />}>
            <PlacePostsMap center={center} label={label} items={items} />
          </Suspense>
        )}
        <div role="tablist" aria-label={tr('Ordem')} className="my-4 flex gap-2">
          {([['at', tr('Neste sítio')], ['near', tr('Perto')]] as const).map(([k, text]) => (
            <button
              key={k}
              role="tab"
              aria-selected={mode === k}
              disabled={k === 'near' && !!first && !first.hasNear}
              onClick={() => setMode(k)}
              className={`flex-1 rounded-full py-2.5 text-sm font-bold transition disabled:opacity-40 ${mode === k ? 'bg-zinc-900 text-white' : 'bg-zinc-100 text-zinc-800'}`}
            >
              {text}
            </button>
          ))}
        </div>
        {first && !first.hasNear && <p className="mb-3 text-sm text-zinc-500">{tr('Ainda não há publicações com a posição deste sítio, por isso não dá para ver o que há por perto.')}</p>}
      </div>
      {q.isLoading && <LoadingBlock className="py-16" />}
      {q.isError && <p role="alert" className="py-16 text-center text-zinc-600">{tr('Não consegui ver este sítio agora')}</p>}
      {q.isSuccess && items.length === 0 && (
        <div className="py-16 text-center">
          <p className="text-zinc-300" aria-hidden><Icon name="map-pin" size={44} className="mx-auto" /></p>
          <p className="mt-3 text-xl font-bold">{mode === 'at' ? tr('Ainda ninguém publicou aqui') : tr('Nada por perto, por agora')}</p>
        </div>
      )}
      {items.map((p) => (
        <PostCard key={p.id} post={p} />
      ))}
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
