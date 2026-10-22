import { useQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { useRef, useState, type FormEvent } from 'react';
import { api, type Post } from '../lib/api';
import { useAuth } from '../lib/auth';
import { CommentIcon, GiftIcon } from './icons';
import { Avatar, Sheet, btnPrimary, inputCls, timeAgo } from './ui';

type Feed = InfiniteData<{ items: Post[]; nextCursor: string | null }>;

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

  const action = 'flex flex-1 items-center justify-center gap-2 py-4 text-[17px] font-medium text-zinc-800';
  return (
    <article className="mx-4 mb-6 rounded-[28px] bg-white px-5 pt-5 shadow-[0_2px_16px_rgba(0,0,0,0.09)]">
      <header className="flex items-center gap-3">
        <Avatar name={post.author.displayName} size={52} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[19px] font-medium leading-tight text-zinc-800">{post.author.displayName}</p>
          <p className="truncate text-[15px] text-zinc-400">{post.locationLabel ?? `@${post.author.username}`}</p>
        </div>
        <time className="self-start text-[15px] text-zinc-400" dateTime={post.createdAt}>
          {timeAgo(post.createdAt)}
        </time>
      </header>
      <p className="mt-4 whitespace-pre-wrap break-words text-[19px] text-zinc-800">{post.body}</p>
      {post.mediaUrl && (
        <img src={post.mediaUrl} alt="" loading="lazy" className="mt-3 max-h-[28rem] w-full rounded-xl object-cover" />
      )}
      <div className="mt-4 flex items-center gap-5 text-[15px] text-zinc-800">
        <span className="flex items-center gap-1.5">🍻 {post.cheers}</span>
        <span className="flex items-center gap-1.5">
          <GiftIcon width={18} height={18} /> {post.gifts}
        </span>
        <button className="ml-auto" onClick={() => setSheet('comments')}>
          {post.comments} Comentários
        </button>
      </div>
      <div className="mt-4 flex border-t border-zinc-300">
        <button onClick={cheer} aria-pressed={post.cheered} className={`${action} ${post.cheered ? '!text-green-700' : ''}`}>
          <span className="text-2xl">🍻</span> Brindou
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
      {sheet === 'comments' && <CommentsSheet post={post} onClose={() => setSheet(null)} onAdded={(n) => patch({ comments: n })} />}
      {sheet === 'gift' && <GiftSheet post={post} onClose={() => setSheet(null)} onDone={(p) => patch(p)} />}
    </article>
  );
}

function CommentsSheet({ post, onClose, onAdded }: { post: Post; onClose: () => void; onAdded: (n: number) => void }) {
  const qc = useQueryClient();
  const key = ['comments', post.id];
  const { data, refetch } = useCommentsQuery(post.id);
  const [text, setText] = useState('');
  const [err, setErr] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    try {
      const list = await api.addComment(post.id, text);
      qc.setQueryData(key, list);
      onAdded(list.length);
      setText('');
      refetch();
    } catch (x) {
      setErr((x as Error).message);
    }
  }
  return (
    <Sheet title="Comentários" onClose={onClose}>
      <ul className="mb-4 space-y-3">
        {data?.length === 0 && <li className="text-zinc-400">Seja o primeiro a comentar.</li>}
        {data?.map((c) => (
          <li key={c.id}>
            <span className="font-semibold">{c.author.displayName}</span> <span className="text-zinc-400">{timeAgo(c.createdAt)}</span>
            <p className="break-words">{c.body}</p>
          </li>
        ))}
      </ul>
      <form onSubmit={submit} className="flex gap-2">
        <input value={text} onChange={(e) => setText(e.target.value)} maxLength={1000} placeholder="Escreva um comentário…" className={inputCls} />
        <button className={btnPrimary}>Enviar</button>
      </form>
      {err && <p role="alert" className="mt-2 text-sm text-red-600">{err}</p>}
    </Sheet>
  );
}

const useCommentsQuery = (id: string) => useQuery({ queryKey: ['comments', id], queryFn: () => api.comments(id) });

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
      setErr((x as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Sheet title={`Presentear ${post.author.displayName}`} onClose={onClose}>
      {sent ? (
        <p className="py-6 text-center text-lg">🎁 Presente de {amount} Txills enviado!</p>
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
                className={`flex-1 rounded-xl border py-2 font-semibold ${amount === v ? 'border-zinc-900 bg-zinc-900 text-white' : 'border-zinc-200'}`}
              >
                {v}
              </button>
            ))}
          </div>
          <p className="text-sm text-zinc-500">Txills de demonstração (sem valor real).</p>
          {err && <p role="alert" className="text-sm text-red-600">{err}</p>}
          <button disabled={busy} onClick={send} className={`${btnPrimary} w-full`}>
            Enviar {amount} Txills
          </button>
        </div>
      )}
    </Sheet>
  );
}
