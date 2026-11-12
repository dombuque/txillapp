/**
 * WebRTC no telemóvel (Android e iPhone) com o react-native-webrtc. O site usa o webrtc.web.ts (o bundle da web nunca importa
 * o react-native-webrtc).
 *
 * O módulo nativo é carregado só quando é preciso e dentro de try: uma app instalada antes de o módulo existir (APK antigo)
 * não rebenta ao arrancar; simplesmente diz que as chamadas ainda não estão disponíveis nesta versão.
 */
import { requireOptionalNativeModule, type EventSubscription } from 'expo';
import { setAudioModeAsync } from 'expo-audio';
import { createElement } from 'react';
import { PermissionsAndroid, Platform, View, type Permission } from 'react-native';
import type { IceServer } from './types';
import type { AudioOutput, PeerLike, VideoViewProps } from './peer';
import { createCallAudio, parseReport, speakerUi, type AudioReport, type SpeakerNative, type SpeakerUi } from './speaker';

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

/** `relayOnly`: só pelo TURN (o outro lado não vê o IP desta pessoa). */
export function createPeer(iceServers: IceServer[], relayOnly = false): PeerLike {
  const m = rtc();
  if (!m) throw new Error('As chamadas chegam na próxima versão da app. Atualiza o Txillapp.');
  return new m.RTCPeerConnection({ iceServers, bundlePolicy: 'max-bundle', iceTransportPolicy: relayOnly ? 'relay' : 'all' }) as unknown as PeerLike;
}

const videoConstraints = (front: boolean) => ({ facingMode: front ? 'user' : 'environment', width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } });

type Ask = 'granted' | 'denied' | 'blocked' | 'stuck';

/**
 * Pede uma permissão no Android sem depender só da resposta do pedido: o PermissionsAndroid guarda um único ouvinte por
 * ecrã, e se outro pedido se cruzar (ou o ecrã da chamada abrir ao mesmo tempo) a resposta pode nunca chegar. Por isso,
 * enquanto espera, vai também vendo se a permissão já foi dada. Ninguém responde em 60 s: 'stuck'.
 */
async function askAndroid(perm: Permission): Promise<Ask> {
  try {
    if (await PermissionsAndroid.check(perm)) return 'granted';
  } catch { /* segue para o pedido */ }
  let done = false;
  const req = PermissionsAndroid.request(perm)
    .then((r): Ask => (r === PermissionsAndroid.RESULTS.GRANTED ? 'granted' : r === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN ? 'blocked' : 'denied'))
    .catch((): Ask => 'denied');
  const poll = new Promise<Ask>((resolve) => {
    const t0 = Date.now();
    const tick = () => {
      if (done) return;
      void PermissionsAndroid.check(perm).then((ok) => ok, () => false).then((ok) => {
        if (done) return;
        if (ok) resolve('granted');
        else if (Date.now() - t0 > 60_000) resolve('stuck');
        else setTimeout(tick, 700);
      });
    };
    setTimeout(tick, 700);
  });
  const r = await Promise.race([req, poll]);
  done = true;
  return r;
}

const MIC_DENIED = 'Sem acesso ao microfone. Dá permissão ao Txillapp e tenta outra vez.';
const MIC_BLOCKED = 'O microfone está bloqueado para o Txillapp. Ativa-o nas Definições do telemóvel > Apps > Txillapp > Permissões.';
const MIC_STUCK = 'O pedido de acesso ao microfone não respondeu. Fecha a app, abre outra vez e tenta de novo.';
const MIC_SLOW = 'O microfone não respondeu. Fecha outras apps que o estejam a usar e tenta outra vez.';

/** Erros do react-native-webrtc em português (vêm em inglês, ex. "Permission denied."). */
function explain(e: unknown): Error {
  const n = (e as { name?: string })?.name ?? '';
  const msg = (e as { message?: string })?.message ?? '';
  if ([MIC_DENIED, MIC_BLOCKED, MIC_STUCK, MIC_SLOW].includes(msg)) return e as Error;
  if (n === 'SecurityError' || n === 'NotAllowedError' || /permission/i.test(msg)) return new Error(MIC_DENIED);
  if (n === 'NotReadableError' || /busy|in use/i.test(msg)) return new Error('O microfone ou a câmara estão ocupados noutra app.');
  return new Error(`Não consegui abrir o microfone${msg ? ` (${msg})` : ''}.`);
}

/** Uma promessa que não pode ficar pendurada para sempre (quem liga vê um erro em vez de "A ligar…" sem fim). */
function within<T>(p: Promise<T>, ms: number, message: string, onLate?: (v: T) => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let late = false;
    const t = setTimeout(() => { late = true; reject(new Error(message)); }, ms);
    p.then(
      (v) => { if (late) onLate?.(v); else { clearTimeout(t); resolve(v); } },
      (e) => { if (!late) { clearTimeout(t); reject(e); } },
    );
  });
}

