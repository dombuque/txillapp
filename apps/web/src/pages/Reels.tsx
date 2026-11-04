import { sized } from '../lib/media';
import { tr } from '../lib/i18n';
import { PontoLoader } from '../components/Loading';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { slideClass, takeSlide, useSwipeTabs } from '../lib/swipeNav';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { PostMenu, RepostSheet } from '../components/PostCard';
import ShareSheet from '../components/ShareSheet';
import CommentsSheet from '../components/CommentsSheet';
import FollowButton from '../components/FollowButton';
import GiftSheet from '../components/GiftSheet';
import PeopleSheet from '../components/PeopleSheet';
import Icon from '../components/Icon';
import RichText from '../components/RichText';
import VideoPlayer, { setMuted, useMuted } from '../components/VideoPlayer';
import { Avatar } from '../components/ui';
import { api, type PeopleKind, type Post } from '../lib/api';
import { useAuth } from '../lib/auth';
import { track } from '../lib/analytics';
import { trackSeen } from '../lib/seen';
import { useVisualViewport, visibleStyle } from '../lib/useVisualViewport';

/** Um vídeo em ecrã inteiro com os botões à direita (brindar, comentar, partilhar, presentear). */
export function Reel({ post, active, onChange, onMore }: { post: Post; active: boolean; onChange: (p: Partial<Post>) => void; onMore?: () => void }) {
  const { user } = useAuth();
  const [progress, setProgress] = useState(0);
  const [sheet, setSheet] = useState<null | 'comments' | 'gift' | 'share' | 'repost'>(null);
  const [people, setPeople] = useState<PeopleKind | null>(null); // quem brindou / repostou (se o dono deixar ver)
  const v = post.media[0];
  const video = v?.kind === 'video';
  const [photo, setPhoto] = useState(0);
  const mine = post.author.id === user?.id;

  // Conta como "visto" depois de 1 s em cena.
  useEffect(() => {
    if (!active) return;
    const t = setTimeout(() => trackSeen(post.id), 1000);
    return () => clearTimeout(t);
  }, [active, post.id]);

  async function cheer() {
    onChange({ cheered: !post.cheered, cheers: post.cheers + (post.cheered ? -1 : 1) });
    track('cheer', { on: !post.cheered, source: 'reels' });
    try {
      onChange(await api.cheer(post.id));
    } catch {
      onChange({ cheered: post.cheered, cheers: post.cheers });
    }
  }
  const rail = 'flex flex-col items-center gap-1 text-white drop-shadow-[0_1px_3px_rgba(0,0,0,0.6)]';
  const circle = 'flex h-12 w-12 items-center justify-center rounded-full bg-black/35 backdrop-blur-sm transition active:scale-90';
  return (
    <section className="relative h-full w-full snap-start snap-always bg-black" aria-label={`${video ? 'Reel' : 'Publicação'} de ${post.author.displayName}`}>
      {video ? (
        <VideoPlayer src={v.url} poster={v.posterUrl} active={active} cover durationMs={null} className="h-full w-full" onProgress={setProgress} id={post.id} onMore={onMore} />
      ) : post.media.length > 0 ? (
        // Foto (ou várias, que se deslizam): ocupa o ecrã todo, sem cortar.
        <div className="flex h-full w-full snap-x snap-mandatory overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" data-no-swipe onScroll={(e) => setPhoto(Math.round(e.currentTarget.scrollLeft / e.currentTarget.clientWidth))}>
          {post.media.map((m, i) => (
            <img key={i} src={sized(m.url, 1080)} alt="" loading={i ? 'lazy' : 'eager'} decoding="async" className="h-full w-full shrink-0 snap-center object-contain" />
          ))}
        </div>
      ) : (
        <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-brand via-[#e8475f] to-[#ff8a5b] pl-8 pr-24 pb-28 pt-20 text-center text-white">
          <p className="max-h-full overflow-hidden whitespace-pre-wrap break-words text-[28px] font-extrabold leading-tight">{post.body}</p>
        </div>
      )}

      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/70 to-transparent" />
      {video && (
        <div className="absolute inset-x-0 bottom-0 h-[3px] bg-white/25" aria-hidden>
          <div className="h-full bg-white" style={{ width: `${progress * 100}%` }} />
        </div>
      )}
      {!video && post.media.length > 1 && (
        <div className="pointer-events-none absolute inset-x-0 bottom-2 flex justify-center gap-1.5" aria-hidden>
          {post.media.map((_, i) => <span key={i} className={`h-1.5 w-1.5 rounded-full ${i === photo ? 'bg-white' : 'bg-white/40'}`} />)}
        </div>
      )}

      <div className="absolute bottom-[max(1.5rem,env(safe-area-inset-bottom))] left-4 right-20 text-white">
        <div className="flex items-center gap-2.5">
          <Link to={`/u/${post.author.username}`}><Avatar name={post.author.displayName} username={post.author.username} size={40} ring={false} /></Link>
          <Link to={`/u/${post.author.username}`} className="min-w-0 truncate font-bold">{post.author.displayName}</Link>
          {!mine && post.authorFollowed === false && <FollowButton username={post.author.username} following={false} requested={false} isPrivate={false} />}
        </div>
        {post.body && (video || post.media.length > 0) && <p className="mt-2 line-clamp-3 text-[15px] leading-snug"><RichText text={post.body} /></p>}
        {post.locationLabel && <Link to={`/place/${encodeURIComponent(post.locationLabel)}`} className="mt-1 flex w-fit items-center gap-1 text-sm text-white/90 underline-offset-2 active:underline"><Icon name="map-pin" size={14} /> {post.locationLabel}</Link>}
      </div>

      <div className="absolute bottom-[max(1.5rem,env(safe-area-inset-bottom))] right-3 flex flex-col items-center gap-3">
        <div className="flex flex-col items-center">
          <button onClick={cheer} aria-label={post.cheered ? 'Tirar o brinde' : 'Brindar'} aria-pressed={post.cheered} className={rail}>
            <span className={`${circle} ${post.cheered ? '!bg-white/90' : ''}`}><Icon name="cheers" size={26} className={post.cheered ? 'text-brand' : ''} /></span>
          </button>
          <button type="button" disabled={!post.lists?.cheers || post.cheers === 0} onClick={() => setPeople('cheers')} aria-label={tr('Ver quem brindou')} className="min-h-8 min-w-10 text-sm font-semibold tabular-nums text-white underline-offset-4 disabled:text-white enabled:underline">{post.cheers}</button>
        </div>
        <button onClick={() => setSheet('comments')} aria-label={tr('Comentários ({v0})', { v0: post.comments })} className={rail}>
          <span className={circle}><Icon name="comment" size={26} /></span>
          <span className="text-sm font-semibold tabular-nums">{post.comments}</span>
        </button>
        <div className="flex flex-col items-center">
          <button onClick={() => setSheet('repost')} aria-label={post.reposted ? `Reposte feito (${post.reposts})` : `Repostar (${post.reposts})`} aria-pressed={post.reposted} className={rail}>
            <span className={`${circle} ${post.reposted ? '!bg-emerald-500/90' : ''}`}><Icon name="repeat" size={26} /></span>
          </button>
          <button type="button" disabled={!post.lists?.reposts || post.reposts === 0} onClick={() => setPeople('reposts')} aria-label={tr('Ver quem repostou')} className="min-h-8 min-w-10 text-sm font-semibold tabular-nums text-white underline-offset-4 disabled:text-white enabled:underline">{post.reposts}</button>
        </div>
        <button onClick={() => setSheet('share')} aria-label={tr('Partilhar')} className={rail}>
          <span className={circle}><Icon name="share" size={26} /></span>
        </button>
        {!mine && post.canGift && (
          <button onClick={() => setSheet('gift')} aria-label={tr('Presentear')} className={rail}>
            <span className={circle}><Icon name="gift" size={26} /></span>
          </button>
        )}
        <div className={rail}><PostMenu post={post} dark /></div>
      </div>

      {people && <PeopleSheet postId={post.id} kind={people} layer="z-[70]" onClose={() => setPeople(null)} />}
      {sheet === 'comments' && <CommentsSheet post={post} layer="z-[70]" onClose={() => setSheet(null)} onDelta={(d) => onChange({ comments: Math.max(0, post.comments + d) })} />}
      {sheet === 'share' && <ShareSheet post={post} layer="z-[70]" onClose={() => setSheet(null)} />}
      {sheet === 'repost' && <RepostSheet post={post} layer="z-[70]" onChange={onChange} onClose={() => setSheet(null)} />}
      {sheet === 'gift' && <GiftSheet postId={post.id} recipient={post.author} layer="z-[70]" onClose={() => setSheet(null)} />}
    </section>
  );
}

/** Reels: vídeos curtos em ecrã inteiro, um de cada vez. Desliza para cima para o seguinte. */
export default function Reels() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const vv = useVisualViewport();
  const isMuted = useMuted(true);
  const [activeId, setActiveId] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);

  const q = useInfiniteQuery({
    queryKey: ['reels'],
    queryFn: ({ pageParam }) => api.reels(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (l) => l.nextCursor ?? undefined,
  });
  const seen = new Set<string>();
  // Vindo do feed com ?start=<id>: esse reel passa à frente e os outros seguem-se (deslizando para cima).
  const [params] = useSearchParams();
  const startId = params.get('start');
  const startPost = useQuery({ queryKey: ['post', startId], queryFn: () => api.getPost(startId!), enabled: !!startId, retry: false });
  const listed = q.data?.pages.flatMap((p) => p.items) ?? [];
  const lead = startPost.data && startPost.data.media[0]?.kind === 'video' ? [startPost.data] : [];
  // Enquanto o reel de partida carrega, não se mostra a lista (para não saltar de um reel para outro).
  const items = (startId && startPost.isLoading ? [] : [...lead, ...listed]).filter((p) => p.media[0]?.kind === 'video' && !seen.has(p.id) && !!seen.add(p.id));
  const current = activeId ?? items[0]?.id ?? null;
  const idx = items.findIndex((p) => p.id === current);

  /** Do fim de um reel para o seguinte (e, no último, carrega mais). */
  async function goNext(id: string) {
    const i = items.findIndex((x) => x.id === id);
    let next = items[i + 1];
    if (!next && q.hasNextPage) {
      await q.fetchNextPage();
      return;
    }
    if (!next) next = items[0];
    root.current?.querySelector(`[data-id="${next.id}"]`)?.scrollIntoView({ behavior: 'smooth' });
  }

  // Qual está em cena: o que ocupa mais de 70% do ecrã.
  useEffect(() => {
    const el = root.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting && e.intersectionRatio >= 0.7) setActiveId((e.target as HTMLElement).dataset.id ?? null);
      },
      { root: el, threshold: [0.7] },
    );
    el.querySelectorAll('[data-id]').forEach((n) => io.observe(n));
    return () => io.disconnect();
  }, [items.length]);

  // Perto do fim, pede mais.
  useEffect(() => {
    if (idx >= items.length - 2 && q.hasNextPage && !q.isFetchingNextPage) void q.fetchNextPage();
  }, [idx, items.length, q]);

  useEffect(() => {
    track('screen_view', { path: '/reels' });
  }, []);

  // Como uma app nativa: barra de estado preta nos Reels e, no sem controlo de média do telemóvel.
  useEffect(() => {
    const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    const before = meta?.content;
    if (meta) meta.content = '#000000';
    return () => {
      if (meta && before) meta.content = before;
    };
  }, []);
  // Os Reels não são um leitor de média: sem cartão no ecrã de bloqueio nem nos controlos do telemóvel.
  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    const ms = navigator.mediaSession;
    ms.metadata = null;
    for (const a of ['play', 'pause', 'seekbackward', 'seekforward', 'previoustrack', 'nexttrack', 'seekto'] as const) {
      try { ms.setActionHandler(a, null); } catch { /* ação não suportada */ }
    }
  }, []);

  useSwipeTabs();
  const slide = useMemo(() => slideClass(takeSlide()), []);

  function patch(id: string, p: Partial<Post>) {
    qc.setQueryData<typeof q.data>(['reels'], (d) => d && { ...d, pages: d.pages.map((pg) => ({ ...pg, items: pg.items.map((i) => (i.id === id ? { ...i, ...p } : i)) })) });
  }

  return (
    <div className={`fixed inset-0 z-40 bg-black ${slide}`} style={visibleStyle(vv)}>
      <div ref={root} className="mx-auto h-full max-w-xl snap-y snap-mandatory overflow-y-scroll [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {items.map((p) => (
          <div key={p.id} data-id={p.id} className="h-full w-full snap-start snap-always">
            <Reel post={p} active={p.id === current} onChange={(c) => patch(p.id, c)} onMore={() => void goNext(p.id)} />
          </div>
        ))}
        {(q.isLoading || (!!startId && startPost.isLoading)) && <div className="flex h-full items-center justify-center"><PontoLoader size={26} /></div>}
        {q.isSuccess && items.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center px-8 text-center text-white">
            <Icon name="film" size={52} className="mx-auto text-white/70" />
            <p className="mt-4 text-2xl font-extrabold">{tr('Ainda sem reels')}</p>
            <p className="mt-2 text-white/75">{tr('Sê tu a começar: grava um vídeo até 60 segundos.')}</p>
            <Link to="/new" className="mt-6 rounded-full bg-brand px-8 py-3.5 font-bold active:scale-95">{tr('Publicar um vídeo')}</Link>
          </div>
        )}
        {q.isError && <p role="alert" className="flex h-full items-center justify-center text-white/80">{tr('Ups, falhou')}</p>}
      </div>

      <div className="pointer-events-none absolute inset-x-0 top-0 mx-auto flex max-w-xl items-center justify-between px-3 pt-[max(0.75rem,env(safe-area-inset-top))] text-white">
        <button onClick={() => (window.history.length > 1 ? navigate(-1) : navigate('/', { replace: true }))} aria-label={tr('Fechar')} className="pointer-events-auto flex h-11 w-11 items-center justify-center rounded-full bg-black/35 backdrop-blur-sm active:scale-90">
          <Icon name="back" size={24} />
        </button>
        <span className="text-lg font-extrabold drop-shadow">{tr('Reels')}</span>
        <button onClick={() => setMuted(!isMuted)} aria-label={isMuted ? 'Ligar o som' : 'Desligar o som'} className="pointer-events-auto flex h-11 w-11 items-center justify-center rounded-full bg-black/35 backdrop-blur-sm active:scale-90">
          <Icon name={isMuted ? 'volume-off' : 'volume'} size={22} />
        </button>
      </div>
    </div>
  );
}
