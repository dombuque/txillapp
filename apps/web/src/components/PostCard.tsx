import { createPortal } from 'react-dom';
import { tr, locale } from '../lib/i18n';
import { useOnline } from '../lib/presence';
import ShareSheet from './ShareSheet';
import TrackCard from './TrackCard';
import VideoPlayer from './VideoPlayer';
import { track } from '../lib/analytics';
import { postLink } from '../lib/share';
import { sized, srcSet } from '../lib/media';
import VerifiedBadge from './VerifiedBadge';
import MentionTextarea from './MentionTextarea';
import Icon from './Icon';
import ReportSheet from './ReportSheet';
import PeopleSheet from './PeopleSheet';
import TaggedImage from './TaggedImage';
import RichText from './RichText';
import { useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, type Page, type Post, type PeopleKind } from '../lib/api';
import { useAuth } from '../lib/auth';
import CommentsSheet from './CommentsSheet';
import GiftSheet from './GiftSheet';
import { CommentIcon, GiftIcon, PencilIcon, RepostIcon, UndoIcon } from './icons';
import { Avatar, Sheet, btnGhost, btnPrimary, fieldInput, timeAgo } from './ui';

type Feed = InfiniteData<Page<Post>>;

/** O meu perfil vive em /profile; os outros em /u/:username. */
export const profilePath = (username: string, me?: string) => (username === me ? '/profile' : `/u/${username}`);

/** Toque simples ou duplo: o duplo chama `double`; o simples só corre (com um pequeno atraso) se não vier segundo toque. */
function useTap(double?: () => void) {
  const t = useRef<number | null>(null);
  return (single?: () => void) => {
    if (!double) return single?.();
    if (t.current != null) {
      window.clearTimeout(t.current);
      t.current = null;
      double();
      return;
    }
    t.current = window.setTimeout(() => {
      t.current = null;
      single?.();
    }, 260);
  };
}

/** Carrossel de fotos: deslizar na horizontal, com contador e pontos como no Instagram. */
function Carousel({ media, onOpen, reelId, onDouble }: { media: Post['media']; onOpen: (index: number) => void; reelId?: string; onDouble?: () => void }) {
  const navigate = useNavigate();
  const tap = useTap(onDouble);
  // Tocar num vídeo do feed abre os Reels já nesse vídeo (e a pessoa fica no Reels).
  const onOpenReel = reelId ? () => tap(() => navigate(`/reels?start=${reelId}`)) : undefined;
  const [i, setI] = useState(0);
  const [showTags, setShowTags] = useState(false);
  if (media.length === 0) return null;
  const tags = media[i]?.tags ?? [];
  return (
    <div className="mt-3">
      <div className="relative">
      <div
        onScroll={(e) => setI(Math.round(e.currentTarget.scrollLeft / e.currentTarget.clientWidth))}
        className="flex snap-x snap-mandatory overflow-x-auto rounded-xl [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {media.map((m, n) => (m.kind === 'video' ? (
          // Vídeo: toca sozinho quando está à vista, sem som; o botão do canto liga o som.
          <div key={m.url} className="block w-full shrink-0 snap-center">
            <VideoPlayer src={m.url} poster={m.posterUrl} durationMs={m.durationMs} width={m.width} height={m.height} className="w-full" onOpen={onOpenReel} />
          </div>
        ) : (
          // Tocar na foto abre-a inteira, em ecrã completo (como no X).
          <button key={m.url} onClick={() => tap(() => onOpen(n))} aria-label={tr('Ver a foto {v0} de {v1} em ecrã inteiro', { v0: n + 1, v1: media.length })} className="block w-full shrink-0 snap-center">
            <img src={sized(m.url, 720)} srcSet={srcSet(m.url)} sizes="(min-width: 640px) 576px, 100vw" alt={tr('Foto {v0} de {v1}', { v0: n + 1, v1: media.length })} loading={n === 0 ? 'eager' : 'lazy'} decoding="async" className="max-h-[28rem] w-full object-cover" />
          </button>
        )))}
      </div>
      {tags.length > 0 && (
        <>
          <button onClick={() => setShowTags((v) => !v)} aria-label={tr('{v0} pessoa(s) identificadas', { v0: tags.length })} aria-expanded={showTags} className="absolute bottom-3 left-3 flex h-8 items-center gap-1 rounded-full bg-black/60 px-2.5 text-sm font-semibold text-white backdrop-blur-sm active:scale-95">
            <Icon name="users" size={16} /> {tags.length}
          </button>
          {showTags && (
            <div className="absolute bottom-14 left-3 right-3 flex flex-wrap gap-1.5">
              {tags.map((t) => (
                <Link key={t.username} to={`/u/${t.username}`} className="rounded-full bg-black/75 px-3 py-1 text-sm font-semibold text-white">@{t.username}</Link>
              ))}
            </div>
          )}
        </>
      )}
      {media.length > 1 && (
        <>
          <span className="absolute right-3 top-3 rounded-full bg-black/60 px-2.5 py-1 text-xs font-semibold text-white">
            {i + 1}/{media.length}
          </span>
        </>
      )}
      </div>
      {media.length > 1 && (
        <div className="mt-2 flex justify-center gap-1.5" aria-hidden>
          {media.map((_, n) => (
            <span key={n} className={`h-1.5 w-1.5 rounded-full ${n === i ? 'bg-brand' : 'bg-zinc-300'}`} />
          ))}
        </div>
      )}
    </div>
  );
}

