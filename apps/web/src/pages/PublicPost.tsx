import { useQuery } from '@tanstack/react-query';
import { tr } from '../lib/i18n';
import { Link, useLocation, useParams } from 'react-router-dom';
import { LoadingBlock } from '../components/Loading';
import Icon from '../components/Icon';
import VerifiedBadge from '../components/VerifiedBadge';
import { Avatar, Wordmark, timeAgo } from '../components/ui';

interface PublicPostData {
  code: string;
  kind: 'post' | 'reel';
  author: { username: string; displayName: string; hasAvatar: boolean; verified: boolean; verifiedTier: 'verified' | 'official' | 'paid' | null };
  body: string;
  locationLabel: string | null;
  createdAt: string;
  repostedBy: string | null;
  media: { kind: 'image' | 'video'; url: string; posterUrl: string | null; width: number | null; height: number | null }[];
  counts: { cheers: number; comments: number };
}

/**
 * O que vê quem abre um link de post ou reel sem ter entrado: a publicação em modo leitura (sem brindar, comentar ou partilhar)
 * e um convite para entrar ou criar conta. Depois de entrar volta a este mesmo link, já com tudo.
 */
export default function PublicPost() {
  const { postId = '' } = useParams();
  const here = useLocation();
  const q = useQuery({
    queryKey: ['public-post', postId],
    queryFn: async (): Promise<PublicPostData> => {
      const res = await fetch(`/api/v1/public/posts/${encodeURIComponent(postId)}`);
      if (!res.ok) throw new Error(res.status === 404 ? 'not-found' : 'error');
      return res.json();
    },
    retry: false,
  });
  const p = q.data;
  const state = { from: here.pathname + here.search };

  const locked = (label: string, icon: 'cheers' | 'comment' | 'share') => (
    <Link to="/login" state={state} aria-label={tr('{v0}: entra para poder', { v0: label })} className="flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-zinc-400">
      <Icon name={icon} size={24} />
      <span className="text-[12px] font-medium">{label}</span>
    </Link>
  );

  return (
    <div className="mx-auto min-h-dvh max-w-xl bg-canvas pb-44">
      <header className="flex items-center justify-between px-5 py-4">
        <Link to="/" aria-label={tr('Txillapp')}><Wordmark className="h-8" /></Link>
        <Link to="/login" state={state} className="rounded-full bg-white px-4 py-2 text-sm font-bold shadow-sm active:scale-95">{tr('Entrar')}</Link>
      </header>

      {q.isLoading && <LoadingBlock />}
      {q.isError && (
        <div className="mx-6 mt-16 text-center">
          <p className="text-xl font-extrabold">{tr('Esta publicação não está disponível')}</p>
          <p className="mt-2 text-zinc-600">{tr('Pode ter sido apagada ou ser de uma conta privada.')}</p>
          <Link to="/register" state={state} className="mt-6 inline-block rounded-full bg-brand px-8 py-3.5 font-semibold text-white active:scale-95">{tr('Criar conta')}</Link>
        </div>
      )}

      {p && (
        <article className="mx-3 mb-6 overflow-hidden rounded-[28px] bg-white pt-5 shadow-[0_2px_16px_rgba(0,0,0,0.09)] min-[360px]:mx-4">
          <header className="flex items-center gap-3 px-5">
            <Avatar name={p.author.displayName} username={p.author.hasAvatar ? p.author.username : undefined} size={48} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[18px] font-semibold leading-tight">
                {p.author.displayName} {p.author.verified && <VerifiedBadge size={16} tier={p.author.verifiedTier} />}
              </p>
              <p className="truncate text-[15px] text-zinc-500">{p.locationLabel ?? `@${p.author.username}`}</p>
            </div>
            <time className="self-start text-[14px] text-zinc-500" dateTime={p.createdAt}>{timeAgo(p.createdAt)}</time>
          </header>
          {p.repostedBy && <p className="mt-2 px-5 text-sm text-zinc-500">{tr('Repostado por')} {p.repostedBy}</p>}
          {p.body && <p className="mt-3 whitespace-pre-wrap break-words px-5 text-[17px] leading-snug">{p.body}</p>}
          {p.media.length > 0 && (
            <div className="mt-3 space-y-1">
              {p.media.map((m, i) =>
                m.kind === 'video' ? (
                  <video key={i} src={m.url} poster={m.posterUrl ?? undefined} controls playsInline preload="metadata" className="max-h-[70dvh] w-full bg-black" />
                ) : (
                  <img key={i} src={m.url} alt="" loading={i ? 'lazy' : 'eager'} className="w-full" />
                ),
              )}
            </div>
          )}
          <div className="flex items-center gap-4 px-5 pb-1 pt-3 text-[15px] text-zinc-600">
            {p.counts.cheers > 0 && <span className="flex items-center gap-1.5"><Icon name="cheers" size={18} /> {p.counts.cheers}</span>}
            {p.counts.comments > 0 && <span className="flex items-center gap-1.5"><Icon name="comment" size={18} /> {p.counts.comments}</span>}
          </div>
          <div className="mt-1 flex items-stretch border-t border-zinc-200 px-2">
            {locked('Brindar', 'cheers')}
            {locked('Comentar', 'comment')}
            {locked('Partilhar', 'share')}
          </div>
        </article>
      )}

      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-zinc-200 bg-white/95 px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4 backdrop-blur">
        <div className="mx-auto max-w-xl text-center">
          <p className="font-extrabold">{tr('Junta-te à malta no Txillapp')}</p>
          <p className="mt-0.5 text-sm text-zinc-600">{tr('Cria conta para brindar, comentar e partilhar.')}</p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Link to="/login" state={state} className="flex h-12 items-center justify-center rounded-full bg-zinc-100 font-bold text-zinc-800 active:scale-[0.98]">{tr('Entrar')}</Link>
            <Link to="/register" state={state} className="flex h-12 items-center justify-center rounded-full bg-brand font-bold text-white active:scale-[0.98]">{tr('Criar conta')}</Link>
          </div>
        </div>
      </div>
    </div>
  );
}
