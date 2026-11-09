/**
 * WebRTC no site: as APIs do próprio browser (RTCPeerConnection, getUserMedia) e elementos <video>.
 * O som do outro lado toca num <audio> escondido (as chamadas de voz não mostram vídeo nenhum).
 */
import { createElement, useEffect, useRef } from 'react';
import { View } from 'react-native';
import type { IceServer } from './types';
import type { PeerLike, VideoViewProps } from './peer';

export const rtcSupported = () => typeof window !== 'undefined' && typeof window.RTCPeerConnection === 'function' && !!navigator.mediaDevices?.getUserMedia;

/** `relayOnly`: só pelo TURN (o outro lado não vê o IP desta pessoa). */
export function createPeer(iceServers: IceServer[], relayOnly = false): PeerLike {
  if (!rtcSupported()) throw new Error('Este browser não faz chamadas. Experimenta o Chrome, o Safari ou a app.');
  return new RTCPeerConnection({ iceServers, bundlePolicy: 'max-bundle', iceTransportPolicy: relayOnly ? 'relay' : 'all' }) as unknown as PeerLike;
}

const videoConstraints = (front: boolean): MediaTrackConstraints => ({ facingMode: front ? 'user' : 'environment', width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } });

function explain(e: unknown): Error {
  const n = (e as { name?: string })?.name;
  if (n === 'NotAllowedError' || n === 'SecurityError') return new Error('Sem acesso ao microfone ou à câmara. Dá permissão no browser e tenta outra vez.');
  if (n === 'NotFoundError' || n === 'OverconstrainedError') return new Error('Não encontrei microfone ou câmara neste aparelho.');
  if (n === 'NotReadableError') return new Error('O microfone ou a câmara estão ocupados noutra app.');
  return e instanceof Error ? e : new Error('Não consegui abrir o microfone.');
}

export async function openMedia(video: boolean, front: boolean): Promise<unknown> {
  if (!rtcSupported()) throw new Error('Este browser não faz chamadas. Experimenta o Chrome, o Safari ou a app.');
  const audio: MediaTrackConstraints = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
  try {
    return await navigator.mediaDevices.getUserMedia({ audio, video: video ? videoConstraints(front) : false });
  } catch (e) {
    // Sem câmara (ou recusada) numa videochamada: entra só com voz em vez de falhar.
    if (video) {
      try { return await navigator.mediaDevices.getUserMedia({ audio, video: false }); } catch { /* cai no erro de baixo */ }
    }
    throw explain(e);
  }
}

/** Pré-visualização só se a câmara já tiver autorização (não se pede permissão enquanto toca). */
export async function openPreview(front: boolean): Promise<unknown> {
  if (!rtcSupported()) return null;
  try {
    const p = await navigator.permissions?.query({ name: 'camera' as PermissionName });
    if (p && p.state !== 'granted') return null;
  } catch { /* o browser não sabe dizer (Firefox, Safari antigo): tenta na mesma */ }
  try {
    return await navigator.mediaDevices.getUserMedia({ audio: false, video: videoConstraints(front) });
  } catch {
    return null;
  }
}

export function addTracks(pc: PeerLike, local: unknown) {
  const s = local as MediaStream;
  for (const t of s.getTracks()) (pc as unknown as RTCPeerConnection).addTrack(t, s);
}

export async function addVideoTrack(pc: PeerLike, local: unknown, front: boolean): Promise<void> {
  const s = local as MediaStream;
  let cam: MediaStream;
  try {
    cam = await navigator.mediaDevices.getUserMedia({ audio: false, video: videoConstraints(front) });
  } catch (e) {
    throw explain(e);
  }
  const track = cam.getVideoTracks()[0];
  if (!track) return;
  s.addTrack(track);
  (pc as unknown as RTCPeerConnection).addTrack(track, s);
}

export const hasVideoTrack = (local: unknown) => !!local && (local as MediaStream).getVideoTracks().length > 0;

export function setEnabled(local: unknown, kind: 'audio' | 'video', on: boolean) {
  if (!local) return;
  const s = local as MediaStream;
  for (const t of kind === 'audio' ? s.getAudioTracks() : s.getVideoTracks()) t.enabled = on;
}

/** No browser não há "trocar de câmara": abre-se a outra e troca-se a faixa enviada (sem renegociar). */
export async function flipCamera(pc: PeerLike | null, local: unknown, front: boolean): Promise<void> {
  const s = local as MediaStream | null;
  const old = s?.getVideoTracks()[0];
  if (!s || !old) return;
  const cam = await navigator.mediaDevices.getUserMedia({ audio: false, video: videoConstraints(!front) });
  const track = cam.getVideoTracks()[0];
  if (!track) return;
  track.enabled = old.enabled;
  const sender = pc ? (pc as unknown as RTCPeerConnection).getSenders().find((x) => x.track === old) : undefined;
  if (sender) await sender.replaceTrack(track);
  s.removeTrack(old);
  old.stop();
  s.addTrack(track);
}

/** Só mostra "virar câmara" com mais de uma câmara (no computador quase nunca). */
export async function canFlip(): Promise<boolean> {
  try {
    const list = await navigator.mediaDevices.enumerateDevices();
    return list.filter((d) => d.kind === 'videoinput').length > 1;
  } catch {
    return false;
  }
}

export function stopMedia(stream: unknown) {
  const s = stream as MediaStream | null;
  if (!s) return;
  for (const t of s.getTracks()) t.stop();
}

export function remoteFromTrack(e: { track: unknown; streams?: readonly unknown[] }, current: unknown | null): unknown {
  const s = e.streams?.[0];
  if (s) return s;
  const cur = (current as MediaStream | null) ?? new MediaStream();
  cur.addTrack(e.track as MediaStreamTrack);
  return cur;
}

let audioEl: HTMLAudioElement | null = null;
/** O som do outro lado (num <audio> escondido, para tocar também nas chamadas de voz). */
export function playRemote(stream: unknown | null) {
  if (typeof document === 'undefined') return;
  if (!stream) {
    if (audioEl) {
      audioEl.srcObject = null;
      audioEl.remove();
      audioEl = null;
    }
    return;
  }
  if (!audioEl) {
    audioEl = document.createElement('audio');
    audioEl.autoplay = true;
    audioEl.setAttribute('playsinline', '');
    audioEl.style.display = 'none';
    document.body.appendChild(audioEl);
  }
  if (audioEl.srcObject !== stream) audioEl.srcObject = stream as MediaStream;
  void audioEl.play().catch(() => undefined);
}

/** No browser o som sai por onde o sistema mandar. */
export async function callAudio(_on: boolean, _speaker: boolean): Promise<void> {}
export const speakerSelectable = false;

/** <video> com o stream (sempre sem som: o som vai pelo <audio> de cima). */
export function VideoView({ stream, mirror, cover = true, style }: VideoViewProps) {
  const ref = useRef<HTMLVideoElement | null>(null);
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    if (v.srcObject !== stream) v.srcObject = (stream as MediaStream | null) ?? null;
    if (stream) void v.play().catch(() => undefined);
  }, [stream]);
  return createElement(
    View,
    { style: [{ backgroundColor: '#000', overflow: 'hidden' }, style] },
    createElement('video', {
      ref,
      autoPlay: true,
      playsInline: true,
      muted: true,
      style: { position: 'absolute', left: 0, top: 0, width: '100%', height: '100%', objectFit: cover ? 'cover' : 'contain', transform: mirror ? 'scaleX(-1)' : undefined, backgroundColor: '#000' },
    }),
  );
}
