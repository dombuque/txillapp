/**
 * A Txillada ao vivo (docs/txillada-contrato.md): os hooks que juntam a API (lib/api.txillada), o canal em tempo real da
 * app (lib/realtime → onTxilladaEvent) e a sala do LiveKit (lib/txilladaLive, um por plataforma). A lógica pura (o estado,
 * os limites, os balões) está em lib/txillada.ts, com testes.
 *
 * - `usePreview`: a câmara à vista no ecrã de preparar (Criar → TXILLADA). Ao começar, as faixas passam para o ecrã do
 *   live sem fechar a câmara (`handOff`).
 * - `useTxillada`: o ecrã da Txillada (app/txillada/[id]), para o anfitrião (transmite) e para quem vê (recebe).
 *   O estado chega pelos eventos do canal e, como rede de segurança, pela API de 8 em 8 s.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useKeepAwake } from 'expo-keep-awake';
import { useEffect, useReducer, useRef, useState } from 'react';
import type { LocalAudioTrack, LocalTrack, LocalVideoTrack, Room, VideoTrack } from 'livekit-client';
import { ApiError } from '@/lib/api';
import { txilladaApi, txilladaKey, type TxilladaAccess } from '@/lib/api.txillada';
import { useAuth } from '@/lib/auth';
import { onTxilladaEvent } from '@/lib/realtime';
import {
  applyEvent, cheerGate, commentGate, errorText, initialLive, lastCommentId, liveUi, parseTxilladaEvent, POLL_MS, viewKind, withCommentCheer, withComments, withDto,
  type LiveState, type TxilladaComment, type TxilladaDto, type TxilladaEvent,
} from '@/lib/txillada';
import { adaptiveVideo, askBroadcast, attachAudio, audioNeedsTap, captureResolution, ensurePortrait, flipTrack, liveAudio, loadLiveKit, mediaError } from '@/lib/txilladaLive';

export type LiveTracks = { video: LocalVideoTrack; audio: LocalAudioTrack };

// ─── Passagem do ecrã de preparar para o do live ─────────────────────────────────────────────────────────────────────
// Lido e escrito só em efeitos e ações (nunca durante o desenho).
let pending: { id: string; access: TxilladaAccess; tracks: LiveTracks | null; front: boolean } | null = null;
/** O ecrã de preparar abriu a Txillada: o do live usa estas faixas (a câmara não fecha) e este acesso. */
export function handOff(id: string, access: TxilladaAccess, tracks: LiveTracks | null, front: boolean) {
  if (pending && pending.id !== id) stopTracks(pending.tracks);
  pending = { id, access, tracks, front };
}
function takeHandOff(id: string) {
  if (pending?.id !== id) return null;
  const p = pending;
  pending = null;
  return p;
}

function stopTracks(t: LiveTracks | null | undefined) {
  if (!t) return;
  for (const x of [t.video, t.audio]) {
    try { x.stop(); } catch { /* já parada */ }
  }
}

async function openTracks(front: boolean): Promise<LiveTracks> {
  await askBroadcast();
  const lk = await loadLiveKit();
  let made: LocalTrack[];
  try {
    made = await lk.createLocalTracks({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: { facingMode: front ? 'user' : 'environment', resolution: captureResolution },
    });
  } catch (e) {
    throw mediaError(e);
  }
  const video = made.find((t) => t.kind === lk.Track.Kind.Video) as LocalVideoTrack | undefined;
  const audio = made.find((t) => t.kind === lk.Track.Kind.Audio) as LocalAudioTrack | undefined;
  if (!video || !audio) {
    made.forEach((t) => t.stop());
    throw new Error('Não consegui abrir a câmara e o microfone.');
  }
  // No browser de um telemóvel, a imagem tem de sair ao alto (o Safari do iPhone podia dar uma faixa deitada).
  await ensurePortrait(video, front);
  return { video, audio };
}

