import VideoPlayer from './VideoPlayer';
import { sized } from '../lib/media';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { useLocation, useNavigate, Link } from 'react-router-dom';
import { api, type Story, type TrayUser } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useVisualViewport, visibleStyle } from '../lib/useVisualViewport';
import Icon from './Icon';
import CloseFriendsSheet from './CloseFriendsSheet';
import RichText from './RichText';
import MentionTextarea from './MentionTextarea';
import { Avatar, timeAgo } from './ui';

const DURATION_MS = 5000;
const TICK_MS = 50;
const MAX_BYTES = 8 * 1024 * 1024;
const TYPES = ['image/jpeg', 'image/png', 'image/webp'];

/**
 * Anel dos stories, como no Instagram: gradiente para os por ver, cinzento para os vistos,
 * e dividido em tantos segmentos quantos os stories dessa pessoa.
 */
function Ring({ count, seenCount = 0, green = false, children }: { count: number; seenCount?: number; green?: boolean; children: React.ReactNode }) {
  const n = Math.max(1, Math.min(count, 12));
  const step = 100 / n;
  const seg = n === 1 ? 100 : step - 3.2;
  return (
    <span className="relative inline-flex h-[72px] w-[72px] items-center justify-center">
      <svg viewBox="0 0 72 72" className="absolute inset-0 -rotate-90" aria-hidden>
        <defs>
          <linearGradient id="story-ring" x1="0" y1="1" x2="1" y2="0">
            <stop offset="0" stopColor="#d6334f" />
            <stop offset="1" stopColor="#fbbf24" />
          </linearGradient>
          <linearGradient id="story-ring-green" x1="0" y1="1" x2="1" y2="0">
            <stop offset="0" stopColor="#059669" />
            <stop offset="1" stopColor="#4ade80" />
          </linearGradient>
        </defs>
        {/* Um arco por story: os já vistos a cinzento, os novos a cores. */}
        {Array.from({ length: n }, (_, i) => (
          <circle
            key={i} cx="36" cy="36" r="33" fill="none" strokeWidth="3.5" strokeLinecap="round" pathLength={100}
            stroke={i < seenCount ? '#d4d4d8' : green ? 'url(#story-ring-green)' : 'url(#story-ring)'}
            strokeDasharray={`${seg} ${100 - seg}`} strokeDashoffset={-i * step}
          />
        ))}
      </svg>
      <span className="flex h-[62px] w-[62px] items-center justify-center rounded-full bg-white">{children}</span>
    </span>
  );
}

/** Foto do perfil com story: anel a cores/cinzento e, ao tocar, abre o story (o servidor só devolve se eu puder ver). */
export function ProfileStoryAvatar({ username, displayName, isMe, hasAvatar, size = 96 }: { username: string; displayName: string; isMe: boolean; hasAvatar: boolean; size?: number }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const q = useQuery({ queryKey: ['stories', username], queryFn: () => api.storiesOf(username), retry: false });
  const list = q.data ?? [];
  const avatar = <Avatar name={displayName} username={hasAvatar ? username : undefined} size={size} ring={list.length === 0} />;
  if (list.length === 0) return avatar;
  const ownSeen = isMe && readOwnSeen() === list[list.length - 1].createdAt;
  const seenCount = isMe ? (ownSeen ? list.length : 0) : list.filter((x) => x.seen).length;
  const tray: TrayUser = {
    username, displayName, isMe, count: list.length, seenCount,
    seen: seenCount === list.length, closeFriends: list.every((x) => x.audience === 'close_friends'), latestAt: list[list.length - 1].createdAt,
  };
  return (
    <>
      <button onClick={() => setOpen(true)} aria-label={`Ver story de ${displayName}`}>
        {/* O anel mede 72px; amplia-se para acompanhar a foto grande do perfil. */}
        <span className="block" style={{ width: size + 12, height: size + 12 }}>
          <span className="block origin-top-left" style={{ transform: `scale(${(size + 12) / 72})` }}>
            <Ring count={list.length} seenCount={seenCount} green={tray.closeFriends}><Avatar name={displayName} username={hasAvatar ? username : undefined} size={56} ring={false} /></Ring>
          </span>
        </span>
      </button>
      {open && (
        <Viewer
          users={[tray]}
          start={0}
          onOwnSeen={writeOwnSeen}
          onClose={() => { setOpen(false); qc.invalidateQueries({ queryKey: ['stories'] }); }}
        />
      )}
    </>
  );
}

