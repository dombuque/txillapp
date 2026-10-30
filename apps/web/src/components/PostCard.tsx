import ShareSheet from './ShareSheet';
import VideoPlayer from './VideoPlayer';
import { track } from '../lib/analytics';
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
import { Link } from 'react-router-dom';
import { api, type Page, type Post, type PeopleKind } from '../lib/api';
import { useAuth } from '../lib/auth';
import CommentsSheet from './CommentsSheet';
import GiftSheet from './GiftSheet';
import { CommentIcon, GiftIcon, PencilIcon, RepostIcon, UndoIcon } from './icons';
import { Avatar, Sheet, btnGhost, btnPrimary, fieldInput, timeAgo } from './ui';

type Feed = InfiniteData<Page<Post>>;

/** O meu perfil vive em /profile; os outros em /u/:username. */
export const profilePath = (username: string, me?: string) => (username === me ? '/profile' : `/u/${username}`);

/** Carrossel de fotos: deslizar na horizontal, com contador e pontos como no Instagram. */
function Carousel({ media, onOpen }: { media: Post['media']; onOpen: (index: number) => void }) {
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
            <VideoPlayer src={m.url} poster={m.posterUrl} durationMs={m.durationMs} width={m.width} height={m.height} className="w-full" />
          </div>
        ) : (
          // Tocar na foto abre-a inteira, em ecrã completo (como no X).
          <button key={m.url} onClick={() => onOpen(n)} aria-label={`Ver a foto ${n + 1} de ${media.length} em ecrã inteiro`} className="block w-full shrink-0 snap-center">
            <img src={sized(m.url, 720)} srcSet={srcSet(m.url)} sizes="(min-width: 640px) 576px, 100vw" alt={`Foto ${n + 1} de ${media.length}`} loading={n === 0 ? 'eager' : 'lazy'} decoding="async" className="max-h-[28rem] w-full object-cover" />
          </button>
        )))}
      </div>
      {tags.length > 0 && (
        <>
          <button onClick={() => setShowTags((v) => !v)} aria-label={`${tags.length} pessoa(s) identificadas`} aria-expanded={showTags} className="absolute bottom-3 left-3 flex h-8 items-center gap-1 rounded-full bg-black/60 px-2.5 text-sm font-semibold text-white backdrop-blur-sm active:scale-95">
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
function usePatch(id: string) {
  const qc = useQueryClient();
  return (p: Partial<Post>) => {
    const merge = (i: Post): Post =>
      i.id === id ? { ...i, ...p } : i.repostOf?.id === id ? { ...i, repostOf: { ...i.repostOf, ...p } } : i;
    for (const key of ['feed', 'profile-posts']) {
      qc.setQueriesData<Feed>({ queryKey: [key] }, (d) => d && { ...d, pages: d.pages.map((pg) => ({ ...pg, items: pg.items.map(merge) })) });
    }
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
              {post.author.id === user?.id ? 'Repostaste' : `${post.author.displayName} repostou`}
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

/** Cartão normal de uma publicação. */
function PostBody({ post }: { post: Post }) {
  const { user } = useAuth();
  const [viewer, setViewer] = useState<number | null>(null);
  const g = post.gift;
  return (
    <article className="mx-3 mb-6 rounded-[28px] bg-white px-4 pt-5 min-[360px]:mx-4 min-[360px]:px-5 shadow-[0_2px_16px_rgba(0,0,0,0.09)]">
      <header className="flex items-center gap-3">
        <Link to={profilePath(post.author.username, user?.username)} aria-label={`Perfil de ${post.author.displayName}`}>
          <Avatar name={post.author.displayName} username={post.author.username} size={52} />
        </Link>
        <div className="min-w-0 flex-1">
          {g ? (
            <p className="text-[17px] leading-tight text-zinc-800">
              <Link to={profilePath(post.author.username, user?.username)} className="font-bold">{post.author.displayName}</Link> presenteou{' '}
              <Link to={profilePath(g.recipient.username, user?.username)} className="font-bold">{g.recipient.displayName}</Link>
            </p>
          ) : (
            <Link to={profilePath(post.author.username, user?.username)} className="block truncate text-[19px] font-medium leading-tight text-zinc-800">
              {post.author.displayName}
              {post.author.verified && <> <VerifiedBadge /></>}
            </Link>
          )}
          <p className="truncate text-[15px] text-zinc-500">{post.locationLabel ?? `@${post.author.username}`}</p>
        </div>
        <time className="self-start text-[15px] text-zinc-500" dateTime={post.createdAt}>
          {timeAgo(post.createdAt)}
        </time>
        <PostMenu post={post} />
      </header>
      {g && (
        <p className="mt-4 rounded-2xl bg-gradient-to-r from-brand to-brand-light py-3 text-center text-2xl font-extrabold text-white">
          <Icon name="gift" size={16} className="inline align-[-3px]" /> {g.amount.toLocaleString('pt-PT')} Txills
        </p>
      )}
      {post.body && <p className="mt-4 whitespace-pre-wrap break-words text-[19px] text-zinc-800"><RichText text={post.body} /></p>}
      <Carousel media={post.media} onOpen={setViewer} />
      <Actions post={post} />
      {viewer !== null && <ImageViewer post={post} start={viewer} onClose={() => setViewer(null)} />}
    </article>
  );
}

/** Repost com comentário: o texto de quem reposta e, por baixo, a publicação original numa caixa. */
function QuoteCard({ post, original }: { post: Post; original: Post }) {
  const { user } = useAuth();
  const [viewer, setViewer] = useState<number | null>(null);
  return (
    <article className="mx-4 mb-6 rounded-[28px] bg-white px-5 pt-5 shadow-[0_2px_16px_rgba(0,0,0,0.09)]">
      <header className="flex items-center gap-3">
        <Link to={profilePath(post.author.username, user?.username)} aria-label={`Perfil de ${post.author.displayName}`}>
          <Avatar name={post.author.displayName} username={post.author.username} size={52} />
        </Link>
        <div className="min-w-0 flex-1">
          <Link to={profilePath(post.author.username, user?.username)} className="block truncate text-[19px] font-medium leading-tight text-zinc-800">
            {post.author.displayName}
          </Link>
          <p className="flex items-center gap-1 truncate text-[15px] text-zinc-500"><RepostIcon width={14} height={14} /> repostou</p>
        </div>
        <time className="self-start text-[15px] text-zinc-500" dateTime={post.createdAt}>{timeAgo(post.createdAt)}</time>
        <PostMenu post={post} />
      </header>
      <p className="mt-4 whitespace-pre-wrap break-words text-[19px] text-zinc-800"><RichText text={post.body} /></p>
      <div className="mt-3 overflow-hidden rounded-2xl border border-zinc-200">
        <div className="flex items-center gap-2.5 px-3 pt-3">
          <Link to={profilePath(original.author.username, user?.username)} className="flex min-w-0 items-center gap-2.5">
            <Avatar name={original.author.displayName} username={original.author.username} size={30} ring={false} />
            <span className="truncate font-semibold">{original.author.displayName}{original.author.verified && <> <VerifiedBadge size={14} /></>}</span>
          </Link>
          <span className="shrink-0 text-sm text-zinc-500">· {timeAgo(original.createdAt)}</span>
        </div>
        {original.body && <p className="line-clamp-4 whitespace-pre-wrap break-words px-3 pt-2 text-[16px] text-zinc-800">{original.body}</p>}
        {original.media[0] ? (
          <button onClick={() => setViewer(0)} aria-label="Ver a foto em ecrã inteiro" className="mt-2 block w-full">
            <img src={sized(original.media[0].url, 720)} alt="" loading="lazy" decoding="async" className="max-h-72 w-full object-cover" />
          </button>
        ) : (
          <div className="h-3" />
        )}
      </div>
      <Actions post={post} />
      {viewer !== null && <ImageViewer post={original} start={viewer} onClose={() => setViewer(null)} />}
    </article>
  );
}

/** Barra de ações: só ícones com contador, como nas redes sociais. */
function Actions({ post, dark = false, layer }: { post: Post; dark?: boolean; layer?: string }) {
  const { user } = useAuth();
  const patch = usePatch(post.id);
  const [sheet, setSheet] = useState<'comments' | 'gift' | 'repost' | null>(null);
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
  const Item = ({ label, children, onClick, pressed, className = 'flex-1' }: { label: string; children: ReactNode; onClick: () => void; pressed?: boolean; className?: string }) => (
    <button onClick={onClick} aria-label={label} aria-pressed={pressed} className={`${btn} ${className} ${pressed ? (dark ? '!text-green-400' : '!text-green-700') : ''}`}>
      {children}
    </button>
  );

  // Linha "quem": só aparece se o dono deixar este espectador ver a lista e houver alguém.
  const rows: { kind: PeopleKind; n: number; label: string }[] = [
    { kind: 'cheers', n: post.cheers, label: post.cheers === 1 ? 'brinde' : 'brindes' },
    { kind: 'reposts', n: post.reposts, label: post.reposts === 1 ? 'repost' : 'reposts' },
    { kind: 'gifts', n: post.gifts, label: post.gifts === 1 ? 'presente' : 'presentes' },
  ];
  const shown = post.kind === 'repost' ? [] : rows.filter((r) => r.n > 0 && post.lists?.[r.kind]);

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
          Ver {post.comments === 1 ? 'o comentário' : `todos os ${post.comments} comentários`}
        </button>
      )}
      <div className={`flex items-center border-t ${dark ? 'border-white/20' : shown.length || post.comments > 0 ? 'mt-1 border-zinc-200' : 'mt-3 border-zinc-200'}`}>
        <Item label={post.cheered ? 'Tirar o brinde' : 'Brindar'} onClick={cheer} pressed={post.cheered} className="flex-[1.6] justify-start">
          <span key={String(post.cheered)} className={`inline-flex ${post.cheered ? 'animate-[pop_.4s_ease-out]' : ''}`}><Icon name="cheers" size={26} /></span>
          <span className="hidden text-[16px] font-medium min-[380px]:inline">{post.cheered ? 'Brindou' : 'Brindar'}</span>
          {count(post.cheers)}
        </Item>
        <Item label={`Comentários (${post.comments})`} onClick={() => setSheet('comments')}>
          <CommentIcon />
          {count(post.comments)}
        </Item>
        {(post.kind === 'post' || (post.kind === 'repost' && !!post.body)) && (
          <Item label={post.reposted ? `Reposte feito (${post.reposts})` : `Repostar (${post.reposts})`} onClick={() => setSheet('repost')} pressed={post.reposted}>
            <RepostIcon />
            {count(post.reposts)}
          </Item>
        )}
        {!mine && post.canGift ? (
          <Item label={`Presentear (${post.gifts})`} onClick={() => setSheet('gift')}>
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
      </div>
      {people && <PeopleSheet postId={post.id} kind={people} layer={layer} onClose={() => setPeople(null)} />}
      {sheet === 'comments' && <CommentsSheet post={post} layer={layer} onClose={() => setSheet(null)} onDelta={(d) => patch({ comments: Math.max(0, post.comments + d) })} />}
      {sheet === 'gift' && <GiftSheet postId={post.id} recipient={post.author} layer={layer} onClose={() => setSheet(null)} />}
      {sheet === 'repost' && <RepostSheet post={post} layer={layer} onChange={patch} onClose={() => setSheet(null)} />}
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

  const onTouchStart = (e: React.TouchEvent) => (startY.current = e.touches[0].clientY);
  const onTouchMove = (e: React.TouchEvent) => {
    if (startY.current !== null) setDrag(Math.max(0, e.touches[0].clientY - startY.current));
  };
  const onTouchEnd = () => {
    if (drag > 110) onClose();
    setDrag(0);
    startY.current = null;
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Fotos de ${post.author.displayName}`}
      className="fixed inset-0 z-[60] flex flex-col text-white"
      style={{ backgroundColor: `rgba(0,0,0,${Math.max(0.35, 1 - drag / 500)})` }}
    >
      <div className="flex items-center justify-between px-2 pt-[max(0.5rem,env(safe-area-inset-top))]">
        <button onClick={onClose} aria-label="Fechar" className="flex h-11 w-11 items-center justify-center rounded-full bg-black/40 text-2xl">×</button>
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
            <TaggedImage src={sized(m.url, 1600)} alt={`Foto ${k + 1} de ${n}`} tags={m.tags} />
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
  const [open, setOpen] = useState<null | 'menu' | 'report' | 'delete' | 'share'>(null);
  const [note, setNote] = useState('');
  const mine = post.author.id === user?.id;

  async function copy() {
    try {
      await navigator.clipboard.writeText(`${location.origin}/p/${post.id}`);
      setNote('Ligação copiada');
    } catch {
      setNote('Não consegui copiar');
    }
    setTimeout(() => setNote(''), 1800);
  }
  async function hide() {
    await api.hideFromFeed(post.id).catch(() => undefined);
    setOpen(null);
    await qc.invalidateQueries({ queryKey: ['feed'] });
  }
  async function remove() {
    await api.removePost(post.id).catch(() => undefined);
    setOpen(null);
    for (const key of ['feed', 'profile-posts', 'post']) await qc.invalidateQueries({ queryKey: [key] });
  }
  return (
    <>
      <button onClick={() => setOpen('menu')} aria-label="Mais opções da publicação" className={`-mr-2 flex h-9 w-9 shrink-0 items-center justify-center self-start rounded-full transition active:bg-zinc-100 ${dark ? 'text-white active:bg-white/20' : 'text-zinc-600'}`}>
        <Icon name="more" size={20} strokeWidth={2.4} />
      </button>
      {open === 'menu' && (
        <Sheet title="Publicação" onClose={() => setOpen(null)}>
          <MenuRow icon={<Icon name="share" />} title="Partilhar" text="No teu status, por ligação ou por outra app." onClick={() => setOpen('share')} />
          <MenuRow icon={<Icon name="link" />} title="Copiar ligação" text={note || 'Para partilhares onde quiseres.'} onClick={copy} />
          {mine ? (
            <MenuRow icon={<Icon name="trash" />} title="Apagar" text="Some para toda a gente." onClick={() => setOpen('delete')} />
          ) : (
            <>
              <MenuRow icon={<Icon name="eye-off" />} title="Não me interessa" text="Esta publicação deixa de aparecer no teu feed." onClick={hide} />
              <MenuRow icon={<Icon name="flag" />} title="Denunciar" text="Avisa a moderação. A pessoa não sabe." onClick={() => setOpen('report')} />
            </>
          )}
        </Sheet>
      )}
      {open === 'delete' && (
        <Sheet title="Apagar a publicação?" onClose={() => setOpen(null)}>
          <p className="mb-4 text-zinc-600">Deixa de aparecer para toda a gente, incluindo os reposts. Não dá para desfazer.</p>
          <button onClick={remove} className="h-12 w-full rounded-full bg-red-700 font-bold text-white active:scale-[0.98]">Apagar</button>
          <button onClick={() => setOpen(null)} className="mt-2 h-12 w-full rounded-full font-semibold text-zinc-700 active:bg-zinc-100">Cancelar</button>
        </Sheet>
      )}
      {open === 'share' && <ShareSheet post={post} onClose={() => setOpen(null)} />}
      {open === 'report' && <ReportSheet type="post" id={post.id} onClose={() => setOpen(null)} />}
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
          <MentionTextarea value={text} onChange={setText} maxLength={500} rows={3} autoFocus placeholder="O que achas?" aria-label="Comentário" className={`${fieldInput} resize-none`} />
          <p role="alert" className="min-h-5 text-center text-sm text-red-600">{err}</p>
          <button disabled={busy || !text.trim()} className={`${btnPrimary} w-full py-3.5`}>{busy ? 'A publicar…' : 'Publicar'}</button>
          <button type="button" onClick={() => setQuote(false)} className={`${btnGhost} w-full`}>Voltar</button>
        </form>
      ) : (
        <div className="-mt-1 space-y-1">
          {post.reposted ? (
            <MenuRow
              icon={<UndoIcon />}
              title="Desfazer repost"
              text="Tira esta publicação do teu perfil."
              disabled={busy}
              onClick={() => run(async () => onChange(await api.unrepost(post.id)))}
            />
          ) : (
            <MenuRow
              icon={<RepostIcon />}
              title="Repostar"
              text="Partilha no teu perfil, tal como está."
              disabled={busy}
              onClick={() => run(async () => { await api.repost(post.id); onChange({ reposted: true, reposts: post.reposts + 1 }); })}
            />
          )}
          <MenuRow icon={<PencilIcon />} title="Repostar com comentário" text="Acrescenta o que achas ao partilhar." onClick={() => setQuote(true)} />
          {err && <p role="alert" className="pt-1 text-center text-sm text-red-600">{err}</p>}
        </div>
      )}
    </Sheet>
  );
}