/** Atualiza a publicação em todas as listas em cache (feed, perfis), incluindo quando aparece dentro de um repost. */
/** Marcador: guardar a publicação (privado). Cheio quando está guardada. */
function BookmarkIcon({ on, size = 22 }: { on: boolean; size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill={on ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M6.5 4.5h11a1 1 0 0 1 1 1V20l-6.5-4.2L5.5 20V5.5a1 1 0 0 1 1-1z" />
    </svg>
  );
}

function SaveButton({ post }: { post: Post }) {
  const patch = usePatch(post.id);
  const [note, setNote] = useState('');
  async function toggle() {
    const next = !post.saved;
    patch({ saved: next }); // otimista
    try {
      await (next ? api.savePost(post.id) : api.unsavePost(post.id));
      setNote(next ? tr('Guardada') : '');
      if (next) setTimeout(() => setNote(''), 1500);
    } catch {
      patch({ saved: !next });
    }
  }
  return (
    <button type="button" onClick={toggle} aria-pressed={!!post.saved} aria-label={post.saved ? tr('Tirar dos guardados') : tr('Guardar')} className={`relative flex h-10 w-9 shrink-0 items-center justify-center self-start rounded-full transition active:scale-90 ${post.saved ? 'text-zinc-900' : 'text-zinc-700'}`}>
      <BookmarkIcon on={!!post.saved} size={24} />
      {note && <span role="status" className="pointer-events-none absolute -bottom-6 right-0 z-10 whitespace-nowrap rounded-full bg-zinc-900 px-2.5 py-0.5 text-[11px] font-bold text-white">{note}</span>}
    </button>
  );
}

function usePatch(id: string) {
  const qc = useQueryClient();
  return (p: Partial<Post>) => {
    const merge = (i: Post): Post =>
      i.id === id ? { ...i, ...p } : i.repostOf?.id === id ? { ...i, repostOf: { ...i.repostOf, ...p } } : i;
    for (const key of ['feed', 'profile-posts', 'explore', 'place', 'tag']) {
      qc.setQueriesData<Feed>({ queryKey: [key] }, (d) => d && { ...d, pages: d.pages.map((pg) => ({ ...pg, items: pg.items.map(merge) })) });
    }
    qc.setQueriesData<Page<Post>>({ queryKey: ['explore-reels'] }, (d) => d && { ...d, items: d.items.map(merge) });
    qc.setQueriesData<Post>({ queryKey: ['post'] }, (d) => (d && typeof d === 'object' && 'id' in d ? merge(d) : d));
    qc.setQueriesData<{ pages: { items: Post[] }[] }>({ queryKey: ['saved'] }, (d) => d && { ...d, pages: d.pages.map((pg) => ({ ...pg, items: pg.items.map(merge) })) });
  };
}

export default function PostCard({ post }: { post: Post }) {
  const { user } = useAuth();
  if (post.kind === 'repost' && post.repostOf) {
    if (!post.body) {
      // Repost simples: faixa "X repostou" sobre a publicação original.
      return (
        <div>
          <p className="mx-6 mb-1.5 flex items-center gap-1.5 text-sm font-medium text-zinc-600">
            <RepostIcon width={16} height={16} />
            <Link to={profilePath(post.author.username, user?.username)} className="font-semibold">
              {post.author.id === user?.id ? tr('Repostaste') : `${post.author.displayName} repostou`}
            </Link>
          </p>
          <PostCard post={post.repostOf} />
        </div>
      );
    }
    return <QuoteCard post={post} original={post.repostOf} />;
  }
  return <PostBody post={post} />;
}

/** Bolinha verde de "online" no canto do avatar (só aparece se a pessoa estiver online e deixar ver). */
export function OnlineDot({ username, className = '' }: { username: string; className?: string }) {
  const on = useOnline(username);
  if (!on) return null;
  return <span role="img" aria-label={tr('Online')} className={`absolute bottom-0 right-0 h-3.5 w-3.5 rounded-full border-2 border-white bg-emerald-500 ${className}`} />;
}

/**
 * O cartão de um presente: as duas fotos cruzadas ao centro com o símbolo do presente, "X presenteou Y", o valor em Txills
 * e a mensagem num balão, tudo num bilhete a degradê. Em cima, só a hora e o menu.
 */
function GiftBlock({ post, g, me }: { post: Post; g: NonNullable<Post['gift']>; me?: string }) {
  const sender = post.author;
  return (
    <>
      <div className="flex items-center justify-between gap-2 text-[14px] text-zinc-500">
        <span className="flex items-center gap-1.5 font-semibold text-brand"><Icon name="gift" size={15} /> {tr('Presente')}</span>
        <span className="flex items-center gap-1">
          <time dateTime={post.createdAt}>{timeAgo(post.createdAt)}{post.editedAt ? ` · ${tr('editado')}` : ''}</time>
          <PostMenu post={post} />
        </span>
      </div>
      <div className="relative isolate mt-2 overflow-hidden rounded-3xl bg-gradient-to-br from-brand via-[#e8475f] to-[#ff8a5b] px-5 pb-5 pt-6 text-center text-white shadow-[0_6px_18px_rgba(214,51,79,0.35)]">
        <span aria-hidden className="pointer-events-none absolute -left-6 -top-6 h-24 w-24 rounded-full bg-white/10" />
        <span aria-hidden className="pointer-events-none absolute -bottom-8 -right-4 h-28 w-28 rounded-full bg-white/10" />
        <span aria-hidden className="pointer-events-none absolute right-8 top-4 h-2 w-2 rounded-full bg-white/50" />
        <span aria-hidden className="pointer-events-none absolute left-10 top-16 h-1.5 w-1.5 rounded-full bg-white/40" />
        <div className="relative mx-auto h-[76px] w-[132px]">
          <Link to={profilePath(g.recipient.username, me)} aria-label={tr('Perfil de {v0}', { v0: g.recipient.displayName })} className="absolute right-0 top-0 rounded-full ring-4 ring-white/90">
            <Avatar name={g.recipient.displayName} username={g.recipient.hasAvatar ? g.recipient.username : undefined} size={68} ring={false} />
          </Link>
          <Link to={profilePath(sender.username, me)} aria-label={tr('Perfil de {v0}', { v0: sender.displayName })} className="absolute left-0 top-0 z-10 rounded-full ring-4 ring-white/90">
            <Avatar name={sender.displayName} username={sender.username} size={68} ring={false} />
            <OnlineDot username={sender.username} />
          </Link>
          <span aria-hidden className="absolute -bottom-1 left-1/2 z-20 flex h-9 w-9 -translate-x-1/2 items-center justify-center rounded-full bg-white text-brand shadow-md"><Icon name="gift" size={20} /></span>
        </div>
        <p className="mt-4 text-[16px] leading-tight">
          <Link to={profilePath(sender.username, me)} className="font-extrabold">{sender.displayName}</Link>
          {sender.verified && <> <VerifiedBadge size={15} tier={sender.verifiedTier} /></>} {tr('presenteou')}{' '}
          <Link to={profilePath(g.recipient.username, me)} className="font-extrabold">{g.recipient.displayName}</Link>
          {g.recipient.verified && <> <VerifiedBadge size={15} tier={g.recipient.verifiedTier} /></>}
        </p>
        <p className="mt-2 text-[40px] font-black leading-none tracking-tight">{g.amount.toLocaleString(locale)}</p>
        <p className="text-[13px] font-bold uppercase tracking-[0.2em] text-white/85">{tr('Txills')}</p>
        {post.body && (
          <p className="relative mx-auto mt-4 max-w-[92%] break-words rounded-2xl bg-white/20 px-4 py-2.5 text-[16px] leading-snug backdrop-blur-sm">
            <span aria-hidden className="absolute -top-1.5 left-1/2 h-3 w-3 -translate-x-1/2 rotate-45 bg-white/20" />
            <RichText text={post.body} />
          </p>
        )}
      </div>
      {post.repostOf && <GiftedPost original={post.repostOf} me={me} />}
    </>
  );
}

/** A publicação que foi presenteada, dentro do cartão do presente (toca para a abrir). */
function GiftedPost({ original, me }: { original: Post; me?: string }) {
  const m = original.media[0];
  const video = m?.kind === 'video';
  const thumb = m ? (video ? m.posterUrl : sized(m.url, 480)) : null;
  return (
    <Link to={video ? `/r/${original.code ?? original.id}` : `/p/${original.code ?? original.id}`} className="mt-3 block overflow-hidden rounded-2xl border border-zinc-200 active:bg-zinc-50">
      <span className="flex items-center gap-2.5 px-3 pt-3">
        <Avatar name={original.author.displayName} username={original.author.username} size={30} ring={false} />
        <span className="min-w-0 truncate font-semibold">{original.author.displayName}</span>
        <span className="shrink-0 text-sm text-zinc-500">· {timeAgo(original.createdAt)}</span>
      </span>
      {original.body && <span className="line-clamp-3 block whitespace-pre-wrap break-words px-3 pt-2 text-[16px] text-zinc-800">{original.body}</span>}
      {thumb ? (
        <span className="relative mt-2 block h-56 w-full bg-zinc-200">
          <img src={thumb} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />
          {video && <span className="absolute inset-0 flex items-center justify-center"><span className="flex h-12 w-12 items-center justify-center rounded-full bg-black/50 text-white"><Icon name="play" size={24} fill="currentColor" /></span></span>}
        </span>
      ) : <span className="block h-3" />}
    </Link>
  );
}

/** Duplo toque: brinda (só põe, nunca tira) e dá o sinal para a animação do copo. */
function useBrindar(post: Post) {
  const [burst, setBurst] = useState(0);
  const patch = usePatch(post.id);
  async function brindar() {
    setBurst((n) => n + 1);
    navigator.vibrate?.(8);
    if (post.cheered) return;
    track('cheer', { on: true, source: post.feed?.source ?? 'other' });
    patch({ cheered: true, cheers: post.cheers + 1 });
    try {
      patch(await api.cheer(post.id));
    } catch {
      patch({ cheered: post.cheered, cheers: post.cheers });
    }
  }
  return { burst, brindar };
}

const BurstCup = ({ n }: { n: number }) => n > 0 ? <span key={n} aria-hidden className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center text-brand opacity-0 animate-[burst_.8s_ease-out_forwards]"><Icon name="cheers" size={96} strokeWidth={1.6} className="drop-shadow-[0_4px_14px_rgba(0,0,0,0.35)]" /></span> : null;

/** Cartão normal de uma publicação. */
function PostBody({ post }: { post: Post }) {
  const { user } = useAuth();
  const [viewer, setViewer] = useState<number | null>(null);
  const g = post.gift;
  const { burst, brindar } = useBrindar(post);
  const tapText = useTap(brindar);
  return (
    <article className="relative mx-1.5 mb-5 rounded-[26px] bg-white px-3.5 pt-4 min-[360px]:mx-2 min-[360px]:px-4 shadow-[0_2px_16px_rgba(0,0,0,0.09)]">
      {g ? <GiftBlock post={post} g={g} me={user?.username} /> : (
        <>
      <header className="flex items-center gap-3">
        {(
          <Link to={profilePath(post.author.username, user?.username)} aria-label={tr('Perfil de {v0}', { v0: post.author.displayName })} className="relative shrink-0">
            <Avatar name={post.author.displayName} username={post.author.username} size={52} />
            <OnlineDot username={post.author.username} />
          </Link>
        )}
        <div className="min-w-0 flex-1">
            <Link to={profilePath(post.author.username, user?.username)} className="block truncate text-[19px] font-medium leading-tight text-zinc-800">
              {post.author.displayName}
              {post.author.verified && <> <VerifiedBadge tier={post.author.verifiedTier} /></>}
            </Link>
          {post.locationLabel ? (
            <Link to={`/place/${encodeURIComponent(post.locationLabel)}`} className="flex items-center gap-1 truncate text-[15px] text-zinc-600 active:text-zinc-900"><Icon name="map-pin" size={14} className="shrink-0" /><span className="truncate">{post.locationLabel}</span></Link>
          ) : (
            <p className="truncate text-[15px] text-zinc-500">@{post.author.username}</p>
          )}
        </div>
        <time className="self-start text-[15px] text-zinc-500" dateTime={post.createdAt}>
          {timeAgo(post.createdAt)}{post.editedAt ? ` · ${tr('editado')}` : ''}
        </time>
        <SaveButton post={post} />
        <PostMenu post={post} />
      </header>
      {post.body && <p onClick={(e) => { if (!(e.target as HTMLElement).closest('a')) tapText(); }} className="mt-4 whitespace-pre-wrap break-words text-[19px] text-zinc-800"><RichText text={post.body} /></p>}
        </>
      )}
      {post.music && <TrackCard track={post.music} autoplay />}
      <Carousel media={post.media} onOpen={setViewer} reelId={post.id} onDouble={brindar} />
      <Actions post={post} />
      <BurstCup n={burst} />
      {viewer !== null && <ImageViewer post={post} start={viewer} onClose={() => setViewer(null)} />}
    </article>
  );
}

/** Repost com comentário: o texto de quem reposta e, por baixo, a publicação original numa caixa. */
function QuoteCard({ post, original }: { post: Post; original: Post }) {
  const { user } = useAuth();
  const [viewer, setViewer] = useState<number | null>(null);
  const { burst, brindar } = useBrindar(post);
  const tapText = useTap(brindar);
  return (
    <article className="relative mx-2 mb-5 rounded-[26px] bg-white px-4 pt-4 shadow-[0_2px_16px_rgba(0,0,0,0.09)]">
      <header className="flex items-center gap-3">
        <Link to={profilePath(post.author.username, user?.username)} aria-label={tr('Perfil de {v0}', { v0: post.author.displayName })}>
          <Avatar name={post.author.displayName} username={post.author.username} size={52} />
        </Link>
        <div className="min-w-0 flex-1">
          <Link to={profilePath(post.author.username, user?.username)} className="block truncate text-[19px] font-medium leading-tight text-zinc-800">
            {post.author.displayName}
          </Link>
          <p className="flex items-center gap-1 truncate text-[15px] text-zinc-500"><RepostIcon width={14} height={14} /> {tr('repostou')}</p>
        </div>
        <time className="self-start text-[15px] text-zinc-500" dateTime={post.createdAt}>{timeAgo(post.createdAt)}{post.editedAt ? ` · ${tr('editado')}` : ''}</time>
        <PostMenu post={post} />
      </header>
      <p onClick={(e) => { if (!(e.target as HTMLElement).closest('a')) tapText(); }} className="mt-4 whitespace-pre-wrap break-words text-[19px] text-zinc-800"><RichText text={post.body} /></p>
      <div className="mt-3 overflow-hidden rounded-2xl border border-zinc-200">
        <div className="flex items-center gap-2.5 px-3 pt-3">
          <Link to={profilePath(original.author.username, user?.username)} className="flex min-w-0 items-center gap-2.5">
            <Avatar name={original.author.displayName} username={original.author.username} size={30} ring={false} />
            <span className="truncate font-semibold">{original.author.displayName}{original.author.verified && <> <VerifiedBadge size={14} tier={original.author.verifiedTier} /></>}</span>
          </Link>
          <span className="shrink-0 text-sm text-zinc-500">· {timeAgo(original.createdAt)}</span>
        </div>
        {original.gift && <p className="mx-3 mt-2 rounded-xl bg-gradient-to-r from-brand to-brand-light py-2 text-center text-lg font-extrabold text-white"><Icon name="gift" size={14} className="inline align-[-2px]" /> {original.gift.amount.toLocaleString(locale)} {tr('Txills')}</p>}
        {original.body && <p className="line-clamp-4 whitespace-pre-wrap break-words px-3 pt-2 text-[16px] text-zinc-800">{original.body}</p>}
        {original.media[0]?.kind === 'video' ? (
          <Link to={`/r/${original.code ?? original.id}`} aria-label={tr('Ver o vídeo')} className="relative mt-2 block h-64 w-full bg-zinc-900">
            {original.media[0].posterUrl && <img src={original.media[0].posterUrl} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />}
            <span className="absolute inset-0 flex items-center justify-center"><span className="flex h-14 w-14 items-center justify-center rounded-full bg-black/50 text-white"><Icon name="play" size={28} fill="currentColor" /></span></span>
          </Link>
        ) : original.media[0] ? (
          <button onClick={() => tapText(() => setViewer(0))} aria-label={tr('Ver a foto em ecrã inteiro')} className="mt-2 block w-full">
            <img src={sized(original.media[0].url, 720)} alt="" loading="lazy" decoding="async" className="max-h-72 w-full object-cover" />
          </button>
        ) : (
          <div className="h-3" />
        )}
      </div>
      <Actions post={post} />
      <BurstCup n={burst} />
      {viewer !== null && <ImageViewer post={original} start={viewer} onClose={() => setViewer(null)} />}
    </article>
  );
}

/** Barra de ações: só ícones com contador, como nas redes sociais. */
function Actions({ post, dark = false, layer }: { post: Post; dark?: boolean; layer?: string }) {
  const { user } = useAuth();
  const patch = usePatch(post.id);
  const [sheet, setSheet] = useState<'comments' | 'gift' | 'repost' | 'share' | null>(null);
  const [people, setPeople] = useState<PeopleKind | null>(null);
  const mine = post.author.id === user?.id;

  async function cheer() {
    track('cheer', { on: !post.cheered, source: post.feed?.source ?? 'other' });
    patch({ cheered: !post.cheered, cheers: post.cheers + (post.cheered ? -1 : 1) }); // optimista
    try {
      patch(await api.cheer(post.id));
    } catch {
      patch({ cheered: post.cheered, cheers: post.cheers });
    }
  }

  const btn = `flex min-h-12 min-w-0 items-center justify-center gap-1.5 px-1 transition active:scale-95 min-[360px]:px-2 ${dark ? 'text-white' : 'text-zinc-800'}`;
  const count = (n: number) => (n > 0 ? <span className="text-[15px] tabular-nums">{n}</span> : null);
  const Item = ({ label, children, onClick, pressed, className = 'flex-1', tone = 'beer' }: { label: string; children: ReactNode; onClick: () => void; pressed?: boolean; className?: string; tone?: 'beer' | 'green' }) => (
    <button onClick={onClick} aria-label={label} aria-pressed={pressed} className={`${btn} ${className} ${pressed ? (tone === 'green' ? (dark ? '!text-green-400' : '!text-green-700') : dark ? '!text-amber-400' : '!text-amber-600') : ''}`}>
      {children}
    </button>
  );

  // Linha "quem": só aparece se o dono deixar este espectador ver a lista e houver alguém.
  const rows: { kind: PeopleKind; n: number; label: string }[] = [
    { kind: 'cheers', n: post.cheers, label: post.cheers === 1 ? 'brinde' : 'brindes' },
    { kind: 'reposts', n: post.reposts, label: post.reposts === 1 ? 'repost' : 'reposts' },
    { kind: 'gifts', n: post.gifts, label: post.gifts === 1 ? 'presente' : 'presentes' },
  ];
  const shown = rows.filter((r) => r.n > 0 && post.lists?.[r.kind] && (post.kind !== 'repost' || r.kind === 'cheers'));

  // Vão para o topo da página: dentro de um cartão aberto numa folha ou no visualizador (que têm transformações) ficariam presas e escondidas.
  const top = layer ?? 'z-[80]';
  const sheets = createPortal(
    <>
      {people && <PeopleSheet postId={post.id} kind={people} layer={top} onClose={() => setPeople(null)} />}
      {sheet === 'comments' && <CommentsSheet post={post} layer={top} onClose={() => setSheet(null)} onDelta={(d) => patch({ comments: Math.max(0, post.comments + d) })} />}
      {sheet === 'gift' && <GiftSheet postId={post.id} recipient={post.author} layer={top} onClose={() => setSheet(null)} />}
      {sheet === 'share' && <ShareSheet post={post} layer={top} onClose={() => setSheet(null)} />}
      {sheet === 'repost' && <RepostSheet post={post} layer={top} onChange={patch} onClose={() => setSheet(null)} />}
    </>,
    document.body,
  );

  // Cartão normal: contadores em cima (brindes, reposts, presentes · comentários) e, por baixo da linha, três ações com texto.
  if (!dark) {
    const chips: { kind: PeopleKind; n: number; icon: 'cheers' | 'repeat' | 'present'; label: string }[] = [
      { kind: 'cheers', n: post.cheers, icon: 'cheers', label: rows[0].label },
      { kind: 'reposts', n: post.reposts, icon: 'repeat', label: rows[1].label },
      { kind: 'gifts', n: post.gifts, icon: 'present', label: rows[2].label },
    ];
    const canSee = (k: PeopleKind) => (post.kind !== 'repost' || k === 'cheers') && !!post.lists?.[k];
    // Quatro colunas iguais, ícone em cima e nome por baixo: o texto nunca sai do cartão, em qualquer largura.
    const barBtn = 'flex min-h-14 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 px-0.5 text-zinc-800 transition active:scale-95 [&>svg]:shrink-0';
    const word = 'block max-w-full truncate text-[12px] font-medium leading-tight min-[400px]:text-[13px]';
    return (
      <>
        <div className="mt-3 flex min-h-8 items-center justify-between gap-3 text-[15px] text-zinc-700">
          <div className="flex min-w-0 flex-wrap items-center gap-x-4">
            {chips.filter((c) => c.n > 0).map((c) => {
              const inner = (<><Icon name={c.icon} size={18} /> <span className="tabular-nums">{c.n}</span></>);
              return canSee(c.kind) ? (
                <button key={c.kind} onClick={() => setPeople(c.kind)} aria-label={tr('{v0} {v1}: ver quem', { v0: c.n, v1: c.label })} className="flex min-h-8 items-center gap-1.5 active:opacity-60">{inner}</button>
              ) : (
                <span key={c.kind} role="img" aria-label={`${c.n} ${c.label}`} className="flex min-h-8 items-center gap-1.5">{inner}</span>
              );
            })}
          </div>
          {post.comments > 0 && (
            <button onClick={() => setSheet('comments')} className="shrink-0 text-[14px] font-medium text-zinc-700 active:opacity-60">
              {post.comments} {post.comments === 1 ? tr('Comentário') : tr('Comentários')}
            </button>
          )}
        </div>
        <div className="mt-1 flex items-stretch border-t border-zinc-200">
          <button onClick={cheer} aria-pressed={post.cheered} aria-label={post.cheered ? 'Tirar o brinde' : 'Brindar'} className={`${barBtn} ${post.cheered ? '!text-amber-600' : ''}`}>
            <span key={String(post.cheered)} className={`inline-flex ${post.cheered ? 'animate-[pop_.4s_ease-out]' : ''}`}><Icon name="cheers" size={24} /></span>
            <span className={word}>{post.cheered ? tr('Brindou') : tr('Brindar')}</span>
          </button>
          <button onClick={() => setSheet('comments')} aria-label={tr('Comentar ({v0})', { v0: post.comments })} className={barBtn}>
            <CommentIcon /> <span className={word}>{tr('Comentar')}</span>
          </button>
          <button
            onClick={() => setSheet('repost')}
            aria-label={post.reposted ? `Repost feito (${post.reposts})` : `Repostar (${post.reposts})`}
            aria-pressed={post.reposted}
            className={`${barBtn} ${post.reposted ? '!text-green-700' : ''}`}
          >
            <RepostIcon /> <span className={word}>{post.reposted ? tr('Repostado') : tr('Repostar')}</span>
          </button>
          {!mine && post.canGift && (
            <button onClick={() => setSheet('gift')} aria-label={tr('Presentear ({v0})', { v0: post.gifts })} className={barBtn}>
              <GiftIcon /> <span className={word}>{tr('Presentear')}</span>
            </button>
          )}
          <button onClick={() => setSheet('share')} aria-label={tr('Partilhar')} className={barBtn}>
            <Icon name="share" size={24} /> <span className={word}>{tr('Partilhar')}</span>
          </button>
        </div>
        {sheets}
      </>
    );
  }

  return (
    <>
      {shown.length > 0 && (
        <div className={`mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm ${dark ? 'text-zinc-300' : 'text-zinc-600'}`}>
          {shown.map((r) => (
            <button key={r.kind} onClick={() => setPeople(r.kind)} className="min-h-8 underline-offset-2 active:underline">
              <b className={dark ? 'text-white' : 'text-zinc-900'}>{r.n}</b> {r.label}
            </button>
          ))}
        </div>
      )}
      {post.comments > 0 && (
        <button onClick={() => setSheet('comments')} className={`${shown.length ? '' : 'mt-3'} block min-h-8 text-sm ${dark ? 'text-zinc-300' : 'text-zinc-500'}`}>
          {tr('Ver')} {post.comments === 1 ? tr('o comentário') : `todos os ${post.comments} comentários`}
        </button>
      )}
      <div className={`flex items-center border-t ${dark ? 'border-white/20' : shown.length || post.comments > 0 ? 'mt-1 border-zinc-200' : 'mt-3 border-zinc-200'}`}>
        <Item label={post.cheered ? 'Tirar o brinde' : 'Brindar'} onClick={cheer} pressed={post.cheered} className="flex-[1.6] justify-start">
          <span key={String(post.cheered)} className={`inline-flex ${post.cheered ? 'animate-[pop_.4s_ease-out]' : ''}`}><Icon name="cheers" size={26} /></span>
          <span className="hidden text-[16px] font-medium min-[380px]:inline">{post.cheered ? tr('Brindou') : tr('Brindar')}</span>
          {count(post.cheers)}
        </Item>
        <Item label={tr('Comentários ({v0})', { v0: post.comments })} onClick={() => setSheet('comments')}>
          <CommentIcon />
          {count(post.comments)}
        </Item>
        {(post.kind === 'post' || post.kind === 'gift' || (post.kind === 'repost' && !!post.body)) && (
          <Item label={post.reposted ? tr('Reposte feito ({n})', { n: post.reposts }) : tr('Repostar ({n})', { n: post.reposts })} onClick={() => setSheet('repost')} tone="green" pressed={post.reposted}>
            <RepostIcon />
            {count(post.reposts)}
          </Item>
        )}
        {!mine && post.canGift ? (
          <Item label={tr('Presentear ({v0})', { v0: post.gifts })} onClick={() => setSheet('gift')}>
            <GiftIcon />
            {count(post.gifts)}
          </Item>
        ) : (
          // Sem seguir (ou nas próprias publicações) não há botão: só o número de presentes.
          post.gifts > 0 && (
            <span role="img" aria-label={`${post.gifts} ${post.gifts === 1 ? 'presente' : 'presentes'}`} className={`flex min-h-12 flex-1 items-center justify-center gap-1.5 px-2 ${dark ? 'text-zinc-300' : 'text-zinc-600'}`}>
              <GiftIcon />
              {count(post.gifts)}
            </span>
          )
        )}
        <Item label={tr('Partilhar')} onClick={() => setSheet('share')}>
          <Icon name="share" size={26} />
        </Item>
      </div>
      {sheets}
    </>
  );
}

/**
 * Foto inteira em ecrã completo, como no X: fundo preto, deslizar entre as fotos, fechar com o X, com Esc
 * ou arrastando para baixo; por baixo a mesma barra de ações (brindar, comentar, repostar, presentear).
 */
function ImageViewer({ post, start, onClose }: { post: Post; start: number; onClose: () => void }) {
  const pager = useRef<HTMLDivElement>(null);
  const [i, setI] = useState(start);
  const [drag, setDrag] = useState(0);
  const startY = useRef<number | null>(null);
  const n = post.media.length;

  useEffect(() => {
    const el = pager.current;
    if (el) el.scrollTo({ left: start * el.clientWidth });
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      const p = pager.current;
      if (!p) return;
      if (e.key === 'ArrowRight') p.scrollBy({ left: p.clientWidth, behavior: 'smooth' });
      if (e.key === 'ArrowLeft') p.scrollBy({ left: -p.clientWidth, behavior: 'smooth' });
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [start, onClose]);

  // Os toques ficam aqui: o feed por baixo não se mexe nem recarrega.
  const onTouchStart = (e: React.TouchEvent) => { e.stopPropagation(); startY.current = e.touches[0].clientY; };
  const onTouchMove = (e: React.TouchEvent) => {
    e.stopPropagation();
    if (startY.current !== null) setDrag(Math.max(0, e.touches[0].clientY - startY.current));
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    e.stopPropagation();
    if (drag > 110) onClose();
    setDrag(0);
    startY.current = null;
  };

  return (
    <div
      role="dialog"
      aria-modal="true" data-swipe="own"
      aria-label={tr('Fotos de {v0}', { v0: post.author.displayName })}
      className="fixed inset-0 z-[60] flex flex-col text-white"
      style={{ backgroundColor: `rgba(0,0,0,${Math.max(0.35, 1 - drag / 500)})` }}
    >
      <div className="flex items-center justify-between px-2 pt-[max(0.5rem,env(safe-area-inset-top))]">
        <button onClick={onClose} aria-label={tr('Fechar')} className="flex h-11 w-11 items-center justify-center rounded-full bg-black/40 text-2xl">×</button>
        {n > 1 && <span className="rounded-full bg-black/50 px-3 py-1 text-sm font-semibold">{i + 1}/{n}</span>}
        <span className="w-11" aria-hidden />
      </div>

      <div
        ref={pager}
        onScroll={(e) => setI(Math.round(e.currentTarget.scrollLeft / e.currentTarget.clientWidth))}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        style={{ transform: `translateY(${drag}px)`, transition: drag ? 'none' : 'transform .2s' }}
        className="mx-auto flex w-full max-w-xl min-h-0 flex-1 snap-x snap-mandatory overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {post.media.map((m, k) => (
          <div key={m.url} className="flex h-full w-full shrink-0 snap-center items-center justify-center">
            {/* object-contain: a foto aparece inteira, sem cortes. */}
            <TaggedImage src={sized(m.url, 1600)} alt={tr('Foto {v0} de {v1}', { v0: k + 1, v1: n })} tags={m.tags} />
          </div>
        ))}
      </div>

      <div className="mx-auto w-full max-w-xl bg-black/60 px-4 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur-sm">
        <p className="text-sm font-semibold">{post.author.displayName} <span className="font-normal text-zinc-300">@{post.author.username}</span></p>
        {post.body && <p className="mt-0.5 line-clamp-2 break-words text-sm text-zinc-100"><RichText text={post.body} /></p>}
        <Actions post={post} dark layer="z-[70]" />
      </div>
    </div>
  );
}

