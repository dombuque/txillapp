import { track } from '../lib/analytics';
import { tr, locale } from '../lib/i18n';
import { sized } from '../lib/media';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useLayoutEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { BackIcon } from '../components/icons';
import Icon from '../components/Icon';
import Camera from '../components/Camera';
import ChatPhotoReview from '../components/ChatPhotoReview';
import GroupSheet from '../components/GroupSheet';
import OnceViewer from '../components/OnceViewer';
import LocationPicker, { type Picked } from '../components/LocationPicker';
import GiftSheet from '../components/GiftSheet';
import ReportSheet from '../components/ReportSheet';
import SharedPost from '../components/SharedPost';
import LinkPreview, { Linkified, firstUrl } from '../components/LinkPreview';
import TileMap from '../components/TileMap';
import VoiceMessage from '../components/VoiceMessage';
import OfflineBar from '../components/OfflineBar';
import { Avatar, Sheet } from '../components/ui';
import { api, type ChatMessage, type ChatThread, type GroupThread } from '../lib/api';
import { detectIntent } from '../lib/chatIntent';
import { firstTime } from '../lib/firstTime';
import { isSharing, startLive, stopLive } from '../lib/liveLocation';
import { useTyping } from '../lib/chatLive';
import { markSeen } from '../lib/whatsNew';
import { NewBadge } from '../components/WhatsNew';
import { REACTIONS, Reaction, StickerButton, StickerPicker } from '../lib/stickers';
import { useVisualViewport, visibleStyle } from '../lib/useVisualViewport';
import { useAuth } from '../lib/auth';
import { ChatStoryThumb } from '../components/Stories';

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_IMAGE = 8 * 1024 * 1024;
const MAX_VOICE_MS = 120_000;
const GROUP_MS = 120_000; // mensagens da mesma pessoa com menos de 2 min juntam-se

