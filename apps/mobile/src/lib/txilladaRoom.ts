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
import { useWindowDimensions } from 'react-native';
import type { LocalAudioTrack, LocalTrack, LocalVideoTrack, RemoteTrackPublication, Room, VideoTrack } from 'livekit-client';
import { ApiError } from '@/lib/api';
import { txilladaApi, txilladaKey, type TxilladaAccess } from '@/lib/api.txillada';
import { useAuth } from '@/lib/auth';
import { onTxilladaEvent } from '@/lib/realtime';
import {
  applyEvent, cheerGate, commentGate, errorText, giftKey, initialLive, isInsufficient, lastCommentId, liveUi, parseTxilladaEvent, POLL_MS, viewKind, withCommentCheer,
  withComments, withDto, withMyGift, type LiveState, type TxilladaComment, type TxilladaDto, type TxilladaEvent, type TxilladaPerson,
} from '@/lib/txillada';
import type { GiftResult } from '@/lib/api.txillada';
import {
  guestNotice, guestsInit, guestsReduce, inviteErrorText, parseGuestEvent, stageIds, stageLayout, stagePeople, tileQuality, type GuestState,
} from '@/lib/txilladaGuests';
import { invitedNotice, mentionNotice, oldestId, parseMentionEvent } from '@/lib/txilladaChat';
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
  | { t: 'commentCheer'; id: string; cheers: number; cheered: boolean } | { t: 'gift'; r: GiftResult } | { t: 'reopen'; dto: TxilladaDto };
function reduce(s: LiveState, a: Act): LiveState {
  switch (a.t) {
    // Reaberta (a Angariação, 0174): outra vez ao vivo, do zero, mas a conversa de antes fica para ler para trás.
    case 'reopen': return { ...initialLive(a.dto), comments: s.comments, removed: s.removed };
    case 'gift': return withMyGift(s, a.r);
    case 'commentCheer': return withCommentCheer(s, a.id, a.cheers, a.cheered);
    case 'dto': return withDto(s, a.dto);
    case 'comments': return withComments(s, a.items);
    case 'event': return applyEvent(s, a.ev, a.me);
    case 'cheers': return a.n > s.cheers ? { ...s, cheers: a.n } : s;
  }
}

export type Conn = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'failed';

type LK = typeof import('livekit-client');

/** Um quadrado do ecrã (0165): a pessoa, a faixa de vídeo, o microfone ligado e se está a falar (o contorno coral). */
export interface StageTile {
  person: TxilladaPerson; track: VideoTrack | null; local: boolean; mirror: boolean; mic: boolean; speaking: boolean;
  /** A câmara ligada (false: desligou-a sem sair; mostra-se a foto e «Câmara desligada», o som continua). */
  cam: boolean;
}
/** O que se recebe de cada pessoa na sala (pelo identity, o id da conta). */
type RemoteSeat = { video: VideoTrack | null; pub: RemoteTrackPublication | null; mic: boolean; cam: boolean };

/** Quem está na sala e o que publica: a câmara (se a recebo) e o microfone (ligado ou calado). */
function snapshot(room: Room, lk: LK): Record<string, RemoteSeat> {
  const out: Record<string, RemoteSeat> = {};
  room.remoteParticipants.forEach((p) => {
    const vp = p.getTrackPublication(lk.Track.Source.Camera) as RemoteTrackPublication | undefined;
    const ap = p.getTrackPublication(lk.Track.Source.Microphone);
    out[p.identity] = { video: vp?.isSubscribed ? ((vp.videoTrack as VideoTrack | undefined) ?? null) : null, pub: vp ?? null, mic: !!ap && !ap.isMuted, cam: !!vp && !vp.isMuted };
  });
  return out;
}

