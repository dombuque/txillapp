/**
 * O LiveKit no telemóvel (Android e iPhone): o @livekit/react-native por cima do @livekit/react-native-webrtc (o fork da
 * LiveKit do react-native-webrtc, que também serve as chamadas; o original já não está instalado). O site usa o
 * txilladaLive.web.ts (o bundle da web nunca importa os módulos nativos).
 *
 * Os módulos são carregados só quando se entra numa Txillada, e dentro de try: o @livekit/react-native mete polyfills
 * globais (TextEncoder, DOMException…) que o resto da app não precisa de ter desde o arranque.
 */
import { PermissionsAndroid, Platform } from 'react-native';

type LK = typeof import('livekit-client');
type RN = typeof import('@livekit/react-native');

let loaded: Promise<{ lk: LK; rn: RN }> | null = null;

/** Carrega o LiveKit (uma vez): regista os globais do WebRTC e devolve o livekit-client. */
export function loadLiveKit(): Promise<LK> {
  loaded ??= (async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const rn = require('@livekit/react-native') as RN;
    rn.registerGlobals();
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const lk = require('livekit-client') as LK;
    return { lk, rn };
  })().catch((e) => {
    loaded = null;
    console.warn('[txillada] livekit', e);
    throw new Error('A Txillada chega na próxima versão da app. Atualiza o Txillapp.');
  });
  return loaded.then((m) => m.lk);
}

/** O componente nativo que mostra um vídeo do LiveKit (o VideoView do @livekit/react-native), ou null sem o módulo. */
export function nativeVideoView(): RN['VideoView'] | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return (require('@livekit/react-native') as RN).VideoView;
  } catch {
    return null;
  }
}

const CAM_DENIED = 'Sem acesso à câmara e ao microfone. Dá permissão ao Txillapp para abrires uma Txillada.';
const CAM_BLOCKED = 'A câmara ou o microfone estão bloqueados para o Txillapp. Ativa-os nas Definições do telemóvel > Apps > Txillapp > Permissões.';

/**
 * Câmara e microfone para transmitir. No Android pedem-se antes do getUserMedia (como nas chamadas, lib/calls/webrtc): o
 * pedido do próprio WebRTC fica numa fila e pode não responder. No iPhone o sistema pergunta no getUserMedia.
 */
export async function askBroadcast(): Promise<void> {
  if (Platform.OS !== 'android') return;
  const r = await PermissionsAndroid.requestMultiple([PermissionsAndroid.PERMISSIONS.CAMERA, PermissionsAndroid.PERMISSIONS.RECORD_AUDIO]).catch(() => null);
  if (!r) throw new Error(CAM_DENIED);
  const vals = Object.values(r);
  if (vals.some((v) => v === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN)) throw new Error(CAM_BLOCKED);
  if (vals.some((v) => v !== PermissionsAndroid.RESULTS.GRANTED)) throw new Error(CAM_DENIED);
}

/** Erros do WebRTC em português (vêm em inglês). */
export function mediaError(e: unknown): Error {
  const n = (e as { name?: string })?.name ?? '';
  const msg = (e as { message?: string })?.message ?? '';
  if ([CAM_DENIED, CAM_BLOCKED].includes(msg)) return e as Error;
  if (n === 'NotAllowedError' || n === 'SecurityError' || /permission/i.test(msg)) return new Error(CAM_DENIED);
  if (n === 'NotReadableError' || /busy|in use/i.test(msg)) return new Error('A câmara ou o microfone estão ocupados noutra app.');
  return new Error(`Não consegui abrir a câmara${msg ? ` (${msg})` : ''}.`);
}

/**
 * O áudio do telemóvel para a Txillada: quem transmite fala (modo de comunicação, pelo altifalante); quem vê ouve como um
 * vídeo (o volume dos media). `on = false` à saída.
 */
export async function liveAudio(on: boolean, host: boolean): Promise<void> {
  try {
    await loadLiveKit();
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { AudioSession, AndroidAudioTypePresets } = require('@livekit/react-native') as RN;
    if (!on) {
      await AudioSession.stopAudioSession();
      return;
    }
    await AudioSession.configureAudio({
      android: { preferredOutputList: ['bluetooth', 'headset', 'speaker'], audioTypeOptions: host ? AndroidAudioTypePresets.communication : AndroidAudioTypePresets.media },
      ios: { defaultOutput: 'speaker' },
    });
    await AudioSession.startAudioSession();
  } catch (e) {
    console.warn('[txillada] audio', e);
  }
}

/** No telemóvel o som de quem transmite toca sozinho (o WebRTC trata disso). */
export function attachAudio(_track: unknown): () => void {
  return () => undefined;
}

/**
 * No telemóvel o som nunca fica à espera de um toque: o `room.canPlaybackAudio` do livekit-client vem falso no React
 * Native (não há regras de autoplay; o WebRTC toca o som sozinho) e o «Toca para ouvir» ficava no meio do vídeo.
 */
export const audioNeedsTap = false;

/**
 * Quem vê no telemóvel recebe o vídeo sem o «adaptive stream» do livekit-client: o vídeo ocupa o ecrã todo (pediria a
 * camada de cima de qualquer maneira) e, com ele ligado, o VideoView do @livekit/react-native mede-se de segundo a
 * segundo (ViewPortDetector) e manda PARAR o vídeo no servidor se a medida vier a 0 (o ecrã ficaria preto, sem erro).
 */
export const adaptiveVideo = false;

/** A câmara para transmitir: no telemóvel o WebRTC roda as imagens (720p ao alto). */
export const captureResolution = { width: 1280, height: 720, frameRate: 30 };

/** Virar a câmara: no telemóvel a faixa troca de câmara sem a fechar. */
export async function flipTrack(track: { mediaStreamTrack: MediaStreamTrack; restartTrack: (o?: { facingMode?: 'user' | 'environment' }) => Promise<void> }, front: boolean): Promise<void> {
  const t = track.mediaStreamTrack as unknown as { _switchCamera?: () => void };
  if (typeof t._switchCamera === 'function') t._switchCamera();
  else await track.restartTrack({ facingMode: front ? 'user' : 'environment' });
}
