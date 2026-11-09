/**
 * Gestor da chamada 1:1 (voz e vídeo). Uma chamada de cada vez.
 *
 * Estados: idle → outgoing (liguei, a chamar) ou incoming (a tocar) → connecting (atendida, a ligar o WebRTC) → active → ended
 * (ecrã final por instantes) → idle.
 *
 * Sinalização: ofertas, respostas e candidatos ICE vão por POST /calls/:id/signal e chegam ao outro lado no stream do chat
 * ({type:'call', event:'signal'}). Negociação "perfeita": quem atende é o lado educado (cede nas colisões), quem liga é o
 * impaciente. Quem liga só cria a ligação quando a outra pessoa atende (assim não se gastam candidatos à toa); quem atende
 * espera pela primeira oferta. Depois disso qualquer lado pode renegociar (por exemplo ao ligar a câmara a meio).
 *
 * O estado vive num pequeno store (useSyncExternalStore): qualquer ecrã lê `useCall()`.
 */
import { useSyncExternalStore } from 'react';
import { ApiError } from '@/lib/api';
import { holdStream, onCallEvent } from '@/lib/realtime';
import { callsApi } from './api';
import type { DataChannelLike, IceEventLike, PeerLike, SdpLike, TrackEventLike } from './peer';
import { startRingback, startRinging, stopSounds } from './sounds';
import type { CallEvent, CallPeer, CallState, EndReason, IceServer } from './types';
import * as rtc from './webrtc';

const IDLE: CallState = {
  phase: 'idle', callId: null, peer: null, outgoing: false, video: false, micOn: true, camOn: false, front: true, speaker: false, canFlip: false,
  local: null, remote: null, remoteMic: null, remoteCam: null, startedAt: null, endedAt: null, endReason: null, minimised: false, message: null, error: null,
};

/* ---------- Store ---------- */

let state: CallState = IDLE;
/** Muda sempre que um stream ganha ou perde faixas (o RTCView do telemóvel precisa de voltar a montar). */
let rev = 0;
const subs = new Set<() => void>();
function set(patch: Partial<CallState>) {
  state = { ...state, ...patch };
  subs.forEach((f) => f());
}
const subscribe = (f: () => void) => {
  subs.add(f);
  return () => void subs.delete(f);
};
export const getCall = () => state;
/** O estado da chamada, em qualquer ecrã. */
export function useCall(): CallState {
  return useSyncExternalStore(subscribe, getCall, getCall);
}
/** Número que muda quando os streams mudam de faixas (para a `key` dos vídeos). */
export function useStreamRev(): number {
  return useSyncExternalStore(subscribe, () => rev, () => rev);
}

/* ---------- Tempo de execução (fora do estado) ---------- */

let pc: PeerLike | null = null;
let dc: DataChannelLike | null = null;
let iceServers: IceServer[] = [];
let polite = false;
let makingOffer = false;
let ignoreOffer = false;
let pendingIce: unknown[] = [];
let early: NonNullable<CallEvent['signal']>[] = [];
let queue: Promise<void> = Promise.resolve();
let iceRestarted = false;
/** Chamadas que já acabaram aqui (um push atrasado não as volta a pôr a tocar). */
const done = new Set<string>();
/** Cada chamada tem um número; o que chega atrasado de uma chamada antiga é ignorado. */
let gen = 0;
const timers: Record<'ring' | 'connect' | 'drop' | 'close', ReturnType<typeof setTimeout> | null> = { ring: null, connect: null, drop: null, close: null };

const RING_OUT_MS = 45_000; // ninguém atende: "Sem resposta"
const RING_IN_MS = 60_000; // segurança, se o "ended" do servidor não chegar
const CONNECT_MS = 30_000;
const DROP_MS = 12_000;

function clear(k: keyof typeof timers) {
  if (timers[k]) clearTimeout(timers[k]!);
  timers[k] = null;
}
function after(k: keyof typeof timers, ms: number, f: () => void) {
  clear(k);
  timers[k] = setTimeout(() => { timers[k] = null; f(); }, ms);
}
const bump = () => { rev += 1; };

const errText = (e: unknown, fallback: string) => (e instanceof ApiError || e instanceof Error) && e.message ? e.message : fallback;

