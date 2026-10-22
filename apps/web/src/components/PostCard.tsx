import { useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { api, type Page, type Post } from '../lib/api';
import { useAuth } from '../lib/auth';
import CommentsSheet from './CommentsSheet';
import GiftSheet from './GiftSheet';
import { CommentIcon, GiftIcon, PencilIcon, RepostIcon, UndoIcon } from './icons';
import { Avatar, Sheet, btnGhost, btnPrimary, fieldInput, timeAgo } from './ui';

type Feed = InfiniteData<Page<Post>>;

/** O meu perfil vive em /profile; os outros em /u/:username. */
export const profilePath = (username: string, me?: string) => (username === me ? '/profile' : `/u/${username}`);

/** Carrossel de fotos: deslizar na horizontal, com contador e pontos como no Instagram. */
function Carousel({ media }: { media: Post['media'] }) {
  const [i, setI] = useState(0);
  if (media.length === 0) return null;
  return (
    <div className="relative mt-3">
      <div
        onScroll={(e) => setI(Math.round(e.currentTarget.scrollLeft / e.currentTarget.clientWidth))}
        className="flex snap-x snap-mandatory overflow-x-auto rounded-xl [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {media.map((m, n) => (
          <img key={m.url} src={m.url} alt={`Foto ${n + 1} de ${media.length}`} loading="lazy" className="max-h-[28rem] w-full shrink-0 snap-center object-cover" />
        ))}
      </div>
      {media.length > 1 && (
        <>
          <span className="absolute right-3 top-3 rounded-full bg-black/60 px-2.5 py-1 text-xs font-semibold text-white">
            {i + 1}/{media.length}
          </span>
          <div className="mt-2 flex justify-center gap-1.5" aria-hidden>
            {media.map((_, n) => (
              <span key={n} className={`h-1.5 w-1.5 rounded-full ${n === i ? 'bg-brand' : 'bg-zinc-300'}`} />
            ))}
          </div>
        </>
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
          <PostBody post={post.repostOf} />
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
  const g = post.gift;
  return (
    <article className="mx-4 mb-6 rounded-[28px] bg-white px-5 pt-5 shadow-[0_2px_16px_rgba(0,0,0,0.09)]">
      <header className="flex items-center gap-3">
        <Link to={profilePath(post.author.username, user?.username)} aria-label={`Perfil de ${post.author.displayName}`}>
          <Avatar name={post.author.displayName} username={post.author.username} size={52} />
        </Link>
        <div className="min-w-0 flex-1">
          {g ? (
            <p className="text-[17px] leading-tight text-zinc-800">
              <Link to={profilePath(post.author.username, user?.username)} className="font-bold">{post.author.displayName}</Link> presenteou{' '}
              <Link to={profilePath(g.recipient.username, user?.username)} className="font-bold">{g.recipient.displayName}</Link> 🎁
            </p>
          ) : (
            <Link to={profilePath(post.author.username, user?.username)} className="block truncate text-[19px] font-medium leading-tight text-zinc-800">
              {post.author.displayName}
            </Link>
          )}
          <p className="truncate text-[15px] text-zinc-500">{post.locationLabel ?? `@${post.author.username}`}</p>
        </div>
        <time className="self-start text-[15px] text-zinc-500" dateTime={post.createdAt}>
          {timeAgo(post.createdAt)}
        </time>
      </header>
      {g && (
        <p className="mt-4 rounded-2xl bg-gradient-to-r from-brand to-brand-light py-3 text-center text-2xl font-extrabold text-white">
          🎁 {g.amount.toLocaleString('pt-PT')} Txills
        </p>
      )}
      {post.body && <p className="mt-4 whitespace-pre-wrap break-words text-[19px] text-zinc-800">{post.body}</p>}
      <Carousel media={post.media} />
      <Actions post={post} />
    </article>
  );
}

/** Repost com comentário: o texto de quem reposta e, por baixo, a publicação original numa caixa. */
function QuoteCard({ post, original }: { post: Post; original: Post }) {
  const { user } = useAuth();
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
      </header>
      <p className="mt-4 whitespace-pre-wrap break-words text-[19px] text-zinc-800">{post.body}</p>
      <div className="mt-3 overflow-hidden rounded-2xl border border-zinc-200">
        <div className="flex items-center gap-2.5 px-3 pt-3">
          <Link to={profilePath(original.author.username, user?.username)} className="flex min-w-0 items-center gap-2.5">
            <Avatar name={original.author.displayName} username={original.author.username} size={30} ring={false} />
            <span className="truncate font-semibold">{original.author.displayName}</span>
          </Link>
          <span className="shrink-0 text-sm text-zinc-500">· {timeAgo(original.createdAt)}</span>
        </div>
        {original.body && <p className="line-clamp-4 whitespace-pre-wrap break-words px-3 pt-2 text-[16px] text-zinc-800">{original.body}</p>}
        {original.media[0] ? <img src={original.media[0].url} alt="" loading="lazy" className="mt-2 max-h-72 w-full object-cover" /> : <div className="h-3" />}
      </div>
      <Actions post={post} />
    </article>
  );
}