const OWN_SEEN_KEY = 'txill_own_story_seen';
function readOwnSeen(): string {
  try { return localStorage.getItem(OWN_SEEN_KEY) ?? ''; } catch { return ''; }
}
function writeOwnSeen(at: string) {
  try { localStorage.setItem(OWN_SEEN_KEY, at); } catch { /* sem armazenamento: o anel volta a cores */ }
}

export default function StoriesTray() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['stories'], queryFn: api.stories, refetchInterval: 60_000 });
  const [viewing, setViewing] = useState<number | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [err, setErr] = useState('');

  // Ordem do visualizador: o próprio (se tiver) e depois os outros.
  const users = data ?? [];
  const others = users.filter((u) => !u.isMe);
  // O servidor não conta o autor como espectador; "já vi os meus" fica guardado neste aparelho.
  const [ownSeenAt, setOwnSeenAt] = useState(readOwnSeen);
  const mineRaw = users.find((u) => u.isMe);
  const mine = mineRaw && { ...mineRaw, seen: mineRaw.latestAt === ownSeenAt };

  function choose(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    if (!TYPES.includes(f.type)) return setErr('Essa foto não serve. Usa JPEG, PNG ou WebP');
    if (f.size > MAX_BYTES) return setErr('Foto pesada demais! Máximo 8 MB');
    setErr('');
    setFile(f);
  }

  const bubble = 'flex w-[76px] shrink-0 flex-col items-center gap-1.5';
  const label = 'w-full truncate text-center text-xs';
  return (
    <section aria-label="Stories" className="mb-4">
      <div className="flex gap-3 overflow-x-auto px-4 pb-1 pt-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div className={bubble}>
          <div className="relative">
            {mine ? (
              <button onClick={() => setViewing(0)} aria-label="Ver o teu story">
                <Ring count={mine.count} seenCount={mine.seen ? mine.count : 0} green={mine.closeFriends}><Avatar name={user?.displayName ?? '?'} username={user?.username} size={56} ring={false} /></Ring>
              </button>
            ) : (
              <label className="block cursor-pointer" aria-label="Criar story">
                <Ring count={1} seenCount={1}><Avatar name={user?.displayName ?? '?'} username={user?.username} size={56} ring={false} /></Ring>
                <input type="file" accept={TYPES.join(',')} onChange={choose} className="sr-only" />
              </label>
            )}
            <label className="absolute -bottom-0.5 -right-0.5 flex h-6 w-6 cursor-pointer items-center justify-center rounded-full border-2 border-white bg-brand text-base font-bold leading-none text-white" aria-label="Adicionar ao story">
              +
              {mine && <input type="file" accept={TYPES.join(',')} onChange={choose} className="sr-only" />}
            </label>
          </div>
          <span className={`${label} font-medium text-zinc-800`}>O teu story</span>
        </div>

        {others.map((u, i) => (
          // Não vistos: anel a cores, nome a negrito. Vistos: anel cinzento, avatar e nome mais apagados.
          <button key={u.username} onClick={() => setViewing(mine ? i + 1 : i)} className={bubble} aria-label={`Ver story de ${u.displayName}${u.seen ? '' : ' (novo)'}`}>
            <span className={u.seen ? 'opacity-60' : ''}>
              <Ring count={u.count} seenCount={u.seenCount} green={u.closeFriends}><Avatar name={u.displayName} username={u.username} size={56} ring={false} /></Ring>
            </span>
            <span className={`${label} ${u.seen ? 'font-normal text-zinc-500' : 'font-bold text-zinc-900'}`}>{u.username}</span>
          </button>
        ))}
        {others.length === 0 && <p className="self-center pr-4 text-sm text-zinc-500">Segue pessoas para ver os stories delas</p>}
      </div>
      {err && <p role="alert" className="px-4 pt-2 text-sm text-red-600">{err}</p>}

      {viewing !== null && (
        <Viewer
          users={[...(mine ? [mine] : []), ...others]}
          start={viewing}
          onOwnSeen={(at) => { writeOwnSeen(at); setOwnSeenAt(at); }}
          onClose={() => {
            setViewing(null);
            qc.invalidateQueries({ queryKey: ['stories'] });
          }}
        />
      )}
      {file && <Creator file={file} onClose={() => setFile(null)} />}
    </section>
  );
}

