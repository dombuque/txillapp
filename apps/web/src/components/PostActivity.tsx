import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type PeopleKind, type Post } from '../lib/api';
import { tr } from '../lib/i18n';
import { LoadingBlock } from './Loading';
import { Avatar, timeAgo } from './ui';

type Tab = 'comments' | PeopleKind;

/**
 * Por baixo de uma publicação aberta: os comentários logo à vista (como no Facebook) e, em separadores, quem brindou, repostou ou presenteou
 * (só aparecem as listas que o dono deixa ver).
 */
export default function PostActivity({ post, onOpenComments }: { post: Post; onOpenComments: () => void }) {
  const tabs: { k: Tab; label: string; n: number }[] = [
    { k: 'comments', label: tr('Comentários'), n: post.comments },
    { k: 'cheers', label: tr('Brindes'), n: post.cheers },
    { k: 'reposts', label: tr('Reposts'), n: post.reposts },
    { k: 'gifts', label: tr('Presentes'), n: post.gifts },
  ].filter((t) => t.k === 'comments' || (t.n > 0 && !!post.lists?.[t.k as PeopleKind])) as { k: Tab; label: string; n: number }[];
  const [tab, setTab] = useState<Tab>('comments');
  const comments = useQuery({ queryKey: ['post-comments-preview', post.id], queryFn: () => api.comments(post.id), enabled: tab === 'comments', retry: false });
  const people = useQuery({ queryKey: ['post-people', post.id, tab], queryFn: () => api.postPeople(post.id, tab as PeopleKind), enabled: tab !== 'comments', retry: false });

  return (
    <section aria-label={tr('Atividade da publicação')} className="mx-2 mb-8 rounded-[26px] bg-white px-4 pb-4 pt-3 shadow-[0_2px_16px_rgba(0,0,0,0.09)]">
      <div role="tablist" className="flex gap-1 overflow-x-auto pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {tabs.map((t) => (
          <button key={t.k} type="button" role="tab" aria-selected={tab === t.k} onClick={() => setTab(t.k)} className={`h-10 shrink-0 rounded-full px-4 text-[14px] font-bold transition active:scale-95 ${tab === t.k ? 'bg-zinc-900 text-white' : 'bg-zinc-100 text-zinc-700'}`}>
            {t.label}{t.n > 0 ? ` · ${t.n}` : ''}
          </button>
        ))}
      </div>

      {tab === 'comments' ? (
        <>
          {comments.isLoading && <LoadingBlock className="py-4" />}
          {comments.isSuccess && comments.data.items.length === 0 && <p className="py-4 text-center text-zinc-500">{tr('Ainda sem comentários. Sê o primeiro!')}</p>}
          <ul className="divide-y divide-zinc-100">
            {comments.data?.items.filter((c) => !c.parentId).slice(0, 4).map((c) => (
              <li key={c.id} className="flex gap-3 py-3">
                <Link to={`/u/${c.author.username}`}><Avatar name={c.author.displayName} username={c.author.username} size={36} ring={false} /></Link>
                <div className="min-w-0 flex-1">
                  <p className="text-[14px] text-zinc-500"><Link to={`/u/${c.author.username}`} className="font-semibold text-zinc-800">{c.author.displayName}</Link> · {timeAgo(c.createdAt)}</p>
                  <p className="whitespace-pre-wrap break-words text-[16px] text-zinc-800">{c.body}</p>
                  {c.replyCount > 0 && <button type="button" onClick={onOpenComments} className="mt-0.5 text-[13px] font-semibold text-zinc-600">{c.replyCount} {c.replyCount === 1 ? tr('resposta') : tr('respostas')}</button>}
                </div>
              </li>
            ))}
          </ul>
          <button type="button" onClick={onOpenComments} className="mt-2 flex h-12 w-full items-center rounded-full bg-zinc-100 px-5 text-left text-[15px] text-zinc-500 active:bg-zinc-200">
            {post.comments > 4 ? tr('Ver os {n} comentários e comentar…', { n: post.comments }) : tr('Escreve um comentário…')}
          </button>
        </>
      ) : (
        <>
          {people.isLoading && <LoadingBlock className="py-4" />}
          {people.isError && <p role="alert" className="py-4 text-center text-zinc-600">{tr('Esta lista não está disponível')}</p>}
          {people.isSuccess && people.data.length === 0 && <p className="py-4 text-center text-zinc-500">{tr('Ainda ninguém.')}</p>}
          <ul>
            {people.data?.map((p) => (
              <li key={p.username}>
                <Link to={`/u/${p.username}`} className="flex items-center gap-3 rounded-xl py-2.5 active:bg-zinc-100">
                  <Avatar name={p.displayName} username={p.hasAvatar ? p.username : undefined} size={42} ring={false} presence />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{p.displayName}</span>
                    <span className="block truncate text-sm text-zinc-500">@{p.username}</span>
                  </span>
                  <span className="shrink-0 text-sm text-zinc-500">{timeAgo(p.at)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
