import { track } from '../lib/analytics';
import { sized } from '../lib/media';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useLayoutEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { BackIcon } from '../components/icons';
import Icon from '../components/Icon';
import Camera from '../components/Camera';
import GiftSheet from '../components/GiftSheet';
import ReportSheet from '../components/ReportSheet';
import TileMap from '../components/TileMap';
import VoiceMessage from '../components/VoiceMessage';
import { Avatar, Sheet } from '../components/ui';
import { api, type ChatMessage } from '../lib/api';
import { detectIntent } from '../lib/chatIntent';
import { useTyping } from '../lib/chatLive';
import { STICKERS, Sticker } from '../lib/stickers';
import { useVisualViewport, visibleStyle } from '../lib/useVisualViewport';

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_IMAGE = 8 * 1024 * 1024;
const MAX_VOICE_MS = 120_000;
const GROUP_MS = 120_000; // mensagens da mesma pessoa com menos de 2 min juntam-se

const clock = (iso: string) => new Date(iso).toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' });
const mmss = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}`;
const sameDay = (a: string, b: string) => new Date(a).toDateString() === new Date(b).toDateString();
function dayLabel(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const yest = new Date();
  yest.setDate(now.getDate() - 1);
  if (d.toDateString() === now.toDateString()) return 'Hoje';
  if (d.toDateString() === yest.toDateString()) return 'Ontem';
  return d.toLocaleDateString('pt-PT', { day: 'numeric', month: 'long', ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}) });
}

/** "Visto há 5 min", "Visto hoje às 14:20", "Visto ontem", "Visto a 3 de out". */
function seenLabel(iso: string | null) {
  if (!iso) return null;
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'Visto agora mesmo';
  if (mins < 60) return `Visto há ${mins} min`;
  const d = new Date(iso);
  const now = new Date();
  const yest = new Date();
  yest.setDate(now.getDate() - 1);
  if (d.toDateString() === now.toDateString()) return `Visto hoje às ${clock(iso)}`;
  if (d.toDateString() === yest.toDateString()) return 'Visto ontem';
  return `Visto a ${d.toLocaleDateString('pt-PT', { day: 'numeric', month: 'short' })}`;
}

/** Mensagem enviada, à espera do servidor: aparece logo e fica "a enviar" ou "não enviada". */
type Msg = ChatMessage & { state?: 'sending' | 'failed'; realId?: string };
interface Draft {
  kind: 'text' | 'image' | 'voice' | 'sticker' | 'location';
  body: string;
  lat?: number;
  lng?: number;
  file?: Blob;
  mime?: string;
  durationMs?: number;
  waveform?: string;
  localUrl?: string;
}

function Bubble({ m, prevSame, nextSame, seen, onMenu, onRetry, onDiscard }: { m: Msg; prevSame: boolean; nextSame: boolean; seen: boolean; onMenu: (m: ChatMessage) => void; onRetry: (m: Msg) => void; onDiscard: (m: Msg) => void }) {
  const mine = m.fromMe;
  const real = !m.id.startsWith('tmp-');
  // Carregar e segurar (ou clique direito): apagar as minhas, denunciar as dos outros.
  const hold = useRef<ReturnType<typeof setTimeout>>();
  const menuProps = real
    ? {
        onPointerDown: () => { hold.current = setTimeout(() => onMenu(m), 450); },
        onPointerUp: () => clearTimeout(hold.current),
        onPointerLeave: () => clearTimeout(hold.current),
        onContextMenu: (e: React.MouseEvent) => { e.preventDefault(); onMenu(m); },
      }
    : {};
  // Dentro de um grupo os cantos juntam-se; só a última leva o "bico".
  const shape = mine
    ? `rounded-[20px] rounded-br-md ${prevSame ? 'rounded-tr-md' : ''}`
    : `rounded-[20px] rounded-bl-md ${prevSame ? 'rounded-tl-md' : ''}`;
  const tone = mine ? 'bg-brand text-white' : 'bg-zinc-100 text-zinc-900';
  const dim = m.state === 'sending' ? 'opacity-70' : '';

  return (
    <div className={`flex select-none flex-col ${mine ? 'items-end' : 'items-start'} ${prevSame ? 'mt-0.5' : 'mt-3'}`} {...menuProps}>
      {m.storyUrl && <img src={sized(m.storyUrl, 160)} alt="Story" className="mb-1 h-28 w-[72px] rounded-xl object-cover opacity-90" />}
      {(m.kind === 'story_reply' || m.kind === 'story_reaction') && (
        <p className="mb-0.5 text-xs text-zinc-500">{m.kind === 'story_reaction' ? (mine ? 'Reagiste ao story' : 'Reagiu ao teu story') : mine ? 'Respondeste ao story' : 'Respondeu ao teu story'}</p>
      )}
      {m.kind === 'story_reaction' && <p className="text-4xl leading-tight">{m.body}</p>}
      {m.kind === 'sticker' && <div className={dim}><Sticker id={m.body} /></div>}
      {m.kind === 'location' && m.lat != null && m.lng != null && (
        <a href={`https://www.google.com/maps?q=${m.lat},${m.lng}`} target="_blank" rel="noreferrer" className={`block overflow-hidden ${shape} ${tone} ${dim}`} style={{ width: 240 }}>
          <TileMap lat={m.lat} lng={m.lng} width={240} height={132} />
          <span className="flex items-center gap-2 px-3 py-2 text-[15px] font-semibold"><Icon name="map-pin" size={16} className="shrink-0" /><span className="min-w-0 truncate">{m.body || 'Localização'}</span></span>
        </a>
      )}
      {m.kind === 'voice' && <div className={`max-w-[86%] ${dim}`}><VoiceMessage m={m} /></div>}
      {m.kind === 'image' && m.mediaUrl && (
        <div className={`max-w-[75%] overflow-hidden ${shape} ${tone} ${dim}`}>
          <a href={m.mediaUrl} target="_blank" rel="noreferrer">
            <img src={m.mediaUrl} alt="Foto enviada" loading="lazy" draggable={false} className="max-h-72 w-full object-cover" />
          </a>
          {m.body && <p className="px-3 py-2 text-[16px]">{m.body}</p>}
        </div>
      )}
      {(m.kind === 'text' || m.kind === 'story_reply') && (
        <p className={`max-w-[82%] whitespace-pre-wrap break-words px-4 py-2.5 text-[16px] leading-snug ${shape} ${tone} ${dim}`}>{m.body}</p>
      )}
      {m.state === 'failed' ? (
        <span className="mt-1 flex items-center gap-2 px-1 text-[12px] font-semibold text-red-600">
          <Icon name="alert" size={14} /> Não enviada
          <button type="button" onClick={() => onRetry(m)} className="underline">Tentar de novo</button>
          <button type="button" onClick={() => onDiscard(m)} className="text-zinc-500 underline">Apagar</button>
        </span>
      ) : m.state === 'sending' ? (
        <span className="mt-0.5 px-1 text-[11px] text-zinc-500">A enviar…</span>
      ) : (
        !nextSame && (
          <span className="mt-0.5 px-1 text-[11px] text-zinc-500">
            {clock(m.at)}
            {mine && seen ? ' · Visto' : ''}
          </span>
        )
      )}
    </div>
  );
}