const clock = (iso: string) => new Date(iso).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
const mmss = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}`;
const sameDay = (a: string, b: string) => new Date(a).toDateString() === new Date(b).toDateString();
function dayLabel(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const yest = new Date();
  yest.setDate(now.getDate() - 1);
  if (d.toDateString() === now.toDateString()) return 'Hoje';
  if (d.toDateString() === yest.toDateString()) return 'Ontem';
  return d.toLocaleDateString(locale, { day: 'numeric', month: 'long', ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}) });
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
  return `Visto a ${d.toLocaleDateString(locale, { day: 'numeric', month: 'short' })}`;
}

/** Mensagem enviada, à espera do servidor: aparece logo e fica "a enviar" ou "não enviada". */
type Msg = ChatMessage & { state?: 'sending' | 'failed'; realId?: string; sender?: { username: string; displayName: string; hasAvatar: boolean } };
interface Draft {
  kind: 'text' | 'image' | 'voice' | 'video' | 'sticker' | 'location' | 'gift';
  giftAmount?: number;
  body: string;
  lat?: number;
  lng?: number;
  once?: boolean;
  liveMinutes?: 15 | 60 | 480;
  /** Texto do presente, só para mostrar já enquanto se envia. */
  note?: string;
  file?: Blob;
  mime?: string;
  durationMs?: number;
  waveform?: string;
  localUrl?: string;
  /** Id da mensagem a que se responde. */
  replyTo?: string;
}

const KIND_LABEL: Record<string, string> = { image: 'Foto', video: 'Vídeo', voice: 'Mensagem de voz', sticker: 'Sticker', post: 'Publicação', location: 'Localização', gift: 'Presente' };
/** Excerto de uma mensagem para citar (na bolha e na barra de resposta). */
const quoteText = (k: string, body: string) => (k === 'text' || k === 'story_reply' ? body : tr(KIND_LABEL[k] ?? 'Mensagem'));

/** Vídeo da conversa: controlos normais e um botão que o abre em ecrã inteiro (visualizador da app, igual em todos os aparelhos). */
function ChatVideo({ src }: { src: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [full, setFull] = useState(false);
  function open() {
    ref.current?.pause();
    setFull(true);
  }
  return (
    <div className="relative">
      <video ref={ref} src={src} controls playsInline preload="metadata" controlsList="nodownload noremoteplayback nofullscreen" onContextMenu={(e) => e.preventDefault()} className="max-h-80 w-full bg-black object-cover" />
      <button type="button" onClick={open} aria-label={tr('Ecrã inteiro')} className="absolute right-2 top-2 flex h-9 w-9 items-center justify-center rounded-full bg-black/55 text-white active:scale-90">
        <Icon name="expand" size={18} />
      </button>
      {full && createPortal(
        <div role="dialog" aria-modal="true" aria-label={tr('Vídeo')} className="fixed inset-0 z-[120] flex items-center justify-center bg-black" onClick={() => setFull(false)}>
          <video src={src} controls autoPlay playsInline controlsList="nodownload noremoteplayback" disablePictureInPicture onClick={(e) => e.stopPropagation()} onContextMenu={(e) => e.preventDefault()} className="max-h-full max-w-full" />
          <button type="button" onClick={() => setFull(false)} aria-label={tr('Fechar')} className="absolute right-3 top-[max(0.75rem,env(safe-area-inset-top))] flex h-11 w-11 items-center justify-center rounded-full bg-black/60 text-white active:scale-90"><Icon name="x" size={22} /></button>
        </div>,
        document.body,
      )}
    </div>
  );
}

function Bubble({ m, prevSame, nextSame, seen, group, flash, onJump, onMenu, onReply, onRetry, onDiscard, onOpenOnce, onStopLive, onCheer, avatars }: { avatars?: { peerHandle?: string; me: { name: string; username?: string }; peer?: { name: string; username?: string } }; onCheer: (m: ChatMessage) => void; m: Msg; prevSame: boolean; nextSame: boolean; seen: boolean; group: boolean; flash: boolean; onJump: (id: string) => void; onOpenOnce: (m: Msg) => void; onStopLive: (m: Msg) => void; onMenu: (m: ChatMessage) => void; onReply: (m: ChatMessage) => void; onRetry: (m: Msg) => void; onDiscard: (m: Msg) => void }) {
  const mine = m.fromMe;
  const real = !m.id.startsWith('tmp-');
  // Resposta a uma nota: o servidor manda «Em resposta à tua nota “…”: texto». Mostra-se como no Instagram: a nota num balão e, por baixo, a resposta.
  const noteReply = !m.viewOnce && m.kind === 'text' ? /^Em resposta à tua nota “([\s\S]*?)”: ([\s\S]*)$/.exec(m.body) : null;
  const noteOwner = mine ? avatars?.peer : avatars?.me;
  // Carregar e segurar (ou clique direito): apagar as minhas, denunciar as dos outros.
  const hold = useRef<ReturnType<typeof setTimeout>>();
  // Duplo toque na mensagem: brinda-a (só põe; tirar é pelo menu).
  const lastTap = useRef(0);
  const tapProps = real && !m.viewOnce
    ? {
        onClick: (e: React.MouseEvent) => {
          if ((e.target as HTMLElement).closest('a,button,video,audio,input,textarea')) return;
          const now = Date.now();
          if (now - lastTap.current < 320) { lastTap.current = 0; onCheer(m); } else lastTap.current = now;
        },
      }
    : {};
  // Deslizar a mensagem para a direita responde-lhe (como no WhatsApp e no Instagram).
  const [dx, setDx] = useState(0);
  const swipe = useRef<{ x: number; y: number; on: boolean } | null>(null);
  const swipeProps = real
    ? {
        onTouchStart: (e: React.TouchEvent) => { swipe.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, on: false }; },
        onTouchMove: (e: React.TouchEvent) => {
          const s = swipe.current;
          if (!s) return;
          const mx = e.touches[0].clientX - s.x;
          const my = e.touches[0].clientY - s.y;
          if (!s.on && mx > 12 && mx > Math.abs(my) * 1.5) {
            s.on = true;
            clearTimeout(hold.current);
          }
          if (s.on) setDx(Math.min(72, Math.max(0, mx)));
          else if (Math.abs(my) > 10) clearTimeout(hold.current);
        },
        onTouchEnd: () => {
          const s = swipe.current;
          swipe.current = null;
          if (s?.on && dx >= 56) {
            navigator.vibrate?.(10);
            onReply(m);
          }
          setDx(0);
        },
      }
    : {};
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
    <div id={real ? `msg-${m.id}` : undefined} className={`relative flex select-none flex-col rounded-3xl transition-colors duration-500 ${flash ? 'bg-brand/15' : ''} ${mine ? 'items-end' : 'items-start'} ${prevSame ? 'mt-0.5' : 'mt-3'}`} style={{ transform: dx ? `translateX(${dx}px)` : undefined, transition: dx ? 'none' : 'transform .18s ease-out', touchAction: 'pan-y' }} {...menuProps} {...swipeProps} {...tapProps}>
      {dx > 8 && <span aria-hidden className="absolute left-[-40px] top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-zinc-100 text-zinc-700" style={{ opacity: Math.min(1, dx / 56), transform: `translateY(-50%) scale(${dx >= 56 ? 1.15 : 0.85})` }}><Icon name="reply" size={16} /></span>}
      {group && !mine && !prevSame && m.sender && <span className="mb-0.5 px-1 text-[12px] font-bold text-zinc-600">{m.sender.displayName.split(' ')[0]}</span>}
      {m.replyTo && <span className="mb-1 px-1 text-[12px] text-zinc-500">{mine ? tr('Respondeste') : !m.replyTo.gone && m.replyTo.fromMe ? tr('Respondeu-te') : tr('Respondeu')}</span>}
      {m.replyTo && (
        <button
          type="button"
          disabled={m.replyTo.gone}
          onClick={(e) => { e.stopPropagation(); if (!m.replyTo!.gone) onJump(m.replyTo!.id); }}
          className={`mb-0.5 max-w-[78%] rounded-2xl border-l-4 px-3 py-1.5 text-left text-[13px] leading-snug transition active:scale-[0.98] ${mine ? 'border-brand/70 bg-brand/10' : 'border-zinc-400 bg-zinc-50'} text-zinc-600`}
        >
          {m.replyTo.gone ? (
            <span className="italic">{tr('Mensagem apagada')}</span>
          ) : (
            <>
              <span className="block truncate font-bold text-zinc-700">{m.replyTo.fromMe ? tr('Tu') : m.replyTo.name}</span>
              <span className="line-clamp-2 break-words">{quoteText(m.replyTo.kind, m.replyTo.body)}</span>
            </>
          )}
        </button>
      )}
      {m.storyUrl && (avatars?.peerHandle || avatars?.me.username) && (
        <ChatStoryThumb src={m.storyUrl} thumb={sized(m.storyUrl, 160)} alt={tr('Story')} ownerUsername={mine ? (avatars.peerHandle ?? '') : (avatars.me.username ?? '')} ownerName={mine ? (avatars.peer?.name ?? '') : avatars.me.name} isMe={!mine} />
      )}
      {(m.kind === 'story_reply' || m.kind === 'story_reaction') && (
        <p className="mb-0.5 text-xs text-zinc-500">{m.kind === 'story_reaction' ? (mine ? tr('Reagiste ao story') : tr('Reagiu ao teu story')) : mine ? tr('Respondeste ao story') : tr('Respondeu ao teu story')}</p>
      )}
      {m.kind === 'story_reaction' && <div className="leading-tight"><Reaction body={m.body} size={64} /></div>}
      {m.viewOnce ? (
        <button
          type="button"
          disabled={mine || m.opened || m.state === 'sending'}
          onClick={() => onOpenOnce(m)}
          className={`flex items-center gap-2.5 px-4 py-2.5 text-[15px] font-semibold ${shape} ${m.opened ? 'bg-zinc-100 text-zinc-500' : mine ? 'bg-brand text-white' : 'bg-zinc-900 text-white'} ${dim} ${!mine && !m.opened ? 'active:scale-95' : ''}`}
        >
          <Icon name="once" size={26} />
          {m.opened ? tr('Aberta') : mine ? tr('Visualização única · por abrir') : m.kind === 'image' ? tr('Foto · toca para abrir') : m.kind === 'video' ? tr('Vídeo · toca para abrir') : m.kind === 'voice' ? tr('Voz · toca para abrir') : tr('Mensagem · toca para abrir')}
        </button>
      ) : null}
      {!m.viewOnce && m.kind === 'gift' && (
        <div className={`w-[240px] overflow-hidden rounded-[20px] bg-gradient-to-br from-brand to-brand-light text-white shadow-[0_2px_10px_rgba(214,51,79,0.35)] ${dim}`}>
          <div className="flex items-center gap-3 px-4 pt-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/25"><Icon name="gift" size={24} /></span>
            <span className="min-w-0">
              <span className="block text-[13px] font-semibold opacity-90">{mine ? tr('Enviaste um presente') : tr('Enviou-te um presente')}</span>
              <span className="block text-[24px] font-extrabold leading-tight">{(m.giftAmount ?? 0).toLocaleString(locale)} {tr('Txills')}</span>
            </span>
          </div>
          <p className="px-4 pb-3 pt-1 text-[15px] leading-snug">{m.body || ' '}</p>
        </div>
      )}
      {!m.viewOnce && m.kind === 'sticker' && <div className={dim}><StickerButton id={m.body} /></div>}
      {!m.viewOnce && m.kind === 'post' && <SharedPost post={m.post ?? null} shape={shape} tone={tone} />}
      {!m.viewOnce && m.kind === 'location' && m.lat != null && m.lng != null && (
        <a href={`https://www.google.com/maps?q=${m.lat},${m.lng}`} target="_blank" rel="noreferrer" className={`block overflow-hidden ${shape} ${tone} ${dim}`} style={{ width: 240 }}>
          <TileMap lat={m.lat} lng={m.lng} width={240} height={132} />
          <span className="flex items-center gap-2 px-3 py-2 text-[15px] font-semibold"><Icon name="map-pin" size={16} className="shrink-0" /><span className="min-w-0 truncate">{m.body || 'Localização'}</span></span>
        </a>
      )}
      {!m.viewOnce && m.kind === 'location' && m.liveUntil && (
        <span className="mt-1 flex items-center gap-2 px-1 text-[12px] font-semibold text-emerald-700">
          <span className={`h-2 w-2 rounded-full ${m.live ? 'animate-pulse bg-emerald-500' : 'bg-zinc-300'}`} aria-hidden />
          {m.live ? `Em direto até às ${clock(m.liveUntil)}` : tr('Partilha em direto terminada')}
          {m.live && mine && <button type="button" onClick={() => onStopLive(m)} className="rounded-full bg-red-50 px-3 py-1 text-red-700 active:scale-95">{tr('Parar')}</button>}
        </span>
      )}
      {!m.viewOnce && m.kind === 'voice' && <div className={`max-w-[86%] ${dim}`}><VoiceMessage m={m} /></div>}
      {!m.viewOnce && m.kind === 'video' && m.mediaUrl && (
        <div className={`max-w-[75%] overflow-hidden ${shape} ${tone} ${dim}`}>
          <ChatVideo src={m.mediaUrl} />
        </div>
      )}
      {!m.viewOnce && m.kind === 'image' && m.mediaUrl && (
        <div className={`max-w-[75%] overflow-hidden ${shape} ${tone} ${dim}`}>
          <a href={m.mediaUrl} target="_blank" rel="noreferrer">
            <img src={m.mediaUrl} alt={tr('Foto enviada')} loading="lazy" draggable={false} className="max-h-72 w-full object-cover" />
          </a>
          {m.body && <p className="px-3 py-2 text-[16px]">{m.body}</p>}
        </div>
      )}
      {noteReply && (
        <div className={`mb-1 flex max-w-[82%] flex-col ${mine ? 'items-end' : 'items-start'}`}>
          <span className="mb-1.5 px-1 text-[12px] text-zinc-500">{mine ? tr('Respondeste à nota') : tr('Respondeu à tua nota')}</span>
          <div className={`flex flex-col ${mine ? 'items-end border-r-2 pr-2' : 'items-start border-l-2 pl-2'} border-zinc-200`}>
            <p className="relative max-w-full whitespace-pre-wrap break-words rounded-[22px] bg-zinc-100 px-4 py-3 text-center text-[15px] font-medium leading-snug text-zinc-800">
              {noteReply[1]}
              <span aria-hidden className="absolute -bottom-1.5 left-3 h-3 w-3 rounded-full bg-zinc-100" />
              <span aria-hidden className="absolute -bottom-3.5 left-1.5 h-1.5 w-1.5 rounded-full bg-zinc-100" />
            </p>
            {noteOwner && <span className="mt-3.5 block"><Avatar name={noteOwner.name} username={noteOwner.username} size={64} ring={false} /></span>}
          </div>
        </div>
      )}
      {!m.viewOnce && (m.kind === 'text' || m.kind === 'story_reply') && (
        <p className={`max-w-[82%] whitespace-pre-wrap break-words px-4 py-2.5 text-[16px] leading-snug ${shape} ${tone} ${dim}`}>{m.kind === 'text' ? <Linkified text={noteReply ? noteReply[2] : m.body} /> : (noteReply ? noteReply[2] : m.body)}</p>
      )}
      {!m.viewOnce && m.kind === 'text' && real && (() => {
        const u = firstUrl(noteReply ? noteReply[2] : m.body);
        return u ? <div className="mt-1 max-w-[82%]"><LinkPreview url={u} shape={shape} tone={tone} /></div> : null;
      })()}
      {!!m.reactions?.length && (
        <button type="button" onClick={() => onMenu(m)} aria-label={tr('Reações')} className={`-mt-2 flex items-center gap-1 rounded-full bg-white px-1.5 py-0.5 shadow-[0_1px_6px_rgba(0,0,0,0.18)] ring-1 ring-zinc-100 ${mine ? 'mr-3' : 'ml-3'}`}>
          {m.reactions.map((r) => (
            <span key={r.reaction} className={`flex items-center rounded-full ${r.mine ? 'bg-brand/10' : ''}`}>
              <Reaction body={r.reaction} size={22} />
              {r.count > 1 && <span className="pr-1 text-[11px] font-bold text-zinc-700">{r.count}</span>}
            </span>
          ))}
        </button>
      )}
      {m.state === 'failed' ? (
        <span className="mt-1 flex items-center gap-2 px-1 text-[12px] font-semibold text-red-600">
          <Icon name="alert" size={14} /> {tr('Não enviada')}
          <button type="button" onClick={() => onRetry(m)} className="underline">{tr('Tentar de novo')}</button>
          <button type="button" onClick={() => onDiscard(m)} className="text-zinc-500 underline">{tr('Apagar')}</button>
        </span>
      ) : m.state === 'sending' ? (
        <span className="mt-0.5 px-1 text-[11px] text-zinc-500">{tr('A enviar…')}</span>
      ) : (
        !nextSame && (
          <span className="mt-0.5 px-1 text-[11px] text-zinc-500">
            {clock(m.at)}
            {mine && seen ? tr(' · Visto') : ''}
          </span>
        )
      )}
    </div>
  );
}