/** Barra de ações: só ícones com contador, como nas redes sociais. */
function Actions({ post }: { post: Post }) {
  const { user } = useAuth();
  const patch = usePatch(post.id);
  const [sheet, setSheet] = useState<'comments' | 'gift' | 'repost' | null>(null);
  const mine = post.author.id === user?.id;

  async function cheer() {
    patch({ cheered: !post.cheered, cheers: post.cheers + (post.cheered ? -1 : 1) }); // optimista
    try {
      patch(await api.cheer(post.id));
    } catch {
      patch({ cheered: post.cheered, cheers: post.cheers });
    }
  }

  const btn = 'flex min-h-12 items-center justify-center gap-1.5 px-2 text-zinc-800 transition active:scale-95';
  const count = (n: number) => (n > 0 ? <span className="text-[15px] tabular-nums">{n}</span> : null);
  const Item = ({ label, children, onClick, pressed, className = 'flex-1' }: { label: string; children: ReactNode; onClick: () => void; pressed?: boolean; className?: string }) => (
    <button onClick={onClick} aria-label={label} aria-pressed={pressed} className={`${btn} ${className} ${pressed ? '!text-green-700' : ''}`}>
      {children}
    </button>
  );

  return (
    <>
      <div className="mt-3 flex items-center border-t border-zinc-200">
        <Item label={post.cheered ? 'Tirar o brinde' : 'Brindar'} onClick={cheer} pressed={post.cheered} className="flex-[1.6] justify-start">
          <span key={String(post.cheered)} className={`text-2xl ${post.cheered ? 'animate-[pop_.4s_ease-out]' : ''}`}>🍻</span>
          <span className="text-[16px] font-medium">{post.cheered ? 'Brindou' : 'Brindar'}</span>
          {count(post.cheers)}
        </Item>
        <Item label={`Comentários (${post.comments})`} onClick={() => setSheet('comments')}>
          <CommentIcon />
          {count(post.comments)}
        </Item>
        {!mine && post.kind === 'post' && (
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
            <span role="img" aria-label={`${post.gifts} ${post.gifts === 1 ? 'presente' : 'presentes'}`} className="flex min-h-12 flex-1 items-center justify-center gap-1.5 px-2 text-zinc-600">
              <GiftIcon />
              {count(post.gifts)}
            </span>
          )
        )}
      </div>
      {sheet === 'comments' && <CommentsSheet post={post} onClose={() => setSheet(null)} onDelta={(d) => patch({ comments: Math.max(0, post.comments + d) })} />}
      {sheet === 'gift' && <GiftSheet postId={post.id} recipient={post.author} onClose={() => setSheet(null)} />}
      {sheet === 'repost' && <RepostSheet post={post} onChange={patch} onClose={() => setSheet(null)} />}
    </>
  );
}

/** Linha de menu de uma folha: ícone em círculo, título e uma linha a explicar. */
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

function RepostSheet({ post, onChange, onClose }: { post: Post; onChange: (p: Partial<Post>) => void; onClose: () => void }) {
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
    <Sheet title={quote ? 'Repostar com comentário' : 'Repostar'} onClose={onClose}>
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
          <textarea value={text} onChange={(e) => setText(e.target.value)} maxLength={500} rows={3} autoFocus placeholder="O que achas? ✍️" aria-label="Comentário" className={`${fieldInput} resize-none`} />
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