/** Linha de menu de uma folha: ícone em círculo, título e uma linha a explicar. */
/** ⋯ da publicação: copiar ligação, denunciar (de outras pessoas) ou apagar (as minhas). */
export function PostMenu({ post, dark = false }: { post: Post; dark?: boolean }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [open, setOpen] = useState<null | 'menu' | 'report' | 'delete' | 'share' | 'edit'>(null);
  const [note, setNote] = useState('');
  const [draft, setDraft] = useState(post.body);
  const [saving, setSaving] = useState(false);
  const [editErr, setEditErr] = useState('');
  const mine = post.author.id === user?.id;

  async function copy() {
    try {
      await navigator.clipboard.writeText(postLink(post));
      setNote(tr('Ligação copiada'));
    } catch {
      setNote(tr('Não consegui copiar'));
    }
    setTimeout(() => setNote(''), 1800);
  }
  async function hide() {
    await api.hideFromFeed(post.id).catch(() => undefined);
    setOpen(null);
    await qc.invalidateQueries({ queryKey: ['feed'] });
  }
  async function saveEdit() {
    setSaving(true);
    setEditErr('');
    try {
      await api.updatePost(post.id, { body: draft });
      setOpen(null);
      for (const key of ['feed', 'profile-posts', 'post', 'reels']) await qc.invalidateQueries({ queryKey: [key] });
    } catch (e) {
      setEditErr((e as Error).message);
    }
    setSaving(false);
  }
  async function toggleSave() {
    const next = !post.saved;
    await (next ? api.savePost(post.id) : api.unsavePost(post.id)).catch(() => undefined);
    setOpen(null);
    for (const key of ['feed', 'profile-posts', 'post', 'reels', 'place', 'saved']) await qc.invalidateQueries({ queryKey: [key] });
  }
  async function clearPlace() {
    await api.updatePost(post.id, { clearLocation: true }).catch(() => undefined);
    setOpen(null);
    for (const key of ['feed', 'profile-posts', 'post', 'reels', 'place']) await qc.invalidateQueries({ queryKey: [key] });
  }
  async function toggleComments() {
    await api.updatePost(post.id, { commentsOff: !post.commentsOff }).catch(() => undefined);
    setOpen(null);
    for (const key of ['feed', 'profile-posts', 'post', 'reels']) await qc.invalidateQueries({ queryKey: [key] });
  }
  async function remove() {
    await api.removePost(post.id).catch(() => undefined);
    setOpen(null);
    for (const key of ['feed', 'profile-posts', 'post']) await qc.invalidateQueries({ queryKey: [key] });
  }
  return (
    <>
      <button onClick={() => setOpen('menu')} aria-label={tr('Mais opções da publicação')} className={dark ? 'flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-black/55 text-white ring-1 ring-white/30 backdrop-blur-sm transition active:scale-90' : '-mr-2 flex h-10 w-10 shrink-0 items-center justify-center self-start rounded-full text-zinc-900 transition active:bg-zinc-100'}>
        <Icon name="more" size={dark ? 28 : 26} strokeWidth={3} />
      </button>
      {createPortal(
        <>
      {open === 'menu' && (
            <Sheet title={tr('Publicação')} onClose={() => setOpen(null)}>
              <MenuRow icon={<Icon name="share" />} title={tr('Partilhar')} text={tr('No teu status, por ligação ou por outra app.')} onClick={() => setOpen('share')} />
              <MenuRow icon={<BookmarkIcon on={!!post.saved} size={22} />} title={post.saved ? tr('Tirar dos guardados') : tr('Guardar')} text={tr('Só tu vês os teus guardados.')} onClick={toggleSave} />
          <MenuRow icon={<Icon name="link" />} title={tr('Copiar ligação')} text={note || 'Para partilhares onde quiseres.'} onClick={copy} />
              {mine && !(post.kind === 'repost' && !post.body) && <MenuRow icon={<Icon name="pencil" />} title={tr('Editar')} text={tr('Muda o texto da publicação.')} onClick={() => { setDraft(post.body); setOpen('edit'); }} />}
              {mine && post.locationLabel && <MenuRow icon={<Icon name="map-pin" />} title={tr('Tirar o local')} text={tr('O sítio deixa de aparecer nesta publicação.')} onClick={clearPlace} />}
              {mine && <MenuRow icon={<Icon name="comment" />} title={post.commentsOff ? tr('Ativar comentários') : tr('Desativar comentários')} text={post.commentsOff ? tr('Voltam a poder comentar.') : tr('Ninguém pode comentar esta publicação.')} onClick={toggleComments} />}
              {mine ? (
                <MenuRow icon={<Icon name="trash" />} title={tr('Apagar')} text={tr('Some para toda a gente.')} onClick={() => setOpen('delete')} />
              ) : (
                <>
                  <MenuRow icon={<Icon name="eye-off" />} title={tr('Não me interessa')} text={tr('Esta publicação deixa de aparecer no teu feed.')} onClick={hide} />
                  <MenuRow icon={<Icon name="flag" />} title={tr('Denunciar')} text={tr('Avisa a moderação. A pessoa não sabe.')} onClick={() => setOpen('report')} />
                </>
              )}
            </Sheet>
          )}
          {open === 'edit' && (
            <Sheet title={tr('Editar a publicação')} onClose={() => setOpen(null)}>
              <MentionTextarea value={draft} onChange={setDraft} maxLength={2000} rows={5} autoFocus aria-label={tr('Texto')} className={`${fieldInput} resize-none`} />
              <p role="alert" className="min-h-5 text-center text-sm text-red-600">{editErr}</p>
              <button onClick={saveEdit} disabled={saving} className="h-12 w-full rounded-full bg-brand font-bold text-white active:scale-[0.98] disabled:opacity-60">{tr('Guardar')}</button>
              <button onClick={() => setOpen(null)} className="mt-2 h-12 w-full rounded-full font-semibold text-zinc-700 active:bg-zinc-100">{tr('Cancelar')}</button>
            </Sheet>
          )}
          {open === 'delete' && (
            <Sheet title={tr('Apagar a publicação?')} onClose={() => setOpen(null)}>
              <p className="mb-4 text-zinc-600">{tr('Deixa de aparecer para toda a gente, incluindo os reposts. Não dá para desfazer.')}</p>
              <button onClick={remove} className="h-12 w-full rounded-full bg-red-700 font-bold text-white active:scale-[0.98]">{tr('Apagar')}</button>
              <button onClick={() => setOpen(null)} className="mt-2 h-12 w-full rounded-full font-semibold text-zinc-700 active:bg-zinc-100">{tr('Cancelar')}</button>
            </Sheet>
          )}
          {open === 'report' && <ReportSheet type="post" id={post.id} onClose={() => setOpen(null)} />}
        </>,
        document.body,
      )}
      {open === 'share' && createPortal(<ShareSheet post={post} layer="z-[80]" onClose={() => setOpen(null)} />, document.body)}
    </>
  );
}