/** Larga tudo o que a chamada abriu (faixas, ligação, sons, temporizadores). */
function teardown() {
  if (state.callId) done.add(state.callId);
  (Object.keys(timers) as (keyof typeof timers)[]).forEach((k) => k !== 'close' && clear(k));
  stopSounds();
  try { dc?.close(); } catch { /* já fechado */ }
  try { pc?.close(); } catch { /* já fechada */ }
  dc = null;
  pc = null;
  pendingIce = [];
  early = [];
  makingOffer = false;
  ignoreOffer = false;
  iceRestarted = false;
  queue = Promise.resolve();
  rtc.stopMedia(state.local);
  rtc.playRemote(null);
  void rtc.callAudio(false, false);
  holdStream(false);
}

/** Volta ao repouso já (sem ecrã final). */
function reset() {
  teardown();
  clear('close');
  gen += 1;
  state = IDLE;
  subs.forEach((f) => f());
}

/** Termina a chamada e mostra o ecrã final por instantes. */
function finish(reason: EndReason, extra: Partial<CallState> = {}) {
  if (state.phase === 'idle' || state.phase === 'ended') return;
  // Outro aparelho meu atendeu ou recusou, ou a chamada perdida acabou de tocar: fecha sem mais nada.
  if (state.phase === 'incoming' && (reason === 'elsewhere' || reason === 'missed' || reason === 'remote')) return reset();
  teardown();
  // Tudo o que ainda estava a caminho desta chamada (pedidos, permissões) passa a ser ignorado.
  gen += 1;
  const g = gen;
  set({ phase: 'ended', endReason: reason, endedAt: Date.now(), local: null, remote: null, minimised: false, ...extra });
  const quick = reason === 'cancelled' ? 900 : reason === 'failed' || reason === 'busy' || reason === 'declined' || reason === 'blocked' ? 3200 : 2200;
  after('close', quick, () => g === gen && reset());
}

/* ---------- Sinalização ---------- */

function send(type: 'offer' | 'answer' | 'ice', data: unknown) {
  const id = state.callId;
  if (!id) return;
  void callsApi.signal(id, type, data).catch(() => undefined);
}

function sendState() {
  if (dc?.readyState !== 'open') return;
  try {
    dc.send(JSON.stringify({ t: 'state', mic: state.micOn, cam: state.camOn && rtc.hasVideoTrack(state.local) }));
  } catch { /* canal a fechar */ }
}

const desc = (d: SdpLike): SdpLike => ({ type: d.type, sdp: d.sdp });

async function flushIce() {
  if (!pc?.remoteDescription) return;
  const list = pendingIce;
  pendingIce = [];
  for (const c of list) await pc.addIceCandidate(c).catch(() => undefined);
}

async function onSignal(sig: NonNullable<CallEvent['signal']>) {
  const p = pc;
  if (!p) {
    early.push(sig);
    return;
  }
  if (sig.type === 'ice') {
    if (!sig.data) return;
    if (!p.remoteDescription) pendingIce.push(sig.data);
    else await p.addIceCandidate(sig.data).catch((e) => { if (!ignoreOffer) console.warn('[calls] ice', e); });
    return;
  }
  const d = sig.data as SdpLike;
  const description: SdpLike = { type: d?.type ?? sig.type, sdp: d?.sdp };
  const offer = description.type === 'offer';
  const collision = offer && (makingOffer || p.signalingState !== 'stable');
  ignoreOffer = !polite && collision;
  if (ignoreOffer) return;
  try {
    if (collision) await p.setLocalDescription({ type: 'rollback' }).catch(() => undefined);
    await p.setRemoteDescription(description);
    await flushIce();
    if (offer) {
      const a = await p.createAnswer();
      await p.setLocalDescription(a);
      send('answer', desc(a));
      // Quem atende com vídeo uma chamada de voz: a oferta não trazia vídeo, por isso agora é a nossa vez de oferecer.
      if (polite && rtc.hasVideoTrack(state.local) && !(description.sdp ?? '').includes('m=video')) void makeOffer(p);
    }
  } catch (e) {
    console.warn('[calls] sdp', e);
  }
}

async function makeOffer(p: PeerLike) {
  if (p !== pc) return;
  try {
    makingOffer = true;
    const o = await p.createOffer();
    if (p.signalingState !== 'stable') return;
    await p.setLocalDescription(o);
    send('offer', desc(o));
  } catch (e) {
    console.warn('[calls] offer', e);
  } finally {
    makingOffer = false;
  }
}