/** Conversa com uma pessoa. Tempo real, envio instantâneo, fotos, voz com onda, "a escrever…" e "Visto". */
export default function Thread() {
  const { username = '' } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [text, setText] = useState('');
  const [err, setErr] = useState('');
  const [menuFor, setMenuFor] = useState<ChatMessage | null>(null);
  const [reporting, setReporting] = useState<string | null>(null);
  const [rec, setRec] = useState<{ ms: number; bars: number[] } | null>(null);
  const [outbox, setOutbox] = useState<Msg[]>([]);
  const [unseen, setUnseen] = useState(0);
  const [away, setAway] = useState(false); // longe do fim da conversa
  const [panel, setPanel] = useState<null | 'attach' | 'stickers'>(null);
  const [camera, setCamera] = useState(false);
  const [gift, setGift] = useState<null | { amount?: number; note?: string }>(null);
  const [place, setPlace] = useState<null | 'finding' | { lat: number; lng: number }>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const scroller = useRef<HTMLDivElement>(null);
  const end = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const gallery = useRef<HTMLInputElement>(null);
  const stick = useRef(true);
  const initial = useRef(true);
  const drafts = useRef(new Map<string, Draft>());
  const seq = useRef(0);
  const typingSent = useRef(0);
  const typing = useTyping(username);
  const vv = useVisualViewport();
  const recorder = useRef<{ mr: MediaRecorder; chunks: Blob[]; start: number; stream: MediaStream; cancelled: boolean; ctx: AudioContext | null; levels: number[] } | null>(null);

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
  // As minhas ainda por confirmar vão no fim; quando a verdadeira chega, a provisória sai.
  const real = new Set(items.map((m) => m.id));
  const all: Msg[] = [...items, ...outbox.filter((o) => !(o.realId && real.has(o.realId)))];

  useEffect(() => {
    qc.invalidateQueries({ queryKey: ['chat-list'] });
    qc.invalidateQueries({ queryKey: ['chat-unread'] });
  }, [items.length, qc]);
  useEffect(() => {
    setOutbox((o) => (o.some((x) => x.realId && real.has(x.realId)) ? o.filter((x) => !(x.realId && real.has(x.realId))) : o));
  }, [items.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fica no fim quando já lá estavas (suave); na primeira vez vai direto. Se estás a ler mensagens antigas, avisa em vez de te puxar.
  const lastLen = useRef(0);
  useLayoutEffect(() => {
    if (!all.length) return;
    const grew = all.length - lastLen.current;
    lastLen.current = all.length;
    if (stick.current) {
      end.current?.scrollIntoView({ block: 'end', behavior: initial.current ? 'auto' : 'smooth' });
      initial.current = false;
    } else if (grew > 0 && !all[all.length - 1].fromMe) {
      setUnseen((n) => n + grew);
    }
  }, [all.length, typing]); // eslint-disable-line react-hooks/exhaustive-deps

  // A caixa cresce com o texto (até 5 linhas).
  useLayoutEffect(() => {
    const el = input.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 128)}px`;
  }, [text]);

  useEffect(() => () => {
    // Ao sair com uma gravação em curso, descarta-a.
    const r = recorder.current;
    if (r) {
      r.cancelled = true;
      r.mr.state !== 'inactive' && r.mr.stop();
      r.stream.getTracks().forEach((t) => t.stop());
      void r.ctx?.close();
    }
  }, []);

  /** Mostra a mensagem logo; o envio acontece por trás e, se falhar, fica a pedir para tentar de novo. */
  async function dispatch(d: Draft, tmpId = `tmp-${Date.now()}-${seq.current++}`) {
    drafts.current.set(tmpId, d);
    const msg: Msg = { id: tmpId, fromMe: true, body: d.body, kind: d.kind, storyUrl: null, mediaUrl: d.localUrl ?? null, durationMs: d.durationMs ?? null, waveform: d.waveform ?? null, at: new Date().toISOString(), state: 'sending' };
    setOutbox((o) => (o.some((x) => x.id === tmpId) ? o.map((x) => (x.id === tmpId ? msg : x)) : [...o, msg]));
    stick.current = true;
    setErr('');
    try {
      const mediaId = d.file ? await api.uploadChatFile(d.file, d.mime ?? d.file.type) : undefined;
      track('message_send', { kind: d.kind });
      const r = await api.chatSend(username, { kind: d.kind, body: d.body, mediaId, durationMs: d.durationMs, waveform: d.waveform });
      drafts.current.delete(tmpId);
      setOutbox((o) => o.map((x) => (x.id === tmpId ? { ...x, state: undefined, realId: r.id } : x)));
      await q.refetch();
    } catch (x) {
      setOutbox((o) => o.map((i) => (i.id === tmpId ? { ...i, state: 'failed' } : i)));
      setErr((x as Error).message);
    }
  }
  const retry = (m: Msg) => {
    const d = drafts.current.get(m.id);
    if (d) void dispatch(d, m.id);
  };
  const discard = (m: Msg) => {
    drafts.current.delete(m.id);
    setOutbox((o) => o.filter((x) => x.id !== m.id));
  };

  function submit(e?: FormEvent) {
    e?.preventDefault();
    const body = text.trim();
    if (!body) return;
    setText('');
    input.current?.focus(); // o teclado fica aberto para a mensagem seguinte
    void dispatch({ kind: 'text', body });
  }

  function onType(v: string) {
    setText(v);
    if (v && Date.now() - typingSent.current > 3000) {
      typingSent.current = Date.now();
      api.chatTyping(username).catch(() => undefined);
    }
  }

  function pickPhoto(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    if (!IMAGE_TYPES.includes(f.type)) return setErr('Essa foto não serve. Usa JPEG, PNG ou WebP');
    if (f.size > MAX_IMAGE) return setErr('Foto pesada demais! Máximo 8 MB');
    const caption = text.trim();
    setText('');
    void dispatch({ kind: 'image', body: caption, file: f, mime: f.type, localUrl: URL.createObjectURL(f) });
  }

  function sendPhoto(f: File) {
    if (!IMAGE_TYPES.includes(f.type)) return setErr('Essa foto não serve. Usa JPEG, PNG ou WebP');
    if (f.size > MAX_IMAGE) return setErr('Foto pesada demais! Máximo 8 MB');
    void dispatch({ kind: 'image', body: '', file: f, mime: f.type, localUrl: URL.createObjectURL(f) });
  }

  function sendSticker(id: string) {
    setPanel(null);
    void dispatch({ kind: 'sticker', body: id });
  }

  /** Pede a localização só quando se toca; mostra onde é e só envia se confirmares. Não fica guardada nem é seguida. */
  function findPlace() {
    setPanel(null);
    if (!navigator.geolocation) return setErr('Este aparelho não partilha localização.');
    setPlace('finding');
    navigator.geolocation.getCurrentPosition(
      (p) => setPlace({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => {
        setPlace(null);
        setErr('Não consegui a tua localização. Ativa-a nas definições do browser.');
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 30_000 },
    );
  }
  function sendPlace() {
    if (!place || place === 'finding') return;
    const { lat, lng } = place;
    setPlace(null);
    void dispatch({ kind: 'location', body: 'A minha localização', lat, lng });
  }

  // ----- voz -----
  async function startRecording() {
    setErr('');
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      return setErr('Gravar voz precisa de ligação segura (HTTPS) e de um browser compatível.');
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      const type = ['audio/webm', 'audio/ogg', 'audio/mp4'].find((t) => MediaRecorder.isTypeSupported(t));
      const mr = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
      // Mede o volume da voz enquanto grava: dá a onda que aparece na mensagem.
      let ctx: AudioContext | null = null;
      let analyser: AnalyserNode | null = null;
      try {
        const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (AC) {
          ctx = new AC();
          analyser = ctx.createAnalyser();
          analyser.fftSize = 512;
          ctx.createMediaStreamSource(stream).connect(analyser);
        }
      } catch {
        ctx = null;
      }
      const r = { mr, chunks: [] as Blob[], start: Date.now(), stream, cancelled: false, ctx, levels: [] as number[] };
      recorder.current = r;
      const buf = new Uint8Array(analyser?.fftSize ?? 0);
      const sample = setInterval(() => {
        if (!analyser) return;
        analyser.getByteTimeDomainData(buf);
        let sum = 0;
        for (const v of buf) sum += (v - 128) ** 2;
        r.levels.push(Math.min(1, Math.sqrt(sum / buf.length) / 48));
      }, 100);
      mr.ondataavailable = (ev) => ev.data.size && r.chunks.push(ev.data);
      mr.onstop = () => {
        clearInterval(sample);
        stream.getTracks().forEach((t) => t.stop());
        void ctx?.close();
        recorder.current = null;
        setRec(null);
        if (r.cancelled || !r.chunks.length) return;
        const durationMs = Math.min(Date.now() - r.start, 300_000);
        const mime = (mr.mimeType || 'audio/webm').split(';')[0];
        const blob = new Blob(r.chunks, { type: mime });
        void dispatch({ kind: 'voice', body: '', file: blob, mime, durationMs, waveform: toWaveform(r.levels), localUrl: URL.createObjectURL(blob) });
      };
      mr.start();
      setRec({ ms: 0, bars: [] });
    } catch {
      setErr('Sem permissão para o microfone. Ativa-o no browser.');
    }
  }

  /** ~48 níveis de 0 a 9 a partir das medições (sem silêncio total, para a onda não ficar vazia). */
  function toWaveform(levels: number[]) {
    if (levels.length < 4) return undefined;
    const n = 48;
    let out = '';
    for (let i = 0; i < n; i++) {
      const a = Math.floor((i * levels.length) / n);
      const b = Math.max(a + 1, Math.floor(((i + 1) * levels.length) / n));
      let peak = 0;
      for (let k = a; k < b; k++) peak = Math.max(peak, levels[k] ?? 0);
      out += String(Math.max(1, Math.min(9, Math.round(peak * 9))));
    }
    return out;
  }

  useEffect(() => {
    if (!rec) return;
    const t = setInterval(() => {
      const r = recorder.current;
      if (!r) return;
      const ms = Date.now() - r.start;
      setRec({ ms, bars: r.levels.slice(-32) });
      if (ms >= MAX_VOICE_MS) r.mr.stop();
    }, 120);
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

  function jumpDown() {
    stick.current = true;
    setUnseen(0);
    end.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
  }

  if (q.isError) {
    return (
      <div className="mx-6 mt-16 text-center">
        <p className="text-zinc-300" aria-hidden><Icon name="alert" size={44} className="mx-auto" /></p>
        <p className="mt-3 text-xl font-bold">Não consegui abrir esta conversa</p>
        <button onClick={() => navigate(-1)} className="mt-4 font-semibold text-brand">Voltar</button>
      </div>
    );
  }

  const person = first?.person;
  const intent = person?.canGift ? detectIntent(items, person.displayName.split(' ')[0]) : null;
  const suggestion = intent && !dismissed.has(intent.key) && !gift ? intent : null;
  const lastMine = [...items].reverse().find((m) => m.fromMe);
  const seenUpTo = (m: ChatMessage) => !!otherRead && m.id <= otherRead && lastMine?.id === m.id;
  const tool = 'flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-zinc-600 transition active:scale-90 active:bg-zinc-100';
  const joined = (a: Msg, b: Msg) => a.fromMe === b.fromMe && sameDay(a.at, b.at) && new Date(b.at).getTime() - new Date(a.at).getTime() < GROUP_MS && a.kind !== 'story_reaction' && b.kind !== 'story_reaction';

  return (
    <div className="fixed inset-x-0 top-0 mx-auto flex h-dvh max-w-xl flex-col bg-white" style={visibleStyle(vv)}>
      <header className="flex shrink-0 items-center gap-1 border-b border-zinc-100 px-2 py-2">
        <button onClick={() => (window.history.length > 1 ? navigate(-1) : navigate('/messages', { replace: true }))} aria-label="Voltar" className="flex h-11 w-11 items-center justify-center rounded-full active:bg-zinc-100">
          <BackIcon />
        </button>
        {person && (
          <Link to={`/u/${person.username}`} className="flex min-w-0 items-center gap-3">
            <span className="relative">
              <Avatar name={person.displayName} username={person.hasAvatar ? person.username : undefined} size={38} ring={false} />
              {person.presence?.online && <span className="absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-white bg-emerald-500" aria-label="Online" />}
            </span>
            <span className="min-w-0">
              <span className="block truncate font-bold leading-tight">{person.displayName}</span>
              <span className="block truncate text-xs text-zinc-500">
                {typing ? (
                  <span className="font-semibold text-brand">a escrever…</span>
                ) : person.presence?.online ? (
                  <span className="flex items-center gap-1 font-semibold text-emerald-600"><span className="h-2 w-2 rounded-full bg-emerald-500" aria-hidden /> Online</span>
                ) : (
                  seenLabel(person.presence?.lastSeen ?? null) ?? `@${person.username}`
                )}
              </span>
            </span>
          </Link>
        )}
      </header>

      <div className="relative min-h-0 flex-1">
        <div
          ref={scroller}
          onScroll={(e) => {
            const el = e.currentTarget;
            const gap = el.scrollHeight - el.scrollTop - el.clientHeight;
            stick.current = gap < 80;
            setAway(gap > 320);
            if (gap < 80) setUnseen(0);
          }}
          className="h-full overflow-y-auto overscroll-contain px-4 pb-3 pt-2 [overflow-anchor:none]"
        >
          {q.hasNextPage && (
            <button onClick={() => { stick.current = false; void q.fetchNextPage(); }} className="mx-auto mb-2 mt-2 block rounded-full bg-zinc-100 px-4 py-1.5 text-sm font-semibold text-zinc-700">Ver mensagens anteriores</button>
          )}
          {q.isLoading && (
            <div className="space-y-3 pt-4" role="status" aria-label="A carregar">
              {[60, 40, 70, 48].map((w, i) => <div key={i} className={`skel h-10 rounded-[20px] ${i % 2 ? 'ml-auto' : ''}`} style={{ width: `${w}%` }} />)}
            </div>
          )}
          {q.isSuccess && all.length === 0 && <p className="py-16 text-center text-zinc-500">Diz olá a {person?.displayName.split(' ')[0] ?? 'esta pessoa'}</p>}
          {all.map((m, i) => {
            const prev = all[i - 1];
            const next = all[i + 1];
            const newDay = !prev || !sameDay(prev.at, m.at);
            return (
              <div key={m.id}>
                {newDay && <p className="mx-auto mb-1 mt-5 w-fit rounded-full bg-zinc-100 px-3 py-1 text-[12px] font-semibold text-zinc-600">{dayLabel(m.at)}</p>}
                <Bubble m={m} prevSame={!!prev && !newDay && joined(prev, m)} nextSame={!!next && joined(m, next)} seen={seenUpTo(m)} onMenu={setMenuFor} onRetry={retry} onDiscard={discard} />
              </div>
            );
          })}
          {typing && (
            <div className="mt-2 flex w-fit items-center gap-1 rounded-[20px] rounded-bl-md bg-zinc-100 px-3.5 py-3" aria-label="A escrever">
              {[0, 1, 2].map((d) => (
                <span key={d} className="h-2 w-2 animate-bounce rounded-full bg-zinc-400" style={{ animationDelay: `${d * 120}ms` }} />
              ))}
            </div>
          )}
          <div ref={end} />
        </div>
        {(away || unseen > 0) && (
          <button onClick={jumpDown} aria-label={unseen ? `${unseen} mensagens novas` : 'Ir para o fim'} className="absolute bottom-3 left-1/2 flex h-10 -translate-x-1/2 items-center gap-1.5 rounded-full bg-white px-4 text-sm font-bold text-zinc-800 shadow-[0_2px_12px_rgba(0,0,0,0.2)] ring-1 ring-zinc-100 active:scale-95">
            <Icon name="chevron-right" size={16} className="rotate-90" /> {unseen ? `${unseen} ${unseen === 1 ? 'nova' : 'novas'}` : 'Fim'}
          </button>
        )}
      </div>

      {first?.blocked ? (
        <p className="shrink-0 border-t border-zinc-100 px-6 py-4 text-center text-sm text-zinc-600">Não podes trocar mensagens com esta conta.</p>
      ) : rec ? (
        <div className="flex shrink-0 items-center gap-3 border-t border-zinc-100 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3">
          <button type="button" onClick={() => finishRecording(false)} aria-label="Cancelar gravação" className={`${tool} text-red-600`}>
            <Icon name="trash" size={22} />
          </button>
          <span className="flex min-w-0 flex-1 items-center gap-2.5 rounded-full bg-red-50 px-3 py-2 text-red-600">
            <span className="h-2.5 w-2.5 shrink-0 animate-pulse rounded-full bg-red-600" aria-hidden />
            <span className="w-10 shrink-0 font-semibold tabular-nums">{mmss(rec.ms)}</span>
            <span className="flex h-7 min-w-0 flex-1 items-center justify-end gap-[2px]" aria-hidden>
              {rec.bars.map((l, i) => <span key={i} className="w-[3px] shrink-0 rounded-full bg-red-500" style={{ height: `${Math.max(12, Math.round(l * 100))}%` }} />)}
            </span>
          </span>
          <button type="button" onClick={() => finishRecording(true)} className="h-11 rounded-full bg-brand px-5 font-bold text-white active:scale-95">Enviar</button>
        </div>
      ) : (
        <div className="shrink-0 border-t border-zinc-100">
        {suggestion && (
          <div className="mx-3 mt-2 flex items-center gap-3 rounded-2xl bg-amber-50 p-2.5 pl-3" role="note">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-700"><Icon name="gift" size={20} /></span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[15px] font-bold leading-tight">{suggestion.title}</span>
              <span className="block text-xs leading-tight text-zinc-600">{suggestion.hint}</span>
            </span>
            <button type="button" onClick={() => setGift({ amount: suggestion.amount, note: suggestion.note })} className="h-9 shrink-0 rounded-full bg-brand px-4 text-sm font-bold text-white active:scale-95">Presentear</button>
            <button type="button" onClick={() => setDismissed((d) => new Set(d).add(suggestion.key))} aria-label="Dispensar sugestão" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-zinc-500 active:bg-amber-100"><Icon name="x" size={18} /></button>
          </div>
        )}
        {panel === 'attach' && (
          <div className="mx-3 mt-2 grid grid-cols-4 gap-2 sm:grid-cols-5" role="menu" aria-label="Anexar">
            {([
              ['camera', 'Câmara', () => { setPanel(null); setCamera(true); }],
              ['image', 'Galeria', () => { setPanel(null); gallery.current?.click(); }],
              ['sparkles', 'Stickers', () => setPanel('stickers')],
              ['map-pin', 'Local', findPlace],
              ...(person?.canGift ? [['gift', 'Presente', () => { setPanel(null); setGift({}); }] as const] : []),
            ] as const).map(([ic, label, run]) => (
              <button key={label} type="button" role="menuitem" onClick={run} className="flex flex-col items-center gap-1.5 rounded-2xl py-2 active:bg-zinc-100">
                <span className="flex h-12 w-12 items-center justify-center rounded-full bg-zinc-100 text-zinc-800"><Icon name={ic} size={22} /></span>
                <span className="text-xs font-semibold text-zinc-700">{label}</span>
              </button>
            ))}
          </div>
        )}
        {panel === 'stickers' && (
          <div className="mx-3 mt-2" aria-label="Stickers">
            <div className="grid max-h-56 grid-cols-4 gap-2 overflow-y-auto rounded-2xl bg-zinc-50 p-2">
              {STICKERS.map((st) => (
                <button key={st.id} type="button" onClick={() => sendSticker(st.id)} aria-label={`Enviar sticker ${st.text}`} className="flex justify-center rounded-2xl p-1 active:scale-90"><Sticker id={st.id} size={72} /></button>
              ))}
            </div>
          </div>
        )}
        <form onSubmit={submit} className="px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2">
          {err && <p role="alert" className="px-2 pb-1 text-center text-sm text-red-600">{err}</p>}
          <div className="flex items-end gap-1.5">
            <button type="button" onClick={() => setPanel(panel ? null : 'attach')} aria-label={panel ? 'Fechar anexos' : 'Anexar'} aria-expanded={!!panel} className={`${tool} ${panel ? 'rotate-45 bg-zinc-100 text-brand' : ''} transition-transform`}>
              <Icon name="plus" size={24} />
            </button>
            <input ref={gallery} type="file" accept={IMAGE_TYPES.join(',')} onChange={pickPhoto} className="sr-only" aria-label="Escolher foto da galeria" />
            <textarea
              ref={input}
              value={text}
              onChange={(e) => onType(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && window.matchMedia('(pointer: fine)').matches) submit(e as unknown as FormEvent);
              }}
              maxLength={2000}
              rows={1}
              placeholder="Escreve uma mensagem…"
              aria-label="Mensagem"
              className="max-h-32 min-h-11 flex-1 resize-none rounded-[22px] bg-zinc-100 px-4 py-2.5 text-[16px] outline-none focus:bg-zinc-200/70"
            />
            {text.trim() ? (
              // pointerdown sem foco: o teclado não fecha ao enviar.
              <button type="submit" onPointerDown={(e) => e.preventDefault()} className="h-11 rounded-full bg-brand px-5 font-bold text-white transition active:scale-95">Enviar</button>
            ) : (
              <button type="button" onClick={startRecording} className={tool} aria-label="Gravar mensagem de voz">
                <Icon name="mic" size={22} />
              </button>
            )}
          </div>
        </form>
        </div>
      )}

      {camera && (
        <Camera
          count={0}
          max={1}
          onShot={(f) => { setCamera(false); sendPhoto(f); }}
          onGallery={(files) => { setCamera(false); if (files[0]) sendPhoto(files[0]); }}
          onClose={() => setCamera(false)}
        />
      )}
      {gift && person && (
        <GiftSheet
          recipient={{ username: person.username, displayName: person.displayName }}
          preset={gift.amount ? { amount: gift.amount, note: gift.note, visibility: 'private' } : undefined}
          onClose={() => { setGift(null); void q.refetch(); }}
        />
      )}
      {place && (
        <Sheet title="Enviar a tua localização" onClose={() => setPlace(null)}>
          {place === 'finding' ? (
            <p className="py-10 text-center text-zinc-600">A procurar onde estás…</p>
          ) : (
            <>
              <TileMap lat={place.lat} lng={place.lng} width={Math.min(420, window.innerWidth - 48)} height={170} className="mx-auto rounded-2xl" />
              <p className="mt-3 text-sm text-zinc-600">Vai só este ponto, uma vez. Não ficas a ser seguido.</p>
              <button onClick={sendPlace} className="mt-4 h-12 w-full rounded-full bg-brand font-bold text-white active:scale-[0.98]">Enviar localização</button>
              <button onClick={() => setPlace(null)} className="mt-2 h-12 w-full rounded-full font-semibold text-zinc-700 active:bg-zinc-100">Cancelar</button>
            </>
          )}
        </Sheet>
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
