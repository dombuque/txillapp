import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Icon, { type IconName } from '../components/Icon';
import StackPage from '../components/StackPage';
import { Avatar, btnGhost, timeAgo } from '../components/ui';
import { api, type AppNotification } from '../lib/api';

const ICON: Record<AppNotification['kind'], { name: IconName; color: string }> = {
  blocked: { name: 'block', color: 'text-red-600' },
  follow: { name: 'user-plus', color: 'text-sky-600' },
  follow_request: { name: 'bell', color: 'text-amber-600' },
  request_accepted: { name: 'check-circle', color: 'text-emerald-600' },
  gift: { name: 'gift', color: 'text-brand' },
  comment: { name: 'comment', color: 'text-sky-600' },
  reply: { name: 'comment', color: 'text-sky-600' },
  story_reply: { name: 'camera', color: 'text-violet-600' },
  repost: { name: 'repeat', color: 'text-emerald-600' },
  mention: { name: 'at', color: 'text-amber-600' },
  tag: { name: 'tag', color: 'text-violet-600' },
};

/** Texto de cada tipo de notificação. */
function describe(n: AppNotification): { text: ReactNode; sub?: string } {
  const quote = n.data.snippet ? `“${n.data.snippet}”` : undefined;
  switch (n.kind) {
    case 'blocked':
      return { text: <>bloqueou-te</>, sub: 'Já não podes seguir esta conta nem ver as publicações e stories dela.' };
    case 'follow':
      return { text: <>começou a seguir-te</> };
    case 'follow_request':
      return { text: <>pediu para te seguir</> };
    case 'request_accepted':
      return { text: <>aceitou o teu pedido para seguir</> };
    case 'gift':
      return { text: <>presenteou-te com <b>{(n.data.amount ?? 0).toLocaleString('pt-PT')} Txills</b> 🎁</>, sub: n.data.note ? `💌 ${n.data.note}` : undefined };
    case 'comment':
      return { text: <>comentou a tua publicação</>, sub: quote };
    case 'reply':
      return { text: <>respondeu ao teu comentário</>, sub: quote };
    case 'story_reply':
      if (n.data.replyKind === 'comment') return { text: <>comentou o teu story</>, sub: quote };
      return n.data.replyKind === 'reaction'
        ? { text: <>reagiu ao teu story {n.data.snippet}</> }
        : { text: <>respondeu ao teu story</>, sub: quote };
    case 'repost':
      return { text: <>repostou a tua publicação</>, sub: quote };
    case 'tag':
      return { text: <>identificou-te numa foto</> };
    case 'mention':
      return { text: <>mencionou-te</>, sub: quote };
  }
}

/** Para onde leva tocar numa notificação (o comentário, a publicação, a conversa, o perfil…). */
function targetOf(n: AppNotification): string | null {
  const post = n.data.postId;
  switch (n.kind) {
    case 'comment':
    case 'reply':
      return post ? `/p/${post}?comments=1` : null;
    case 'mention':
    case 'tag':
    case 'repost':
    case 'gift':
      return post ? `/p/${post}` : n.kind === 'gift' ? '/wallet' : `/u/${n.actor.username}`;
    case 'story_reply':
      return n.data.replyKind === 'comment' ? '/profile' : `/messages/${n.actor.username}`;
    case 'follow':
    case 'request_accepted':
      return `/u/${n.actor.username}`;
    default:
      return null; // pedidos de seguir (têm botões) e avisos de bloqueio
  }
}

