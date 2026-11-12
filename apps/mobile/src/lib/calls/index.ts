/**
 * Chamadas 1:1 de voz e vídeo (site e app). Ver session.ts para o funcionamento.
 * `openIncomingCall` também é chamado pela notificação push quando a app estava fechada.
 */
export {
  acceptCall,
  audioOutputs,
  currentAudioOutput,
  declineCall,
  dismissEnded,
  dropIncoming,
  expandCall,
  flipCamera,
  fmtDuration,
  getCall,
  hangUp,
  minimiseCall,
  onAudioOutputsChange,
  onCallState,
  openIncomingCall,
  setAudioOutput,
  speakerMode,
  startCall,
  toggleCamera,
  toggleMic,
  toggleSpeaker,
  useCall,
  useStreamRev,
  VideoView,
} from './session';
export { callsApi } from './api';
export { speakerLabel, speakerLit } from './speaker';
export type { AudioOutput } from './peer';
export type { CallEvent, CallLogItem, CallPeer, CallPhase, CallState, EndReason } from './types';
