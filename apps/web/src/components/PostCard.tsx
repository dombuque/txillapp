import { useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { api, type Page, type Post } from '../lib/api';
import { useAuth } from '../lib/auth';
import CommentsSheet from './CommentsSheet';
import { CommentIcon, GiftIcon } from './icons';
import { Avatar, Sheet, btnPrimary, timeAgo } from './ui';

type Feed = InfiniteData<Page<Post>>;

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

export default function PostCard({ post }: { post: Post }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [sheet, setSheet] = useState<'comments' | 'gift' | null>(null);

  const patch = (p: Partial<Post>) =>
    qc.setQueryData<Feed>(['feed'], (d) =>
      d && { ...d, pages: d.pages.map((pg) => ({ ...pg, items: pg.items.map((i) => (i.id === post.id ? { ...i, ...p } : i)) })) },
    );

  async function cheer() {
    patch({ cheered: !post.cheered, cheers: post.cheers + (post.cheered ? -1 : 1) }); // optimista
    try {
      patch(await api.cheer(post.id));
    } catch {
      patch({ cheered: post.cheered, cheers: post.cheers });
    }
  }

  const action = 'flex flex-1 items-center justify-center gap-2 py-4 text-[17px] font-medium text-zinc-800 transition active:scale-95';
  const g = post.gift;
  return (
    <article className="mx-4 mb-6 rounded-[28px] bg-white px-5 pt-5 shadow-[0_2px_16px_rgba(0,0,0,0.09)]">
      <header className="flex items-center gap-3">
        <Avatar name={post.author.displayName} size={52} />
        <div className="min-w-0 flex-1">
          {g ? (
            <p className="text-[17px] leading-tight text-zinc-800">
              <b>{post.author.displayName}</b> presenteou <b>{g.recipient.displayName}</b> 🎁
            </p>
          ) : (
            <p className="truncate text-[19px] font-medium leading-tight text-zinc-800">{post.author.displayName}</p>
          )}
          <p className="truncate text-[15px] text-zinc-400">{post.locationLabel ?? `@${post.author.username}`}</p>
        </div>
        <time className="self-start text-[15px] text-zinc-400" dateTime={post.createdAt}>
          {timeAgo(post.createdAt)}
        </time>
      </header>
      {g && (
        <p className="mt-4 rounded-2xl bg-gradient-to-r from-brand to-rose-400 py-3 text-center text-2xl font-extrabold text-white">
          🎁 {g.amount.toLocaleString('pt-PT')} Txills
        </p>
      )}
      {post.body && <p className="mt-4 whitespace-pre-wrap break-words text-[19px] text-zinc-800">{post.body}</p>}
      <Carousel media={post.media} />
      <div className="mt-4 flex items-center gap-5 text-[15px] text-zinc-800">
        <span className="flex items-center gap-1.5">🍻 {post.cheers}</span>
        <span className="flex items-center gap-1.5">
          <GiftIcon width={18} height={18} /> {post.gifts}
        </span>
        <button className="ml-auto" onClick={() => setSheet('comments')}>
          {post.comments} {post.comments === 1 ? 'Comentário' : 'Comentários'}
        </button>
      </div>
      <div className="mt-4 flex border-t border-zinc-300">
        <button onClick={cheer} aria-pressed={post.cheered} className={`${action} ${post.cheered ? '!text-green-700' : ''}`}>
          <span key={String(post.cheered)} className={`text-2xl ${post.cheered ? 'animate-[pop_.4s_ease-out]' : ''}`}>🍻</span>
          {post.cheered ? 'Brindou' : 'Brindar'}
        </button>
        <button onClick={() => setSheet('comments')} className={action}>
          <CommentIcon /> Comentar
        </button>
        {user?.id !== post.author.id && (
          <button onClick={() => setSheet('gift')} className={action}>
            <GiftIcon /> Presentear
          </button>
        )}
      </div>
      {sheet === 'comments' && <CommentsSheet post={post} onClose={() => setSheet(null)} onDelta={(d) => patch({ comments: Math.max(0, post.comments + d) })} />}
      {sheet === 'gift' && <GiftSheet post={post} onClose={() => setSheet(null)} onDone={(p) => patch(p)} />}
    </article>
  );
}

function GiftSheet({ post, onClose, onDone }: { post: Post; onClose: () => void; onDone: (p: Partial<Post>) => void }) {
  const qc = useQueryClient();
  const keyRef = useRef(api.newKey()); // mesma chave em retentativas = sem presente duplicado
  const [amount, setAmount] = useState(10);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [sent, setSent] = useState(false);

  async function send() {
    setBusy(true);
    setErr('');
    try {
      const r = await api.gift(post.id, amount, keyRef.current);
      onDone({ gifts: r.post.gifts });
      qc.invalidateQueries({ queryKey: ['wallet'] });
      setSent(true);
    } catch (x) {
      const m = (x as Error).message;
      setErr(m === 'Saldo insuficiente' ? 'Ups, o teu saldo não chega 😬' : m);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Sheet title={`Presentear ${post.author.displayName} 🎁`} onClose={onClose}>
      {sent ? (
        <p className="py-6 text-center text-lg">🎁 Mandaste {amount} Txills! Que generoso 😍</p>
      ) : (
        <div className="space-y-4">
          <div className="flex gap-2">
            {[5, 10, 50, 100].map((v) => (
              <button
                key={v}
                onClick={() => {
                  setAmount(v);
                  keyRef.current = api.newKey();
                }}
                className={`flex-1 rounded-full border py-2.5 font-semibold transition active:scale-95 ${amount === v ? 'border-brand bg-brand text-white' : 'border-zinc-300'}`}
              >
                {v}
              </button>
            ))}
          </div>
          <p role="alert" className="min-h-5 text-sm text-red-600">{err}</p>
          <button disabled={busy} onClick={send} className={`${btnPrimary} w-full`}>
            Mandar {amount} Txills
          </button>
        </div>
      )}
    </Sheet>
  );
}