function MenuRow({ icon, title, text, onClick, disabled }: { icon: ReactNode; title: string; text: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled} className="flex w-full items-center gap-4 rounded-2xl px-1 py-3 text-left transition active:bg-zinc-100 disabled:opacity-60">
      <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-zinc-800">{icon}</span>
      <span className="min-w-0">
        <span className="block text-[17px] font-semibold">{title}</span>
        <span className="block text-sm text-zinc-600">{text}</span>
      </span>
    </button>
  );
}

export function RepostSheet({ post, onChange, onClose, layer }: { post: Post; onChange: (p: Partial<Post>) => void; onClose: () => void; layer?: string }) {
  const qc = useQueryClient();
  const [quote, setQuote] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setErr('');
    try {
      await fn();
      for (const key of ['feed', 'profile-posts']) qc.invalidateQueries({ queryKey: [key] });
      onClose();
    } catch (x) {
      setErr((x as Error).message);
      setBusy(false);
    }
  }

  return (
    <Sheet title={quote ? 'Repostar com comentário' : 'Repostar'} onClose={onClose} layer={layer}>
      {quote ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            run(async () => {
              await api.repost(post.id, text);
              onChange({ reposts: post.reposts + 1 });
            });
          }}
          className="space-y-3"
        >
          <MentionTextarea value={text} onChange={setText} maxLength={500} rows={3} autoFocus placeholder={tr('O que achas?')} aria-label={tr('Comentário')} className={`${fieldInput} resize-none`} />
          <p role="alert" className="min-h-5 text-center text-sm text-red-600">{err}</p>
          <button disabled={busy || !text.trim()} className={`${btnPrimary} w-full py-3.5`}>{busy ? tr('A publicar…') : tr('Publicar')}</button>
          <button type="button" onClick={() => setQuote(false)} className={`${btnGhost} w-full`}>{tr('Voltar')}</button>
        </form>
      ) : (
        <div className="-mt-1 space-y-1">
          {post.reposted ? (
            <MenuRow
              icon={<UndoIcon />}
              title={tr('Desfazer repost')}
              text={tr('Tira esta publicação do teu perfil.')}
              disabled={busy}
              onClick={() => run(async () => onChange(await api.unrepost(post.id)))}
            />
          ) : (
            <MenuRow
              icon={<RepostIcon />}
              title={tr('Repostar')}
              text={tr('Partilha no teu perfil, tal como está.')}
              disabled={busy}
              onClick={() => run(async () => { await api.repost(post.id); onChange({ reposted: true, reposts: post.reposts + 1 }); })}
            />
          )}
          <MenuRow icon={<PencilIcon />} title={tr('Repostar com comentário')} text={tr('Acrescenta o que achas ao partilhar.')} onClick={() => setQuote(true)} />
          {err && <p role="alert" className="pt-1 text-center text-sm text-red-600">{err}</p>}
        </div>
      )}
    </Sheet>
  );
}
