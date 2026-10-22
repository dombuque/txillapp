import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import FollowButton from '../components/FollowButton';
import StackPage from '../components/StackPage';
import { SearchIcon } from '../components/icons';
import { Avatar } from '../components/ui';
import { api, type Person } from '../lib/api';
import { useAuth } from '../lib/auth';

type Kind = 'followers' | 'following';

/** Uma lista (seguidores ou a seguir) com pesquisa própria. Cada separador mantém o seu texto e a sua posição. */
function ConnectionList({ username, kind, meUsername }: { username: string; kind: Kind; meUsername: string }) {
  const [text, setText] = useState('');
  const [term, setTerm] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setTerm(text.trim()), 300);
    return () => clearTimeout(t);
  }, [text]);

  const q = useInfiniteQuery({
    queryKey: ['people', kind, username, term],
    queryFn: ({ pageParam }) => (kind === 'followers' ? api.followers(username, pageParam, term) : api.following(username, pageParam, term)),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (l) => l.nextCursor ?? undefined,
  });
  const people: Person[] = q.data?.pages.flatMap((x) => x.items) ?? [];

  return (
    <div className="h-full overflow-y-auto overscroll-contain pb-6">
      <form role="search" onSubmit={(e) => e.preventDefault()} className="sticky top-0 z-[1] bg-white px-4 pb-2 pt-2">
        <label className="flex items-center gap-2.5 rounded-xl bg-zinc-100 px-3.5 py-2.5 text-zinc-600 focus-within:ring-2 focus-within:ring-brand">
          <SearchIcon width={18} height={18} />
          <input
            type="search"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={kind === 'followers' ? 'Procurar seguidores' : 'Procurar quem sigo'}
            aria-label={kind === 'followers' ? 'Procurar nos seguidores' : 'Procurar em quem sigo'}
            enterKeyHint="search"
            autoCapitalize="none"
            autoCorrect="off"
            className="min-w-0 flex-1 bg-transparent text-[15px] text-zinc-900 outline-none placeholder:text-zinc-500 [&::-webkit-search-cancel-button]:hidden"
          />
          {text && (
            <button type="button" onClick={() => setText('')} aria-label="Limpar pesquisa" className="flex h-7 w-7 items-center justify-center text-lg">×</button>
          )}
        </label>
      </form>

      {q.isLoading && <p className="py-10 text-center text-zinc-600">A carregar…</p>}
      {q.isError && <p role="alert" className="py-10 text-center text-red-600">Ups, não consegui carregar 😅</p>}
      {q.isSuccess && people.length === 0 && (
        <div className="py-12 text-center text-zinc-600">
          <p className="text-4xl" aria-hidden>{term ? '🕵️' : kind === 'followers' ? '🌱' : '👀'}</p>
          <p className="mt-2 font-semibold">
            {term ? 'Ninguém com esse nome' : kind === 'followers' ? 'Ainda sem seguidores' : 'Ainda não segue ninguém'}
          </p>
        </div>
      )}
      <ul>
        {people.map((x) => (
          <li key={x.username} className="flex items-center gap-3 px-4 py-2.5">
            <Link to={x.username === meUsername ? '/profile' : `/u/${x.username}`} className="flex min-w-0 flex-1 items-center gap-3">
              <Avatar name={x.displayName} username={x.username} size={48} ring={false} />
              <span className="min-w-0">
                <span className="block truncate font-semibold">{x.displayName}</span>
                <span className="block truncate text-sm text-zinc-600">@{x.username}{x.followsYou && x.username !== meUsername ? ' · segue-te' : ''}</span>
              </span>
            </Link>
            {x.username !== meUsername && (
              <div className="w-28 shrink-0"><FollowButton username={x.username} following={x.following} requested={false} large /></div>
            )}
          </li>
        ))}
      </ul>
      {q.hasNextPage && (
        <button onClick={() => q.fetchNextPage()} disabled={q.isFetchingNextPage} className="mx-auto mt-2 block text-sm font-semibold text-zinc-600">
          {q.isFetchingNextPage ? 'A carregar…' : 'Ver mais'}
        </button>
      )}
    </div>
  );
}

/**
 * Seguidores e a seguir numa só página, como no Instagram: dois separadores que se alternam
 * tocando neles ou com um swipe para o lado, cada um com a sua pesquisa.
 */
export default function Connections() {
  const { username = '' } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const start: Kind = (useLocation().state as { tab?: Kind } | null)?.tab ?? 'followers';
  const [tab, setTab] = useState<Kind>(start);
  const pager = useRef<HTMLDivElement>(null);

  const profile = useQuery({ queryKey: ['profile', username], queryFn: () => api.profile(username), retry: false });
  const p = profile.data;

  // Abre já no separador pedido (sem animação).
  useEffect(() => {
    const el = pager.current;
    if (el && start === 'following') el.scrollTo({ left: el.clientWidth });
  }, [start, p?.canSeeConnections]);

  function go(next: Kind) {
    setTab(next);
    const el = pager.current;
    if (el) el.scrollTo({ left: next === 'followers' ? 0 : el.clientWidth, behavior: 'smooth' });
  }
  // O swipe actualiza o separador activo.
  function onScroll() {
    const el = pager.current;
    if (el) setTab(Math.round(el.scrollLeft / el.clientWidth) === 0 ? 'followers' : 'following');
  }

  const tabBtn = (kind: Kind, label: string, n?: number) => (
    <button
      role="tab"
      aria-selected={tab === kind}
      onClick={() => go(kind)}
      className={`relative min-h-12 flex-1 text-[15px] transition ${tab === kind ? 'font-bold text-zinc-900' : 'font-medium text-zinc-600'}`}
    >
      {n !== undefined ? `${n.toLocaleString('pt-PT')} ` : ''}{label}
      <span className={`absolute inset-x-6 bottom-0 h-[3px] rounded-full bg-zinc-900 transition-opacity ${tab === kind ? 'opacity-100' : 'opacity-0'}`} aria-hidden />
    </button>
  );

  return (
    <StackPage title={`@${username}`}>
      {profile.isError && (
        <div className="mx-6 mt-16 text-center">
          <p className="text-5xl">🕵️</p>
          <p className="mt-3 text-xl font-bold">Essa pessoa não existe</p>
          <button onClick={() => navigate(-1)} className="mt-6 underline">Voltar</button>
        </div>
      )}
      {p && !p.canSeeConnections && (
        <div className="mx-6 mt-16 text-center">
          <p className="text-5xl" aria-hidden>🔒</p>
          <p className="mt-3 text-xl font-extrabold">Estas listas são privadas</p>
          <p className="mt-1 text-zinc-600">{p.displayName} escolheu quem as pode ver.</p>
        </div>
      )}
      {p?.canSeeConnections && (
        <>
          <div role="tablist" aria-label="Seguidores e a seguir" className="sticky top-[57px] z-10 flex border-b border-zinc-100 bg-white">
            {tabBtn('followers', 'seguidores', p.counts.followers)}
            {tabBtn('following', 'a seguir', p.counts.following)}
          </div>
          <div ref={pager} onScroll={onScroll} className="flex h-[calc(100dvh-7.5rem)] snap-x snap-mandatory overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <section role="tabpanel" aria-label="Seguidores" className="h-full w-full shrink-0 snap-center">
              <ConnectionList username={username} kind="followers" meUsername={user!.username} />
            </section>
            <section role="tabpanel" aria-label="A seguir" className="h-full w-full shrink-0 snap-center">
              <ConnectionList username={username} kind="following" meUsername={user!.username} />
            </section>
          </div>
        </>
      )}
    </StackPage>
  );
}