/** Microfone (e câmara, se `video`). Sem câmara (ou recusada) numa videochamada entra só com voz, como no site. */
export async function openMedia(video: boolean, front: boolean): Promise<unknown> {
  const m = rtc();
  if (!m) throw new Error('As chamadas chegam na próxima versão da app. Atualiza o Txillapp.');
  let cam = video;
  if (Platform.OS === 'android') {
    // Pedidas aqui, uma de cada vez, antes do getUserMedia: o pedido do próprio react-native-webrtc fica numa fila e,
    // se um pedido ficar sem resposta, todas as chamadas seguintes ficavam presas em "A ligar…" sem erro nenhum.
    const mic = await askAndroid(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO);
    if (mic === 'blocked') throw new Error(MIC_BLOCKED);
    if (mic === 'stuck') throw new Error(MIC_STUCK);
    if (mic !== 'granted') throw new Error(MIC_DENIED);
    if (cam) cam = (await askAndroid(PermissionsAndroid.PERMISSIONS.CAMERA)) === 'granted';
  }
  const open = (withCam: boolean): Promise<unknown> => {
    const p = m.mediaDevices.getUserMedia({ audio: true, video: withCam ? videoConstraints(front) : false });
    // No Android as permissões já estão dadas: abrir o microfone é coisa de um instante. No iPhone pode estar aberto o
    // pedido de permissão do sistema, por isso lá não há limite.
    return Platform.OS === 'android' ? within<unknown>(p, 15_000, MIC_SLOW, (s) => stopMedia(s)) : p;
  };
  try {
    return await open(cam);
  } catch (e) {
    console.warn('[calls] getUserMedia', e);
    if (cam) {
      try { return await open(false); } catch { /* cai no erro de baixo */ }
    }
    throw explain(e);
  }
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

/** O módulo local modules/call-service: no Android e no iPhone escolhe a saída do som. Num APK antigo não existe. */
interface TxAudioModule extends SpeakerNative {
  addListener?(event: 'onAudioRoute', listener: (e: { route?: string; headset?: string }) => void): EventSubscription;
}
const audioNative = Platform.OS === 'android' || Platform.OS === 'ios' ? requireOptionalNativeModule<TxAudioModule>('TxCallService') : null;
const speakerNative = audioNative && typeof audioNative.setSpeaker === 'function' && typeof audioNative.resetAudio === 'function' ? audioNative : null;

/** O modo de áudio do expo-audio: gravar e falar, e o auscultador (modo de comunicação) ou o altifalante. */
async function audioMode(on: boolean, speaker: boolean): Promise<void> {
  try {
    if (on) await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true, shouldRouteThroughEarpiece: !speaker, interruptionMode: 'doNotMix', shouldPlayInBackground: true });
    else await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true, shouldRouteThroughEarpiece: false, interruptionMode: 'mixWithOthers', shouldPlayInBackground: false });
  } catch { /* sem modo de áudio: fica o padrão */ }
}

const audio = createCallAudio(audioMode, speakerNative);

/**
 * Prepara o áudio para a chamada: gravar e falar, pelo altifalante ou pelo auscultador (ou pelos auscultadores
 * ligados). `on = false` no fim da chamada: repõe o áudio normal. A regra está em ./speaker.ts.
 */
export async function callAudio(on: boolean, speaker: boolean): Promise<void> {
  if (on) await audio.start(speaker);
  else await audio.end();
}

/** Avisos do telemóvel quando a saída do som muda (auscultadores ligados ou tirados). Devolve a função que desliga. */
export function onAudioRoute(listener: (r: AudioReport) => void): () => void {
  if (!speakerNative?.addListener) return () => undefined;
  try {
    const sub = speakerNative.addListener('onAudioRoute', (e) => listener(parseReport(e)));
    return () => sub.remove();
  } catch {
    return () => undefined;
  }
}

/** Como é o botão do altifalante: no telemóvel, um interruptor (Android e iPhone). */
export const speakerMode = (_outputs: readonly AudioOutput[] = []): SpeakerUi => speakerUi({ os: Platform.OS });

/** Só no site há saídas de som para escolher numa lista. */
export async function audioOutputs(): Promise<AudioOutput[]> {
  return [];
}
export async function setAudioOutput(_id: string): Promise<boolean> {
  return false;
}
export const currentAudioOutput = (): string => '';
export function onAudioOutputsChange(_f: () => void): () => void {
  return () => undefined;
}

/** Mostra um stream (câmara minha ou do outro lado). */
export function VideoView({ stream, mirror, cover = true, zOrder, style }: VideoViewProps) {
  const m = rtc();
  if (!m || !stream) return createElement(View, { style: [{ backgroundColor: '#000' }, style] });
  return createElement(m.RTCView, { streamURL: (stream as NStream).toURL(), mirror: !!mirror, objectFit: cover ? 'cover' : 'contain', zOrder: zOrder ?? 0, style: [{ backgroundColor: '#000' }, style] });
}
