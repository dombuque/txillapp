import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import EditProfileSheet from '../components/EditProfileSheet';
import FollowButton from '../components/FollowButton';
import GiftSheet from '../components/GiftSheet';
import PostCard from '../components/PostCard';
import { BackIcon } from '../components/icons';
import { Avatar, Sheet, btnGhost, btnPrimary } from '../components/ui';
import { ApiError, api, type Person, type Post } from '../lib/api';
import { useAuth } from '../lib/auth';

type SheetName = null | 'edit' | 'followers' | 'following' | 'requests' | 'menu' | 'block' | 'gift';

/** Perfil de qualquer pessoa (/u/:username) e o meu (/profile). */
export default function ProfilePage() {
  const { username: param } = useParams();
  const { user } = useAuth();
  const qc = useQueryClient();
  const username = param ?? user!.username;
  const navigate = useNavigate();
  const [sheet, setSheet] = useState<SheetName>(null);
  const [openPost, setOpenPost] = useState<Post | null>(null);
  const close = () => setSheet(null);

  const q = useQuery({ queryKey: ['profile', username], queryFn: () => api.profile(username), retry: false });
  const p = q.data;
  const posts = useInfiniteQuery({
    queryKey: ['profile-posts', username],
    queryFn: ({ pageParam }) => api.userPosts(username, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (l) => l.nextCursor ?? undefined,
    enabled: !!p?.canView,
  });
  const items = posts.data?.pages.flatMap((x) => x.items) ?? [];

  if (q.isError) {
    const missing = q.error instanceof ApiError && q.error.status === 404;
    return (
      <div className="mx-6 mt-16 text-center">
        <p className="text-5xl">{missing ? '🕵️' : '😅'}</p>
        <p className="mt-3 text-xl font-bold">{missing ? 'Essa pessoa não existe' : 'Não consegui abrir este perfil'}</p>
        <button onClick={() => navigate(-1)} className={`${btnGhost} mt-6`}>Voltar</button>
      </div>
    );
  }
  if (!p) return <div className="mx-4 mt-6 h-64 animate-pulse rounded-[28px] bg-zinc-100" aria-label="A carregar" />;

  const blocked = p.blockedByMe || p.blockedMe;
  const stat = (n: number, label: string, onClick?: () => void) => (
    <button onClick={onClick} disabled={!onClick} className="min-h-12 flex-1 text-center disabled:cursor-default">
      <span className="block text-xl font-extrabold">{n.toLocaleString('pt-PT')}</span>
      <span className="text-sm text-zinc-600">{label}</span>
    </button>
  );

  async function unblock() {
    await api.unblock(p!.username);
    await qc.invalidateQueries({ queryKey: ['profile'] });
    qc.invalidateQueries({ queryKey: ['blocked'] });
  }
  async function block() {
    await api.block(p!.username);
    for (const key of ['profile', 'feed', 'stories', 'suggestions', 'blocked']) qc.invalidateQueries({ queryKey: [key] });
    close();
  }

  return (
    <div className="pb-6">
      {p.isMe ? (
        <div className="flex items-center justify-between px-5 pb-2">
          <p className="font-semibold">@{p.username}</p>
          <button onClick={() => navigate('/settings')} aria-label="Definições e privacidade" className="-mr-2 flex h-11 w-11 items-center justify-center rounded-full text-zinc-900 transition active:scale-90">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
              <path d="M4 7h16M4 12h16M4 17h16" />
            </svg>
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-1 px-2 pb-2">
          <button onClick={() => navigate(-1)} aria-label="Voltar" className="flex h-11 w-11 items-center justify-center text-zinc-900"><BackIcon /></button>
          <p className="min-w-0 flex-1 truncate font-semibold">@{p.username}</p>
          <button onClick={() => setSheet('menu')} aria-label="Mais opções" className="flex h-11 w-11 items-center justify-center rounded-full text-zinc-900 transition active:bg-zinc-100">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden><circle cx="5" cy="12" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="19" cy="12" r="2" /></svg>
          </button>
        </div>
      )}

      <section className="mx-4 rounded-[28px] bg-white px-5 pb-5 pt-6 shadow-[0_2px_16px_rgba(0,0,0,0.09)]">
        <div className="flex flex-col items-center text-center">
          <Avatar name={p.displayName} username={p.hasAvatar ? p.username : undefined} size={96} />
          <h1 className="mt-4 text-2xl font-extrabold leading-tight">
            {p.displayName} {p.isPrivate && <span title="Conta privada" aria-label="Conta privada">🔒</span>}
          </h1>
          <p className="text-zinc-600">
            @{p.username}
            {!p.isMe && p.followsYou && !blocked && <span className="ml-2 rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-semibold text-zinc-700">Segue-te</span>}
          </p>
          {p.bio && <p className="mt-3 max-w-sm whitespace-pre-wrap break-words text-[15px] text-zinc-800">{p.bio}</p>}
          {!p.bio && p.isMe && (
            <button onClick={() => setSheet('edit')} className="mt-3 text-sm font-medium text-zinc-600 underline">Adiciona uma bio ✍️</button>
          )}
        </div>

        <div className="mt-5 flex border-y border-zinc-100 py-2">
          {stat(p.counts.posts, 'publicações')}
          {stat(p.counts.followers, 'seguidores', p.canSeeConnections ? () => setSheet('followers') : undefined)}
          {stat(p.counts.following, 'a seguir', p.canSeeConnections ? () => setSheet('following') : undefined)}
        </div>

        {/* Bloqueio ao estilo do X: o cabeçalho fica visível, com o aviso. */}
        {p.blockedMe && (
          <div role="status" className="mt-4 rounded-2xl bg-zinc-100 p-4 text-center">
            <p className="font-bold">🚫 Foste bloqueado por @{p.username}</p>
            <p className="mt-1 text-sm text-zinc-600">Não podes seguir esta conta nem ver as publicações e stories dela.</p>
          </div>
        )}
        {p.blockedByMe && !p.blockedMe && (
          <div className="mt-4 rounded-2xl bg-zinc-100 p-4 text-center">
            <p className="font-bold">🚫 Bloqueaste @{p.username}</p>
            <p className="mt-1 text-sm text-zinc-600">A pessoa não vê o teu conteúdo nem te pode seguir.</p>
            <button onClick={unblock} className={`${btnGhost} mt-3 !py-2.5`}>Desbloquear</button>
          </div>
        )}

        {!blocked && (
          <div className="mt-4 flex justify-center gap-3">
            {p.isMe ? (
              <button onClick={() => setSheet('edit')} className={`${btnGhost} flex-1`}>Editar perfil</button>
            ) : (
              <>
                <div className="flex-1">
                  <FollowButton username={p.username} following={p.following} requested={p.requested} isPrivate={p.isPrivate} large />
                </div>
                {/* Só se presenteia quem se segue. */}
                {p.following && <button onClick={() => setSheet('gift')} className={`${btnGhost} whitespace-nowrap !px-4`}>🎁 Presentear</button>}
              </>
            )}
          </div>
        )}

        {p.isMe && p.pendingRequests > 0 && (
          <button onClick={() => setSheet('requests')} className="mt-4 flex w-full items-center justify-between rounded-2xl bg-rose-50 px-4 py-3 font-semibold text-brand">
            <span>👋 Pedidos para seguir</span>
            <span className="rounded-full bg-brand px-2.5 py-0.5 text-sm text-white">{p.pendingRequests}</span>
          </button>
        )}
      </section>

      {!p.canView && !blocked ? (
        <div className="mx-4 mt-6 rounded-[28px] bg-white p-8 text-center shadow-[0_2px_16px_rgba(0,0,0,0.09)]">
          <p className="text-5xl">🔒</p>
          <p className="mt-3 text-xl font-extrabold">Esta conta é privada</p>
          <p className="mt-1 text-zinc-600">
            {p.requested ? 'Pedido enviado. Quando aceitar, vês as publicações e stories.' : 'Segue para ver as publicações e stories.'}
          </p>
        </div>
      ) : (
        p.canView && (
          <section className="mt-6 px-4" aria-label="Publicações">
            {posts.isSuccess && items.length === 0 && (
              <div className="mt-8 text-center text-zinc-600">
                <p className="text-4xl">📷</p>
                <p className="mt-2 font-semibold">{p.isMe ? 'Ainda não publicaste nada' : 'Ainda sem publicações'}</p>
                {p.isMe && <Link to="/new" className="mt-3 inline-block font-semibold text-brand underline">Faz a primeira!</Link>}
              </div>
            )}
            <div className="grid grid-cols-3 gap-1.5">
              {items.map((post) => {
                const shown = post.kind === 'repost' && post.repostOf ? post.repostOf : post;
                return (
                  <button key={post.id} onClick={() => setOpenPost(post)} aria-label={`Abrir publicação: ${post.body || shown.body || 'foto'}`} className="relative aspect-square overflow-hidden rounded-xl bg-rose-50 text-left active:opacity-80">
                    {shown.media[0] ? (
                      <img src={shown.media[0].url} alt="" loading="lazy" className="h-full w-full object-cover" />
                    ) : (
                      <span className="flex h-full w-full items-center justify-center p-2 text-center text-xs font-medium leading-snug text-zinc-700">
                        {post.gift ? '🎁 ' : ''}{(post.body || shown.body).slice(0, 70)}
                      </span>
                    )}
                    {shown.media.length > 1 && <span className="absolute right-1.5 top-1.5 rounded-full bg-black/55 px-1.5 text-[10px] font-bold text-white">▣ {shown.media.length}</span>}
                    {post.kind === 'repost' && <span className="absolute left-1.5 top-1.5 rounded-full bg-black/55 px-1.5 text-[10px] font-bold text-white">🔁</span>}
                  </button>
                );
              })}
            </div>
            {posts.hasNextPage && (
              <div className="mt-4 text-center">
                <button onClick={() => posts.fetchNextPage()} disabled={posts.isFetchingNextPage} className={btnGhost}>
                  {posts.isFetchingNextPage ? 'A carregar…' : 'Ver mais'}
                </button>
              </div>
            )}
          </section>
        )
      )}

      {sheet === 'edit' && <EditProfileSheet profile={p} onClose={close} />}
      {sheet === 'followers' && <PeopleSheet title="Seguidores" username={p.username} kind="followers" meUsername={user!.username} onClose={close} />}
      {sheet === 'following' && <PeopleSheet title="A seguir" username={p.username} kind="following" meUsername={user!.username} onClose={close} />}
      {sheet === 'requests' && <RequestsSheet myUsername={p.username} onClose={close} />}
      {sheet === 'gift' && <GiftSheet recipient={{ username: p.username, displayName: p.displayName }} onClose={close} />}
      {sheet === 'menu' && (
        <Sheet title={`@${p.username}`} onClose={close}>
          <button onClick={() => setSheet('block')} className="flex w-full items-center gap-4 rounded-2xl px-1 py-3 text-left text-red-700 transition active:bg-red-50">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-red-50 text-xl" aria-hidden>🚫</span>
            <span>
              <span className="block text-[17px] font-semibold">{p.blockedByMe ? 'Já bloqueaste esta conta' : `Bloquear @${p.username}`}</span>
              <span className="block text-sm text-zinc-600">Deixa de ver o teu conteúdo e de te poder seguir.</span>
            </span>
          </button>
        </Sheet>
      )}
      {sheet === 'block' && (
        <Sheet title={`Bloquear @${p.username}?`} onClose={close}>
          <ul className="mb-4 list-disc space-y-1 pl-5 text-[15px] text-zinc-700">
            <li>{p.displayName} deixa de ver as tuas publicações e stories.</li>
            <li>Não te pode seguir nem interagir contigo.</li>
            <li>Deixam de se seguir um ao outro.</li>
            <li>Ela é avisada de que foi bloqueada.</li>
          </ul>
          <button onClick={block} className="w-full rounded-full bg-red-700 py-3.5 font-bold text-white transition active:scale-[0.98]">Bloquear</button>
          <button onClick={close} className={`${btnGhost} mt-3 w-full`}>Cancelar</button>
        </Sheet>
      )}
      {openPost && (
        <Sheet title={`Publicação de ${openPost.author.displayName}`} onClose={() => setOpenPost(null)}>
          <div className="-mx-6"><PostCard post={openPost} /></div>
        </Sheet>
      )}
    </div>
  );
}

function PeopleSheet({ title, username, kind, meUsername, onClose }: { title: string; username: string; kind: 'followers' | 'following'; meUsername: string; onClose: () => void }) {
  const navigate = useNavigate();
  const q = useInfiniteQuery({
    queryKey: ['people', kind, username],
    queryFn: ({ pageParam }) => (kind === 'followers' ? api.followers(username, pageParam) : api.following(username, pageParam)),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (l) => l.nextCursor ?? undefined,
  });
  const people: Person[] = q.data?.pages.flatMap((x) => x.items) ?? [];
  return (
    <Sheet title={title} onClose={onClose}>
      {q.isLoading && <p className="py-8 text-center text-zinc-600">A carregar…</p>}
      {q.isSuccess && people.length === 0 && <p className="py-8 text-center text-zinc-600">{kind === 'followers' ? 'Ainda sem seguidores 🌱' : 'Ainda não segue ninguém 👀'}</p>}
      {people.map((x) => (
        <div key={x.username} className="flex items-center gap-3 py-2.5">
          <button onClick={() => { onClose(); navigate(x.username === meUsername ? '/profile' : `/u/${x.username}`); }} className="flex min-w-0 flex-1 items-center gap-3 text-left">
            <Avatar name={x.displayName} username={x.username} size={44} />
            <span className="min-w-0">
              <span className="block truncate font-semibold">{x.displayName}</span>
              <span className="block truncate text-sm text-zinc-600">@{x.username}{x.followsYou && x.username !== meUsername ? ' · segue-te' : ''}</span>
            </span>
          </button>
          {x.username !== meUsername && (
            <div className="w-28 shrink-0"><FollowButton username={x.username} following={x.following} requested={false} /></div>
          )}
        </div>
      ))}
      {q.hasNextPage && <button onClick={() => q.fetchNextPage()} className="mx-auto mt-2 block text-sm font-semibold text-zinc-600">Ver mais</button>}
    </Sheet>
  );
}

function RequestsSheet({ myUsername, onClose }: { myUsername: string; onClose: () => void }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['requests'], queryFn: api.followRequests });
  async function answer(username: string, accept: boolean) {
    await (accept ? api.acceptRequest(username) : api.declineRequest(username)).catch(() => undefined);
    await qc.invalidateQueries({ queryKey: ['requests'] });
    qc.invalidateQueries({ queryKey: ['profile', myUsername] });
  }
  const list = q.data ?? [];
  return (
    <Sheet title="Pedidos para seguir" onClose={onClose}>
      {q.isSuccess && list.length === 0 && <p className="py-8 text-center text-zinc-600">Sem pedidos pendentes 🎉</p>}
      {list.map((r) => (
        <div key={r.username} className="flex items-center gap-3 py-2.5">
          <Avatar name={r.displayName} username={r.username} size={44} />
          <span className="min-w-0 flex-1">
            <span className="block truncate font-semibold">{r.displayName}</span>
            <span className="block truncate text-sm text-zinc-600">@{r.username}</span>
          </span>
          <button onClick={() => answer(r.username, true)} className={`${btnPrimary} !px-4 !py-2 text-sm`}>Aceitar</button>
          <button onClick={() => answer(r.username, false)} className="rounded-full border border-zinc-300 px-4 py-2 text-sm font-semibold active:scale-95">Recusar</button>
        </div>
      ))}
    </Sheet>
  );
}
