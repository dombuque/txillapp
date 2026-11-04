import { sized } from '../lib/media';
import { tr, locale } from '../lib/i18n';
import { profileShare, shareNow } from '../lib/share';
import ExploreViewer from '../components/ExploreViewer';
import Suggestions from '../components/Suggestions';
import { shouldShowSuggestions } from '../lib/suggestPacing';
import Icon, { type IconName } from '../components/Icon';
import ReportSheet from '../components/ReportSheet';
import VerifiedBadge from '../components/VerifiedBadge';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { slideClass } from '../lib/swipeNav';
import { Link, useNavigate, useParams } from 'react-router-dom';
import EditProfileSheet from '../components/EditProfileSheet';
import GeleiraShelf, { GeleiraToggle } from '../components/GeleiraShelf';
import ProfileQrSheet from '../components/ProfileQrSheet';
import { BookmarkIcon } from '../components/PostCard';
import FollowButton from '../components/FollowButton';
import GiftSheet from '../components/GiftSheet';
import RichText from '../components/RichText';
import PostCard from '../components/PostCard';
import { ProfileStoryAvatar } from '../components/Stories';
import { BackIcon } from '../components/icons';
import { Avatar, Sheet, btnGhost, btnPrimary, btnSmall } from '../components/ui';
import { ApiError, api, type Post, type ProfileTab } from '../lib/api';
import { useAuth } from '../lib/auth';

type SheetName = null | 'report' | 'edit' | 'requests' | 'menu' | 'block' | 'gift' | 'qr';

/** Perfil de qualquer pessoa (/u/:username) e o meu (/profile). */
/** Símbolo do QR (três cantos e pontos), no mesmo traço dos outros ícones. */
function QrGlyph() {
  return (
    <svg viewBox="0 0 24 24" width={20} height={20} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="mx-auto" aria-hidden>
      <rect x="3.5" y="3.5" width="6" height="6" rx="1.2" /><rect x="14.5" y="3.5" width="6" height="6" rx="1.2" /><rect x="3.5" y="14.5" width="6" height="6" rx="1.2" />
      <path d="M14.5 14.5h2.5v2.5M20.5 14.5v.01M14.5 20.5h.01M17.5 20.5h3M20.5 17.5v3" />
    </svg>
  );
}

const TABS: { id: ProfileTab; label: string; icon: IconName | 'bookmark' }[] = [
  { id: 'all', label: tr('Tudo'), icon: 'grid' },
  { id: 'reels', label: tr('Reels'), icon: 'film' },
  { id: 'reposts', label: tr('Reposts'), icon: 'repeat' },
  { id: 'gifts', label: tr('Presentes'), icon: 'gift' },
  // Só no meu perfil (privado): depois dos presentes.
  { id: 'saved', label: tr('Guardados'), icon: 'bookmark' },
];
const EMPTY: Record<Exclude<ProfileTab, 'all'>, { me: string; other: string }> = {
  reels: { me: tr('Ainda não publicaste reels.'), other: tr('Ainda sem reels.') },
  reposts: { me: tr('Ainda não repostaste nada.'), other: tr('Ainda sem reposts.') },
  gifts: { me: tr('Os presentes que deres ou receberes e publicares aparecem aqui.'), other: tr('Ainda sem presentes publicados.') },
  saved: { me: tr('Toca no marcador de uma publicação para a guardares aqui. Só tu vês isto.'), other: '' },
};

