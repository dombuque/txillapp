import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type FormEvent, type TouchEvent } from 'react';
import { api, type Comment, type Post } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Avatar, timeAgo } from './ui';

const QUICK = ['🍻', '🙌', '🔥', '👏', '😢', '😍', '😮', '😂'];

/** Menções (@utilizador) a destacar, como no Instagram. */
function Body({ text }: { text: string }) {
  return (
    <p className="whitespace-pre-wrap break-words text-[15px] leading-snug text-zinc-800">
      {text.split(/(@[\w.]+)/g).map((part, i) =>
        part.startsWith('@') ? (
          <span key={i} className="font-semibold text-brand">
            {part}
          </span>
        ) : (
          part
        ),
      )}
    </p>
  );
}

interface RowProps {
  c: Comment;
  canDelete: boolean;
  isReply?: boolean;
  onReply: (c: Comment) => void;
  onRemoved: (c: Comment) => void;
}

function Row({ c, canDelete, isReply, onReply, onRemoved }: RowProps) {
  const [cheer, setCheer] = useState({ cheered: c.cheered, cheers: c.cheers });
  const [gone, setGone] = useState(false);

  async function toggle() {
    const prev = cheer;
    setCheer({ cheered: !prev.cheered, cheers: prev.cheers + (prev.cheered ? -1 : 1) }); // optimista
    try {
      setCheer(await api.cheerComment(c.id));
    } catch {
      setCheer(prev);
    }
  }
  async function remove() {
    setGone(true);
    try {
      await api.deleteComment(c.id);
      onRemoved(c);
    } catch {
      setGone(false);
    }
  }
  if (gone) return null;

  return (
    <div className="flex gap-3 py-2.5">
      <Avatar name={c.author.displayName} size={isReply ? 28 : 36} />
      <div className="min-w-0 flex-1">
        <p className="text-sm">
          <span className="font-semibold">{c.author.username}</span>{' '}
          <span className="text-zinc-400">{timeAgo(c.createdAt)}</span>
        </p>
        <Body text={c.body} />
        <div className="mt-1 flex gap-4 text-xs font-semibold text-zinc-500">
          {cheer.cheers > 0 && <span>{cheer.cheers} {cheer.cheers === 1 ? 'brinde' : 'brindes'}</span>}
          <button onClick={() => onReply(c)}>Responder</button>
          {canDelete && <button onClick={remove}>Apagar</button>}
        </div>
      </div>
      <button
        onClick={toggle}
        aria-label={cheer.cheered ? 'Tirar o brinde' : 'Brindar comentário'}
        aria-pressed={cheer.cheered}
        className={`self-start pt-1 text-lg transition active:scale-125 ${cheer.cheered ? '' : 'opacity-40 grayscale'}`}
      >
        🍻
      </button>
    </div>
  );
}

interface ThreadProps {
  c: Comment;
  expanded: boolean;
  toggle: () => void;
  canDeleteFor: (c: Comment) => boolean;
  onReply: (c: Comment) => void;
  onRemoved: (c: Comment) => void;
}