const CloseIcon = () => <Icon name="x" size={24} strokeWidth={2} />;
const DotsIcon = () => <Icon name="more" size={24} strokeWidth={2.4} />;
const EyeIcon = () => <Icon name="eye" size={20} strokeWidth={2} />;

const REACTIONS = ['😂', '😮', '😍', '😢', '👏', '🔥', '🥂'];

function expiresIn(iso: string) {
  const h = Math.ceil((new Date(iso).getTime() - Date.now()) / 3_600_000);
  return h <= 0 ? 'a expirar' : `expira em ${h} h`;
}

/** Responder ao story ou reagir com emoji, como no Instagram: a mensagem chega ao autor. */
function ReplyBar({ story, username, onFocusChange }: { story: Story; username: string; onFocusChange: (v: boolean) => void }) {
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function send(body: string) {
    if (!body.trim() || busy) return;
    setBusy(true);
    try {
      await api.replyStory(story.id, body.trim());
      setText('');
      setMsg(REACTIONS.includes(body) ? `${body} enviado!` : 'Mensagem enviada');
    } catch (x) {
      setMsg((x as Error).message);
    } finally {
      setBusy(false);
      setTimeout(() => setMsg(null), 2200);
    }
  }
  const focus = (v: boolean) => {
    setOpen(v);
    onFocusChange(v);
  };

  return (
    <div className="pointer-events-auto w-full" onPointerDown={(e) => e.stopPropagation()}>
      {open && (
        <div className="mb-3 flex justify-between px-1 text-3xl">
          {REACTIONS.map((e) => (
            <button key={e} type="button" onMouseDown={(ev) => ev.preventDefault()} onClick={() => send(e)} aria-label={`Reagir com ${e}`} className="transition active:scale-125">
              {e}
            </button>
          ))}
        </div>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(text);
        }}
        className="flex items-center gap-3"
      >
        <MentionTextarea
          single
          up
          wrapperClassName="min-w-0 flex-1"
          value={text}
          onChange={setText}
          onFocus={() => focus(true)}
          onBlur={() => focus(false)}
          maxLength={500}
          placeholder={`Enviar mensagem a ${username}…`}
          aria-label={`Responder ao story de ${username}`}
          className="w-full rounded-full border border-white/60 bg-black/20 px-5 py-3 text-white outline-none backdrop-blur-sm placeholder:text-white/70 focus:border-white"
        />
        {text.trim() && <button className="font-semibold text-white">Enviar</button>}
      </form>
      {msg && <p role="status" className="mt-2 text-center text-sm font-medium text-white">{msg}</p>}
    </div>
  );
}

/** Painel inferior dentro do visualizador (menu e atividade do story). */
function Panel({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="absolute inset-0 z-20 flex items-end bg-black/50" onClick={onClose} role="presentation">
      <div role="dialog" aria-label={title} className="animate-[rise_.2s_ease-out] max-h-[72%] w-full overflow-y-auto rounded-t-[28px] bg-white px-5 pb-6 pt-3 text-left text-zinc-900" onClick={(e) => e.stopPropagation()}>
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-zinc-300" aria-hidden />
        <h2 className="mb-3 text-center text-base font-bold">{title}</h2>
        {children}
      </div>
    </div>
  );
}

