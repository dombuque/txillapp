/**
 * O viva-voz (altifalante) das chamadas: a regra, sem react-native, para os testes.
 *
 * - Chamada de voz: começa no auscultador (altifalante desligado). Videochamada: começa no altifalante.
 * - Auscultadores com fio ou Bluetooth: o som vai para eles e o botão apaga-se. Ao tirá-los, volta ao que faz sentido
 *   para a chamada (vídeo com a câmara ligada → altifalante; voz → auscultador).
 * - No fim da chamada repõe-se o áudio normal do telemóvel (uma só vez).
 *
 * Onde aparece o botão:
 * - app (Android e iPhone): sempre, como interruptor «Altifalante»;
 * - site/PWA num browser que deixa escolher a saída (setSinkId + enumerateDevices com 2 saídas ou mais, Chrome no
 *   computador): como escolha da saída do som;
 * - PWA no iPhone/iPad: não aparece. O Safari não dá forma fiável de trocar entre auscultador e altifalante numa
 *   chamada WebRTC (ver o relatório do ramo viva-voz); o som sai por onde o iOS decidir.
 */

/** Por onde está a sair o som da chamada. */
export type AudioRoute = 'speaker' | 'earpiece' | 'wired' | 'bluetooth' | 'unknown';
/** Auscultadores ligados ao telemóvel (com fio ou Bluetooth), ou nenhum. */
export type Headset = 'wired' | 'bluetooth' | null;

export interface AudioReport { route: AudioRoute; headset: Headset }

/** O que os módulos nativos (modules/call-service: Android em Kotlin, iPhone em Swift) sabem fazer com o som. */
export interface SpeakerNative {
  /** Liga ou desliga o altifalante; devolve a rota em que ficou. */
  setSpeaker(on: boolean): string | void;
  /** Repõe o áudio normal (fim da chamada). */
  resetAudio(): void;
}

/** Estado inicial do altifalante pelo tipo de chamada. */
export const initialSpeaker = (video: boolean) => !!video;

/** O botão aceso? Quando o módulo nativo já disse por onde sai o som, manda a rota; senão, o que se pediu. */
export function speakerLit(speaker: boolean, route: AudioRoute | null | undefined): boolean {
  if (!route || route === 'unknown') return !!speaker;
  return route === 'speaker';
}

export const speakerLabel = (lit: boolean) => (lit ? 'Altifalante ligado' : 'Altifalante desligado');

/** Como aparece o botão nesta plataforma. */
export type SpeakerUi = 'toggle' | 'picker' | 'none';

export interface SpeakerEnv {
  /** Platform.OS */
  os: string;
  /** Só na web: é um iPhone/iPad (Safari ou PWA no ecrã principal). */
  appleMobileWeb?: boolean;
  /** Só na web: HTMLMediaElement.prototype.setSinkId e mediaDevices.enumerateDevices existem. */
  sinkSupported?: boolean;
  /** Só na web: quantas saídas de som diferentes o browser listou. */
  outputs?: number;
}

export function speakerUi(env: SpeakerEnv): SpeakerUi {
  if (env.os === 'android' || env.os === 'ios') return 'toggle';
  if (env.os !== 'web') return 'none';
  if (env.appleMobileWeb) return 'none';
  return env.sinkSupported && (env.outputs ?? 0) >= 2 ? 'picker' : 'none';
}

/** iPhone, iPod ou iPad (o iPadOS diz-se «Macintosh» mas tem ecrã tátil). */
export function isAppleMobile(ua: string, platform = '', maxTouchPoints = 0): boolean {
  if (/iPhone|iPod|iPad/i.test(ua)) return true;
  return (platform === 'MacIntel' || /Macintosh/.test(ua)) && maxTouchPoints > 1;
}

/**
 * O que fazer quando o telemóvel avisa que mudou a saída de som (ligaram ou tiraram auscultadores).
 * Devolve o novo valor do altifalante, ou null para deixar como está.
 * - Auscultadores novos (ou já ligados ao começar a chamada): o som vai para eles → altifalante desligado.
 * - Tirou os auscultadores: volta ao altifalante só se estiver com a câmara ligada.
 */
export function speakerAfterRoute(prev: Headset | undefined, now: AudioReport, camOn: boolean): boolean | null {
  if (now.headset && now.headset !== prev) return false;
  if (!now.headset && prev) return initialSpeaker(camOn);
  return null;
}

/** Normaliza o que vem do módulo nativo (strings soltas). */
export function parseReport(raw: { route?: unknown; headset?: unknown } | null | undefined): AudioReport {
  const r = String(raw?.route ?? 'unknown');
  const h = String(raw?.headset ?? '');
  return {
    route: (['speaker', 'earpiece', 'wired', 'bluetooth'] as const).includes(r as never) ? (r as AudioRoute) : 'unknown',
    headset: h === 'wired' || h === 'bluetooth' ? h : null,
  };
}

/**
 * O áudio da chamada no telemóvel, na ordem certa.
 * `mode(on, speaker)` é o modo de áudio do expo-audio (gravar e falar, e o auscultador ou o altifalante). Com o módulo
 * nativo, o expo-audio fica sempre no modo de comunicação («auscultador») e quem escolhe a saída é o módulo:
 * no Android o setCommunicationDevice (12+) ou o isSpeakerphoneOn; no iPhone o overrideOutputAudioPort.
 * Sem o módulo (APK antigo), fica só o expo-audio, como antes.
 */
export function createCallAudio(mode: (on: boolean, speaker: boolean) => Promise<void>, native: SpeakerNative | null) {
  let active = false;
  let want = false;
  let seq = 0;
  const push = () => {
    if (!native) return;
    try { native.setSpeaker(want); } catch { /* módulo antigo: fica o expo-audio */ }
  };
  return {
    /** Começa (ou continua) a chamada com o altifalante `speaker`. */
    async start(speaker: boolean): Promise<void> {
      want = speaker;
      if (active) {
        if (native) push();
        else await mode(true, want);
        return;
      }
      active = true;
      const my = ++seq;
      await mode(true, native ? false : want);
      // Se entretanto se tocou no botão (ou a chamada acabou), vale o último pedido.
      if (my !== seq || !active) return;
      push();
    },
    /** Fim da chamada: repõe o modo normal e larga a saída escolhida. Só uma vez. */
    async end(): Promise<void> {
      if (!active) return;
      active = false;
      seq += 1;
      want = false;
      await mode(false, false);
      if (native) {
        try { native.resetAudio(); } catch { /* nada a repor */ }
      }
    },
    isActive: () => active,
    wanted: () => want,
  };
}
