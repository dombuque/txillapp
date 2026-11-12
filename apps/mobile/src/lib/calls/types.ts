/** Tipos das chamadas 1:1 (voz e vídeo). O contrato do servidor está em ./api.ts. */
import type { AudioRoute } from './speaker';

export interface CallPeer { username: string; displayName: string; hasAvatar: boolean; /** Selo de verificado (o mesmo par dos posts e do perfil). */ verified?: boolean; verifiedTier?: 'verified' | 'official' | 'paid' | null }

export interface IceServer { urls: string | string[]; username?: string; credential?: string }

export type CallPhase = 'idle' | 'outgoing' | 'incoming' | 'connecting' | 'active' | 'ended';

/** Porque é que a chamada acabou (para o texto do ecrã final). */
export type EndReason = 'hangup' | 'remote' | 'declined' | 'busy' | 'missed' | 'no-answer' | 'failed' | 'cancelled' | 'elsewhere' | 'blocked';

export interface CallState {
  phase: CallPhase;
  callId: string | null;
  peer: CallPeer | null;
  /** Fui eu que liguei. */
  outgoing: boolean;
  /** Quem liga: um aparelho do outro lado já disse que a chamada lhe chegou («A tocar…» em vez de «A chamar…»). */
  delivered: boolean;
  /** Quem liga: passaram 15 s sem chegar a nenhum aparelho do outro lado («Sem resposta do telemóvel de X»). */
  unreachable: boolean;
  /** A chamada tem vídeo (pedido ao ligar, ou alguém ligou a câmara depois). */
  video: boolean;
  micOn: boolean;
  camOn: boolean;
  /** Câmara da frente (selfie). */
  front: boolean;
  /** Altifalante pedido (viva-voz). Começa ligado só nas videochamadas. */
  speaker: boolean;
  /** Por onde o telemóvel diz que o som está a sair (null: ainda não disse, ou na web). */
  audioRoute: AudioRoute | null;
  /** Dá para virar a câmara (no computador com uma só câmara, não). */
  canFlip: boolean;
  /** Streams opacos: MediaStream do browser ou do react-native-webrtc. Só o VideoView da plataforma os sabe mostrar. */
  local: unknown | null;
  remote: unknown | null;
  /** O que o outro lado diz de si (pelo canal de dados): null enquanto não se sabe. */
  remoteMic: boolean | null;
  remoteCam: boolean | null;
  /** Quando ligou de facto (para o cronómetro). */
  startedAt: number | null;
  endedAt: number | null;
  endReason: EndReason | null;
  /** Ecrã da chamada minimizado (a pílula por cima da app). */
  minimised: boolean;
  /** Recusa com mensagem que o outro lado mandou (quando recusa). */
  message: string | null;
  error: string | null;
}

/** Evento de chamada que chega no stream do chat (GET /chat/stream). */
export interface CallEvent {
  type: 'call';
  /** `ringing`: para quem liga, a chamada chegou a um aparelho de quem recebe. */
  event: 'ring' | 'ringing' | 'accepted' | 'declined' | 'ended' | 'signal';
  callId: string;
  video?: boolean;
  from?: CallPeer;
  reason?: string;
  message?: string;
  signal?: { type: 'offer' | 'answer' | 'ice'; data: unknown };
}

/** Uma linha do histórico de chamadas (GET /calls). */
export interface CallLogItem {
  id: string;
  video: boolean;
  /** 'out' = liguei eu. */
  direction: 'in' | 'out';
  status: 'ringing' | 'active' | 'declined' | 'cancelled' | 'missed' | 'ended';
  /** O outro lado ("Conta eliminada" se a conta já não existe). */
  peer: CallPeer;
  startedAt: string;
  /** Duração em segundos (só nas que foram atendidas). */
  durationS: number | null;
}