/** Comentários públicos do story (visíveis a quem pode ver o story). Só se comenta se o autor deixar. */
function CommentsPanel({ story, onClose, canComment, onTyping }: { story: Story; onClose: () => void; canComment: boolean; onTyping: (v: boolean) => void }) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const key = ['story-comments', story.id];
  const list = useQuery({ queryKey: key, queryFn: () => api.storyComments(story.id) });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: key });
    void qc.invalidateQueries({ queryKey: ['stories', story.author.username] });
  };

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const body = text.trim();
    if (!body || busy) return;
    setBusy(true);
    setErr('');
    try {
      await api.commentStory(story.id, body);
      setText('');
      refresh();
    } catch (x) {
      setErr((x as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title={`Comentários${list.data ? ` (${list.data.length})` : ''}`} onClose={onClose}>
      <ul className="min-h-[96px]">
        {list.isLoading && <li className="py-6 text-center text-zinc-500">A carregar…</li>}
        {list.isSuccess && list.data.length === 0 && <li className="py-6 text-center text-zinc-500">Ainda sem comentários. Sê o primeiro</li>}
        {list.data?.map((c) => (
          <li key={c.id} className="flex items-start gap-3 py-2.5">
            <Avatar name={c.author.displayName} username={c.author.hasAvatar ? c.author.username : undefined} size={36} ring={false} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm text-zinc-500">
                <b className="text-zinc-900">{c.author.username}</b> · {timeAgo(c.createdAt)}
              </p>
              <p className="break-words text-[15px] leading-snug"><RichText text={c.body} /></p>
            </div>
            {c.canDelete && (
              <button
                onClick={async () => { await api.deleteStoryComment(c.id).catch(() => undefined); refresh(); }}
                aria-label="Apagar comentário"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-zinc-400 active:bg-zinc-100"
              >
                <Icon name="x" size={18} />
              </button>
            )}
          </li>
        ))}
      </ul>
      {canComment ? (
        <form onSubmit={send} className="mt-2 flex items-center gap-2 border-t border-zinc-100 pt-3">
          <Avatar name={user?.displayName ?? '?'} username={user?.username} size={32} ring={false} />
          <MentionTextarea
            single
            up
            wrapperClassName="min-w-0 flex-1"
            value={text}
            onChange={setText}
            onFocus={() => onTyping(true)}
            onBlur={() => onTyping(false)}
            maxLength={500}
            placeholder="Adiciona um comentário…"
            aria-label="Comentário"
            className="h-11 w-full rounded-full bg-zinc-100 px-4 text-[15px] outline-none focus:ring-2 focus:ring-brand/50"
          />
          <button disabled={!text.trim() || busy} className="px-2 font-bold text-brand disabled:opacity-40">Publicar</button>
        </form>
      ) : (
        <p className="mt-2 rounded-xl bg-zinc-50 px-3 py-2.5 text-center text-sm text-zinc-600">Este story não aceita comentários.</p>
      )}
      {err && <p role="alert" className="mt-1 text-center text-sm text-red-600">{err}</p>}
    </Panel>
  );
}

function Viewer({ users, start, onClose, onOwnSeen }: { users: TrayUser[]; start: number; onClose: () => void; onOwnSeen: (latestAt: string) => void }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [u, setU] = useState(start);
  const [s, setS] = useState(0);
  const [pct, setPct] = useState(0);
  const [held, setHeld] = useState(false);
  const [panel, setPanel] = useState<null | 'menu' | 'viewers' | 'comments'>(null);
  const [typing, setTyping] = useState(false);
  const [tab, setTab] = useState<'viewers' | 'replies'>('viewers');
  const downAt = useRef(0);
  const vv = useVisualViewport();
  // Tocar numa @menção leva a outro perfil: o story fecha.
  const here = useLocation().pathname;
  const openedAt = useRef(here);
  useEffect(() => { if (here !== openedAt.current) onClose(); }, [here]); // eslint-disable-line react-hooks/exhaustive-deps
  const user = users[u];
  const q = useQuery({ queryKey: ['stories', user.username], queryFn: () => api.storiesOf(user.username) });
  const list = q.data ?? [];
  const story = list[s];
  const paused = held || typing || panel !== null;
  const viewers = useQuery({
    queryKey: ['story-viewers', story?.id],
    queryFn: () => api.storyViewers(story!.id),
    enabled: panel === 'viewers' && !!story,
  });
  const replies = useQuery({
    queryKey: ['story-replies', story?.id],
    queryFn: () => api.storyReplies(story!.id),
    enabled: panel === 'viewers' && !!story,
  });

  useEffect(() => { setS(0); setPct(0); }, [u]);
  // Como no Instagram: abre no primeiro story ainda não visto dessa pessoa (ou no primeiro, se já viu todos).
  const startedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!q.isSuccess || startedFor.current === user.username) return;
    startedFor.current = user.username;
    const firstNew = list.findIndex((x) => !x.seen);
    setS(firstNew === -1 ? 0 : firstNew);
    setPct(0);
  }, [q.isSuccess, user.username, list]);
  useEffect(() => setPct(0), [s]);
  useEffect(() => {
    if (!story) return;
    if (!user.isMe) api.viewStory(story.id).catch(() => undefined);
    else if (s === list.length - 1) onOwnSeen(user.latestAt); // chegou ao último dos meus: ficam como vistos
  }, [story?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!story || paused) return;
    // Reels partilhados duram o que dura o vídeo (até 30 s); fotos, 5 s.
    const total = story.mediaKind === 'video' && story.durationMs ? Math.min(story.durationMs, 30_000) : DURATION_MS;
    const t = setInterval(() => setPct((p) => p + (100 * TICK_MS) / total), TICK_MS);
    return () => clearInterval(t);
  }, [story?.id, paused]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (pct >= 100) next(); }); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (q.isSuccess && list.length === 0) next();
  }, [q.isSuccess, list.length]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') return panel ? setPanel(null) : onClose();
      if (panel) return;
      if (e.key === 'ArrowRight') next();
      if (e.key === 'ArrowLeft') prev();
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });

  function next() {
    if (s < list.length - 1) setS(s + 1);
    else {
      // Acabaram os não vistos: sai do modo stories em vez de passar pelos já vistos.
      const nextNew = users.findIndex((x, i) => i > u && !x.seen);
      if (nextNew === -1) onClose();
      else setU(nextNew);
    }
  }
  function prev() {
    if (s > 0) setS(s - 1);
    else if (u > 0) setU(u - 1);
    else setPct(0);
  }
  async function remove() {
    if (!story) return;
    await api.deleteStory(story.id).catch(() => undefined);
    setPanel(null);
    await qc.invalidateQueries({ queryKey: ['stories', user.username] });
    if (list.length <= 1) onClose();
  }

  const tap = (fn: () => void) => () => {
    if (Date.now() - downAt.current < 250) fn(); // toque curto navega; segurar só pausa
  };
  const stop = { onPointerDown: (e: React.PointerEvent) => e.stopPropagation() };
  const circleBtn = 'flex h-10 w-10 items-center justify-center rounded-full bg-black/30 text-white backdrop-blur-sm transition active:scale-90';

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black" style={visibleStyle(vv)} role="dialog" aria-modal="true" aria-label={`Story de ${user.displayName}`}>
      <div
        className="relative h-full w-full max-w-[460px] select-none overflow-hidden bg-zinc-900 sm:h-[min(100dvh,860px)] sm:rounded-3xl"
        onPointerDown={() => { downAt.current = Date.now(); setHeld(true); }}
        onPointerUp={() => setHeld(false)}
        onPointerLeave={() => setHeld(false)}
      >
        {story && (
          <>
            {/* Fundo desfocado da própria foto: a imagem aparece inteira, sem barras pretas */}
            {story.mediaKind === 'video' ? (
              <VideoPlayer key={story.id} src={story.mediaUrl} poster={`${story.mediaUrl}?poster=1`} active={!paused} cover className="relative h-full w-full" id={story.id} />
            ) : (
              <>
                <img src={sized(story.mediaUrl, 160)} alt="" aria-hidden className="absolute inset-0 h-full w-full scale-125 object-cover opacity-70 blur-2xl" draggable={false} />
                <img src={sized(story.mediaUrl, 1080)} alt={story.caption ?? `Story de ${user.displayName}`} className="relative h-full w-full object-contain" draggable={false} />
              </>
            )}
          </>
        )}

        <div className="absolute inset-x-0 top-0 bg-gradient-to-b from-black/60 to-transparent px-3 pb-10 pt-[max(0.75rem,env(safe-area-inset-top))]">
          <div className="flex gap-1" aria-hidden>
            {list.map((_, i) => (
              <span key={i} className="h-[3px] flex-1 overflow-hidden rounded-full bg-white/35">
                <span className="block h-full rounded-full bg-white" style={{ width: i < s ? '100%' : i === s ? `${Math.min(pct, 100)}%` : '0%' }} />
              </span>
            ))}
          </div>
          <div className="mt-3 flex items-center gap-3 text-white">
            <Avatar name={user.displayName} username={user.username} size={40} ring={false} />
            <div className="min-w-0 flex-1 leading-tight">
              <p className="truncate font-semibold">{user.username}</p>
              <p className="text-xs text-white/75">
                {story ? timeAgo(story.createdAt) : ''}
                {user.isMe && story ? ` · ${expiresIn(story.expiresAt)}` : ''}
              </p>
            </div>
            {user.isMe && story && (
              <button {...stop} onClick={() => setPanel('menu')} aria-label="Mais opções" className={circleBtn}>
                <DotsIcon />
              </button>
            )}
            <button {...stop} onClick={onClose} aria-label="Fechar" className={circleBtn}>
              <CloseIcon />
            </button>
          </div>
        </div>

        <button aria-label="Anterior" onClick={tap(prev)} className="absolute bottom-28 left-0 top-28 w-1/3" />
        <button aria-label="Seguinte" onClick={tap(next)} className="absolute bottom-28 right-0 top-28 w-2/3" />

        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-col items-center gap-3 bg-gradient-to-t from-black/70 to-transparent px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-16">
          {story?.sharedFrom && (
            <Link {...stop} to={`/p/${story.sharedFrom.postId}`} className="pointer-events-auto flex min-h-10 items-center gap-2 rounded-full bg-black/45 px-4 text-sm font-semibold text-white backdrop-blur-sm active:scale-95">
              <Icon name={story.mediaKind === 'video' ? 'film' : 'image'} size={16} /> {story.mediaKind === 'video' ? 'Reel' : 'Publicação'} de @{story.sharedFrom.username} <span aria-hidden>›</span>
            </Link>
          )}
          {story?.caption && (
            <p {...stop} className="pointer-events-auto max-w-full break-words rounded-2xl bg-black/40 px-4 py-2 text-center text-lg text-white backdrop-blur-sm [&_a]:underline [&_a]:text-white"><RichText text={story.caption} /></p>
          )}
          {user.isMe && story && (
            <div className="pointer-events-auto flex gap-2">
              <button {...stop} onClick={() => { setTab('viewers'); setPanel('viewers'); }} aria-label={`${story.viewCount ?? 0} visualizações`} className="flex min-h-11 items-center gap-2 rounded-full bg-white/20 px-4 text-sm font-semibold text-white backdrop-blur-sm transition active:scale-95">
                <EyeIcon /> {story.viewCount ?? 0}
              </button>
              <button {...stop} onClick={() => setPanel('comments')} aria-label={`${story.commentCount} comentários`} className="flex min-h-11 items-center gap-2 rounded-full bg-white/20 px-4 text-sm font-semibold text-white backdrop-blur-sm transition active:scale-95">
                <Icon name="comment" size={18} /> {story.commentCount}
              </button>
            </div>
          )}
          {!user.isMe && story && (
            <button {...stop} onClick={() => setPanel('comments')} className="pointer-events-auto flex min-h-10 items-center gap-2 rounded-full bg-black/40 px-4 text-sm font-semibold text-white backdrop-blur-sm active:scale-95">
              <Icon name="comment" size={18} /> {story.commentCount > 0 ? `${story.commentCount} ${story.commentCount === 1 ? 'comentário' : 'comentários'}` : 'Comentar'}
            </button>
          )}
          {!user.isMe && story && story.canReply && <ReplyBar key={story.id} story={story} username={user.username} onFocusChange={setTyping} />}
          {!user.isMe && story && !story.canReply && (
            <p className="rounded-full bg-black/40 px-4 py-2 text-center text-sm text-white/90 backdrop-blur-sm">Este story não aceita respostas</p>
          )}
        </div>

        {panel === 'menu' && (
          <Panel title="O teu story" onClose={() => setPanel(null)}>
            <button onClick={() => { onClose(); navigate('/settings'); }} className="w-full rounded-xl py-3.5 text-lg active:bg-zinc-100">Definições do story</button>
            <button onClick={remove} className="w-full rounded-xl py-3.5 text-lg font-semibold text-red-600 active:bg-zinc-100">Apagar story</button>
            <button onClick={() => setPanel(null)} className="w-full rounded-xl py-3.5 text-lg active:bg-zinc-100">Cancelar</button>
          </Panel>
        )}
        {panel === 'comments' && story && (
          <CommentsPanel story={story} canComment={user.isMe || story.canReply} onTyping={setTyping} onClose={() => setPanel(null)} />
        )}
        {panel === 'viewers' && (
          <Panel title="Atividade do story" onClose={() => setPanel(null)}>
            <div role="tablist" className="mb-3 flex rounded-full bg-zinc-100 p-1">
              {([['viewers', `Visualizações${story?.viewCount ? ` (${story.viewCount})` : ''}`], ['replies', `Respostas${replies.data ? ` (${replies.data.length})` : ''}`]] as const).map(([k, label]) => (
                <button
                  key={k}
                  role="tab"
                  aria-selected={tab === k}
                  onClick={() => setTab(k)}
                  className={`h-10 flex-1 rounded-full text-sm font-bold transition ${tab === k ? 'bg-white shadow-sm' : 'text-zinc-500'}`}
                >
                  {label}
                </button>
              ))}
            </div>

            {tab === 'replies' && (
              <ul>
                {replies.isLoading && <li className="py-6 text-center text-zinc-500">A carregar…</li>}
                {replies.isSuccess && replies.data.length === 0 && <li className="py-6 text-center text-zinc-500">Ainda sem respostas</li>}
                {replies.data?.map((r) => (
                  <li key={r.id} className="flex items-start gap-3 py-2.5">
                    <Avatar name={r.author.displayName} username={r.author.username} size={40} ring={false} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-zinc-500">
                        <b className="text-zinc-900">{r.author.displayName}</b> · {timeAgo(r.createdAt)}
                      </p>
                      {r.kind === 'reaction' ? <p className="text-3xl leading-tight">{r.body}</p> : <p className="mt-0.5 break-words rounded-2xl rounded-tl-md bg-zinc-100 px-3.5 py-2">{r.body}</p>}
                    </div>
                  </li>
                ))}
              </ul>
            )}

            {tab === 'viewers' && (
              <ul>
                {viewers.isLoading && <li className="py-6 text-center text-zinc-500">A carregar…</li>}
                {viewers.isSuccess && viewers.data.length === 0 && <li className="py-6 text-center text-zinc-500">Ainda ninguém viu</li>}
                {viewers.data?.map((v) => (
                  <li key={v.username} className="flex items-center gap-3 py-2.5">
                    <Avatar name={v.displayName} username={v.username} size={40} ring={false} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold">{v.displayName}</p>
                      <p className="truncate text-sm text-zinc-500">@{v.username}</p>
                    </div>
                    <span className="shrink-0 text-sm text-zinc-500">{timeAgo(v.viewedAt)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        )}
      </div>
    </div>
  );
}

function Creator({ file, onClose }: { file: File; onClose: () => void }) {
  const qc = useQueryClient();
  const [preview] = useState(() => URL.createObjectURL(file));
  const [caption, setCaption] = useState('');
  const vv = useVisualViewport();
  const [audience, setAudience] = useState<'all' | 'close_friends'>('all');
  const [listOpen, setListOpen] = useState(false);
  const friends = useQuery({ queryKey: ['close-friends'], queryFn: api.closeFriends });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function share(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      const mediaId = await api.uploadImage(file);
      await api.createStory(mediaId, caption.trim(), audience);
      await qc.invalidateQueries({ queryKey: ['stories'] });
      onClose();
    } catch (x) {
      setErr((x as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black" style={visibleStyle(vv)} role="dialog" aria-modal="true" aria-label="Novo story">
      <form onSubmit={share} className="relative flex h-full w-full max-w-xl flex-col">
        <img src={preview} alt="Pré-visualização do story" className="min-h-0 flex-1 object-contain" />
        <button type="button" onClick={onClose} aria-label="Cancelar" className="absolute left-3 top-[max(0.75rem,env(safe-area-inset-top))] px-2 text-3xl leading-none text-white">×</button>
        <div className="space-y-3 bg-black px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3">
          <MentionTextarea single up value={caption} onChange={setCaption} maxLength={200} placeholder="Escreve uma legenda…" aria-label="Legenda" className="w-full rounded-full bg-white/15 px-4 py-3 text-white outline-none placeholder:text-white/60 focus:ring-2 focus:ring-brand" />
          <div role="radiogroup" aria-label="Quem vê" className="flex gap-2">
            {([['all', 'globe', 'Os teus stories'], ['close_friends', 'heart', 'Amigos próximos']] as const).map(([v, ic, label]) => (
              <button
                key={v}
                type="button"
                role="radio"
                aria-checked={audience === v}
                onClick={() => setAudience(v)}
                className={`h-11 flex-1 rounded-full text-sm font-bold transition active:scale-95 ${audience === v ? (v === 'all' ? 'bg-white text-zinc-900' : 'bg-emerald-500 text-white') : 'bg-white/15 text-white'}`}
              >
                <Icon name={ic} size={18} className="mr-1.5 inline align-[-3px]" />{label}
              </button>
            ))}
          </div>
          {audience === 'close_friends' && (
            <button type="button" onClick={() => setListOpen(true)} className="w-full text-center text-sm font-semibold text-emerald-300">
              {friends.data?.length ? `${friends.data.length} na lista · gerir` : 'A tua lista está vazia · adicionar amigos'}
            </button>
          )}
          <p role="alert" className="min-h-5 text-center text-sm text-red-400">{err}</p>
          <button disabled={busy} className={`w-full rounded-full py-3.5 text-lg font-semibold text-white transition active:scale-[0.98] disabled:opacity-50 ${audience === 'close_friends' ? 'bg-emerald-600' : 'bg-brand'}`}>
            {busy ? 'A publicar…' : audience === 'close_friends' ? 'Partilhar com amigos próximos' : 'Partilhar no story'}
          </button>
        </div>
      </form>
      {listOpen && <CloseFriendsSheet layer="z-[70]" onClose={() => setListOpen(false)} />}
    </div>
  );
}