/** Conversa com uma pessoa. Tempo real, envio instantâneo, fotos, voz com onda, "a escrever…" e "Visto". */
export default function Thread() {
  const { username = '', id: groupId = '' } = useParams();
  const isGroup = !!groupId;
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { user } = useAuth();
  const [text, setText] = useState('');
  const [err, setErr] = useState('');
  const [menuFor, setMenuFor] = useState<ChatMessage | null>(null);
  const [searching, setSearching] = useState(false);
  const [needle, setNeedle] = useState('');
  const [replying, setReplying] = useState<ChatMessage | null>(null);
  useEffect(() => {
    if (menuFor) markSeen('reacoes'); // abriu o menu das mensagens: já descobriu as reações
  }, [menuFor]);
  const [reporting, setReporting] = useState<string | null>(null);
  const [rec, setRec] = useState<{ ms: number; bars: number[] } | null>(null);
  const [outbox, setOutbox] = useState<Msg[]>([]);
  const [unseen, setUnseen] = useState(0);
  const [away, setAway] = useState(false); // longe do fim da conversa
  const [panel, setPanel] = useState<null | 'attach' | 'stickers'>(null);
  const [once, setOnce] = useState(false); // a próxima mensagem é de visualização única
  const [review, setReview] = useState<File | null>(null); // foto à espera de enviar (pré-visualização)
  const [onceHelp, setOnceHelp] = useState(false); // a explicação só aparece da primeira vez
  const [opening, setOpening] = useState<Msg | null>(null);
  const [camera, setCamera] = useState(false);
  const [gift, setGift] = useState<null | { amount?: number; note?: string }>(null);
  const [place, setPlace] = useState(false);
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
  const typing = useTyping(isGroup ? '' : username);
  const [members, setMembers] = useState(false);
  const vv = useVisualViewport();
  const recorder = useRef<{ mr: MediaRecorder; chunks: Blob[]; start: number; stream: MediaStream; cancelled: boolean; ctx: AudioContext | null; levels: number[] } | null>(null);

  const q = useInfiniteQuery({
    queryKey: isGroup ? ['chat-group', groupId] : ['chat-thread', username],
    queryFn: ({ pageParam }): Promise<ChatThread | GroupThread> => (isGroup ? api.chatGroupThread(groupId, pageParam) : api.chatThread(username, pageParam)),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (l) => l.nextCursor ?? undefined,
    // O tempo real faz o trabalho; isto é só uma rede de segurança.
    refetchInterval: () => (document.visibilityState === 'visible' ? 30_000 : false),
    retry: false,
  });
  const first = q.data?.pages[0] as (Partial<ChatThread> & Partial<GroupThread>) | undefined;
  const otherRead = first?.otherRead ?? null;
  const items = ((q.data?.pages.flatMap((p) => p.items) ?? []) as Msg[]).slice().reverse();
  const group = first?.group;
  // As minhas ainda por confirmar vão no fim; quando a verdadeira chega, a provisória sai.
  const real = new Set(items.map((m) => m.id));
  const all: Msg[] = [...items, ...outbox.filter((o) => !(o.realId && real.has(o.realId)))];

  useEffect(() => {
    qc.invalidateQueries({ queryKey: ['chat-list'] });
    qc.invalidateQueries({ queryKey: ['chat-groups'] });
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
    // Uma mensagem nova leva a resposta pendente (ao tentar de novo, mantém a que já tinha).
    if (!drafts.current.has(tmpId) && replying && !d.replyTo) {
      d = { ...d, replyTo: replying.id };
      setReplying(null);
    }
    drafts.current.set(tmpId, d);
    const msg: Msg = { id: tmpId, fromMe: true, body: d.once ? '' : d.kind === 'gift' ? (d.note ?? '') : d.body, kind: d.kind, giftAmount: d.giftAmount, viewOnce: !!d.once, storyUrl: null, mediaUrl: d.once ? null : (d.localUrl ?? null), durationMs: d.durationMs ?? null, waveform: d.waveform ?? null, at: new Date().toISOString(), state: 'sending' };
    setOutbox((o) => (o.some((x) => x.id === tmpId) ? o.map((x) => (x.id === tmpId ? msg : x)) : [...o, msg]));
    stick.current = true;
    setErr('');
    try {
      const mediaId = d.file ? (d.kind === 'video' ? await api.uploadVideo(d.file as File, { progress: () => undefined, stage: () => undefined }, 'chat') : await api.uploadChatFile(d.file, d.mime ?? d.file.type)) : undefined;
      track('message_send', { kind: d.kind });
      const msg = { kind: d.kind, body: d.body, mediaId, durationMs: d.durationMs, waveform: d.waveform, lat: d.lat, lng: d.lng, once: d.once, liveMinutes: d.liveMinutes, replyTo: d.replyTo };
      const r = isGroup ? await api.chatGroupSend(groupId, msg) : await api.chatSend(username, msg);
      drafts.current.delete(tmpId);
      if (d.liveMinutes) startLive(r.id, Date.now() + d.liveMinutes * 60_000);
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
  // Voltou a ligação: o que ficou por enviar segue sozinho.
  useEffect(() => {
    const on = () => outbox.filter((o) => o.state === 'failed').forEach(retry);
    window.addEventListener('online', on);
    return () => window.removeEventListener('online', on);
  }); // eslint-disable-line react-hooks/exhaustive-deps
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
    void dispatch({ kind: 'text', body, once });
    setOnce(false);
  }

  function onType(v: string) {
    setText(v);
    if (!isGroup && v && Date.now() - typingSent.current > 3000) {
      typingSent.current = Date.now();
      api.chatTyping(username).catch(() => undefined);
    }
  }

  /** Tirada na câmara ou escolhida da galeria: primeiro vê-se e decide-se (legenda, filtro, visualização única); só vai ao tocar em Enviar. */
  function queuePhoto(f: File) {
    if (!IMAGE_TYPES.includes(f.type)) return setErr(tr('Essa foto não serve. Usa JPEG, PNG ou WebP'));
    if (f.size > MAX_IMAGE) return setErr(tr('Foto pesada demais! Máximo 8 MB'));
    setErr('');
    setReview(f);
  }
  function pickPhoto(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    if (f.type.startsWith('video/')) return queueVideo(f);
    queuePhoto(f);
  }
  /** Vídeo da galeria: vai direto (a opção de "ver uma vez" do campo aplica-se). Até 100 MB e 60 s; o servidor converte e verifica. */
  function queueVideo(f: File) {
    if (!['video/mp4', 'video/quicktime', 'video/webm'].includes(f.type)) return setErr(tr('Usa um vídeo MP4, MOV ou WebM'));
    if (f.size > 100 * 1024 * 1024) return setErr(tr('Vídeo pesado demais! Máximo 100 MB'));
    setErr('');
    void dispatch({ kind: 'video', body: '', file: f, mime: f.type, localUrl: URL.createObjectURL(f), once });
    setOnce(false);
  }
  function sendReviewed(r: { file: File; caption: string; once: boolean }) {
    setReview(null);
    setText('');
    void dispatch({ kind: 'image', body: r.caption, file: r.file, mime: r.file.type, localUrl: URL.createObjectURL(r.file), once: r.once });
    setOnce(false);
  }

  function sendSticker(id: string) {
    setPanel(null);
    void dispatch({ kind: 'sticker', body: id });
  }

  /** Localização como no WhatsApp: mapa com pino, localização atual (com a precisão) ou um local próximo. Só vai o que se escolhe, uma vez. */
  function sendPlace(p: Picked) {
    setPlace(false);
    void dispatch({ kind: 'location', body: p.label, lat: p.lat, lng: p.lng, liveMinutes: isGroup ? undefined : p.live });
  }

  // ----- voz -----
  async function startRecording() {
    setErr('');
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      return setErr(tr('Gravar voz precisa de ligação segura (HTTPS) e de um browser compatível.'));
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
        void dispatch({ kind: 'voice', body: '', file: blob, mime, durationMs, waveform: toWaveform(r.levels), localUrl: URL.createObjectURL(blob), once });
        setOnce(false);
      };
      mr.start();
      setRec({ ms: 0, bars: [] });
    } catch {
      setErr(tr('Sem permissão para o microfone. Ativa-o no browser.'));
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

  /** Reagir à mensagem (tocar na que já tenho tira-a). */
  async function react(m: ChatMessage, id: string, already: boolean) {
    setMenuFor(null);
    try {
      if (already) await api.chatUnreact(m.id);
      else await api.chatReact(m.id, id);
      await q.refetch();
    } catch (x) {
      setErr((x as Error).message);
    }
  }

  /** Duplo toque: brinda a mensagem (se ainda não brindei). */
  async function cheerMsg(m: ChatMessage) {
    navigator.vibrate?.(8);
    if (m.reactions?.some((x) => x.mine && x.reaction === ':brinde:')) return;
    try {
      await api.chatReact(m.id, ':brinde:');
      await q.refetch();
    } catch (x) {
      setErr((x as Error).message);
    }
  }

  async function remove(m: ChatMessage) {
    setMenuFor(null);
    await api.chatDelete(m.id).catch((x) => setErr((x as Error).message));
    await q.refetch();
  }

  async function acceptReq() {
    await api.chatAccept(username).catch((x) => setErr((x as Error).message));
    await q.refetch();
    qc.invalidateQueries({ queryKey: ['chat-list'] });
  }
  async function declineReq() {
    await api.chatDecline(username).catch((x) => setErr((x as Error).message));
    qc.invalidateQueries({ queryKey: ['chat-list'] });
    navigate('/messages', { replace: true });
  }
  async function blockReq() {
    await api.block(username).catch((x) => setErr((x as Error).message));
    qc.invalidateQueries({ queryKey: ['chat-list'] });
    navigate('/messages', { replace: true });
  }

  async function stopSharing(m: Msg) {
    stopLive(m.id);
    await api.chatLiveStop(m.id).catch(() => undefined);
    await q.refetch();
  }

  // Diz ao servidor que esta conversa está aberta e à vista: assim não manda aviso para o telemóvel enquanto estás aqui.
  useEffect(() => {
    const key = isGroup ? `g:${groupId}` : `u:${username}`;
    const ping = () => document.visibilityState === 'visible' && api.chatActive(key).catch(() => undefined);
    const vis = () => (document.visibilityState === 'visible' ? ping() : void api.chatActive(null).catch(() => undefined));
    ping();
    const t = setInterval(ping, 20_000);
    document.addEventListener('visibilitychange', vis);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', vis);
      void api.chatActive(null).catch(() => undefined);
    };
  }, [isGroup, groupId, username]);

  // Com o teclado a abrir/fechar a área visível muda: se estavas no fim, continuas no fim.
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const onResize = () => {
      if (stick.current && document.activeElement === input.current) end.current?.scrollIntoView({ block: 'end' });
    };
    vv.addEventListener('resize', onResize);
    return () => vv.removeEventListener('resize', onResize);
  }, []);

  // Tocar na citação de uma resposta leva à mensagem original (carrega mensagens mais antigas se for preciso) e destaca-a um instante.
  const [flashId, setFlashId] = useState<string | null>(null);
  async function jumpTo(id: string) {
    for (let tries = 0; tries < 8; tries++) {
      const el = document.getElementById(`msg-${id}`);
      if (el) {
        stick.current = false;
        el.scrollIntoView({ block: 'center', behavior: 'smooth' });
        setFlashId(id);
        setTimeout(() => setFlashId((c) => (c === id ? null : c)), 1800);
        return;
      }
      if (!q.hasNextPage) return;
      stick.current = false;
      await q.fetchNextPage();
      await new Promise((r) => setTimeout(r, 80));
    }
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
        <p className="mt-3 text-xl font-bold">{tr('Não consegui abrir esta conversa')}</p>
        <button onClick={() => navigate(-1)} className="mt-4 font-semibold text-brand">{tr('Voltar')}</button>
      </div>
    );
  }

  const person = first?.person;
  // Depois de um presente na conversa a sugestão desaparece: só se olha para o que foi dito a seguir ao último presente.
  const lastGift = items.map((m) => m.kind).lastIndexOf('gift');
  const intent = person?.canGift ? detectIntent(lastGift >= 0 ? items.slice(lastGift + 1) : items, person.displayName.split(' ')[0]) : null;
  const suggestion = intent && !dismissed.has(intent.key) && !gift ? intent : null;
  const lastMine = [...items].reverse().find((m) => m.fromMe);
  const seenUpTo = (m: ChatMessage) => !!otherRead && m.id <= otherRead && lastMine?.id === m.id;
  const bar = 'mb-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-zinc-800 transition active:scale-90 active:bg-white';
  const tool = 'flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-zinc-600 transition active:scale-90 active:bg-zinc-100';
  const joined = (a: Msg, b: Msg) => a.fromMe === b.fromMe && sameDay(a.at, b.at) && new Date(b.at).getTime() - new Date(a.at).getTime() < GROUP_MS && a.kind !== 'story_reaction' && b.kind !== 'story_reaction';

  return (
    <div className="fixed inset-x-0 top-0 mx-auto flex h-dvh max-w-xl flex-col bg-white pt-[env(safe-area-inset-top)]" style={visibleStyle(vv)}>
      <header className="flex shrink-0 items-center gap-1 border-b border-zinc-100 px-2 py-2">
        <button onClick={() => (window.history.length > 1 ? navigate(-1) : navigate('/messages', { replace: true }))} aria-label={tr('Voltar')} className="flex h-11 w-11 items-center justify-center rounded-full active:bg-zinc-100">
          <BackIcon />
        </button>
        {group && (
          <button type="button" onClick={() => setMembers(true)} aria-label={tr('Ver membros de {v0}', { v0: group.name })} className="flex min-w-0 flex-1 items-center gap-3 text-left">
            <span className="relative block h-[40px] w-[40px] shrink-0">
              {group.members.slice(0, 2).map((m, i) => (
                <span key={m.username} className={`absolute rounded-full ring-2 ring-white ${i === 0 ? 'left-0 top-0' : 'bottom-0 right-0'}`}><Avatar name={m.displayName} username={m.hasAvatar ? m.username : undefined} size={26} ring={false} /></span>
              ))}
            </span>
            <span className="min-w-0">
              <span className="block truncate font-bold leading-tight">{group.name}</span>
              <span className="block truncate text-xs text-zinc-500">{group.members.length} {tr('pessoas · toca para ver')}</span>
            </span>
          </button>
        )}
        {person && (
          <Link to={`/u/${person.username}`} className="flex min-w-0 items-center gap-3">
            <span className="relative">
              <Avatar name={person.displayName} username={person.hasAvatar ? person.username : undefined} size={38} ring={false} />
              {person.presence?.online && <span className="absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-white bg-emerald-500" aria-label={tr('Online')} />}
            </span>
            <span className="min-w-0">
              <span className="block truncate font-bold leading-tight">{person.displayName}</span>
              <span className="block truncate text-xs text-zinc-500">
                {typing ? (
                  <span className="font-semibold text-brand">{tr('a escrever…')}</span>
                ) : person.presence?.online ? (
                  <span className="flex items-center gap-1 font-semibold text-emerald-600"><span className="h-2 w-2 rounded-full bg-emerald-500" aria-hidden /> {tr('Online')}</span>
                ) : (
                  seenLabel(person.presence?.lastSeen ?? null) ?? `@${person.username}`
                )}
              </span>
            </span>
          </Link>
        )}
        <button type="button" onClick={() => setSearching(true)} aria-label={tr('Procurar na conversa')} className="ml-auto flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-zinc-700 active:bg-zinc-100"><Icon name="search" size={22} /></button>
      </header>
      <OfflineBar />
      {searching && (
        <Sheet title={tr('Procurar na conversa')} onClose={() => { setSearching(false); setNeedle(''); }}>
          <input autoFocus value={needle} onChange={(e) => setNeedle(e.target.value)} placeholder={tr('Escreve uma palavra…')} aria-label={tr('Procurar na conversa')} className="h-12 w-full rounded-full bg-zinc-100 px-5 text-[16px] outline-none" />
          {(() => {
            const norm = (t: string) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
            const n = norm(needle.trim());
            const hits = n.length < 2 ? [] : [...all].reverse().filter((m) => !m.id.startsWith('tmp-') && !m.viewOnce && m.body && (m.kind === 'text' || m.kind === 'story_reply') && norm(m.body).includes(n)).slice(0, 40);
            return (
              <>
                <ul className="mt-3 space-y-1">
                  {hits.map((m) => (
                    <li key={m.id}>
                      <button type="button" onClick={() => { setSearching(false); setNeedle(''); void jumpTo(m.id); }} className="block w-full rounded-2xl px-3 py-2 text-left active:bg-zinc-100">
                        <span className="block text-xs font-semibold text-zinc-500">{m.fromMe ? tr('Tu') : m.sender?.displayName ?? person?.displayName} · {dayLabel(m.at)}</span>
                        <span className="line-clamp-2 break-words text-[15px] text-zinc-800">{m.body}</span>
                      </button>
                    </li>
                  ))}
                </ul>
                {n.length >= 2 && hits.length === 0 && <p className="py-6 text-center text-zinc-600">{tr('Nada encontrado nas mensagens carregadas.')}</p>}
                {q.hasNextPage && <button type="button" onClick={() => void q.fetchNextPage()} className="mt-2 w-full rounded-full bg-zinc-100 py-2.5 text-sm font-semibold text-zinc-700 active:bg-zinc-200">{tr('Carregar mensagens mais antigas')}</button>}
              </>
            );
          })()}
        </Sheet>
      )}

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
          {!isGroup && first?.relation && !first.relation.theyFollow && !first.relation.request && person && (
            <div role="note" className="mx-auto mb-2 mt-3 max-w-sm rounded-2xl bg-zinc-50 px-4 py-3 text-center text-[13px] leading-snug text-zinc-600 ring-1 ring-zinc-100">
              <Icon name="info" size={16} className="mx-auto mb-1 text-zinc-500" />
              <b className="text-zinc-800">{person.displayName.split(' ')[0]} {tr('não te segue.')}</b> {tr('Pode não ver nem responder à tua mensagem.')}
              {first.relation.left !== null && <span className="block">{first.relation.left > 0 ? `Podes enviar mais ${first.relation.left} ${first.relation.left === 1 ? tr('mensagem') : tr('mensagens')} até responder.` : tr('Aguarda que responda, aceite ou te siga para escreveres outra vez.')}</span>}
            </div>
          )}
          {q.hasNextPage && (
            <button onClick={() => { stick.current = false; void q.fetchNextPage(); }} className="mx-auto mb-2 mt-2 block rounded-full bg-zinc-100 px-4 py-1.5 text-sm font-semibold text-zinc-700">{tr('Ver mensagens anteriores')}</button>
          )}
          {q.isLoading && (
            <div className="space-y-3 pt-4" role="status" aria-label={tr('A carregar')}>
              {[60, 40, 70, 48].map((w, i) => <div key={i} className={`skel h-10 rounded-[20px] ${i % 2 ? 'ml-auto' : ''}`} style={{ width: `${w}%` }} />)}
            </div>
          )}
          {q.isSuccess && all.length === 0 && <p className="py-16 text-center text-zinc-500">{tr('Diz olá a')} {person?.displayName.split(' ')[0] ?? 'esta pessoa'}</p>}
          {all.map((m, i) => {
            const prev = all[i - 1];
            const next = all[i + 1];
            const newDay = !prev || !sameDay(prev.at, m.at);
            return (
              <div key={m.id}>
                {newDay && <p className="mx-auto mb-2 mt-6 w-fit text-[12px] font-semibold uppercase tracking-wide text-zinc-500">{dayLabel(m.at)}</p>}
                <Bubble m={m} group={isGroup} flash={flashId === m.id} onJump={jumpTo} prevSame={!!prev && !newDay && joined(prev, m)} nextSame={!!next && joined(m, next)} seen={seenUpTo(m)} onMenu={setMenuFor} onReply={(x) => { setReplying(x); input.current?.focus(); }} onRetry={retry} onDiscard={discard} onOpenOnce={setOpening} onStopLive={stopSharing} onCheer={cheerMsg} avatars={{ peerHandle: isGroup ? undefined : username, me: { name: user?.displayName ?? '', username: user?.username }, peer: person ? { name: person.displayName, username: person.hasAvatar ? person.username : undefined } : undefined }} />
              </div>
            );
          })}
          {typing && (
            <div className="mt-2 flex w-fit items-center gap-1 rounded-[20px] rounded-bl-md bg-zinc-100 px-3.5 py-3" aria-label={tr('A escrever')}>
              {[0, 1, 2].map((d) => (
                <span key={d} className="h-2 w-2 animate-bounce rounded-full bg-zinc-400" style={{ animationDelay: `${d * 120}ms` }} />
              ))}
            </div>
          )}
          <div ref={end} />
        </div>
        {(away || unseen > 0) && (
          <button onClick={jumpDown} aria-label={unseen ? `${unseen} mensagens novas` : 'Ir para o fim'} className={`absolute bottom-3 left-1/2 flex h-10 -translate-x-1/2 items-center justify-center gap-1.5 rounded-full bg-white text-sm font-bold ${unseen ? 'px-4' : 'w-10'} text-zinc-800 shadow-[0_2px_12px_rgba(0,0,0,0.2)] ring-1 ring-zinc-100 active:scale-95`}>
            <Icon name="chevron-right" size={16} className="rotate-90" />{unseen ? ` ${unseen} ${unseen === 1 ? tr('nova') : tr('novas')}` : null}
          </button>
        )}
      </div>

      {!isGroup && first?.relation?.request && person ? (
        <div className="shrink-0 border-t border-zinc-100 px-4 pb-[max(0.9rem,env(safe-area-inset-bottom))] pt-3">
          <p className="text-center text-[14px] leading-snug text-zinc-700"><b>{tr('Pedido de mensagem.')}</b> {tr('Não segues')} {person.displayName.split(' ')[0]}{tr('. Se aceitares, podem falar à vontade; se recusares, não és incomodado.')}</p>
          <div className="mt-3 grid grid-cols-3 gap-2">
            <button onClick={() => acceptReq()} className="h-11 rounded-full bg-brand font-bold text-white active:scale-95">{tr('Aceitar')}</button>
            <button onClick={() => declineReq()} className="h-11 rounded-full bg-zinc-100 font-semibold text-zinc-800 active:scale-95">{tr('Recusar')}</button>
            <button onClick={() => blockReq()} className="h-11 rounded-full bg-zinc-100 font-semibold text-red-700 active:scale-95">{tr('Bloquear')}</button>
          </div>
        </div>
      ) : first?.relation?.left === 0 && !isGroup ? (
        <p className="shrink-0 border-t border-zinc-100 px-6 py-4 text-center text-sm text-zinc-600">{person?.displayName.split(' ')[0]} {tr('ainda não respondeu. Podes escrever outra vez quando responder, aceitar ou te seguir.')}</p>
      ) : first?.blocked ? (
        <p className="shrink-0 border-t border-zinc-100 px-6 py-4 text-center text-sm text-zinc-600">{tr('Não podes trocar mensagens com esta conta.')}</p>
      ) : rec ? (
        <div className="flex shrink-0 items-center gap-3 border-t border-zinc-100 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3">
          <button type="button" onClick={() => finishRecording(false)} aria-label={tr('Cancelar gravação')} className={`${tool} text-red-600`}>
            <Icon name="trash" size={22} />
          </button>
          <span className="flex min-w-0 flex-1 items-center gap-2.5 rounded-full bg-red-50 px-3 py-2 text-red-600">
            <span className="h-2.5 w-2.5 shrink-0 animate-pulse rounded-full bg-red-600" aria-hidden />
            <span className="w-10 shrink-0 font-semibold tabular-nums">{mmss(rec.ms)}</span>
            <span className="flex h-7 min-w-0 flex-1 items-center justify-end gap-[2px]" aria-hidden>
              {rec.bars.map((l, i) => <span key={i} className="w-[3px] shrink-0 rounded-full bg-red-500" style={{ height: `${Math.max(12, Math.round(l * 100))}%` }} />)}
            </span>
          </span>
          <button type="button" onClick={() => finishRecording(true)} className="h-11 rounded-full bg-brand px-5 font-bold text-white active:scale-95">{tr('Enviar')}</button>
        </div>
      ) : (
        <div className="shrink-0 border-t border-zinc-100">
        {once && onceHelp && (
          <p role="status" className="mx-3 mt-2 flex items-center justify-between rounded-2xl bg-zinc-900 px-4 py-2 text-[13px] font-semibold text-white">
            <span>{tr('Visualização única: a próxima mensagem só se abre uma vez.')}</span>
            <button type="button" onClick={() => setOnceHelp(false)} aria-label={tr('Fechar a explicação')} className="ml-3 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/20"><Icon name="x" size={14} /></button>
          </p>
        )}
        {suggestion && (
          <div className="mx-3 mt-2 flex items-center gap-3 rounded-2xl bg-amber-50 p-2.5 pl-3" role="note">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-700"><Icon name="gift" size={20} /></span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[15px] font-bold leading-tight">{suggestion.title}</span>
              <span className="block text-xs leading-tight text-zinc-600">{suggestion.hint}</span>
            </span>
            <button type="button" onClick={() => setGift({ amount: suggestion.amount, note: suggestion.note })} className="h-9 shrink-0 rounded-full bg-brand px-4 text-sm font-bold text-white active:scale-95">{tr('Presentear')}</button>
            <button type="button" onClick={() => setDismissed((d) => new Set(d).add(suggestion.key))} aria-label={tr('Dispensar sugestão')} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-zinc-500 active:bg-amber-100"><Icon name="x" size={18} /></button>
          </div>
        )}
        {panel === 'attach' && (
          <div className="mx-3 mt-2 flex justify-end gap-1" role="menu" aria-label={tr('Mais')}>
            {([
              ['map-pin', 'Localização', () => { setPanel(null); setPlace(true); }],
              ...(person?.canGift ? [['gift', 'Presente', () => { setPanel(null); setGift({}); }] as const] : []),
            ] as const).map(([ic, label, run]) => (
              <button key={label} type="button" role="menuitem" onClick={run} className="flex w-[84px] flex-col items-center gap-1.5 rounded-2xl py-2 active:bg-zinc-100">
                <span className="flex h-12 w-12 items-center justify-center rounded-full bg-zinc-100 text-zinc-800"><Icon name={ic} size={22} /></span>
                <span className="text-xs font-semibold text-zinc-700">{label}</span>
              </button>
            ))}
          </div>
        )}
        {replying && (
          <div className="mx-3 mt-2 flex items-center gap-2 rounded-2xl border-l-4 border-brand bg-zinc-50 py-1.5 pl-3 pr-1.5">
            <span className="min-w-0 flex-1 text-[13px] leading-snug">
              <span className="block truncate font-bold text-zinc-700">{tr('A responder a {v0}', { v0: replying.fromMe ? tr('ti') : ((replying as Msg).sender?.displayName.split(' ')[0] ?? person?.displayName.split(' ')[0] ?? '') })}</span>
              <span className="block truncate text-zinc-600">{quoteText(replying.kind, replying.body)}</span>
            </span>
            <button type="button" onClick={() => setReplying(null)} aria-label={tr('Cancelar resposta')} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-zinc-500 active:bg-zinc-200"><Icon name="x" size={18} /></button>
          </div>
        )}
        {panel === 'stickers' && <StickerPicker onPick={sendSticker} onClose={() => setPanel(null)} />}
        <form onSubmit={submit} className="px-3 pb-[max(1.25rem,calc(env(safe-area-inset-bottom)+0.6rem))] pt-2">
          {err && <p role="alert" className="px-2 pb-1 text-center text-sm text-red-600">{err}</p>}
          {/* Como no Instagram: câmara à esquerda, o campo ao meio e, à direita, voz, galeria, stickers e mais. */}
          <div className="flex items-end gap-1 rounded-[26px] bg-zinc-100 p-1.5 transition-colors focus-within:bg-zinc-200/70">
            <button type="button" onClick={() => setCamera(true)} aria-label={tr('Abrir a câmara')} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand to-brand-light text-white transition active:scale-90">
              <Icon name="camera" size={20} />
            </button>
            <input ref={gallery} type="file" accept={`${IMAGE_TYPES.join(',')},video/mp4,video/quicktime,video/webm`} onChange={pickPhoto} className="sr-only" aria-label={tr('Escolher foto ou vídeo da galeria')} />
            <textarea
              ref={input}
              value={text}
              onChange={(e) => onType(e.target.value)}
              onFocus={() => {
                setPanel(null);
                // O teclado abre e encolhe a conversa: sobe para a última mensagem (volta a tentar quando o teclado acaba de abrir).
                stick.current = true;
                const down = () => end.current?.scrollIntoView({ block: 'end' });
                down();
                setTimeout(down, 120);
                setTimeout(down, 350);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && window.matchMedia('(pointer: fine)').matches) submit(e as unknown as FormEvent);
              }}
              maxLength={2000}
              rows={1}
              placeholder={tr('Mensagem…')}
              aria-label={tr('Mensagem')}
              className="max-h-32 min-h-10 min-w-0 flex-1 resize-none bg-transparent px-2 py-2 text-[16px] outline-none placeholder:text-zinc-500"
            />
            {text.trim() ? (
              // pointerdown sem foco: o teclado não fecha ao enviar.
              <button type="submit" onPointerDown={(e) => e.preventDefault()} className="h-10 shrink-0 rounded-full bg-brand px-4 font-bold text-white transition active:scale-95">{tr('Enviar')}</button>
            ) : (
              <>
                <button type="button" onClick={() => { if (!once && firstTime('view-once')) setOnceHelp(true); setOnce(!once); }} aria-pressed={once} aria-label={tr('Visualização única')} className={`${bar} ${once ? 'bg-brand text-white active:bg-brand' : ''}`}><Icon name="once" size={22} /></button>
                <button type="button" onClick={startRecording} className={bar} aria-label={tr('Gravar mensagem de voz')}><Icon name="mic" size={22} /></button>
                <button type="button" onClick={() => gallery.current?.click()} className={bar} aria-label={tr('Enviar foto ou vídeo da galeria')}><Icon name="image" size={22} /></button>
                <button type="button" data-sticker-toggle onClick={() => { markSeen('stickers'); setPanel(panel === 'stickers' ? null : 'stickers'); }} aria-label={tr('Stickers')} aria-expanded={panel === 'stickers'} className={`${bar} relative ${panel === 'stickers' ? 'bg-white text-brand' : ''}`}><Icon name="sticker" size={22} /><NewBadge id="stickers" className="absolute -right-2 -top-2" /></button>
                <button type="button" onClick={() => setPanel(panel === 'attach' ? null : 'attach')} aria-label={tr('Mais')} aria-expanded={panel === 'attach'} className={`${bar} ${panel === 'attach' ? 'bg-white text-brand' : ''}`}><Icon name="plus" size={22} /></button>
              </>
            )}
          </div>
        </form>
        </div>
      )}

      {camera && (
        <Camera
          count={0}
          max={1}
          onShot={(f) => { setCamera(false); queuePhoto(f); }}
          onGallery={(files) => { setCamera(false); if (files[0]) queuePhoto(files[0]); }}
          onClose={() => setCamera(false)}
        />
      )}
      {gift && person && (
        <GiftSheet
          recipient={{ username: person.username, displayName: person.displayName }}
          preset={gift.amount ? { amount: gift.amount, note: gift.note, visibility: 'private' } : undefined}
          onSent={(r) => {
            if (intent) setDismissed((d) => new Set(d).add(intent.key));
            void dispatch({ kind: 'gift', body: r.transactionId, giftAmount: r.amount, note: r.note });
          }}
          onClose={() => { setGift(null); void q.refetch(); }}
        />
      )}
      {place && <LocationPicker onSend={sendPlace} onClose={() => setPlace(false)} />}
      {review && <ChatPhotoReview file={review} name={person?.displayName.split(' ')[0] ?? group?.name ?? 'o chat'} canOnce initialCaption={text.trim()} onCancel={() => setReview(null)} onSend={sendReviewed} />}
      {opening && <OnceViewer id={opening.id} from={person?.displayName ?? ''} onClose={() => { setOpening(null); void q.refetch(); }} />}
      {members && group && <GroupSheet group={group} onClose={() => setMembers(false)} onChanged={() => void q.refetch()} onLeft={() => navigate('/messages', { replace: true })} />}
      {reporting && <ReportSheet type="message" id={reporting} onClose={() => setReporting(null)} />}
      {menuFor && (
        <Sheet title={tr('Mensagem')} onClose={() => setMenuFor(null)}>
          <div className="flex justify-between gap-1 pb-2" role="group" aria-label={tr('Reagir')}>
            {REACTIONS.map((r) => {
              const mine = menuFor.reactions?.some((x) => x.mine && x.reaction === r.id);
              return (
                <button key={r.id} type="button" aria-label={r.label} aria-pressed={!!mine} onClick={() => react(menuFor, r.id, !!mine)} className={`flex h-12 w-12 items-center justify-center rounded-full transition active:scale-90 ${mine ? 'bg-brand/15 ring-2 ring-brand/40' : 'bg-zinc-100'}`}>
                  <Reaction body={r.id} size={34} />
                </button>
              );
            })}
          </div>
          <button onClick={() => { setReplying(menuFor); setMenuFor(null); input.current?.focus(); }} className="flex w-full items-center gap-4 rounded-2xl px-1 py-3 text-left transition active:bg-zinc-100">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-zinc-800"><Icon name="reply" /></span>
            <span className="block text-[17px] font-semibold">{tr('Responder')}</span>
          </button>
          {menuFor.fromMe ? (
            <button onClick={() => remove(menuFor)} className="flex w-full items-center gap-4 rounded-2xl px-1 py-3 text-left text-red-700 transition active:bg-red-50">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-red-50"><Icon name="trash" /></span>
              <span>
                <span className="block text-[17px] font-semibold">{tr('Apagar para todos')}</span>
                <span className="block text-sm text-zinc-600">{tr('Desaparece da conversa, sem deixar rasto.')}</span>
              </span>
            </button>
          ) : (
            <button onClick={() => { setReporting(menuFor.id); setMenuFor(null); }} className="flex w-full items-center gap-4 rounded-2xl px-1 py-3 text-left transition active:bg-zinc-100">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-zinc-800"><Icon name="flag" /></span>
              <span>
                <span className="block text-[17px] font-semibold">{tr('Denunciar mensagem')}</span>
                <span className="block text-sm text-zinc-600">{tr('Avisa a moderação. A pessoa não sabe.')}</span>
              </span>
            </button>
          )}
        </Sheet>
      )}
    </div>
  );
}