function Row({ n, fresh }: { n: AppNotification; fresh: boolean }) {
  const navigate = useNavigate();
  const target = targetOf(n);
  const stop = { onClick: (e: React.MouseEvent) => e.stopPropagation() };
  const qc = useQueryClient();
  const [answer, setAnswer] = useState<'accepted' | 'declined' | null>(null);
  const [busy, setBusy] = useState(false);
  const { text, sub } = describe(n);

  async function respond(accept: boolean) {
    setBusy(true);
    try {
      await (accept ? api.acceptRequest(n.actor.username) : api.declineRequest(n.actor.username));
      setAnswer(accept ? 'accepted' : 'declined');
      qc.invalidateQueries({ queryKey: ['profile'] });
    } catch {
      setAnswer(null); // pedido já tratado noutro sítio
    } finally {
      setBusy(false);
    }
  }

  return (
    <li
      {...(target ? { role: 'link', tabIndex: 0, onClick: () => navigate(target), onKeyDown: (e: React.KeyboardEvent) => e.key === 'Enter' && navigate(target) } : {})}
      className={`flex gap-3 px-4 py-3.5 ${fresh ? 'bg-rose-50/70' : ''} ${target ? 'cursor-pointer transition active:bg-zinc-100' : ''}`}
    >
      <Link {...stop} to={`/u/${n.actor.username}`} aria-label={`Perfil de ${n.actor.displayName}`} className="relative shrink-0">
        <Avatar name={n.actor.displayName} username={n.actor.username} size={46} ring={false} />
        <span className="absolute -bottom-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full border-2 border-white bg-white text-sm shadow-sm" aria-hidden>
          <Icon name={ICON[n.kind].name} size={14} className={ICON[n.kind].color} strokeWidth={2.4} />
        </span>
      </Link>
      <div className="min-w-0 flex-1">
        <p className="break-words text-[15px] leading-snug text-zinc-900">
          <Link {...stop} to={`/u/${n.actor.username}`} className="font-bold">{n.actor.username}</Link> {text}{' '}
          <time className="whitespace-nowrap text-zinc-500" dateTime={n.createdAt}>{timeAgo(n.createdAt)}</time>
        </p>
        {sub && <p className="mt-1 line-clamp-3 break-words text-sm text-zinc-600">{sub}</p>}
        {n.kind === 'follow_request' && !answer && (
          <div className="mt-2.5 flex gap-2">
            <button disabled={busy} onClick={(e) => { e.stopPropagation(); respond(true); }} className="rounded-full bg-brand px-5 py-2 text-sm font-bold text-white transition active:scale-95">Aceitar</button>
            <button disabled={busy} onClick={(e) => { e.stopPropagation(); respond(false); }} className="rounded-full border border-zinc-300 px-5 py-2 text-sm font-semibold transition active:scale-95">Recusar</button>
          </div>
        )}
        {answer && <p role="status" className="mt-2 text-sm font-medium text-zinc-600">{answer === 'accepted' ? '✓ Pedido aceite' : 'Pedido recusado'}</p>}
      </div>
    </li>
  );
}

/** Notificações: bloqueios, seguidores, pedidos, presentes, comentários, respostas a stories e reposts. */
export default function Notifications() {
  const qc = useQueryClient();
  const q = useInfiniteQuery({
    queryKey: ['notifications'],
    queryFn: ({ pageParam }) => api.notifications(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (l) => l.nextCursor ?? undefined,
    refetchOnMount: 'always',
  });
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  // O que era novo quando abri fica destacado nesta visita, mesmo depois de marcado como lido.
  const freshIds = useRef<Set<string> | null>(null);
  if (q.isSuccess && freshIds.current === null) freshIds.current = new Set(items.filter((n) => !n.read).map((n) => n.id));

  useEffect(() => {
    if (!q.isSuccess) return;
    const t = setTimeout(() => {
      api.markNotificationsRead().then(() => qc.invalidateQueries({ queryKey: ['unread'] })).catch(() => undefined);
    }, 1200);
    return () => clearTimeout(t);
  }, [q.isSuccess, qc]);

  const fresh = items.filter((n) => freshIds.current?.has(n.id));
  const older = items.filter((n) => !freshIds.current?.has(n.id));

  return (
    <StackPage title="Notificações">
      {q.isLoading && <p className="py-12 text-center text-zinc-500">A ver o que aconteceu… 👀</p>}
      {q.isError && (
        <div role="alert" className="mx-6 mt-10 text-center">
          <p className="text-lg">Ups, não consegui carregar 😅</p>
          <button onClick={() => q.refetch()} className={`${btnGhost} mt-4`}>Tentar outra vez</button>
        </div>
      )}
      {q.isSuccess && items.length === 0 && (
        <div className="mx-6 mt-16 text-center">
          <p className="text-6xl" aria-hidden>🔕</p>
          <p className="mt-4 text-2xl font-extrabold">Tudo calmo por aqui</p>
          <p className="mt-2 text-lg font-light text-zinc-600">Quando alguém te seguir, comentar ou presentear, aparece aqui.</p>
        </div>
      )}
      {fresh.length > 0 && (
        <section aria-label="Novas">
          <h2 className="px-5 pb-1 pt-2 text-sm font-bold text-zinc-600">Novas</h2>
          <ul>{fresh.map((n) => <Row key={n.id} n={n} fresh />)}</ul>
        </section>
      )}
      {older.length > 0 && (
        <section aria-label="Anteriores">
          {fresh.length > 0 && <h2 className="px-5 pb-1 pt-4 text-sm font-bold text-zinc-600">Anteriores</h2>}
          <ul>{older.map((n) => <Row key={n.id} n={n} fresh={false} />)}</ul>
        </section>
      )}
      {q.hasNextPage && (
        <div className="mt-4 text-center">
          <button onClick={() => q.fetchNextPage()} disabled={q.isFetchingNextPage} className={btnGhost}>
            {q.isFetchingNextPage ? 'A carregar…' : 'Ver mais'}
          </button>
        </div>
      )}
    </StackPage>
  );
}
