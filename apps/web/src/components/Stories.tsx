import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { api, type Story, type TrayUser } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Avatar, timeAgo } from './ui';

const DURATION_MS = 5000;
const TICK_MS = 50;
const MAX_BYTES = 8 * 1024 * 1024;
const TYPES = ['image/jpeg', 'image/png', 'image/webp'];

/** Anel gradiente para stories por ver, cinzento para os já vistos (como no Instagram). */
function Ring({ seen, children }: { seen: boolean; children: React.ReactNode }) {
  return (
    <span className={`inline-block rounded-full p-[3px] ${seen ? 'bg-zinc-300' : 'bg-gradient-to-tr from-brand to-amber-400'}`}>
      <span className="block rounded-full bg-white p-[2px]">{children}</span>
    </span>
  );
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
  const mine = users.find((u) => u.isMe);
  const others = users.filter((u) => !u.isMe);

  function choose(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    if (!TYPES.includes(f.type)) return setErr('Essa foto não serve. Usa JPEG, PNG ou WebP 🙃');
    if (f.size > MAX_BYTES) return setErr('Foto pesada demais! Máximo 8 MB 🏋️');
    setErr('');
    setFile(f);
  }

  const bubble = 'flex w-[76px] shrink-0 flex-col items-center gap-1.5';
  const label = 'w-full truncate text-center text-xs text-zinc-700';
  return (
    <section aria-label="Stories" className="mb-4">
      <div className="flex gap-3 overflow-x-auto px-4 pb-1 pt-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div className={bubble}>
          <div className="relative">
            {mine ? (
              <button onClick={() => setViewing(0)} aria-label="Ver o teu story">
                <Ring seen><Avatar name={user?.displayName ?? '?'} size={60} ring={false} /></Ring>
              </button>
            ) : (
              <label className="block cursor-pointer" aria-label="Criar story">
                <Ring seen><Avatar name={user?.displayName ?? '?'} size={60} ring={false} /></Ring>
                <input type="file" accept={TYPES.join(',')} onChange={choose} className="sr-only" />
              </label>
            )}
            <label className="absolute -bottom-0.5 -right-0.5 flex h-6 w-6 cursor-pointer items-center justify-center rounded-full border-2 border-white bg-brand text-base font-bold leading-none text-white" aria-label="Adicionar ao story">
              +
              {mine && <input type="file" accept={TYPES.join(',')} onChange={choose} className="sr-only" />}
            </label>
          </div>
          <span className={label}>O teu story</span>
        </div>

        {others.map((u, i) => (
          <button key={u.username} onClick={() => setViewing(mine ? i + 1 : i)} className={bubble} aria-label={`Ver story de ${u.displayName}`}>
            <Ring seen={u.seen}><Avatar name={u.displayName} size={60} ring={false} /></Ring>
            <span className={label}>{u.username}</span>
          </button>
        ))}
      </div>
      {err && <p role="alert" className="px-4 pt-2 text-sm text-red-600">{err}</p>}

      {viewing !== null && (
        <Viewer
          users={[...(mine ? [mine] : []), ...others]}
          start={viewing}
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

const iconProps = { width: 24, height: 24, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true } as const;
const CloseIcon = () => (
  <svg {...iconProps}>
    <path d="M6 6l12 12M18 6 6 18" />
  </svg>
);
const DotsIcon = () => (
  <svg {...iconProps} fill="currentColor" stroke="none">
    <circle cx="5" cy="12" r="2" />
    <circle cx="12" cy="12" r="2" />
    <circle cx="19" cy="12" r="2" />
  </svg>
);
const EyeIcon = () => (
  <svg {...iconProps} width={20} height={20}>
    <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

const REACTIONS = ['😂', '😮', '😍', '😢', '👏', '🔥', '🍻'];

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
      setMsg(REACTIONS.includes(body) ? `${body} enviado!` : 'Mensagem enviada ✅');
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
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onFocus={() => focus(true)}
          onBlur={() => focus(false)}
          maxLength={500}
          placeholder={`Enviar mensagem a ${username}…`}
          aria-label={`Responder ao story de ${username}`}
          className="min-w-0 flex-1 rounded-full border border-white/60 bg-black/20 px-5 py-3 text-white outline-none backdrop-blur-sm placeholder:text-white/70 focus:border-white"
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
      <div role="dialog" aria-label={title} className="animate-[rise_.2s_ease-out] max-h-[70%] w-full overflow-y-auto rounded-t-[24px] bg-white px-5 pb-6 pt-3 text-zinc-900" onClick={(e) => e.stopPropagation()}>
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-zinc-300" aria-hidden />
        <h2 className="mb-2 text-center text-base font-bold">{title}</h2>
        {children}
      </div>
    </div>
  );
}

function Viewer({ users, start, onClose }: { users: TrayUser[]; start: number; onClose: () => void }) {
  const qc = useQueryClient();
  const [u, setU] = useState(start);
  const [s, setS] = useState(0);
  const [pct, setPct] = useState(0);
  const [held, setHeld] = useState(false);
  const [panel, setPanel] = useState<null | 'menu' | 'viewers'>(null);
  const [typing, setTyping] = useState(false);
  const downAt = useRef(0);
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
  useEffect(() => setPct(0), [s]);
  useEffect(() => {
    if (story && !user.isMe) api.viewStory(story.id).catch(() => undefined);
  }, [story?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!story || paused) return;
    const t = setInterval(() => setPct((p) => p + (100 * TICK_MS) / DURATION_MS), TICK_MS);
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
    else if (u < users.length - 1) setU(u + 1);
    else onClose();
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
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black" role="dialog" aria-modal="true" aria-label={`Story de ${user.displayName}`}>
      <div
        className="relative h-full w-full max-w-[460px] select-none overflow-hidden bg-zinc-900 sm:h-[min(100dvh,860px)] sm:rounded-3xl"
        onPointerDown={() => { downAt.current = Date.now(); setHeld(true); }}
        onPointerUp={() => setHeld(false)}
        onPointerLeave={() => setHeld(false)}
      >
        {story && (
          <>
            {/* Fundo desfocado da própria foto: a imagem aparece inteira, sem barras pretas */}
            <img src={story.mediaUrl} alt="" aria-hidden className="absolute inset-0 h-full w-full scale-125 object-cover opacity-70 blur-2xl" draggable={false} />
            <img src={story.mediaUrl} alt={story.caption ?? `Story de ${user.displayName}`} className="relative h-full w-full object-contain" draggable={false} />
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
            <Avatar name={user.displayName} size={40} ring={false} />
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
          {story?.caption && (
            <p className="max-w-full break-words rounded-2xl bg-black/40 px-4 py-2 text-center text-lg text-white backdrop-blur-sm">{story.caption}</p>
          )}
          {user.isMe && story && (
            <button {...stop} onClick={() => setPanel('viewers')} className="pointer-events-auto flex items-center gap-2 rounded-full bg-white/20 px-4 py-2 text-sm font-semibold text-white backdrop-blur-sm transition active:scale-95">
              <EyeIcon /> {story.viewCount ?? 0}
            </button>
          )}
          {!user.isMe && story && <ReplyBar key={story.id} story={story} username={user.username} onFocusChange={setTyping} />}
        </div>

        {panel === 'menu' && (
          <Panel title="O teu story" onClose={() => setPanel(null)}>
            <button onClick={remove} className="w-full rounded-xl py-3.5 text-lg font-semibold text-red-600 active:bg-zinc-100">Apagar story</button>
            <button onClick={() => setPanel(null)} className="w-full rounded-xl py-3.5 text-lg active:bg-zinc-100">Cancelar</button>
          </Panel>
        )}
        {panel === 'viewers' && (
          <Panel title="Atividade do story" onClose={() => setPanel(null)}>
            {replies.data && replies.data.length > 0 && (
              <>
                <p className="mb-1 mt-2 text-sm font-semibold text-zinc-500">Respostas ({replies.data.length})</p>
                {replies.data.map((r) => (
                  <div key={r.id} className="flex items-center gap-3 py-2.5">
                    <Avatar name={r.author.displayName} size={40} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-zinc-500">
                        <b className="text-zinc-900">{r.author.username}</b> · {timeAgo(r.createdAt)}
                      </p>
                      <p className={r.kind === 'reaction' ? 'text-3xl leading-tight' : 'break-words'}>{r.body}</p>
                    </div>
                  </div>
                ))}
              </>
            )}
            <p className="mb-1 mt-4 text-sm font-semibold text-zinc-500">Quem viu {story?.viewCount ? `(${story.viewCount})` : ''}</p>
            {viewers.isLoading && <p className="py-6 text-center text-zinc-500">A carregar…</p>}
            {viewers.isSuccess && viewers.data.length === 0 && <p className="py-4 text-center text-zinc-500">Ainda ninguém viu 👀</p>}
            {viewers.data?.map((v) => (
              <div key={v.username} className="flex items-center gap-3 py-2.5">
                <Avatar name={v.displayName} size={40} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{v.displayName}</p>
                  <p className="text-sm text-zinc-500">@{v.username} · {timeAgo(v.viewedAt)}</p>
                </div>
              </div>
            ))}
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
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function share(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      const mediaId = await api.uploadImage(file);
      await api.createStory(mediaId, caption.trim());
      await qc.invalidateQueries({ queryKey: ['stories'] });
      onClose();
    } catch (x) {
      setErr((x as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black" role="dialog" aria-modal="true" aria-label="Novo story">
      <form onSubmit={share} className="relative flex h-full w-full max-w-xl flex-col">
        <img src={preview} alt="Pré-visualização do story" className="min-h-0 flex-1 object-contain" />
        <button type="button" onClick={onClose} aria-label="Cancelar" className="absolute left-3 top-[max(0.75rem,env(safe-area-inset-top))] px-2 text-3xl leading-none text-white">×</button>
        <div className="space-y-3 bg-black px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3">
          <input value={caption} onChange={(e) => setCaption(e.target.value)} maxLength={200} placeholder="Escreve uma legenda… 💬" aria-label="Legenda" className="w-full rounded-full bg-white/15 px-4 py-3 text-white outline-none placeholder:text-white/60 focus:ring-2 focus:ring-brand" />
          <p role="alert" className="min-h-5 text-center text-sm text-red-400">{err}</p>
          <button disabled={busy} className="w-full rounded-full bg-brand py-3.5 text-lg font-semibold text-white transition active:scale-[0.98] disabled:opacity-50">
            {busy ? 'A publicar… 🚀' : 'Partilhar no story'}
          </button>
        </div>
      </form>
    </div>
  );
}
