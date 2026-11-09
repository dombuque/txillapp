import type { StyleProp, ViewStyle } from 'react-native';

/**
 * O mínimo comum entre o RTCPeerConnection do browser e o do react-native-webrtc. O gestor da chamada (session.ts) só fala com
 * isto; cada plataforma (webrtc.ts no telemóvel, webrtc.web.ts no site) faz a ponte.
 */
export interface SdpLike { type: string; sdp?: string }

export interface DataChannelLike {
  readyState: string;
  send(data: string): void;
  close(): void;
  addEventListener(type: 'message' | 'open' | 'close', f: (e: { data?: unknown }) => void): void;
}

export interface PeerLike {
  readonly signalingState: string;
  readonly connectionState: string;
  readonly iceConnectionState: string;
  readonly remoteDescription: SdpLike | null;
  createOffer(): Promise<SdpLike>;
  createAnswer(): Promise<SdpLike>;
  setLocalDescription(d: SdpLike): Promise<void>;
  setRemoteDescription(d: SdpLike): Promise<void>;
  addIceCandidate(c: unknown): Promise<void>;
  addEventListener(type: 'icecandidate' | 'track' | 'negotiationneeded' | 'connectionstatechange' | 'iceconnectionstatechange', f: (e: never) => void): void;
  createDataChannel(label: string, init: { negotiated: boolean; id: number; ordered?: boolean }): DataChannelLike;
  restartIce?(): void;
  close(): void;
}

/** Evento "track" (só o que usamos). */
export interface TrackEventLike { track: { kind: string; id: string }; streams?: readonly unknown[] }
/** Evento "icecandidate". */
export interface IceEventLike { candidate: { toJSON?: () => unknown } | null }

export interface VideoViewProps {
  stream: unknown | null;
  /** Espelhar (a minha câmara da frente). */
  mirror?: boolean;
  /** Preencher (corta) ou caber inteiro. */
  cover?: boolean;
  /** Ordem por cima de outros vídeos (Android: a janelinha fica por cima). */
  zOrder?: number;
  style?: StyleProp<ViewStyle>;
}