/** Liga o RTCPeerConnection (quem liga: quando atendem; quem atende: ao atender). */
function setupPeer() {
  const g = gen;
  const p = rtc.createPeer(iceServers);
  pc = p;
  // Canal de dados combinado dos dois lados (id 0): serve para dizer "microfone/câmara desligados".
  try {
    dc = p.createDataChannel('tx', { negotiated: true, id: 0, ordered: true });
    dc.addEventListener('open', () => sendState());
    dc.addEventListener('message', (e) => {
      try {
        const m = JSON.parse(String(e.data)) as { t?: string; mic?: boolean; cam?: boolean };
        if (m.t === 'state' && g === gen) set({ remoteMic: m.mic ?? null, remoteCam: m.cam ?? null, ...(m.cam ? { video: true } : {}) });
      } catch { /* mensagem estranha */ }
    });
  } catch {
    dc = null;
  }
  p.addEventListener('icecandidate', (e: IceEventLike) => {
    if (g !== gen || !e.candidate) return;
    const c = e.candidate;
    send('ice', typeof c.toJSON === 'function' ? c.toJSON() : c);
  });
  p.addEventListener('track', (e: TrackEventLike) => {
    if (g !== gen) return;
    const remote = rtc.remoteFromTrack(e, state.remote);
    rtc.playRemote(remote);
    bump();
    set({ remote, ...(e.track.kind === 'video' ? { video: true } : {}) });
  });
  p.addEventListener('negotiationneeded', () => {
    if (g !== gen) return;
    // Quem atende espera pela primeira oferta de quem liga (evita as duas ofertas ao mesmo tempo).
    if (polite && !p.remoteDescription) return;
    void makeOffer(p);
  });
  const onConn = () => {
    if (g !== gen || !pc) return;
    const c = p.connectionState;
    const i = p.iceConnectionState;
    if (c === 'connected' || i === 'connected' || i === 'completed') {
      clear('drop');
      clear('connect');
      if (state.phase === 'connecting') set({ phase: 'active', startedAt: state.startedAt ?? Date.now() });
    } else if (c === 'failed' || i === 'failed') {
      // Uma nova tentativa de ICE (só quem liga, para não colidir); se falhar outra vez, acabou.
      if (!polite && !iceRestarted && p.restartIce) {
        iceRestarted = true;
        p.restartIce();
        after('drop', DROP_MS, () => g === gen && finish('failed', { error: 'A ligação caiu.' }));
      } else finish('failed', { error: 'A ligação caiu.' });
    } else if (c === 'disconnected' || i === 'disconnected') {
      if (!timers.drop) after('drop', DROP_MS, () => g === gen && finish('failed', { error: 'A ligação caiu.' }));
    }
  };
  p.addEventListener('connectionstatechange', onConn);
  p.addEventListener('iceconnectionstatechange', onConn);
  rtc.addTracks(p, state.local);
  after('connect', CONNECT_MS, () => g === gen && state.phase === 'connecting' && finish('failed', { error: 'Não consegui ligar. Tenta outra vez.' }));
  // Sinais que chegaram antes de haver ligação.
  const got = early;
  early = [];
  for (const s of got) queue = queue.then(() => onSignal(s));
}

async function loadIce(list?: IceServer[]) {
  if (list && list.length) return list;
  try {
    return (await callsApi.ice()).iceServers ?? [];
  } catch {
    return [{ urls: 'stun:stun.l.google.com:19302' }];
  }
}

/* ---------- Eventos do servidor ---------- */

function onEvent(raw: unknown) {
  const e = raw as CallEvent;
  if (!e || e.type !== 'call' || !e.callId) return;
  const mine = e.callId === state.callId;
  switch (e.event) {
    case 'ring':
      if (e.from) openIncomingCall({ callId: e.callId, from: e.from, video: !!e.video });
      return;
    case 'accepted':
      if (!mine) return;
      if (state.outgoing && state.phase === 'outgoing') void onAccepted();
      else if (!state.outgoing && state.phase === 'incoming') finish('elsewhere'); // atendi noutro aparelho
      return;
    case 'declined':
      if (!mine) return;
      if (state.outgoing) finish(e.reason === 'busy' ? 'busy' : 'declined', { message: e.message ?? null });
      else finish('elsewhere');
      return;
    case 'ended':
      // reason: "cancelled" (quem ligou desistiu), "declined" (desligaram enquanto tocava), "ended" (em curso),
      // "missed" (ninguém atendeu a tempo), "lost" (o servidor deu a chamada por caída).
      if (!mine) return;
      if (state.phase === 'incoming') finish('missed');
      else if (state.outgoing && state.phase === 'outgoing') finish(e.reason === 'declined' ? 'declined' : 'no-answer');
      else if (e.reason === 'lost') finish('failed', { error: 'A ligação caiu.' });
      else finish('remote');
      return;
    case 'signal':
      if (!mine || !e.signal) return;
      queue = queue.then(() => onSignal(e.signal!));
      return;
  }
}
onCallEvent(onEvent);