function Replies({ c, expanded, toggle, canDeleteFor, onReply, onRemoved }: ThreadProps) {
  const q = useInfiniteQuery({
    queryKey: ['replies', c.id],
    queryFn: ({ pageParam }) => api.replies(c.id, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (l) => l.nextCursor ?? undefined,
    enabled: expanded && c.replyCount > 0,
  });
  if (c.replyCount === 0) return null;
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <div className="ml-12">
      <button onClick={toggle} className="flex items-center gap-3 py-1 text-xs font-semibold text-zinc-500">
        <span className="h-px w-7 bg-zinc-300" />
        {expanded ? 'Ocultar respostas' : `Ver ${c.replyCount} ${c.replyCount === 1 ? 'resposta' : 'respostas'}`}
      </button>
      {expanded && (
        <div>
          {items.map((r) => (
            <Row key={r.id} c={r} isReply canDelete={canDeleteFor(r)} onReply={onReply} onRemoved={onRemoved} />
          ))}
          {q.isLoading && <div className="py-2 text-sm text-zinc-400">A carregar…</div>}
          {q.hasNextPage && (
            <div>
              <button onClick={() => q.fetchNextPage()} className="flex items-center gap-3 py-1 text-xs font-semibold text-zinc-500">
                <span className="h-px w-7 bg-zinc-300" />
                Ver mais respostas
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function CommentsSheet({ post, onClose, onDelta }: { post: Post; onClose: () => void; onDelta: (n: number) => void }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState('');
  const [replyTo, setReplyTo] = useState<Comment | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [dragY, setDragY] = useState(0);
  const startY = useRef<number | null>(null);

  const q = useInfiniteQuery({
    queryKey: ['comments', post.id],
    queryFn: ({ pageParam }) => api.comments(post.id, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (l) => l.nextCursor ?? undefined,
  });
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  const canDeleteFor = (c: Comment) => c.author.id === user?.id || post.author.id === user?.id;

  function reply(c: Comment) {
    setReplyTo(c);
    setText(`@${c.author.username} `);
    setExpanded((s) => new Set(s).add(c.parentId ?? c.id));
    inputRef.current?.focus();
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const body = text.trim();
    if (!body || busy) return;
    setBusy(true);
    setErr('');
    try {
      const c = await api.addComment(post.id, body, replyTo?.id);
      onDelta(1);
      setText('');
      setReplyTo(null);
      if (c.parentId) {
        setExpanded((s) => new Set(s).add(c.parentId!));
        await qc.invalidateQueries({ queryKey: ['replies', c.parentId] });
      }
      await qc.invalidateQueries({ queryKey: ['comments', post.id] });
    } catch (x) {
      setErr((x as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function removed(c: Comment) {
    onDelta(-(1 + c.replyCount));
    qc.invalidateQueries({ queryKey: ['comments', post.id] });
    if (c.parentId) qc.invalidateQueries({ queryKey: ['replies', c.parentId] });
  }

  // Arrastar o cabeçalho para baixo fecha a folha (gesto típico de telemóvel).
  const onTouchStart = (e: TouchEvent) => (startY.current = e.touches[0].clientY);
  const onTouchMove = (e: TouchEvent) => {
    if (startY.current !== null) setDragY(Math.max(0, e.touches[0].clientY - startY.current));
  };
  const onTouchEnd = () => {
    if (dragY > 100) onClose();
    setDragY(0);
    startY.current = null;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" onClick={onClose} role="presentation">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Comentários"
        style={{ transform: `translateY(${dragY}px)`, transition: dragY ? 'none' : 'transform .2s' }}
        className="animate-[rise_.25s_ease-out] flex h-[78dvh] w-full max-w-xl flex-col rounded-t-[28px] bg-white"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="touch-none border-b border-zinc-200 pb-3 pt-2.5" onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}>
          <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-zinc-300" aria-hidden />
          <h2 className="text-center text-base font-bold">Comentários</h2>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-2">
          {q.isLoading && <p className="py-10 text-center text-zinc-400">A carregar a conversa…</p>}
          {q.isError && <p role="alert" className="py-10 text-center text-red-600">Ups, não consegui carregar 😅</p>}
          {q.isSuccess && items.length === 0 && (
            <div className="py-14 text-center">
              <p className="text-4xl">🤐</p>
              <p className="mt-2 text-lg font-bold">Ainda ninguém disse nada</p>
              <p className="text-zinc-500">Sê o primeiro a puxar conversa</p>
            </div>
          )}
          <div>
            {items.map((c) => (
              <div key={c.id}>
                <Row c={c} canDelete={canDeleteFor(c)} onReply={reply} onRemoved={removed} />
                <Replies
                  c={c}
                  expanded={expanded.has(c.id)}
                  toggle={() => setExpanded((s) => { const n = new Set(s); n.has(c.id) ? n.delete(c.id) : n.add(c.id); return n; })}
                  canDeleteFor={canDeleteFor}
                  onReply={reply}
                  onRemoved={removed}
                />
              </div>
            ))}
          </div>
          {q.hasNextPage && (
            <button onClick={() => q.fetchNextPage()} disabled={q.isFetchingNextPage} className="mx-auto my-3 block text-sm font-semibold text-zinc-500">
              {q.isFetchingNextPage ? 'A carregar…' : 'Ver mais comentários'}
            </button>
          )}
        </div>

        <div className="border-t border-zinc-200 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          {replyTo && (
            <div className="flex items-center justify-between bg-zinc-100 px-4 py-2 text-sm text-zinc-600">
              <span>A responder a <b>{replyTo.author.displayName}</b></span>
              <button onClick={() => { setReplyTo(null); setText(''); }} aria-label="Cancelar resposta" className="px-2 text-lg">×</button>
            </div>
          )}
          <div className="flex justify-between px-4 pt-2 text-2xl">
            {QUICK.map((e) => (
              <button key={e} onClick={() => { setText((t) => t + e); inputRef.current?.focus(); }} aria-label={`Adicionar ${e}`} className="active:scale-125">
                {e}
              </button>
            ))}
          </div>
          <form onSubmit={submit} className="flex items-center gap-3 px-4 pt-2">
            <Avatar name={user?.displayName ?? '?'} size={36} />
            <div className="flex flex-1 items-center rounded-full border border-zinc-300 pl-4 pr-2">
              <input
                ref={inputRef}
                value={text}
                onChange={(e) => setText(e.target.value)}
                maxLength={1000}
                placeholder={replyTo ? `Responder a ${replyTo.author.username}…` : 'Diz lá… 💬'}
                aria-label="Escrever comentário"
                className="min-w-0 flex-1 bg-transparent py-2.5 text-[15px] outline-none"
              />
              <button disabled={!text.trim() || busy} className="px-2 py-1 font-semibold text-brand disabled:opacity-40">
                Publicar
              </button>
            </div>
          </form>
          <p role="alert" className="px-4 text-center text-sm text-red-600">{err}</p>
        </div>
      </div>
    </div>
  );
}
