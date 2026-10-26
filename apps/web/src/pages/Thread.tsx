import { track } from '../lib/analytics';
import { sized } from '../lib/media';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useLayoutEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { BackIcon } from '../components/icons';
import Icon from '../components/Icon';
import ReportSheet from '../components/ReportSheet';
import { Avatar, Sheet } from '../components/ui';
import { api, type ChatMessage } from '../lib/api';
import { useTyping } from '../lib/chatLive';
import { useVisualViewport, visibleStyle } from '../lib/useVisualViewport';

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_IMAGE = 8 * 1024 * 1024;
const MAX_VOICE_MS = 120_000;

const clock = (iso: string) => new Date(iso).toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' });
const mmss = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}`;

const icon = { width: 22, height: 22, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true } as const;

/** Mensagem de voz: botão de tocar, barra de progresso e duração. */
function VoiceBubble({ m }: { m: ChatMessage }) {
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [at, setAt] = useState(0);
  const total = m.durationMs ?? 0;
  const mine = m.fromMe;
  return (
    <div className={`flex w-[230px] max-w-[82%] items-center gap-3 rounded-[20px] px-3 py-2.5 ${mine ? 'rounded-br-md bg-brand text-white' : 'rounded-bl-md bg-zinc-100 text-zinc-900'}`}>
      <audio
        ref={audio}
        src={m.mediaUrl ?? undefined}
        preload="none"
        onTimeUpdate={(e) => setAt(e.currentTarget.currentTime * 1000)}
        onEnded={() => { setPlaying(false); setAt(0); }}
        onPause={() => setPlaying(false)}
        onPlay={() => setPlaying(true)}
      />
      <button
        type="button"
        onClick={() => (playing ? audio.current?.pause() : void audio.current?.play())}
        aria-label={playing ? 'Pausar' : 'Ouvir mensagem de voz'}
        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${mine ? 'bg-white/25' : 'bg-white shadow-sm'}`}
      >
        {playing ? (
          <svg {...icon} fill="currentColor" stroke="none"><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></svg>
        ) : (
          <svg {...icon} fill="currentColor" stroke="none"><path d="M8 5v14l11-7z" /></svg>
        )}
      </button>
      <div className="min-w-0 flex-1">
        <div className={`h-1.5 overflow-hidden rounded-full ${mine ? 'bg-white/30' : 'bg-zinc-300'}`}>
          <div className={`h-full rounded-full ${mine ? 'bg-white' : 'bg-brand'}`} style={{ width: `${total ? Math.min(100, (at / total) * 100) : 0}%` }} />
        </div>
        <p className={`mt-1 text-xs tabular-nums ${mine ? 'text-white/85' : 'text-zinc-500'}`}>{mmss(playing || at > 0 ? at : total)}</p>
      </div>
    </div>
  );
}

function Bubble({ m, last, seen, onMenu }: { m: ChatMessage; last: boolean; seen: boolean; onMenu: (m: ChatMessage) => void }) {
  const mine = m.fromMe;
  // Carregar e segurar (ou clique direito): apagar as minhas, denunciar as dos outros.
  const hold = useRef<ReturnType<typeof setTimeout>>();
  const menuProps = {
    onPointerDown: () => { hold.current = setTimeout(() => onMenu(m), 450); },
    onPointerUp: () => clearTimeout(hold.current),
    onPointerLeave: () => clearTimeout(hold.current),
    onContextMenu: (e: React.MouseEvent) => { e.preventDefault(); onMenu(m); },
  };
  return (
    <div className={`flex select-none flex-col ${mine ? 'items-end' : 'items-start'}`} {...menuProps}>
      {m.storyUrl && <img src={sized(m.storyUrl, 160)} alt="Story" className="mb-1 h-28 w-[72px] rounded-xl object-cover opacity-90" />}
      {(m.kind === 'story_reply' || m.kind === 'story_reaction') && (
        <p className="mb-0.5 text-xs text-zinc-500">{m.kind === 'story_reaction' ? (mine ? 'Reagiste ao story' : 'Reagiu ao teu story') : mine ? 'Respondeste ao story' : 'Respondeu ao teu story'}</p>
      )}
      {m.kind === 'story_reaction' && <p className="text-4xl leading-tight">{m.body}</p>}
      {m.kind === 'voice' && <VoiceBubble m={m} />}
      {m.kind === 'image' && m.mediaUrl && (
        <div className={`max-w-[75%] overflow-hidden rounded-[20px] ${mine ? 'rounded-br-md bg-brand' : 'rounded-bl-md bg-zinc-100'}`}>
          <a href={m.mediaUrl} target="_blank" rel="noreferrer">
            <img src={m.mediaUrl} alt="Foto enviada" loading="lazy" draggable={false} className="max-h-72 w-full object-cover" />
          </a>
          {m.body && <p className={`px-3 py-2 text-[16px] ${mine ? 'text-white' : 'text-zinc-900'}`}>{m.body}</p>}
        </div>
      )}
      {(m.kind === 'text' || m.kind === 'story_reply') && (
        <p className={`max-w-[82%] whitespace-pre-wrap break-words rounded-[20px] px-4 py-2.5 text-[16px] leading-snug ${mine ? 'rounded-br-md bg-brand text-white' : 'rounded-bl-md bg-zinc-100 text-zinc-900'}`}>{m.body}</p>
      )}
      {last && (
        <span className="mt-0.5 px-1 text-[11px] text-zinc-500">
          {clock(m.at)}
          {mine && seen ? ' · Visto' : ''}
        </span>
      )}
    </div>
  );
}