async function onAccepted() {
  const g = gen;
  stopSounds();
  clear('ring');
  set({ phase: 'connecting' });
  polite = false;
  try {
    setupPeer();
  } catch (e) {
    if (g === gen) finish('failed', { error: errText(e, 'Não consegui ligar.') });
  }
}

/* ---------- Ações ---------- */

/** Liga a alguém. `peer` pode ser só o username; o servidor devolve o nome e a foto. */
export async function startCall(peer: CallPeer | string, video: boolean): Promise<void> {
  if (state.phase === 'ended') reset();
  if (state.phase !== 'idle') {
    set({ minimised: false });
    return;
  }
  const hint: CallPeer = typeof peer === 'string' ? { username: peer, displayName: peer, hasAvatar: false } : peer;
  gen += 1;
  const g = gen;
  set({ ...IDLE, phase: 'outgoing', outgoing: true, peer: hint, video, camOn: video, speaker: video });
  holdStream(true);
  if (!rtc.rtcSupported()) {
    finish('failed', { error: 'As chamadas ainda não funcionam neste aparelho. Atualiza a app ou usa outro browser.' });
    return;
  }
  let local: unknown;
  try {
    local = await rtc.openMedia(video, true);
  } catch (e) {
    if (g === gen) finish('failed', { error: errText(e, 'Sem acesso ao microfone.') });
    return;
  }
  if (g !== gen) return rtc.stopMedia(local);
  const camOn = video && rtc.hasVideoTrack(local);
  bump();
  set({ local, camOn, canFlip: camOn ? await rtc.canFlip() : false });
  void rtc.callAudio(true, video);
  try {
    const r = await callsApi.start(hint.username, video);
    if (g !== gen) {
      void callsApi.end(r.id).catch(() => undefined);
      return;
    }
    iceServers = await loadIce(r.iceServers);
    if (g !== gen) return;
    set({ callId: r.id, peer: r.peer ?? hint, video: r.video ?? video });
    startRingback();
    after('ring', RING_OUT_MS, () => {
      if (g !== gen || state.phase !== 'outgoing') return;
      void callsApi.end(r.id).catch(() => undefined);
      finish('no-answer');
    });
  } catch (e) {
    if (g !== gen) return;
    const status = e instanceof ApiError ? e.status : 0;
    finish(status === 409 ? 'busy' : status === 403 || status === 404 ? 'blocked' : 'failed', { error: errText(e, 'Não consegui ligar.') });
  }
}

/**
 * Mostra uma chamada a entrar (o ecrã por cima de tudo, com toque). Chamado pelo stream do chat e também pela notificação
 * push quando a app estava fechada.
 */
export function openIncomingCall({ callId, from: who, video }: { callId: string; from: CallPeer | string; video: boolean }) {
  if (!callId || done.has(callId)) return;
  // A notificação push só traz o username: o nome fica o @ e a foto tenta-se na mesma (sem foto ficam as iniciais).
  const from: CallPeer = typeof who === 'string' ? { username: who, displayName: who, hasAvatar: !!who } : who;
  if (state.callId === callId && state.phase !== 'ended') {
    set({ minimised: false });
    return;
  }
  if (state.phase === 'ended') reset();
  if (state.phase !== 'idle') {
    // Já estou noutra chamada: o servidor diz ao outro lado que estou ocupado.
    void callsApi.decline(callId).catch(() => undefined);
    return;
  }
  gen += 1;
  const g = gen;
  set({ ...IDLE, phase: 'incoming', outgoing: false, callId, peer: from, video, camOn: video, speaker: video });
  holdStream(true);
  startRinging();
  after('ring', RING_IN_MS, () => g === gen && state.phase === 'incoming' && finish('missed'));
  // Videochamada: a minha câmara da frente fica de fundo enquanto toca.
  if (video && rtc.rtcSupported()) {
    void rtc.openPreview(true).then((s) => {
      if (!s) return;
      if (g !== gen || state.phase !== 'incoming') return rtc.stopMedia(s);
      bump();
      set({ local: s });
    });
  }
}