export default function ProfilePage() {
  const { username: param } = useParams();
  const { user } = useAuth();
  const qc = useQueryClient();
  const username = param ?? user!.username;
  const navigate = useNavigate();
  /** Convidar a malta: abre logo a partilha do telemóvel (ou o WhatsApp) com a tua ligação de convite. */
  async function inviteCrew() {
    try {
      const d = await api.invites();
      const text = tr('Entra no Txillapp com o meu convite e ganhamos Txills os dois:');
      if (navigator.share) return void (await navigator.share({ title: 'Txillapp', text, url: d.link }));
      window.open(`https://wa.me/?text=${encodeURIComponent(`${text} ${d.link}`)}`, '_blank', 'noopener');
    } catch (e) {
      if ((e as Error).name !== 'AbortError') navigate('/invites');
    }
  }
  const [sheet, setSheet] = useState<SheetName>(null);
  const [geleiraOpen, setGeleiraOpen] = useState(false);
  const [openPost, setOpenPost] = useState<Post | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const close = () => setSheet(null);

  const q = useQuery({ queryKey: ['profile', username], queryFn: () => api.profile(username), retry: false });
  const p = q.data;
  // As sugestões de pessoas só aparecem às vezes (ritmo no aparelho), não em todas as visitas ao perfil.
  const [showSuggestions] = useState(() => shouldShowSuggestions('profile', { minGapHours: 8, base: 0.25, step: 0.2 }));
  const [tab, setTab] = useState<ProfileTab>('all');
  const tabs = TABS.filter((x) => x.id !== 'saved' || username === user?.username);
  const swipe = useRef<{ x: number; y: number; at: number; lock: 'h' | 'v' | null } | null>(null);
  const [dragX, setDragX] = useState(0);
  const [enter, setEnter] = useState<'left' | 'right' | null>(null);
  const posts = useInfiniteQuery({
    queryKey: ['profile-posts', username, tab],
    queryFn: ({ pageParam }) => (tab === 'saved' ? api.savedPosts(pageParam) : api.userPosts(username, pageParam, tab)),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (l) => l.nextCursor ?? undefined,
    enabled: !!p?.canView,
  });
  const items = posts.data?.pages.flatMap((x) => x.items) ?? [];

  if (q.isError) {
    const missing = q.error instanceof ApiError && q.error.status === 404;
    return (
      <div className="mx-6 mt-16 text-center">
        <Icon name={missing ? 'search' : 'alert'} size={44} className="mx-auto text-zinc-300" />
        <p className="mt-3 text-xl font-bold">{missing ? tr('Essa pessoa não existe') : tr('Não consegui abrir este perfil')}</p>
        <button onClick={() => navigate(-1)} className={`${btnGhost} mt-6`}>{tr('Voltar')}</button>
      </div>
    );
  }
  if (!p) return <div className="skel mx-4 mt-6 h-64 rounded-[28px]" role="status" aria-label={tr('A carregar')} />;

  const blocked = p.blockedByMe || p.blockedMe;
  const stat = (n: number, label: string, onClick?: () => void) => (
    <button onClick={onClick} disabled={!onClick} className="min-h-12 flex-1 text-center disabled:cursor-default">
      <span className="block text-xl font-extrabold leading-tight">{n.toLocaleString(locale)}</span>
      <span className="text-[13px] text-zinc-600">{label}</span>
    </button>
  );

  /** Partilhar o perfil: menu de partilha do telemóvel com o texto já escrito; sem ele, copia o texto e o link. */
  async function share() {
    const r = await shareNow(profileShare(p!.displayName, p!.username, window.location.origin));
    if (r === 'copied') flash('Texto e link copiados');
    if (r === 'failed') flash('Não consegui copiar');
  }
  function flash(text: string) {
    setToast(text);
    setTimeout(() => setToast(null), 2200);
  }

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
        <div className="flex items-center justify-between px-5 pb-2 pt-5">
          <p className="font-semibold">@{p.username}</p>
          <button onClick={() => navigate('/settings')} aria-label={tr('Definições e privacidade')} className="-mr-2 flex h-11 w-11 items-center justify-center rounded-full text-zinc-900 transition active:scale-90">
            <Icon name="menu" size={26} strokeWidth={2} />
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-1 px-2 pb-2 pt-5">
          <button onClick={() => navigate(-1)} aria-label={tr('Voltar')} className="flex h-11 w-11 items-center justify-center text-zinc-900"><BackIcon /></button>
          <p className="min-w-0 flex-1 truncate font-semibold">@{p.username}</p>
          <button onClick={() => setSheet('menu')} aria-label={tr('Mais opções')} className="flex h-11 w-11 items-center justify-center rounded-full text-zinc-900 transition active:bg-zinc-100">
            <Icon name="more" size={24} strokeWidth={2.4} />
          </button>
        </div>
      )}

      <section className="mx-4 rounded-[28px] bg-white px-5 pb-5 pt-5 shadow-[0_2px_16px_rgba(0,0,0,0.09)]">
        <div className={`relative flex items-center gap-4 ${p.bio ? 'mt-12' : ''}`}>
          {p.bio && (
            // A bio num balão a flutuar por cima da foto, como as notas: branco, com sombra, a pairar devagar, com o "bico" a apontar para a pessoa.
            <div className="absolute -top-[52px] left-6 z-10 max-w-[78%] animate-[bob_3.2s_ease-in-out_infinite] rounded-[18px] bg-white px-3.5 py-2 text-center text-[14px] leading-snug text-zinc-800 shadow-[0_4px_16px_rgba(0,0,0,0.16)] ring-1 ring-zinc-100">
              <p className="line-clamp-3 whitespace-pre-wrap break-words"><RichText text={p.bio} /></p>
              <span aria-hidden className="absolute -bottom-1.5 left-[26px] h-3 w-3 rotate-45 rounded-[2px] bg-white ring-1 ring-zinc-100 [clip-path:polygon(100%_0,100%_100%,0_100%)]" />
            </div>
          )}
          <span className="shrink-0"><ProfileStoryAvatar username={p.username} displayName={p.displayName} isMe={p.isMe} hasAvatar={p.hasAvatar} size={84} /></span>
          <div className="flex min-w-0 flex-1">
            {stat(p.counts.posts, 'publicações')}
            {stat(p.counts.followers, 'seguidores', p.canSeeConnections ? () => navigate('/u/' + p.username + '/connections', { state: { tab: 'followers' } }) : undefined)}
            {stat(p.counts.following, 'a seguir', p.canSeeConnections ? () => navigate('/u/' + p.username + '/connections', { state: { tab: 'following' } }) : undefined)}
          </div>
        </div>
        <div className="mt-3 text-left">
          <h1 className="text-xl font-extrabold leading-tight">
            {p.displayName} {p.verified && <VerifiedBadge size={20} tier={p.verifiedTier} />} {p.isPrivate && <Icon name="lock" size={14} className="inline align-[-2px] text-zinc-500" aria-hidden={false} role="img" aria-label={tr('Conta privada')} />}
          </h1>
          {/* O @utilizador já está no topo do ecrã: aqui não se repete. */}
          {!p.isMe && p.followsYou && !blocked && <span className="mt-1 inline-block rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-semibold text-zinc-700">{tr('Segue-te')}</span>}

          {(p.city || p.website) && (
            <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-zinc-600">
              {p.city && <span className="flex items-center gap-1"><Icon name="map-pin" size={14} /> {p.city}</span>}
              {p.website && (
                <a href={p.website} target="_blank" rel="noopener noreferrer nofollow" className="flex min-w-0 items-center gap-1 font-semibold text-brand">
                  <Icon name="link" size={14} className="shrink-0" /> <span className="truncate">{p.website.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')}</span>
                </a>
              )}
            </p>
          )}
          {!p.bio && p.isMe && (
            <button onClick={() => setSheet('edit')} className="mt-3 text-sm font-medium text-zinc-600 underline">{tr('Adiciona uma bio')}</button>
          )}
        </div>


        {/* Bloqueio ao estilo do X: o cabeçalho fica visível, com o aviso. */}
        {p.blockedMe && (
          <div role="status" className="mt-4 rounded-2xl bg-zinc-100 p-4 text-center">
            <p className="font-bold">{tr('Foste bloqueado por @')}{p.username}</p>
            <p className="mt-1 text-sm text-zinc-600">{tr('Não podes seguir esta conta nem ver as publicações e stories dela.')}</p>
          </div>
        )}
        {p.blockedByMe && !p.blockedMe && (
          <div className="mt-4 rounded-2xl bg-zinc-100 p-4 text-center">
            <p className="font-bold">{tr('Bloqueaste @')}{p.username}</p>
            <p className="mt-1 text-sm text-zinc-600">{tr('A pessoa não vê o teu conteúdo nem te pode seguir.')}</p>
            <button onClick={unblock} className={`${btnGhost} mt-3 !py-2.5`}>{tr('Desbloquear')}</button>
          </div>
        )}

        {/* Botões compactos, como nas redes sociais. A geleira é um botão da mesma linha: ao tocar, abre-se para baixo. */}
        {!blocked && (
          <>
            <div className="mt-4 flex gap-2">
              {p.isMe ? (
                // Tudo em símbolos, numa só linha e sempre no mesmo sítio.
                <>
                  {([
                    ['pencil', tr('Editar perfil'), () => setSheet('edit')],
                    ['qr', tr('Partilhar perfil'), () => setSheet('qr')],
                    ['user-plus', tr('Convidar a malta'), () => void inviteCrew()],
                    ['trending', tr('Estatísticas do perfil'), () => navigate('/insights')],
                    ['wallet', tr('Carteira de Txills'), () => navigate('/wallet')],
                  ] as const).map(([icon, label, go]) => (
                    <button key={label} onClick={go} aria-label={label} title={label} className={`${btnSmall} flex-1 !px-0`}>
                      {icon === 'qr' ? <QrGlyph /> : <Icon name={icon} size={20} className="mx-auto" />}
                    </button>
                  ))}
                  <GeleiraToggle username={p.username} isMe open={geleiraOpen} onToggle={() => setGeleiraOpen((v) => !v)} icon grow />
                </>
              ) : (
                <>
                  <div className="flex-1">
                    <FollowButton username={p.username} following={p.following} requested={p.requested} isPrivate={p.isPrivate} large />
                  </div>
                  {/* Só se presenteia quem se segue. */}
                  {p.following && <button onClick={() => setSheet('gift')} className={`${btnSmall} flex flex-1 items-center justify-center gap-1.5`}><Icon name="gift" size={18} /> {tr('Presentear')}</button>}
                  <button onClick={() => navigate(`/messages/${p.username}`)} aria-label={tr('Enviar mensagem')} className={`${btnSmall} w-11 shrink-0 !px-0`}>
                    <Icon name="send" size={18} className="mx-auto" />
                  </button>
                  <button onClick={() => setSheet('qr')} aria-label={tr('Partilhar perfil')} className={`${btnSmall} w-11 shrink-0 !px-0`}>
                    <Icon name="share" size={18} className="mx-auto" />
                  </button>
                  {p.canView && <GeleiraToggle username={p.username} isMe={false} open={geleiraOpen} onToggle={() => setGeleiraOpen((v) => !v)} icon />}
                </>
              )}
            </div>
          </>
        )}

        {p.isMe && p.pendingRequests > 0 && (
          <button onClick={() => setSheet('requests')} className="mt-4 flex w-full items-center justify-between rounded-2xl bg-rose-50 px-4 py-3 font-semibold text-brand">
            <span>{tr('Pedidos para seguir')}</span>
            <span className="rounded-full bg-brand px-2.5 py-0.5 text-sm text-white">{p.pendingRequests}</span>
          </button>
        )}
      </section>

      {p.canView && !blocked && geleiraOpen && <GeleiraShelf username={p.username} isMe={p.isMe} />}
      {showSuggestions && p.canView && !blocked && <div className="mt-4"><Suggestions /></div>}

      {!p.canView && !blocked ? (
        <div className="mx-4 mt-6 rounded-[28px] bg-white p-8 text-center shadow-[0_2px_16px_rgba(0,0,0,0.09)]">
          <p className="text-zinc-300" aria-hidden><Icon name="lock" size={44} className="mx-auto" /></p>
          <p className="mt-3 text-xl font-extrabold">{tr('Esta conta é privada')}</p>
          <p className="mt-1 text-zinc-600">
            {p.requested ? tr('Pedido enviado. Quando aceitar, vês as publicações e stories.') : tr('Segue para ver as publicações e stories.')}
          </p>
        </div>
      ) : (
        p.canView && (
          <section
          className="mt-6 px-4"
          aria-label={tr('Publicações')}
          // Deslizar para os lados muda de separador: o conteúdo acompanha o dedo (só quando o gesto é claramente horizontal) e assenta ou volta.
          data-no-swipe={tab !== 'all' ? '' : undefined}
          onTouchStart={(e) => { const t = e.touches[0]; swipe.current = e.touches.length === 1 && t.clientX > 20 ? { x: t.clientX, y: t.clientY, at: Date.now(), lock: null } : null; }}
          onTouchMove={(e) => {
            const s0 = swipe.current;
            if (!s0 || s0.lock === 'v') return;
            const t = e.touches[0];
            const dx = t.clientX - s0.x;
            const dy = t.clientY - s0.y;
            if (!s0.lock) {
              if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
              s0.lock = Math.abs(dx) > Math.abs(dy) * 1.1 ? 'h' : 'v';
              if (s0.lock === 'v') return;
            }
            const at = tabs.findIndex((x) => x.id === tab);
            const edge = (dx > 0 && at === 0) || (dx < 0 && at === tabs.length - 1);
            setDragX(edge ? dx * 0.2 : dx);
          }}
          onTouchEnd={(e) => {
            const s0 = swipe.current;
            swipe.current = null;
            if (!s0 || s0.lock !== 'h') return setDragX(0);
            const dx = e.changedTouches[0].clientX - s0.x;
            const quick = Date.now() - s0.at < 320;
            const i = tabs.findIndex((x) => x.id === tab) + (dx < 0 ? 1 : -1);
            setDragX(0);
            if ((Math.abs(dx) > 55 || (quick && Math.abs(dx) > 28)) && i >= 0 && i < tabs.length) {
              setEnter(dx < 0 ? 'right' : 'left');
              setTab(tabs[i].id);
            }
          }}
          onTouchCancel={() => { swipe.current = null; setDragX(0); }}
        >
            <div role="tablist" aria-label={tr('Conteúdo do perfil')} className="mb-3 flex border-b border-zinc-200">
              {tabs.map((t) => (
                <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} aria-label={t.label} onClick={() => { setEnter(null); setTab(t.id); }} className={`flex h-12 min-w-0 flex-1 items-center justify-center border-b-2 transition active:bg-zinc-50 ${tab === t.id ? 'border-zinc-900 text-zinc-900' : 'border-transparent text-zinc-400'}`}>
                  {t.icon === 'bookmark' ? <BookmarkIcon on={tab === t.id} size={24} /> : <Icon name={t.icon} size={24} />}
                </button>
              ))}
            </div>
            <div
              key={tab}
              style={{ transform: dragX ? `translateX(${dragX}px)` : undefined, transition: dragX ? 'none' : 'transform .2s ease-out', touchAction: 'pan-y' }}
              className={`min-h-[40dvh] ${dragX ? '' : slideClass(enter)}`}
            >
            {posts.isLoading && <p className="py-8 text-center text-sm text-zinc-500">{tr('A carregar…')}</p>}
            {posts.isSuccess && items.length === 0 && tab !== 'all' && (
              <p className="mt-8 text-center text-zinc-600">{p.isMe ? EMPTY[tab].me : EMPTY[tab].other}</p>
            )}
            {posts.isSuccess && items.length === 0 && tab === 'all' && (
              <div className="mt-8 text-center text-zinc-600">
                <p className="text-zinc-300" aria-hidden><Icon name="camera" size={36} className="mx-auto" /></p>
                <p className="mt-2 font-semibold">{p.isMe ? tr('Ainda não publicaste nada') : tr('Ainda sem publicações')}</p>
                {p.isMe && <Link to="/new" className="mt-3 inline-block font-semibold text-brand underline">{tr('Faz a primeira!')}</Link>}
              </div>
            )}
            <div className="grid grid-cols-3 gap-1.5">
              {items.map((post) => {
                const shown = post.kind === 'repost' && post.repostOf ? post.repostOf : post;
                return (
                  <button key={post.id} onClick={() => setOpenPost(post)} aria-label={tr('Abrir publicação: {v0}', { v0: post.body || shown.body || 'foto' })} className="relative aspect-square overflow-hidden rounded-xl bg-rose-50 text-left active:opacity-80">
                    {post.kind === 'gift' && post.gift ? (
                      // Presente: o mesmo bilhete do post, em ponto pequeno (fotos cruzadas, valor e Txills).
                      <span className="flex h-full w-full flex-col items-center justify-center gap-1 bg-gradient-to-br from-brand via-[#e8475f] to-[#ff8a5b] p-2 text-white">
                        <span className="relative h-7 w-[46px]">
                          <span className="absolute right-0 top-0 rounded-full ring-2 ring-white/90"><Avatar name={post.gift.recipient.displayName} username={post.gift.recipient.hasAvatar ? post.gift.recipient.username : undefined} size={26} ring={false} /></span>
                          <span className="absolute left-0 top-0 z-10 rounded-full ring-2 ring-white/90"><Avatar name={post.author.displayName} username={post.author.username} size={26} ring={false} /></span>
                        </span>
                        <span className="text-[22px] font-black leading-none">{post.gift.amount.toLocaleString(locale)}</span>
                        <span className="text-[9px] font-bold uppercase tracking-[0.18em] text-white/85">{tr('Txills')}</span>
                      </span>
                    ) : shown.media[0] ? (
                      <img src={shown.media[0].kind === 'video' ? shown.media[0].posterUrl : sized(shown.media[0].url, 480)} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />
                    ) : (
                      <span className="flex h-full w-full items-center justify-center p-2 text-center text-xs font-medium leading-snug text-zinc-700">
                        {(post.body || shown.body).slice(0, 70)}
                      </span>
                    )}
                    {shown.media.length > 1 && <span aria-label={tr('{v0} fotos', { v0: shown.media.length })} className="absolute right-1.5 top-1.5 flex items-center gap-1 rounded-full bg-black/55 px-1.5 py-0.5 text-[10px] font-bold text-white"><Icon name="images" size={12} /> {shown.media.length}</span>}
                    {post.kind === 'gift' && <span aria-label={tr('Presente')} className="absolute left-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-white/90 text-brand"><Icon name="gift" size={12} /></span>}
                    {post.kind === 'repost' && <span aria-label={tr('Repost')} className="absolute left-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-black/55 text-white"><Icon name="repeat" size={12} /></span>}
                  </button>
                );
              })}
            </div>
            {posts.hasNextPage && (
              <div className="mt-4 text-center">
                <button onClick={() => posts.fetchNextPage()} disabled={posts.isFetchingNextPage} className={btnGhost}>
                  {posts.isFetchingNextPage ? tr('A carregar…') : tr('Ver mais')}
                </button>
              </div>
            )}
            </div>
          </section>
        )
      )}

      {toast && (
        <div role="status" className="fixed bottom-24 left-1/2 z-40 -translate-x-1/2 rounded-full bg-zinc-900 px-5 py-2.5 text-sm font-medium text-white shadow-lg">{toast}</div>
      )}
      {sheet === 'edit' && <EditProfileSheet profile={p} onClose={close} />}
      {sheet === 'qr' && <ProfileQrSheet username={p.username} displayName={p.displayName} onClose={close} />}
      {sheet === 'requests' && <RequestsSheet myUsername={p.username} onClose={close} />}
      {sheet === 'gift' && <GiftSheet recipient={{ username: p.username, displayName: p.displayName }} onClose={close} />}
      {sheet === 'menu' && (
        <Sheet title={`@${p.username}`} onClose={close}>
          <button onClick={() => setSheet('block')} className="flex w-full items-center gap-4 rounded-2xl px-1 py-3 text-left text-red-700 transition active:bg-red-50">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-red-50" aria-hidden><Icon name="block" /></span>
            <span>
              <span className="block text-[17px] font-semibold">{p.blockedByMe ? tr('Já bloqueaste esta conta') : `Bloquear @${p.username}`}</span>
              <span className="block text-sm text-zinc-600">{tr('Deixa de ver o teu conteúdo e de te poder seguir.')}</span>
            </span>
          </button>
          <button onClick={() => setSheet('report')} className="flex w-full items-center gap-4 rounded-2xl px-1 py-3 text-left transition active:bg-zinc-100">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-zinc-100 text-zinc-800" aria-hidden><Icon name="flag" /></span>
            <span>
              <span className="block text-[17px] font-semibold">{tr('Denunciar @')}{p.username}</span>
              <span className="block text-sm text-zinc-600">{tr('Avisa a moderação. A pessoa não sabe.')}</span>
            </span>
          </button>
        </Sheet>
      )}
      {sheet === 'report' && <ReportSheet type="user" id={p.id} onClose={close} />}
      {sheet === 'block' && (
        <Sheet title={tr('Bloquear @{v0}?', { v0: p.username })} onClose={close}>
          <ul className="mb-4 list-disc space-y-1 pl-5 text-[15px] text-zinc-700">
            <li>{p.displayName} {tr('deixa de ver as tuas publicações e stories.')}</li>
            <li>{tr('Não te pode seguir nem interagir contigo.')}</li>
            <li>{tr('Deixam de se seguir um ao outro.')}</li>
            <li>{tr('Ela é avisada de que foi bloqueada.')}</li>
          </ul>
          <button onClick={block} className="w-full rounded-full bg-red-700 py-3.5 font-bold text-white transition active:scale-[0.98]">{tr('Bloquear')}</button>
          <button onClick={close} className={`${btnGhost} mt-3 w-full`}>{tr('Cancelar')}</button>
        </Sheet>
      )}
      {openPost && <ExploreViewer items={items} startId={openPost.id} title={tr('Publicação')} onClose={() => setOpenPost(null)} />}
    </div>
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
    <Sheet title={tr('Pedidos para seguir')} onClose={onClose}>
      {q.isSuccess && list.length === 0 && <p className="py-8 text-center text-zinc-600">{tr('Sem pedidos pendentes')}</p>}
      {list.map((r) => (
        <div key={r.username} className="flex items-center gap-3 py-2.5">
          <Avatar name={r.displayName} username={r.username} size={44} />
          <span className="min-w-0 flex-1">
            <span className="block truncate font-semibold">{r.displayName}</span>
            <span className="block truncate text-sm text-zinc-600">@{r.username}</span>
          </span>
          <button onClick={() => answer(r.username, true)} className={`${btnPrimary} !px-4 !py-2 text-sm`}>{tr('Aceitar')}</button>
          <button onClick={() => answer(r.username, false)} className="rounded-full border border-zinc-300 px-4 py-2 text-sm font-semibold active:scale-95">{tr('Recusar')}</button>
        </div>
      ))}
    </Sheet>
  );
}