/**
 * A qualidade de quem transmite: 720p a 30 imagens por segundo até ~2 Mbps, com simulcast (uma camada de 360p para quem
 * tem rede fraca). Quem vê no browser em ecrã inteiro pede a camada alta (adaptiveStream com a densidade do ecrã); quem
 * vê no telemóvel fica sem adaptiveStream (o VideoView do @livekit/react-native mandava parar o vídeo; ver adaptiveVideo).
 */
const VIDEO_ENCODING = { maxBitrate: 2_000_000, maxFramerate: 30 };
function roomOptions(lk: typeof import('livekit-client'), amHost: boolean) {
  return {
    adaptiveStream: !amHost && adaptiveVideo ? { pixelDensity: 'screen' as const } : false,
    dynacast: true,
    disconnectOnPageLeave: true,
    publishDefaults: { simulcast: true, videoEncoding: VIDEO_ENCODING, videoSimulcastLayers: [lk.VideoPresets.h360] },
  };
}

/** A câmara à vista no ecrã de preparar. `on` falso (fora de foco) fecha-a. */
export function usePreview(on: boolean) {
  const [tracks, setTracks] = useState<LiveTracks | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [front, setFront] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const kept = useRef(false);
  const startFront = useRef(true);
  useEffect(() => {
    if (!on) return;
    let dead = false;
    let mine: LiveTracks | null = null;
    kept.current = false;
    setError(null);
    void openTracks(startFront.current).then(
      (t) => {
        if (dead) { stopTracks(t); return; }
        mine = t;
        setTracks(t);
      },
      (e: Error) => { if (!dead) setError(e.message); },
    );
    return () => {
      dead = true;
      if (!kept.current) stopTracks(mine);
      setTracks(null);
    };
  }, [on, attempt]);
  async function flip() {
    if (!tracks) return;
    const next = !front;
    try {
      await flipTrack(tracks.video, next);
      setFront(next);
      startFront.current = next;
    } catch { /* fica a câmara que estava */ }
  }
  /** As faixas passam para o ecrã do live (não se fecham ao sair daqui). */
  function keep(): LiveTracks | null {
    kept.current = true;
    return tracks;
  }
  return { tracks, error, front, flip, keep, retry: () => setAttempt((n) => n + 1) };
}

/** O relógio do live: a hora de agora, a cada segundo (só enquanto `on`). */
export function useNow(on: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!on) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [on]);
  return now;
}

type Act =
  | { t: 'dto'; dto: TxilladaDto } | { t: 'comments'; items: TxilladaComment[] } | { t: 'event'; ev: TxilladaEvent; me: string | null } | { t: 'cheers'; n: number }
  | { t: 'commentCheer'; id: string; cheers: number; cheered: boolean };
function reduce(s: LiveState, a: Act): LiveState {
  switch (a.t) {
    case 'commentCheer': return withCommentCheer(s, a.id, a.cheers, a.cheered);
    case 'dto': return withDto(s, a.dto);
    case 'comments': return withComments(s, a.items);
    case 'event': return applyEvent(s, a.ev, a.me);
    case 'cheers': return a.n > s.cheers ? { ...s, cheers: a.n } : s;
  }
}

export type Conn = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'failed';

/** Só mantém o ecrã aceso (useKeepAwake) enquanto o componente está montado: separado para o poder ligar e desligar. */
export function KeepAwake(): null {
  useKeepAwake('txillada');
  return null;
}

/**
 * O ecrã da Txillada. Para o anfitrião: transmite a câmara e o microfone, vira, cala, termina, apaga e expulsa. Para quem
 * vê: o vídeo e o som de quem transmite, comentar, brindar. Para os dois: os números e os comentários em tempo real.
 */
