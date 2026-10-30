import { PontoLoader } from '../components/Loading';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { PostMenu, RepostSheet } from '../components/PostCard';
import ShareSheet from '../components/ShareSheet';
import CommentsSheet from '../components/CommentsSheet';
import FollowButton from '../components/FollowButton';
import GiftSheet from '../components/GiftSheet';
import Icon from '../components/Icon';
import RichText from '../components/RichText';
import VideoPlayer, { setMuted, useMuted } from '../components/VideoPlayer';
import { Avatar } from '../components/ui';
import { api, type Post } from '../lib/api';
import { useAuth } from '../lib/auth';
import { track } from '../lib/analytics';
import { trackSeen } from '../lib/seen';
import { useVisualViewport, visibleStyle } from '../lib/useVisualViewport';

/** Um vídeo em ecrã inteiro com os botões à direita (brindar, comentar, partilhar, presentear). */
function Reel({ post, active, onChange }: { post: Post; active: boolean; onChange: (p: Partial<Post>) => void }) {
  const { user } = useAuth();
  const [progress, setProgress] = useState(0);
  const [sheet, setSheet] = useState<null | 'comments' | 'gift' | 'share' | 'repost'>(null);
  const v = post.media[0];
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
    <section className="relative h-full w-full snap-start snap-always bg-black" aria-label={`Reel de ${post.author.displayName}`}>
      <VideoPlayer src={v.url} poster={v.posterUrl} active={active} cover durationMs={null} className="h-full w-full" onProgress={setProgress} id={post.id} />

      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/70 to-transparent" />
      <div className="absolute inset-x-0 bottom-0 h-[3px] bg-white/25" aria-hidden>
        <div className="h-full bg-white" style={{ width: `${progress * 100}%` }} />
      </div>

      <div className="absolute bottom-6 left-4 right-20 text-white">
        <div className="flex items-center gap-2.5">
          <Link to={`/u/${post.author.username}`}><Avatar name={post.author.displayName} username={post.author.username} size={40} ring={false} /></Link>
          <Link to={`/u/${post.author.username}`} className="min-w-0 truncate font-bold">{post.author.displayName}</Link>
          {!mine && post.authorFollowed === false && <FollowButton username={post.author.username} following={false} requested={false} isPrivate={false} />}
        </div>
        {post.body && <p className="mt-2 line-clamp-3 text-[15px] leading-snug"><RichText text={post.body} /></p>}
        {post.locationLabel && <p className="mt-1 flex items-center gap-1 text-sm text-white/80"><Icon name="globe" size={14} /> {post.locationLabel}</p>}
      </div>

      <div className="absolute bottom-6 right-3 flex flex-col items-center gap-5">
        <button onClick={cheer} aria-label={post.cheered ? 'Tirar o brinde' : 'Brindar'} aria-pressed={post.cheered} className={rail}>
          <span className={`${circle} ${post.cheered ? '!bg-white/90' : ''}`}><Icon name="cheers" size={26} className={post.cheered ? 'text-brand' : ''} /></span>
          <span className="text-sm font-semibold tabular-nums">{post.cheers}</span>
        </button>
        <button onClick={() => setSheet('comments')} aria-label={`Comentários (${post.comments})`} className={rail}>
          <span className={circle}><Icon name="comment" size={26} /></span>
          <span className="text-sm font-semibold tabular-nums">{post.comments}</span>
        </button>
        <button onClick={() => setSheet('repost')} aria-label={post.reposted ? `Reposte feito (${post.reposts})` : `Repostar (${post.reposts})`} aria-pressed={post.reposted} className={rail}>
          <span className={`${circle} ${post.reposted ? '!bg-emerald-500/90' : ''}`}><Icon name="repeat" size={26} /></span>
          <span className="text-sm font-semibold tabular-nums">{post.reposts}</span>
        </button>
        <button onClick={() => setSheet('share')} aria-label="Partilhar" className={rail}>
          <span className={circle}><Icon name="share" size={26} /></span>
        </button>
        {!mine && post.canGift && (
          <button onClick={() => setSheet('gift')} aria-label="Presentear" className={rail}>
            <span className={circle}><Icon name="gift" size={26} /></span>
          </button>
        )}
        <div className={rail}><PostMenu post={post} dark /></div>
      </div>

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
  const items = (q.data?.pages.flatMap((p) => p.items) ?? []).filter((p) => p.media[0]?.kind === 'video' && !seen.has(p.id) && !!seen.add(p.id));
  const current = activeId ?? items[0]?.id ?? null;
  const idx = items.findIndex((p) => p.id === current);

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

  // Como uma app nativa: barra de estado preta nos Reels e, no controlo de média do telemóvel, o nome e o logótipo do Txillapp.
  useEffect(() => {
    const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    const before = meta?.content;
    if (meta) meta.content = '#000000';
    return () => {
      if (meta && before) meta.content = before;
    };
  }, []);
  const playing = idx >= 0 ? items[idx] : null;
  useEffect(() => {
    if (!('mediaSession' in navigator) || !playing) return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: (playing.body || 'Reel').slice(0, 80),
      artist: playing.author.displayName,
      album: 'Txillapp',
      artwork: [{ src: '/icon-512.png', sizes: '512x512', type: 'image/png' }],
    });
    return () => {
      navigator.mediaSession.metadata = null;
    };
  }, [playing?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  function patch(id: string, p: Partial<Post>) {
    qc.setQueryData<typeof q.data>(['reels'], (d) => d && { ...d, pages: d.pages.map((pg) => ({ ...pg, items: pg.items.map((i) => (i.id === id ? { ...i, ...p } : i)) })) });
  }

  return (
    <div className="fixed inset-0 z-40 bg-black" style={visibleStyle(vv)}>
      <div ref={root} className="mx-auto h-full max-w-xl snap-y snap-mandatory overflow-y-scroll [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {items.map((p) => (
          <div key={p.id} data-id={p.id} className="h-full w-full snap-start snap-always">
            <Reel post={p} active={p.id === current} onChange={(c) => patch(p.id, c)} />
          </div>
        ))}
        {q.isLoading && <div className="flex h-full items-center justify-center"><PontoLoader size={26} /></div>}
        {q.isSuccess && items.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center px-8 text-center text-white">
            <Icon name="film" size={52} className="mx-auto text-white/70" />
            <p className="mt-4 text-2xl font-extrabold">Ainda sem reels</p>
            <p className="mt-2 text-white/75">Sê tu a começar: grava um vídeo até 60 segundos.</p>
            <Link to="/new" className="mt-6 rounded-full bg-brand px-8 py-3.5 font-bold active:scale-95">Publicar um vídeo</Link>
          </div>
        )}
        {q.isError && <p role="alert" className="flex h-full items-center justify-center text-white/80">Ups, falhou</p>}
      </div>

      <div className="pointer-events-none absolute inset-x-0 top-0 mx-auto flex max-w-xl items-center justify-between px-3 pt-[max(0.75rem,env(safe-area-inset-top))] text-white">
        <button onClick={() => (window.history.length > 1 ? navigate(-1) : navigate('/', { replace: true }))} aria-label="Fechar" className="pointer-events-auto flex h-11 w-11 items-center justify-center rounded-full bg-black/35 backdrop-blur-sm active:scale-90">
          <Icon name="back" size={24} />
        </button>
        <span className="text-lg font-extrabold drop-shadow">Reels</span>
        <button onClick={() => setMuted(!isMuted)} aria-label={isMuted ? 'Ligar o som' : 'Desligar o som'} className="pointer-events-auto flex h-11 w-11 items-center justify-center rounded-full bg-black/35 backdrop-blur-sm active:scale-90">
          <Icon name={isMuted ? 'volume-off' : 'volume'} size={22} />
        </button>
      </div>
    </div>
  );
}