/** Espera que o LiveKit me deixe publicar (a API mudou a permissão com o updateParticipant). Devolve se deixou. */
function waitCanPublish(room: Room, lk: LK, ms: number): Promise<boolean> {
  const lp = room.localParticipant;
  if (lp.permissions?.canPublish) return Promise.resolve(true);
  return new Promise((resolve) => {
    const done = (ok: boolean) => {
      clearTimeout(t);
      lp.off(lk.ParticipantEvent.ParticipantPermissionsChanged, check);
      resolve(ok);
    };
    const check = () => { if (lp.permissions?.canPublish) done(true); };
    const t = setTimeout(() => done(!!lp.permissions?.canPublish), ms);
    lp.on(lk.ParticipantEvent.ParticipantPermissionsChanged, check);
  });
}

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
  const myId = user?.id ?? null;
  const { width, height } = useWindowDimensions();
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
  /** Os convidados (0165): quem transmite, os pedidos e convites (o anfitrião) e o meu lugar. */
  const [gs, gdispatch] = useReducer(guestsReduce, undefined, guestsInit);
  const kind = viewKind(dto, live, !!q.error && !dto);
  const ui = liveUi(dto && kind === 'live' ? dto : null);
  const host = !!dto?.isHost;

  const [conn, setConn] = useState<Conn>('idle');
  const [error, setError] = useState<string | null>(null);
  const [video, setVideo] = useState<VideoTrack | null>(null);
  const [front, setFront] = useState(true);
  const [mic, setMic] = useState(true);
  /** A minha câmara ligada (o anfitrião pode desligá-la sem terminar: o som continua). */
  const [cam, setCam] = useState(true);
  /** Há comentários mais antigos do que os que tenho (para ler para trás); a carregar agora. */
  const [olderMore, setOlderMore] = useState(false);
  const [olderBusy, setOlderBusy] = useState(false);
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
  const lkRef = useRef<LK | null>(null);
  /** Quem pode aparecer no ecrã (o anfitrião e os convidados que vejo): as faixas dos outros não se recebem. */
  const allowedRef = useRef<Set<string>>(new Set());
  /** As faixas abertas ao aceitar um convite (a permissão da câmara pede-se antes de dizer que sim). */
  const guestTracksRef = useRef<LiveTracks | null>(null);
  const hostRef = useRef(false);
  const mineRef = useRef<GuestState>('none');
  const [remote, setRemote] = useState<Record<string, RemoteSeat>>({});
  const [speaking, setSpeaking] = useState<string[]>([]);
  /** A minha câmara quando estou a transmitir como convidado. */
  const [myVideo, setMyVideo] = useState<VideoTrack | null>(null);
  /** Um aviso dos convidados («@ana pediu para entrar», «O anfitrião recusou o teu pedido»…); o ecrã mostra-o. */
  const [notice, setNotice] = useState<{ n: number; text: string } | null>(null);
  /** Quantas vezes já se voltou a entrar na sala para poder publicar (a permissão não chegou): no máximo uma. */
  const rejoined = useRef(0);

  useEffect(() => { if (q.data) { dispatch({ t: 'dto', dto: q.data }); gdispatch({ t: 'dto', dto: q.data, now: Date.now() }); } }, [q.data]);
  useEffect(() => { afterRef.current = lastCommentId(live); hostRef.current = host; mineRef.current = gs.mine; });

  // Os eventos do canal da app, só os desta Txillada.
  useEffect(() => onTxilladaEvent((raw) => {
    // Mencionaram-me num comentário (estou a ver: só o aviso, sem convite).
    const mev = parseMentionEvent(raw, id);
    if (mev) {
      if (mev.from.username !== me) setNotice((o) => ({ n: (o?.n ?? 0) + 1, text: mentionNotice(mev.from.username) }));
      return;
    }
    const gev = parseGuestEvent(raw, id);
    if (gev) {
      gdispatch({ t: 'event', ev: gev, me });
      const text = guestNotice(gev, me, hostRef.current);
      if (text) setNotice((o) => ({ n: (o?.n ?? 0) + 1, text }));
      return;
    }
    const ev = parseTxilladaEvent(raw, id);
    if (!ev) return;
    dispatch({ t: 'event', ev, me });
    if (ev.type === 'txillada.ended') void qc.invalidateQueries({ queryKey: txilladaKey(id) });
    // O fixado novo também fica na resposta guardada (um pedido antigo não o traz de volta).
    if (ev.type === 'txillada.pinned') qc.setQueryData<TxilladaDto>(txilladaKey(id), (d) => (d ? { ...d, pinned: ev.comment } : d));
  }), [id, me, qc]);

  // Os comentários: os 50 mais recentes ao entrar e, de 8 em 8 s, os que vieram depois (se o canal perder algum).
  const isLive = kind === 'live';
  useEffect(() => {
    if (!isLive) return;
    let dead = false;
    const pull = () => {
      const first = !afterRef.current;
      void txilladaApi.comments(id, afterRef.current).then((r) => {
        if (dead) return;
        // O primeiro pedido (os 50 mais recentes) diz se há mais antigos para ler para trás.
        if (first) setOlderMore(r?.more === true);
        if (r?.items?.length) dispatch({ t: 'comments', items: r.items });
      }, () => undefined);
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
        lkRef.current = lk;
        undo.push(() => { void room.disconnect(); if (roomRef.current === room) roomRef.current = null; setRemote({}); setSpeaking([]); });
        // Todos recebem as faixas de quem transmite (o anfitrião também: as dos convidados), menos as de quem não aparece
        // no meu ecrã (um bloqueio com um convidado, ou quem já saiu): essas deixam-se de receber.
        const sounds = new Map<string, () => void>();
        undo.push(() => { sounds.forEach((f) => f()); sounds.clear(); });
        const refresh = () => setRemote(snapshot(room, lk));
        room.on(lk.RoomEvent.TrackSubscribed, (track, pub, p) => {
          if (!allowedRef.current.has(p.identity)) { pub.setSubscribed(false); return; }
          if (track.kind === lk.Track.Kind.Audio) sounds.set(pub.trackSid, attachAudio(track));
          refresh();
        });
        room.on(lk.RoomEvent.TrackUnsubscribed, (_track, pub) => {
          sounds.get(pub.trackSid)?.();
          sounds.delete(pub.trackSid);
          refresh();
        });
        for (const e of [lk.RoomEvent.TrackMuted, lk.RoomEvent.TrackUnmuted, lk.RoomEvent.TrackPublished, lk.RoomEvent.TrackUnpublished, lk.RoomEvent.ParticipantConnected, lk.RoomEvent.ParticipantDisconnected]) {
          room.on(e, refresh);
        }
        // Quem fala fica com o contorno coral (a deteção de fala do LiveKit; também a minha voz).
        room.on(lk.RoomEvent.ActiveSpeakersChanged, (list) => setSpeaking(list.map((x) => x.identity)));
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
        await room.connect(access.url, access.token, { autoSubscribe: true });
        if (dead) return;
        refresh();
        if (amHost) {
          const tracks = handed?.tracks ?? (await openTracks(handed?.front ?? true));
          if (dead) { stopTracks(tracks); return; }
          tracksRef.current = tracks;
          undo.push(() => { stopTracks(tracks); if (tracksRef.current === tracks) tracksRef.current = null; });
          setFront(handed?.front ?? true);
          setVideo(tracks.video);
          setMic(!tracks.audio.isMuted);
          setCam(!tracks.video.isMuted);
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

  // ── Os convidados (0165) ────────────────────────────────────────────────────────────────────────────────────────────
  const people = dto ? stagePeople(dto.host, gs.guests) : [];
  const allowedKey = dto ? stageIds(dto.host, gs.guests).join(',') : '';
  const amGuest = !host && gs.mine === 'guest' && kind === 'live';
  // Ligado à sala (uma religação curta não desliga a câmara de quem transmite).
  const linked = conn === 'connected' || conn === 'reconnecting';

  // Recebe só as faixas de quem está no meu ecrã; quem passa a aparecer (um convidado novo) volta a receber-se.
  useEffect(() => {
    const allowed = new Set(allowedKey ? allowedKey.split(',') : []);
    allowedRef.current = allowed;
    const room = roomRef.current;
    if (!room || conn !== 'connected') return;
    room.remoteParticipants.forEach((p) => {
      const want = allowed.has(p.identity);
      p.trackPublications.forEach((pub) => {
        if (want !== pub.isSubscribed) (pub as RemoteTrackPublication).setSubscribed(want);
      });
    });
  }, [allowedKey, conn]);

  // A camada de cada quadrado: 720p nos grandes, 360p nos pequenos (simulcast; o adaptiveStream do site fica por baixo disto).
  const layoutKey = `${people.length}:${Math.round(width)}x${Math.round(height)}:${people.map((p) => `${remote[p.id]?.pub?.trackSid ?? ''}${remote[p.id]?.video ? '+' : ''}`).join(',')}`;
  useEffect(() => {
    const lk = lkRef.current;
    if (!lk) return;
    const rects = stageLayout(people.length, width, height);
    people.forEach((p, i) => {
      const pub = remote[p.id]?.pub;
      if (!pub || !pub.isSubscribed || !rects[i]) return;
      try { pub.setVideoQuality(tileQuality(rects[i], width, height) === 'high' ? lk.VideoQuality.HIGH : lk.VideoQuality.LOW); } catch { /* ainda sem a faixa */ }
    });
  }, [layoutKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // A transmitir como convidado: abre a câmara e o microfone (como o anfitrião: ao alto, 720p com simulcast), espera pela
  // permissão do LiveKit e publica. Ao deixar de transmitir (sair, tirado, a Txillada acabou), para tudo e volta a só ver.
  useEffect(() => {
    if (!amGuest || !linked) return;
    const room = roomRef.current;
    const lk = lkRef.current;
    if (!room || !lk) return;
    let dead = false;
    let mine: LiveTracks | null = null;
    void (async () => {
      try {
        // As do convite (abertas antes do sim), ou abrem-se agora (o pedido aceite pelo anfitrião). Tiram-se do ref já, antes
        // de esperar: o aviso do canal e a resposta da API chegam por qualquer ordem e a câmara só se abre uma vez.
        const pre = guestTracksRef.current;
        guestTracksRef.current = null;
        const tracks = pre ?? (await openTracks(true));
        if (dead) { stopTracks(tracks); return; }
        mine = tracks;
        tracksRef.current = tracks;
        setMyVideo(tracks.video);
        setMic(!tracks.audio.isMuted);
        setFront(true);
        await liveAudio(true, true);
        if (!(await waitCanPublish(room, lk, 8000))) {
          if (dead) return;
          // A permissão não chegou (o updateParticipant falhou?): volta-se a entrar, com um token que já publica (uma vez).
          if (rejoined.current++ < 1) { setAttempt((n) => n + 1); return; }
          throw new Error('Não consegui começar a transmitir. Tenta outra vez.');
        }
        if (dead) return;
        await room.localParticipant.publishTrack(tracks.video, { source: lk.Track.Source.Camera, simulcast: true, videoEncoding: VIDEO_ENCODING, videoSimulcastLayers: [lk.VideoPresets.h360] });
        await room.localParticipant.publishTrack(tracks.audio, { source: lk.Track.Source.Microphone });
      } catch (e) {
        if (dead) return;
        console.warn('[txillada] guest', e);
        const msg = e instanceof Error && /^(Sem acesso|A câmara|Não consegui|Não encontrei|Este browser)/.test(e.message) ? e.message : 'Não consegui começar a transmitir. Tenta outra vez.';
        setNotice((o) => ({ n: (o?.n ?? 0) + 1, text: msg }));
        gdispatch({ t: 'mine', mine: 'none', now: Date.now() });
        void txilladaApi.guestLeave(id).catch(() => undefined);
      }
    })();
    return () => {
      dead = true;
      const t = mine;
      if (t) {
        for (const x of [t.video, t.audio]) void room.localParticipant.unpublishTrack(x, true).catch(() => undefined);
        stopTracks(t);
        if (tracksRef.current === t) tracksRef.current = null;
      }
      setMyVideo(null);
      void liveAudio(true, false);
    };
  }, [amGuest, linked, id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Sair do ecrã da Txillada com um pedido, um convite ou a transmitir: deixa de o estar (o webhook também o sabe).
  useEffect(() => () => {
    if (!hostRef.current && mineRef.current !== 'none') void txilladaApi.guestLeave(id).catch(() => undefined);
    stopTracks(guestTracksRef.current);
    guestTracksRef.current = null;
  }, [id]);

  const errText = (e: unknown) => (e instanceof ApiError ? errorText(e.status, e.message) : (e as Error)?.message || errorText(undefined));

  /** Quem vê: pedir para entrar. Devolve a mensagem de erro, ou null. */
  async function requestJoin(): Promise<string | null> {
    rejoined.current = 0;
    gdispatch({ t: 'mine', mine: 'requested', now: Date.now() });
    try {
      const r = await txilladaApi.guestRequest(id);
      // Havia um convite à espera: já está a transmitir.
      gdispatch({ t: 'mine', mine: r?.state === 'guest' ? 'guest' : 'requested', now: Date.now(), guests: r?.guests });
      return null;
    } catch (e) {
      gdispatch({ t: 'mine', mine: 'none', now: Date.now() });
      return errText(e);
    }
  }
  /** Desistir do pedido, recusar o convite, ou deixar de transmitir (volta a só ver). */
  async function leaveStage(): Promise<string | null> {
    const before = gs.mine;
    gdispatch({ t: 'mine', mine: 'none', now: Date.now() });
    try {
      await (before === 'invited' ? txilladaApi.guestDecline(id) : txilladaApi.guestLeave(id));
      return null;
    } catch (e) {
      return errText(e);
    }
  }
  /** Aceitar o convite: primeiro a câmara e o microfone (a permissão), depois o sim à API; o resto faz o efeito de cima. */
  async function acceptInvite(): Promise<string | null> {
    rejoined.current = 0;
    let tracks: LiveTracks | null = null;
    try {
      tracks = await openTracks(true);
      // Antes do sim à API: o `guest_joined` do canal pode chegar antes da resposta, e o efeito de cima usa estas faixas.
      stopTracks(guestTracksRef.current);
      guestTracksRef.current = tracks;
      const r = await txilladaApi.guestAccept(id);
      gdispatch({ t: 'mine', mine: 'guest', now: Date.now(), guests: r?.guests });
      return null;
    } catch (e) {
      // Só se as faixas ainda não passaram para o efeito (se passaram, é ele que as fecha).
      if (guestTracksRef.current === tracks) { guestTracksRef.current = null; stopTracks(tracks); }
      if (e instanceof ApiError && [404, 409].includes(e.status)) gdispatch({ t: 'mine', mine: 'none', now: Date.now() });
      return errText(e);
    }
  }
  /** O anfitrião: aceitar, recusar, convidar e tirar. As listas novas vêm na resposta. */
  async function hostGuest(what: 'accept' | 'decline' | 'invite' | 'remove', username: string): Promise<string | null> {
    try {
      const fn = { accept: txilladaApi.guestAcceptRequest, decline: txilladaApi.guestDeclineRequest, invite: txilladaApi.guestInvite, remove: txilladaApi.guestRemove }[what];
      const r = await fn(id, username);
      if (r) gdispatch({ t: 'lists', guests: r.guests, requests: r.requests, invites: r.invites });
      return null;
    } catch (e) {
      void qc.invalidateQueries({ queryKey: txilladaKey(id) });
      return errText(e);
    }
  }

  /**
   * «Convidar por @» (0168): o anfitrião convida alguém que pode ainda não estar a ver (recebe um aviso que abre a Txillada).
   * As listas mudam logo; devolve a mensagem de erro em palavras claras, ou null.
   */
  async function inviteByAt(username: string): Promise<string | null> {
    try {
      const r = await txilladaApi.guestInvite(id, username);
      if (r) gdispatch({ t: 'lists', guests: r.guests, requests: r.requests, invites: r.invites });
      return null;
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) void qc.invalidateQueries({ queryKey: txilladaKey(id) });
      return inviteErrorText(e instanceof ApiError ? { status: e.status, code: e.code, message: e.message, extra: e.extra } : null, username);
    }
  }

  // Os quadrados: o anfitrião e os convidados, cada um com a sua faixa (a minha câmara, se transmito, sem passar pela rede).
  const tiles: StageTile[] = people.map((p) => {
    const local = !!myId && p.id === myId;
    const r = remote[p.id];
    return {
      person: p,
      track: local ? (host ? video : myVideo) : (r?.video ?? null),
      local,
      mirror: local && front,
      mic: local ? mic : (r ? r.mic : true),
      speaking: speaking.includes(p.id),
      cam: local ? (host ? cam : true) : (r ? r.cam || !r.pub : true),
    };
  });

  async function toggleMic() {
    const a = tracksRef.current?.audio;
    if (!a) return;
    if (mic) await a.mute(); else await a.unmute();
    setMic(!mic);
  }
  /**
   * O anfitrião desliga (ou volta a ligar) a câmara sem terminar: quem vê passa a ver a foto e «Câmara desligada»; o som
   * continua e a ligação à sala não cai (a faixa fica publicada, só calada).
   */
  async function toggleCam(): Promise<string | null> {
    const v = tracksRef.current?.video;
    if (!v) return null;
    try {
      if (cam) await v.mute(); else await v.unmute();
      setCam(!cam);
      return null;
    } catch {
      return cam ? 'Não consegui desligar a câmara.' : 'Não consegui ligar a câmara. Tenta outra vez.';
    }
  }
  /** Ler para trás: os 50 comentários antes do mais antigo que tenho (se a API tiver mais). */
  async function loadOlder(): Promise<void> {
    if (olderBusy || !olderMore) return;
    const before = oldestId(live.comments);
    if (!before) { setOlderMore(false); return; }
    setOlderBusy(true);
    try {
      const r = await txilladaApi.comments(id, null, before);
      if (r?.items?.length) dispatch({ t: 'comments', items: r.items });
      setOlderMore(r?.more === true && !!r?.items?.length);
    } catch {
      /* tenta-se outra vez ao voltar ao topo */
    } finally {
      setOlderBusy(false);
    }
  }
  /**
   * Reabrir a Angariação (o anfitrião, 0174): a mesma Txillada, com a meta e o que já se juntou, outra vez ao vivo numa sala
   * nova. Devolve a mensagem de erro, ou null.
   */
  async function reopen(): Promise<string | null> {
    try {
      const d = await txilladaApi.reopen(id);
      if (d?.id) {
        dispatch({ t: 'reopen', dto: d });
        gdispatch({ t: 'dto', dto: d, now: Date.now() });
        qc.setQueryData(txilladaKey(id), d);
      } else {
        void qc.invalidateQueries({ queryKey: txilladaKey(id) });
      }
      return null;
    } catch (e) {
      void qc.invalidateQueries({ queryKey: txilladaKey(id) });
      return e instanceof ApiError ? errorText(e.status, e.message) : errorText(undefined);
    }
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
      const r = await txilladaApi.comment(id, text);
      if (r?.id) {
        const { invited, ...c } = r;
        dispatch({ t: 'event', ev: { type: 'txillada.comment', txilladaId: id, comment: c }, me });
        // Quem mencionei e não estava a ver recebeu o convite para vir ver.
        const note = invitedNotice(invited);
        if (note) setNotice((o) => ({ n: (o?.n ?? 0) + 1, text: note }));
      }
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
  /** O anfitrião fixa um comentário (ou tira o fixado, com null). A pílula muda logo; devolve a mensagem de erro, ou null. */
  async function pin(c: TxilladaComment | null): Promise<string | null> {
    const before = live.pinned;
    const set = (x: TxilladaComment | null) => {
      dispatch({ t: 'event', ev: { type: 'txillada.pinned', txilladaId: id, comment: x }, me });
      qc.setQueryData<TxilladaDto>(txilladaKey(id), (d) => (d ? { ...d, pinned: x } : d));
    };
    set(c);
    try {
      const r = await txilladaApi.pin(id, c?.id ?? null);
      if (r && 'pinned' in r) set(r.pinned ?? null);
      return null;
    } catch (e) {
      set(before);
      return e instanceof ApiError ? errorText(e.status, e.message) : errorText(undefined);
    }
  }
  /** Denunciei um comentário: deixa já de me aparecer (nos balões e no fixado); o servidor também o esconde. */
  function hideComment(c: TxilladaComment) {
    dispatch({ t: 'event', ev: { type: 'txillada.comment_removed', txilladaId: id, commentId: c.id }, me });
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
  /**
   * Pagar a entrada de uma Txillada privada (0167): uma vez só (pagar outra vez não cobra). Correu bem: o ecrã passa a ligar
   * à sala. Devolve null, ou a mensagem e se foi por falta de saldo (a app aponta para a carteira).
   */
  async function pay(): Promise<{ error: string; insufficient: boolean } | null> {
    try {
      const r = await txilladaApi.pay(id);
      if (r?.txillada?.id) qc.setQueryData(txilladaKey(id), r.txillada);
      else void qc.invalidateQueries({ queryKey: txilladaKey(id) });
      return null;
    } catch (e) {
      if (e instanceof ApiError && e.status === 410) void qc.invalidateQueries({ queryKey: txilladaKey(id) });
      return { error: e instanceof ApiError ? errorText(e.status, e.message) : errorText(undefined), insufficient: e instanceof ApiError && isInsufficient(e) };
    }
  }
  /**
   * Oferecer Txills (0167): a linha «ofereceu N vibes», a barra e o top mudam logo com a resposta (o evento da sala chega
   * depois e não repete). A chave é a mesma se o pedido se perder pelo caminho (uma segunda tentativa não cobra outra vez).
   */
  async function gift(amount: number): Promise<{ balance: number | null; error?: string; insufficient?: boolean }> {
    const key = giftKey();
    for (let attempt = 0; ; attempt++) {
      try {
        const r = await txilladaApi.gift(id, amount, key);
        if (r?.gift?.id) dispatch({ t: 'gift', r });
        return { balance: typeof r?.balance === 'number' ? r.balance : null };
      } catch (e) {
        // Sem resposta (a rede caiu a meio): mais uma vez com a mesma chave.
        if (!(e instanceof ApiError) && attempt < 1) continue;
        return { balance: null, error: e instanceof ApiError ? errorText(e.status, e.message) : errorText(undefined), insufficient: e instanceof ApiError && isInsufficient(e) };
      }
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
    toggleMic, flip, startAudio, sendComment, cheer, cheerComment, pin, hideComment, removeComment, ban, end, pay, gift, retry: () => void q.refetch(), reconnect: () => { setError(null); setAttempt((n) => n + 1); },
    // Convidados (0165).
    guests: gs, tiles, notice, requestJoin, leaveStage, acceptInvite, hostGuest, inviteByAt,
    // A câmara do anfitrião, ler para trás e reabrir a Angariação (txillada-voltar).
    cam, toggleCam, olderMore, olderBusy, loadOlder, reopen,
  };
}