/** Conversa com uma pessoa. Tempo real (as mensagens chegam sozinhas), com fotos, voz, "a escrever…" e "Visto". */
export default function Thread() {
  const { username = '' } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [text, setText] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [menuFor, setMenuFor] = useState<ChatMessage | null>(null);
  const [reporting, setReporting] = useState<string | null>(null);
  const [rec, setRec] = useState<{ ms: number } | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const typingSent = useRef(0);
  const typing = useTyping(username);
  const vv = useVisualViewport();
  const recorder = useRef<{ mr: MediaRecorder; chunks: Blob[]; start: number; stream: MediaStream; cancelled: boolean } | null>(null);

  const q = useInfiniteQuery({
    queryKey: ['chat-thread', username],
    queryFn: ({ pageParam }) => api.chatThread(username, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (l) => l.nextCursor ?? undefined,
    // O tempo real faz o trabalho; isto é só uma rede de segurança.
    refetchInterval: () => (document.visibilityState === 'visible' ? 30_000 : false),
    retry: false,
  });
  const first = q.data?.pages[0];
  const otherRead = first?.otherRead ?? null;
  const items = (q.data?.pages.flatMap((p) => p.items) ?? []).slice().reverse();

  useEffect(() => {
    qc.invalidateQueries({ queryKey: ['chat-list'] });
    qc.invalidateQueries({ queryKey: ['chat-unread'] });
  }, [items.length, qc]);

  useLayoutEffect(() => {
    if (stick.current) end.current?.scrollIntoView({ block: 'end' });
  }, [items.length, typing]);

  useEffect(() => () => {
    // Ao sair com uma gravação em curso, descarta-a.
    const r = recorder.current;
    if (r) {
      r.cancelled = true;
      r.mr.state !== 'inactive' && r.mr.stop();
      r.stream.getTracks().forEach((t) => t.stop());
    }
  }, []);

  async function deliver(msg: Parameters<typeof api.chatSend>[1]) {
    setBusy(true);
    setErr('');
    try {
      track('message_send', { kind: msg.kind ?? 'text' });
      await api.chatSend(username, msg);
      stick.current = true;
      await q.refetch();
    } catch (x) {
      setErr((x as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const body = text.trim();
    if (!body || busy) return;
    setText('');
    await deliver({ body });
  }

  function onType(v: string) {
    setText(v);
    if (v && Date.now() - typingSent.current > 3000) {
      typingSent.current = Date.now();
      api.chatTyping(username).catch(() => undefined);
    }
  }

  async function pickPhoto(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    if (!IMAGE_TYPES.includes(f.type)) return setErr('Essa foto não serve. Usa JPEG, PNG ou WebP 🙃');
    if (f.size > MAX_IMAGE) return setErr('Foto pesada demais! Máximo 8 MB 🏋️');
    setBusy(true);
    setErr('');
    try {
      const mediaId = await api.uploadChatFile(f, f.type);
      const caption = text.trim();
      setText('');
      await api.chatSend(username, { kind: 'image', mediaId, body: caption });
      stick.current = true;
      await q.refetch();
    } catch (x) {
      setErr((x as Error).message);
    } finally {
      setBusy(false);
    }
  }

  // ----- voz -----
  async function startRecording() {
    setErr('');
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      return setErr('Gravar voz precisa de ligação segura (HTTPS) e de um browser compatível.');
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const type = ['audio/webm', 'audio/ogg', 'audio/mp4'].find((t) => MediaRecorder.isTypeSupported(t));
      const mr = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
      const r = { mr, chunks: [] as Blob[], start: Date.now(), stream, cancelled: false };
      recorder.current = r;
      mr.ondataavailable = (ev) => ev.data.size && r.chunks.push(ev.data);
      mr.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        recorder.current = null;
        setRec(null);
        if (r.cancelled || !r.chunks.length) return;
        const durationMs = Math.min(Date.now() - r.start, 300_000);
        const mime = (mr.mimeType || 'audio/webm').split(';')[0];
        setBusy(true);
        try {
          const blob = new Blob(r.chunks, { type: mime });
          const mediaId = await api.uploadChatFile(blob, mime);
          await api.chatSend(username, { kind: 'voice', mediaId, durationMs });
          stick.current = true;
          await q.refetch();
        } catch (x) {
          setErr((x as Error).message);
        } finally {
          setBusy(false);
        }
      };
      mr.start();
      setRec({ ms: 0 });
    } catch {
      setErr('Sem permissão para o microfone 🙈 Ativa-o no browser.');
    }
  }

  useEffect(() => {
    if (!rec) return;
    const t = setInterval(() => {
      const r = recorder.current;
      if (!r) return;
      const ms = Date.now() - r.start;
      setRec({ ms });
      if (ms >= MAX_VOICE_MS) r.mr.stop();
    }, 250);
    return () => clearInterval(t);
  }, [rec !== null]); // eslint-disable-line react-hooks/exhaustive-deps

  const finishRecording = (send: boolean) => {
    const r = recorder.current;
    if (!r) return;
    r.cancelled = !send;
    r.mr.stop();
  };

  async function remove(m: ChatMessage) {
    setMenuFor(null);
    await api.chatDelete(m.id).catch((x) => setErr((x as Error).message));
    await q.refetch();
  }

  if (q.isError) {
    return (
      <div className="mx-6 mt-16 text-center">
        <p className="text-5xl">😅</p>
        <p className="mt-3 text-xl font-bold">Não consegui abrir esta conversa</p>
        <button onClick={() => navigate(-1)} className="mt-4 font-semibold text-brand">Voltar</button>
      </div>
    );
  }

  const person = first?.person;
  const lastMine = [...items].reverse().find((m) => m.fromMe);
  const seenUpTo = (m: ChatMessage) => !!otherRead && m.id <= otherRead && lastMine?.id === m.id;
  const tool = 'flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-zinc-600 transition active:scale-90 active:bg-zinc-100';

  return (
    <div className="fixed inset-x-0 top-0 mx-auto flex h-dvh max-w-xl flex-col bg-white" style={visibleStyle(vv)}>
      <header className="flex shrink-0 items-center gap-1 border-b border-zinc-100 px-2 py-2">
        <button onClick={() => (window.history.length > 1 ? navigate(-1) : navigate('/messages', { replace: true }))} aria-label="Voltar" className="flex h-11 w-11 items-center justify-center rounded-full active:bg-zinc-100">
          <BackIcon />
        </button>
        {person && (
          <Link to={`/u/${person.username}`} className="flex min-w-0 items-center gap-3">
            <Avatar name={person.displayName} username={person.hasAvatar ? person.username : undefined} size={38} ring={false} />
            <span className="min-w-0">
              <span className="block truncate font-bold leading-tight">{person.displayName}</span>
              <span className="block truncate text-xs text-zinc-500">{typing ? <span className="font-semibold text-brand">a escrever…</span> : `@${person.username}`}</span>
            </span>
          </Link>
        )}
      </header>

      <div
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
        className="min-h-0 flex-1 space-y-2 overflow-y-auto px-4 py-4"
      >
        {q.hasNextPage && (
          <button onClick={() => { stick.current = false; void q.fetchNextPage(); }} className="mx-auto block rounded-full bg-zinc-100 px-4 py-1.5 text-sm font-semibold text-zinc-700">Ver mensagens anteriores</button>
        )}
        {q.isSuccess && items.length === 0 && <p className="py-16 text-center text-zinc-500">Diz olá a {person?.displayName.split(' ')[0] ?? 'esta pessoa'} 👋</p>}
        {items.map((m, i) => (
          <Bubble key={m.id} m={m} last={i === items.length - 1 || items[i + 1].fromMe !== m.fromMe} seen={seenUpTo(m)} onMenu={setMenuFor} />
        ))}
        {typing && (
          <div className="flex items-center gap-1 px-1 pt-1" aria-label="A escrever">
            {[0, 1, 2].map((d) => (
              <span key={d} className="h-2 w-2 animate-bounce rounded-full bg-zinc-400" style={{ animationDelay: `${d * 120}ms` }} />
            ))}
          </div>
        )}
        <div ref={end} />
      </div>

      {first?.blocked ? (
        <p className="shrink-0 border-t border-zinc-100 px-6 py-4 text-center text-sm text-zinc-600">Não podes trocar mensagens com esta conta.</p>
      ) : rec ? (
        <div className="flex shrink-0 items-center gap-3 border-t border-zinc-100 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3">
          <button type="button" onClick={() => finishRecording(false)} aria-label="Cancelar gravação" className={`${tool} text-red-600`}>
            <svg {...icon}><path d="M3 6h18M8 6V4h8v2m-9 0 1 14h8l1-14" /></svg>
          </button>
          <span className="flex min-w-0 flex-1 items-center gap-2 text-red-600">
            <span className="h-3 w-3 animate-pulse rounded-full bg-red-600" aria-hidden />
            <span className="font-semibold tabular-nums">{mmss(rec.ms)}</span>
            <span className="truncate text-sm text-zinc-500">A gravar…</span>
          </span>
          <button type="button" onClick={() => finishRecording(true)} className="h-11 rounded-full bg-brand px-5 font-bold text-white active:scale-95">Enviar</button>
        </div>
      ) : (
        <form onSubmit={submit} className="shrink-0 border-t border-zinc-100 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2">
          {err && <p role="alert" className="px-2 pb-1 text-center text-sm text-red-600">{err}</p>}
          <div className="flex items-end gap-1.5">
            <label className={`${tool} cursor-pointer`} title="Foto" aria-label="Enviar foto">
              <svg {...icon}><rect x="3" y="4" width="18" height="16" rx="2.5" /><circle cx="9" cy="10" r="1.6" /><path d="m21 16-5-5-8 8" /></svg>
              <input type="file" accept={IMAGE_TYPES.join(',')} onChange={pickPhoto} className="sr-only" disabled={busy} />
            </label>
            <textarea
              value={text}
              onChange={(e) => onType(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && window.matchMedia('(pointer: fine)').matches) submit(e as unknown as FormEvent);
              }}
              maxLength={2000}
              rows={1}
              placeholder="Escreve uma mensagem…"
              aria-label="Mensagem"
              className="max-h-32 min-h-11 flex-1 resize-none rounded-[22px] bg-zinc-100 px-4 py-2.5 text-[16px] outline-none focus:ring-2 focus:ring-brand/50"
            />
            {text.trim() ? (
              <button disabled={busy} className="h-11 rounded-full bg-brand px-5 font-bold text-white transition active:scale-95 disabled:opacity-40">Enviar</button>
            ) : (
              <button type="button" onClick={startRecording} disabled={busy} className={tool} aria-label="Gravar mensagem de voz">
                <svg {...icon}><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></svg>
              </button>
            )}
          </div>
        </form>
      )}

      {reporting && <ReportSheet type="message" id={reporting} onClose={() => setReporting(null)} />}
      {menuFor && (
        <Sheet title="Mensagem" onClose={() => setMenuFor(null)}>
          {menuFor.fromMe ? (
            <button onClick={() => remove(menuFor)} className="flex w-full items-center gap-4 rounded-2xl px-1 py-3 text-left text-red-700 transition active:bg-red-50">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-red-50"><Icon name="trash" /></span>
              <span>
                <span className="block text-[17px] font-semibold">Apagar para todos</span>
                <span className="block text-sm text-zinc-600">Desaparece da conversa, sem deixar rasto.</span>
              </span>
            </button>
          ) : (
            <button onClick={() => { setReporting(menuFor.id); setMenuFor(null); }} className="flex w-full items-center gap-4 rounded-2xl px-1 py-3 text-left transition active:bg-zinc-100">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-zinc-800"><Icon name="flag" /></span>
              <span>
                <span className="block text-[17px] font-semibold">Denunciar mensagem</span>
                <span className="block text-sm text-zinc-600">Avisa a moderação. A pessoa não sabe.</span>
              </span>
            </button>
          )}
        </Sheet>
      )}
    </div>
  );
}
