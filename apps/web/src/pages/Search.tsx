import Icon from '../components/Icon';
import { track } from '../lib/analytics';
import { sized } from '../lib/media';
import VerifiedBadge from '../components/VerifiedBadge';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import FollowButton from '../components/FollowButton';
import PostCard from '../components/PostCard';
import { SearchIcon } from '../components/icons';
import Suggestions from '../components/Suggestions';
import { Avatar, Sheet, timeAgo } from '../components/ui';
import { api, type Post } from '../lib/api';

const RECENT_KEY = 'txill.recent-searches';
const readRecent = (): string[] => {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
  } catch {
    return [];
  }
};

/** Pesquisa de pessoas (por @ ou nome) e publicações (texto ou local). Pesquisas recentes só ficam neste dispositivo. */
export default function Search() {
  const [params] = useSearchParams();
  const [text, setText] = useState(() => params.get('q')?.slice(0, 100) ?? '');
  const [term, setTerm] = useState('');
  const [tab, setTab] = useState<'people' | 'tags' | 'posts'>('people');
  const trending = useQuery({ queryKey: ['trending'], queryFn: api.trending, staleTime: 60_000 });
  const [recent, setRecent] = useState<string[]>(readRecent);
  const [open, setOpen] = useState<Post | null>(null);

  // Pausa de 300 ms depois de parar de escrever.
  useEffect(() => {
    const t = setTimeout(() => {
      setTerm(text.trim());
      if (text.trim().startsWith('#')) setTab('tags');
    }, 300);
    return () => clearTimeout(t);
  }, [text]);

  const q = useQuery({ queryKey: ['search', term], queryFn: () => api.search(term), enabled: term.length >= 2, staleTime: 30_000 });

  function remember(t: string) {
    track('search', { length: t.length, hashtag: t.startsWith('#') });
    const next = [t, ...recent.filter((r) => r !== t)].slice(0, 8);
    setRecent(next);
    try {
      localStorage.setItem(RECENT_KEY, JSON.stringify(next));
    } catch {
      /* sem armazenamento: não faz mal */
    }
  }
  function forget() {
    setRecent([]);
    try {
      localStorage.removeItem(RECENT_KEY);
    } catch {
      /* idem */
    }
  }

  const tags = q.data?.tags ?? [];
  const people = q.data?.people ?? [];
  const posts = q.data?.posts ?? [];
  const searching = term.length >= 2;

  return (
    <div className="pb-6">
      <form role="search" onSubmit={(e) => { e.preventDefault(); if (term.length >= 2) remember(term); }} className="px-4 pb-3 pt-2">
        <label className="flex items-center gap-2.5 rounded-full bg-zinc-100 px-4 py-3 text-zinc-600 focus-within:ring-2 focus-within:ring-brand">
          <SearchIcon width={20} height={20} />
          <input
            type="search"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Procura malta e publicações…"
            aria-label="Pesquisar"
            autoFocus
            enterKeyHint="search"
            autoCapitalize="none"
            autoCorrect="off"
            className="min-w-0 flex-1 bg-transparent text-base text-zinc-900 outline-none placeholder:text-zinc-500 [&::-webkit-search-cancel-button]:hidden"
          />
          {text && (
            <button type="button" onClick={() => setText('')} aria-label="Limpar pesquisa" className="flex h-8 w-8 items-center justify-center text-xl">×</button>
          )}
        </label>
      </form>

      {!searching && (
        <>
          {recent.length > 0 && (
            <section className="px-5 pb-4" aria-label="Pesquisas recentes">
              <div className="mb-2 flex items-center justify-between">
                <h2 className="font-bold">Recentes</h2>
                <button onClick={forget} className="text-sm font-semibold text-zinc-600 underline">Limpar</button>
              </div>
              <div className="flex flex-wrap gap-2">
                {recent.map((r) => (
                  <button key={r} onClick={() => setText(r)} className="rounded-full bg-zinc-100 px-3.5 py-2 text-sm font-medium text-zinc-800 active:scale-95">
                    <Icon name="clock" size={14} className="mr-1 inline align-[-2px]" />{r}
                  </button>
                ))}
              </div>
            </section>
          )}
          {(trending.data?.tags.length ?? 0) > 0 && (
            <section className="px-5 pb-4" aria-label="Em alta">
              <h2 className="mb-1 font-bold">Em alta</h2>
              <ol>
                {trending.data!.tags.map((t, i) => (
                  <li key={t.tag}>
                    <Link to={`/tag/${t.tag}`} className="flex items-center gap-3 rounded-xl py-2.5 active:bg-zinc-100">
                      <span className="w-6 text-center text-sm font-bold text-zinc-400">{i + 1}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[17px] font-bold">#{t.tag}</span>
                        <span className="block text-sm text-zinc-500">
                          {t.posts} {t.posts === 1 ? 'publicação' : 'publicações'} · {t.authors} {t.authors === 1 ? 'pessoa' : 'pessoas'}
                        </span>
                      </span>
                      {t.rising && <span className="rounded-full bg-orange-50 px-2.5 py-1 text-xs font-bold text-orange-700">A subir ↗</span>}
                    </Link>
                  </li>
                ))}
              </ol>
            </section>
          )}
          <Suggestions />
          <p className="px-6 pt-4 text-center text-zinc-500">Procura pessoas pelo @ ou nome, #hashtags, e publicações por texto ou local.</p>
        </>
      )}

      {searching && (
        <>
          <div role="tablist" aria-label="Resultados" className="mx-4 mb-2 flex gap-2">
            {([['people', `Pessoas${q.data ? ` (${people.length})` : ''}`], ['tags', `#Tags${q.data ? ` (${tags.length})` : ''}`], ['posts', `Publicações${q.data ? ` (${posts.length})` : ''}`]] as const).map(([k, label]) => (
              <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={`flex-1 rounded-full py-2.5 text-sm font-bold transition ${tab === k ? 'bg-zinc-900 text-white' : 'bg-zinc-100 text-zinc-700'}`}>
                {label}
              </button>
            ))}
          </div>

          {q.isLoading && <p className="py-10 text-center text-zinc-500">A procurar…</p>}
          {q.isError && <p role="alert" className="py-10 text-center text-red-600">Ups, a pesquisa falhou</p>}

          {q.isSuccess && tab === 'people' && (
            <ul className="px-4">
              {people.length === 0 && (
                <li className="py-10 text-center text-zinc-600">
                  <p className="text-zinc-300" aria-hidden><Icon name="search" size={36} className="mx-auto" /></p>
                  <p className="mt-2 font-semibold">Ninguém com esse nome</p>
                </li>
              )}
              {people.map((p) => (
                <li key={p.username} className="flex items-center gap-3 py-2.5">
                  <Link to={`/u/${p.username}`} onClick={() => remember(term)} className="flex min-w-0 flex-1 items-center gap-3">
                    <Avatar name={p.displayName} username={p.username} size={48} />
                    <span className="min-w-0">
                      <span className="block truncate font-semibold">{p.displayName} {p.verified && <VerifiedBadge size={15} />} {p.isPrivate && <Icon name="lock" size={14} className="inline align-[-2px] text-zinc-500" aria-hidden={false} role="img" aria-label="Conta privada" />}</span>
                      <span className="block truncate text-sm text-zinc-600">@{p.username}{p.followsYou ? ' · segue-te' : ''}</span>
                    </span>
                  </Link>
                  <div className="w-28 shrink-0">
                    <FollowButton username={p.username} following={p.following} requested={p.requested} isPrivate={p.isPrivate} />
                  </div>
                </li>
              ))}
            </ul>
          )}

          {q.isSuccess && tab === 'tags' && (
            <ul className="px-4">
              {tags.length === 0 && (
                <li className="py-10 text-center text-zinc-600">
                  <p className="text-zinc-300" aria-hidden><Icon name="tag" size={36} className="mx-auto" /></p>
                  <p className="mt-2 font-semibold">Nenhuma hashtag assim</p>
                </li>
              )}
              {tags.map((t) => (
                <li key={t.tag}>
                  <Link to={`/tag/${t.tag}`} onClick={() => remember(term)} className="flex items-center gap-3 rounded-xl py-2.5 active:bg-zinc-100">
                    <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-rose-50 text-xl font-bold text-brand" aria-hidden>#</span>
                    <span className="min-w-0">
                      <span className="block truncate text-[17px] font-bold">#{t.tag}</span>
                      <span className="block text-sm text-zinc-500">{t.posts} {t.posts === 1 ? 'publicação' : 'publicações'}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}

          {q.isSuccess && tab === 'posts' && (
            <ul className="px-4">
              {posts.length === 0 && (
                <li className="py-10 text-center text-zinc-600">
                  <p className="text-zinc-300" aria-hidden><Icon name="inbox" size={36} className="mx-auto" /></p>
                  <p className="mt-2 font-semibold">Nenhuma publicação encontrada</p>
                </li>
              )}
              {posts.map((p) => (
                <li key={p.id}>
                  <button onClick={() => { remember(term); setOpen(p); }} className="flex w-full items-center gap-3 rounded-2xl py-2.5 text-left active:bg-zinc-100">
                    {p.media[0] ? (
                      <img src={p.media[0].kind === 'video' ? p.media[0].posterUrl : sized(p.media[0].url, 160)} alt="" loading="lazy" decoding="async" className="h-16 w-16 shrink-0 rounded-xl object-cover" />
                    ) : (
                      <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl bg-rose-50" aria-hidden><Icon name="comment" size={24} className="inline align-[-3px]" /></span>
                    )}
                    <span className="min-w-0">
                      <span className="block truncate font-semibold">{p.author.displayName}</span>
                      <span className="line-clamp-2 break-words text-sm text-zinc-700">{p.body || (p.media.length ? 'Foto' : '')}</span>
                      <span className="text-xs text-zinc-500">{timeAgo(p.createdAt)}{p.locationLabel ? ` · ${p.locationLabel}` : ''}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {open && (
        <Sheet title={`Publicação de ${open.author.displayName}`} onClose={() => setOpen(null)}>
          <div className="-mx-6"><PostCard post={open} /></div>
        </Sheet>
      )}
    </div>
  );
}
