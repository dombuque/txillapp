/**
 * WebRTC no telemóvel (Android e iPhone) com o react-native-webrtc. O site usa o webrtc.web.ts (o bundle da web nunca importa
 * o react-native-webrtc).
 *
 * O módulo nativo é carregado só quando é preciso e dentro de try: uma app instalada antes de o módulo existir (APK antigo)
 * não rebenta ao arrancar; simplesmente diz que as chamadas ainda não estão disponíveis nesta versão.
 */
import { setAudioModeAsync } from 'expo-audio';
import { createElement } from 'react';
import { View } from 'react-native';
import type { IceServer } from './types';
import type { PeerLike, VideoViewProps } from './peer';

type RTC = typeof import('react-native-webrtc');
type NStream = import('react-native-webrtc').MediaStream;

let mod: RTC | null | undefined;
function rtc(): RTC | null {
  if (mod === undefined) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      mod = require('react-native-webrtc') as RTC;
    } catch {
      mod = null;
    }
  }
  return mod;
}

/** Esta instalação da app tem o WebRTC (o módulo nativo entrou no build). */
export const rtcSupported = () => !!rtc();

export function createPeer(iceServers: IceServer[]): PeerLike {
  const m = rtc();
  if (!m) throw new Error('As chamadas chegam na próxima versão da app. Atualiza o Txillapp.');
  return new m.RTCPeerConnection({ iceServers, bundlePolicy: 'max-bundle' }) as unknown as PeerLike;
}

const videoConstraints = (front: boolean) => ({ facingMode: front ? 'user' : 'environment', width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } });

/** Microfone (e câmara, se `video`). */
export async function openMedia(video: boolean, front: boolean): Promise<unknown> {
  const m = rtc();
  if (!m) throw new Error('As chamadas chegam na próxima versão da app. Atualiza o Txillapp.');
  return m.mediaDevices.getUserMedia({ audio: true, video: video ? videoConstraints(front) : false });
}

/** Só a câmara (para a pré-visualização do ecrã de chamada a entrar), e só se já houver autorização: não pede enquanto toca. */
export async function openPreview(front: boolean): Promise<unknown> {
  const m = rtc();
  if (!m) return null;
  try {
    const ok = await m.permissions.query({ name: 'camera' });
    if (ok !== true && ok !== 'granted') return null;
    return await m.mediaDevices.getUserMedia({ audio: false, video: videoConstraints(front) });
  } catch {
    return null;
  }
}

export function addTracks(pc: PeerLike, local: unknown) {
  const s = local as NStream;
  for (const t of s.getTracks()) (pc as unknown as InstanceType<RTC['RTCPeerConnection']>).addTrack(t, s);
}

/** Liga a câmara a meio da chamada (quem atendeu só com voz): junta a faixa de vídeo e o WebRTC renegoceia. */
export async function addVideoTrack(pc: PeerLike, local: unknown, front: boolean): Promise<void> {
  const m = rtc();
  if (!m) return;
  const s = local as NStream;
  const cam = await m.mediaDevices.getUserMedia({ audio: false, video: videoConstraints(front) });
  const track = cam.getVideoTracks()[0];
  if (!track) return;
  s.addTrack(track);
  (pc as unknown as InstanceType<RTC['RTCPeerConnection']>).addTrack(track, s);
}

export const hasVideoTrack = (local: unknown) => !!local && (local as NStream).getVideoTracks().length > 0;

export function setEnabled(local: unknown, kind: 'audio' | 'video', on: boolean) {
  if (!local) return;
  const s = local as NStream;
  for (const t of kind === 'audio' ? s.getAudioTracks() : s.getVideoTracks()) t.enabled = on;
}

/** Vira a câmara (frente ↔ trás). No telemóvel a faixa troca de câmara sem renegociar. */
export async function flipCamera(_pc: PeerLike | null, local: unknown, _front: boolean): Promise<void> {
  const t = (local as NStream | null)?.getVideoTracks()[0];
  t?._switchCamera();
}

export const canFlip = async () => true;

export function stopMedia(stream: unknown) {
  const s = stream as NStream | null;
  if (!s) return;
  for (const t of s.getTracks()) {
    try { t.stop(); } catch { /* já parada */ }
  }
  try { s.release(); } catch { /* nada */ }
}

/** O stream remoto de um evento "track" (o react-native-webrtc traz sempre o stream do outro lado). */
export function remoteFromTrack(e: { track: unknown; streams?: readonly unknown[] }, current: unknown | null): unknown {
  const s = e.streams?.[0];
  if (s) return s;
  const m = rtc();
  if (current) {
    (current as NStream).addTrack(e.track as never);
    return current;
  }
  return m ? new m.MediaStream([e.track as never]) : null;
}

/** No telemóvel o som do outro lado toca sozinho (o WebRTC trata disso). */
export function playRemote(_stream: unknown | null) {}

/** Prepara o áudio para a chamada: gravar e falar, pelo altifalante ou pelo auscultador. */
export async function callAudio(on: boolean, speaker: boolean): Promise<void> {
  try {
    if (on) await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true, shouldRouteThroughEarpiece: !speaker, interruptionMode: 'doNotMix', shouldPlayInBackground: true });
    else await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true, shouldRouteThroughEarpiece: false, interruptionMode: 'mixWithOthers', shouldPlayInBackground: false });
  } catch { /* sem modo de áudio: fica o padrão */ }
}

/** Há altifalante para escolher (no telemóvel, sim). */
export const speakerSelectable = true;

/** Mostra um stream (câmara minha ou do outro lado). */
export function VideoView({ stream, mirror, cover = true, zOrder, style }: VideoViewProps) {
  const m = rtc();
  if (!m || !stream) return createElement(View, { style: [{ backgroundColor: '#000' }, style] });
  return createElement(m.RTCView, { streamURL: (stream as NStream).toURL(), mirror: !!mirror, objectFit: cover ? 'cover' : 'contain', zOrder: zOrder ?? 0, style: [{ backgroundColor: '#000' }, style] });
}