export function useTxillada(id: string) {
  const { user } = useAuth();
  const me = user?.username ?? null;
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: txilladaKey(id),
    queryFn: () => txilladaApi.get(id),
    enabled: !!id,
    retry: (n, e) => !(e instanceof ApiError && [403, 404].includes(e.status)) && n < 2,
    refetchInterval: (query) => (query.state.data?.status === 'live' ? POLL_MS : false),
  });
  const dto = q.data ?? null;
  const [live, dispatch] = useReducer(reduce, undefined, () => initialLive());
  const kind = viewKind(dto, live, !!q.error && !dto);
  const ui = liveUi(dto && kind === 'live' ? dto : null);
  const host = !!dto?.isHost;

  const [conn, setConn] = useState<Conn>('idle');
  const [error, setError] = useState<string | null>(null);
  const [video, setVideo] = useState<VideoTrack | null>(null);
  const [front, setFront] = useState(true);
  const [mic, setMic] = useState(true);
  const [audioBlocked, setAudioBlocked] = useState(false);
  /** Sobe a cada brinde meu (os copos aparecem logo). */
  const [myBurst, setMyBurst] = useState(0);
  /** Sobe com «Tentar outra vez» depois de a ligação cair: volta a entrar na sala. */
  const [attempt, setAttempt] = useState(0);
  const roomRef = useRef<Room | null>(null);
  const tracksRef = useRef<LiveTracks | null>(null);
  const lastComment = useRef<number | null>(null);
  const cheerTimes = useRef<number[]>([]);
  const commentCheerTimes = useRef<number[]>([]);
  const afterRef = useRef<string | null>(null);

  useEffect(() => { if (q.data) dispatch({ t: 'dto', dto: q.data }); }, [q.data]);
  useEffect(() => { afterRef.current = lastCommentId(live); });

  // Os eventos do canal da app, só os desta Txillada.
  useEffect(() => onTxilladaEvent((raw) => {
    const ev = parseTxilladaEvent(raw, id);
    if (!ev) return;
    dispatch({ t: 'event', ev, me });
    if (ev.type === 'txillada.ended') void qc.invalidateQueries({ queryKey: txilladaKey(id) });
  }), [id, me, qc]);

  // Os comentários: os 50 mais recentes ao entrar e, de 8 em 8 s, os que vieram depois (se o canal perder algum).
  const isLive = kind === 'live';
  useEffect(() => {
    if (!isLive) return;
    let dead = false;
    const pull = () => {
      void txilladaApi.comments(id, afterRef.current).then((r) => { if (!dead && r?.items?.length) dispatch({ t: 'comments', items: r.items }); }, () => undefined);
    };
    pull();
    const t = setInterval(pull, POLL_MS);
    return () => { dead = true; clearInterval(t); };
  }, [id, isLive]);

  // A sala do LiveKit: liga quando a Txillada está a decorrer; acabada (ou ao sair), desliga e fecha a câmara.
  useEffect(() => {
    if (!isLive || !dto) return;
    let dead = false;
    const undo: (() => void)[] = [];
    const amHost = dto.isHost;
    setConn('connecting');
    setError(null);
    void (async () => {
      try {
        const handed = amHost ? takeHandOff(id) : null;
        const access = handed?.access ?? (await txilladaApi.join(id));
        const lk = await loadLiveKit();
        if (dead) { stopTracks(handed?.tracks); return; }
        await liveAudio(true, amHost);
        undo.push(() => void liveAudio(false, amHost));
        const room = new lk.Room(roomOptions(lk, amHost));
        roomRef.current = room;
        undo.push(() => { void room.disconnect(); if (roomRef.current === room) roomRef.current = null; });
        room.on(lk.RoomEvent.TrackSubscribed, (track) => {
          if (track.kind === lk.Track.Kind.Video) setVideo(track as VideoTrack);
          else if (track.kind === lk.Track.Kind.Audio) undo.push(attachAudio(track));
        });
        room.on(lk.RoomEvent.TrackUnsubscribed, (track) => {
          if (track.kind === lk.Track.Kind.Video) setVideo((v) => (v === track ? null : v));
        });
        room.on(lk.RoomEvent.Reconnecting, () => setConn('reconnecting'));
        room.on(lk.RoomEvent.Reconnected, () => setConn('connected'));
        room.on(lk.RoomEvent.AudioPlaybackStatusChanged, () => setAudioBlocked(audioNeedsTap && !room.canPlaybackAudio));
        room.on(lk.RoomEvent.Disconnected, (reason) => {
          if (dead) return;
          if (reason === lk.DisconnectReason.PARTICIPANT_REMOVED && !amHost) setError('Saíste desta Txillada: o anfitrião tirou-te.');
          else if (reason === lk.DisconnectReason.ROOM_DELETED) dispatch({ t: 'event', ev: { type: 'txillada.ended', txilladaId: id, status: 'ended' }, me });
          else setConn('failed');
          void qc.invalidateQueries({ queryKey: txilladaKey(id) });
        });
        await room.connect(access.url, access.token, { autoSubscribe: !amHost });
        if (dead) return;
        if (amHost) {
          const tracks = handed?.tracks ?? (await openTracks(handed?.front ?? true));
          if (dead) { stopTracks(tracks); return; }
          tracksRef.current = tracks;
          undo.push(() => { stopTracks(tracks); if (tracksRef.current === tracks) tracksRef.current = null; });
          setFront(handed?.front ?? true);
          setVideo(tracks.video);
          setMic(!tracks.audio.isMuted);
          await room.localParticipant.publishTrack(tracks.video, { source: lk.Track.Source.Camera, simulcast: true, videoEncoding: VIDEO_ENCODING, videoSimulcastLayers: [lk.VideoPresets.h360] });
          await room.localParticipant.publishTrack(tracks.audio, { source: lk.Track.Source.Microphone });
        }
        setAudioBlocked(audioNeedsTap && !room.canPlaybackAudio);
        setConn('connected');
      } catch (e) {
        if (dead) return;
        // 410 do join: acabou entre o GET e o join. Não é uma falha de ligação: o ecrã passa a «A Txillada acabou».
        if (e instanceof ApiError && e.status === 410) {
          dispatch({ t: 'event', ev: { type: 'txillada.ended', txilladaId: id, status: 'ended' }, me });
          void qc.invalidateQueries({ queryKey: txilladaKey(id) });
          setConn('idle');
          return;
        }
        console.warn('[txillada] room', e);
        setConn('failed');
        setError(e instanceof ApiError ? errorText(e.status, e.message) : (e as Error)?.message || errorText(undefined));
      }
    })();
    return () => {
      dead = true;
      for (const f of undo.reverse()) {
        try { f(); } catch { /* segue */ }
      }
      setVideo(null);
      setConn('idle');
    };
  }, [id, isLive, !!dto, dto?.isHost, attempt]); // eslint-disable-line react-hooks/exhaustive-deps

  async function toggleMic() {
    const a = tracksRef.current?.audio;
    if (!a) return;
    if (mic) await a.mute(); else await a.unmute();
    setMic(!mic);
  }
  async function flip() {
    const v = tracksRef.current?.video;
    if (!v) return;
    const next = !front;
    try { await flipTrack(v, next); setFront(next); } catch { /* fica a que estava */ }
  }
  /** O som no browser pode precisar de um toque (as regras do autoplay). */
  async function startAudio() {
    try { await roomRef.current?.startAudio(); } catch { /* fica bloqueado */ }
    setAudioBlocked(audioNeedsTap && !(roomRef.current?.canPlaybackAudio ?? true));
  }

  /** Manda um comentário. Devolve a mensagem de erro, ou null se correu bem. */
  async function sendComment(body: string): Promise<string | null> {
    const text = body.trim();
    if (!text) return null;
    const gate = commentGate(lastComment.current, Date.now());
    if (!gate.ok) return 'Calma! Espera um bocadinho antes de comentar outra vez.';
    lastComment.current = Date.now();
    try {
      const c = await txilladaApi.comment(id, text);
      if (c?.id) dispatch({ t: 'event', ev: { type: 'txillada.comment', txilladaId: id, comment: c }, me });
      return null;
    } catch (e) {
      return e instanceof ApiError ? errorText(e.status, e.message) : errorText(undefined);
    }
  }
  /** Brindar: os copos aparecem logo; no máximo 5 por segundo (mais depressa não conta). */
  function cheer(): boolean {
    const g = cheerGate(cheerTimes.current, Date.now());
    cheerTimes.current = g.times;
    if (!g.ok) return false;
    setMyBurst((n) => n + 1);
    // Pela reação 🍻 (conta como o brinde e, além dos copos, sobe a flutuar a todos).
    void txilladaApi.react(id, 'cheers').then((r) => { if (typeof r?.cheers === 'number') dispatch({ t: 'cheers', n: r.cheers }); }, () => undefined);
    return true;
  }
  /**
   * Brindar um comentário (dois toques no balão): só põe, como nas publicações (já brindado, só os copos). A contagem sobe
   * logo e acerta com a resposta; no máximo 5 por segundo (mais depressa não manda nada). Devolve false se não brindou agora.
   */
  function cheerComment(c: TxilladaComment): boolean {
    if (c.cheered || kind !== 'live') return false;
    const g = cheerGate(commentCheerTimes.current, Date.now());
    commentCheerTimes.current = g.times;
    if (!g.ok) return false;
    dispatch({ t: 'commentCheer', id: c.id, cheers: (c.cheers ?? 0) + 1, cheered: true });
    void txilladaApi.cheerComment(id, c.id).then(
      (r) => {
        if (typeof r?.cheers === 'number') dispatch({ t: 'commentCheer', id: c.id, cheers: r.cheers, cheered: !!r.cheered });
      },
      () => dispatch({ t: 'commentCheer', id: c.id, cheers: c.cheers ?? 0, cheered: false }),
    );
    return true;
  }
  async function removeComment(c: TxilladaComment): Promise<string | null> {
    try {
      await txilladaApi.removeComment(id, c.id);
      dispatch({ t: 'event', ev: { type: 'txillada.comment_removed', txilladaId: id, commentId: c.id }, me });
      return null;
    } catch (e) {
      return e instanceof ApiError ? errorText(e.status, e.message) : errorText(undefined);
    }
  }
  async function ban(c: TxilladaComment): Promise<string | null> {
    try {
      await txilladaApi.ban(id, c.author.username);
      return null;
    } catch (e) {
      return e instanceof ApiError ? errorText(e.status, e.message) : errorText(undefined);
    }
  }
  /** O anfitrião termina: a sala fecha e fica o resumo (a Txillada não fica gravada). */
  async function end(): Promise<string | null> {
    try {
      const d = await txilladaApi.end(id);
      if (d?.id) qc.setQueryData(txilladaKey(id), d);
      dispatch({ t: 'event', ev: { type: 'txillada.ended', txilladaId: id, status: d?.status && d.status !== 'live' ? d.status : 'ended' }, me });
      return null;
    } catch (e) {
      return e instanceof ApiError ? errorText(e.status, e.message) : errorText(undefined);
    }
  }

  const loadError = q.error ? (q.error instanceof ApiError ? errorText(q.error.status, q.error.message) : errorText(undefined)) : null;
  return {
    dto, live, kind, ui, host, me, conn, error: error ?? (kind === 'error' ? loadError : null), video, front, mic, audioBlocked, myBurst,
    toggleMic, flip, startAudio, sendComment, cheer, cheerComment, removeComment, ban, end, retry: () => void q.refetch(), reconnect: () => { setError(null); setAttempt((n) => n + 1); },
  };
}