/** Atende (com ou sem câmara). */
export async function acceptCall(withVideo = state.video): Promise<void> {
  if (state.phase !== 'incoming' || !state.callId) return;
  const g = gen;
  const id = state.callId;
  stopSounds();
  clear('ring');
  // A pré-visualização sai; abre-se o microfone (e a câmara, se for com vídeo).
  rtc.stopMedia(state.local);
  set({ phase: 'connecting', local: null, camOn: withVideo, speaker: withVideo || state.video });
  if (!rtc.rtcSupported()) {
    void callsApi.decline(id).catch(() => undefined);
    finish('failed', { error: 'As chamadas ainda não funcionam neste aparelho. Atualiza a app ou usa outro browser.' });
    return;
  }
  let local: unknown;
  try {
    local = await rtc.openMedia(withVideo, true);
  } catch (e) {
    if (g !== gen) return;
    void callsApi.end(id).catch(() => undefined);
    finish('failed', { error: errText(e, 'Sem acesso ao microfone.') });
    return;
  }
  if (g !== gen) return rtc.stopMedia(local);
  const camOn = withVideo && rtc.hasVideoTrack(local);
  bump();
  set({ local, camOn, canFlip: camOn ? await rtc.canFlip() : false });
  void rtc.callAudio(true, state.speaker);
  try {
    const r = await callsApi.accept(id);
    if (g !== gen) return;
    iceServers = await loadIce(r?.iceServers);
    if (g !== gen) return;
    polite = true;
    setupPeer();
  } catch (e) {
    if (g === gen) finish('failed', { error: errText(e, 'Não consegui atender.') });
  }
}

/** Recusa (com mensagem rápida opcional, que o servidor manda na conversa). */
export function declineCall(message?: string) {
  if (state.phase !== 'incoming' || !state.callId) return;
  void callsApi.decline(state.callId, message?.trim() || undefined).catch(() => undefined);
  reset();
}

/** Desligar (ou cancelar enquanto ainda está a chamar). */
export function hangUp() {
  if (state.phase === 'idle' || state.phase === 'ended') return;
  if (state.phase === 'incoming') return declineCall();
  if (state.callId) void callsApi.end(state.callId).catch(() => undefined);
  finish(state.phase === 'outgoing' ? 'cancelled' : 'hangup');
}

export function toggleMic() {
  const on = !state.micOn;
  rtc.setEnabled(state.local, 'audio', on);
  set({ micOn: on });
  sendState();
}

export async function toggleCamera() {
  const on = !state.camOn;
  if (on && !rtc.hasVideoTrack(state.local)) {
    if (!pc || !state.local) return;
    const g = gen;
    try {
      await rtc.addVideoTrack(pc, state.local, state.front);
    } catch (e) {
      if (g === gen) set({ error: errText(e, 'Não consegui ligar a câmara.') });
      return;
    }
    if (g !== gen) return;
    bump();
    set({ camOn: true, video: true, canFlip: await rtc.canFlip(), error: null });
  } else {
    rtc.setEnabled(state.local, 'video', on);
    set({ camOn: on });
  }
  sendState();
}

export async function flipCamera() {
  if (!rtc.hasVideoTrack(state.local)) return;
  try {
    await rtc.flipCamera(pc, state.local, state.front);
    bump();
    set({ front: !state.front });
  } catch { /* fica a mesma câmara */ }
}

export function toggleSpeaker() {
  const on = !state.speaker;
  set({ speaker: on });
  void rtc.callAudio(true, on);
}

export function minimiseCall() {
  if (state.phase !== 'idle' && state.phase !== 'ended') set({ minimised: true });
}
export function expandCall() {
  set({ minimised: false });
}
/** Fecha já o ecrã final. */
export function dismissEnded() {
  if (state.phase === 'ended') reset();
}

export const speakerSelectable = rtc.speakerSelectable;
export { VideoView } from './webrtc';

/** "02:31" (ou "1:02:31" acima de uma hora). */
export function fmtDuration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${String(m).padStart(2, '0')}:${ss}`;
}
