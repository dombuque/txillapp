/**
 * O LiveKit no site e no PWA: o livekit-client direto no browser (o WebRTC do browser). O telemóvel usa o
 * txilladaLive.ts (com o @livekit/react-native). O livekit-client só é descarregado quando se entra numa Txillada.
 */

type LK = typeof import('livekit-client');

let loaded: Promise<LK> | null = null;

export function loadLiveKit(): Promise<LK> {
  loaded ??= import('livekit-client').catch((e) => {
    loaded = null;
    console.warn('[txillada] livekit', e);
    throw new Error('Não consegui abrir a Txillada. Recarrega a página e tenta outra vez.');
  });
  return loaded;
}

/** No site o vídeo é um <video> (components/txillada/TxilladaVideo.web.tsx). */
export function nativeVideoView(): null {
  return null;
}

const CAM_DENIED = 'Sem acesso à câmara e ao microfone. Dá permissão ao Txillapp no browser (o cadeado ao lado do endereço) para abrires uma Txillada.';

/** No browser a permissão é pedida no getUserMedia. */
export async function askBroadcast(): Promise<void> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) throw new Error('Este browser não deixa transmitir. Experimenta o Chrome, o Safari ou a app do Txillapp.');
}

export function mediaError(e: unknown): Error {
  const n = (e as { name?: string })?.name ?? '';
  const msg = (e as { message?: string })?.message ?? '';
  if (msg === CAM_DENIED) return e as Error;
  if (n === 'NotAllowedError' || n === 'SecurityError' || /permission/i.test(msg)) return new Error(CAM_DENIED);
  if (n === 'NotReadableError' || /busy|in use|could not start/i.test(msg)) return new Error('A câmara ou o microfone estão ocupados noutra janela ou app.');
  if (n === 'NotFoundError' || n === 'OverconstrainedError') return new Error('Não encontrei câmara ou microfone neste aparelho.');
  return new Error(`Não consegui abrir a câmara${msg ? ` (${msg})` : ''}.`);
}

/** No browser não há sessão de áudio para configurar. */
export async function liveAudio(_on: boolean, _host: boolean): Promise<void> {}

/** O som de quem transmite: um <audio> escondido na página (o livekit-client cria-o). Devolve a função que o tira. */
export function attachAudio(track: unknown): () => void {
  const t = track as { attach?: () => HTMLMediaElement; detach?: () => HTMLMediaElement[] };
  if (typeof t.attach !== 'function' || typeof document === 'undefined') return () => undefined;
  const el = t.attach();
  el.style.display = 'none';
  document.body.appendChild(el);
  return () => {
    try { t.detach?.().forEach((x) => x.remove()); } catch { /* já saiu */ }
    el.remove();
  };
}

/** No browser o som pode ficar bloqueado (as regras do autoplay) até um toque: o «Toca para ouvir». */
export const audioNeedsTap = true;

/** No browser quem vê usa o «adaptive stream» (o vídeo pára com o separador escondido e segue o tamanho do <video>). */
export const adaptiveVideo = true;

/** No browser pede-se logo ao alto (9:16): uma webcam deitada é cortada ao meio, como fica no cartão. */
export const captureResolution = { width: 720, height: 1280, frameRate: 30, aspectRatio: 9 / 16 };

type Restartable = {
  mediaStreamTrack?: MediaStreamTrack;
  restartTrack: (o?: { facingMode?: 'user' | 'environment'; resolution?: { width: number; height: number; frameRate?: number; aspectRatio?: number } }) => Promise<void>;
};

/** O ecrã está ao alto (um telemóvel)? Num computador fica-se com o que a câmara der. */
function portraitScreen(): boolean {
  if (typeof window === 'undefined') return false;
  return window.innerHeight > window.innerWidth;
}
function landscapeTrack(t: Restartable): boolean {
  const s = t.mediaStreamTrack?.getSettings?.();
  return !!s?.width && !!s?.height && s.width > s.height;
}

/**
 * Garante a imagem ao alto num telemóvel. O Safari do iPhone lê o `width`/`height` pedidos na orientação do sensor (deitado)
 * e, com 720×1280, podia escolher uma imagem deitada (4:3 ou 16:9): quem via recebia uma faixa deitada. Se a imagem vier
 * deitada com o telemóvel ao alto, pede-se outra vez com as medidas trocadas (1280×720, sem forma imposta), que o Safari
 * roda para o alto. No computador (ecrã deitado) não se mexe.
 */
export async function ensurePortrait(track: Restartable, front: boolean): Promise<void> {
  if (!portraitScreen() || !landscapeTrack(track)) return;
  try {
    await track.restartTrack({ facingMode: front ? 'user' : 'environment', resolution: { width: 1280, height: 720, frameRate: 30 } });
  } catch { /* fica a que estava (quem vê mostra-a inteira, com o fundo desfocado) */ }
}

/**
 * Virar a câmara: no browser abre-se a outra (frente/trás) com o mesmo track. As medidas vão outra vez (sem elas o
 * livekit-client voltava às de omissão, 1280×720 deitado) e confirma-se que fica ao alto.
 */
export async function flipTrack(track: Restartable, front: boolean): Promise<void> {
  await track.restartTrack({ facingMode: front ? 'user' : 'environment', resolution: captureResolution });
  await ensurePortrait(track, front);
}
