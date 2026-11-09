import { post, raw, type Page } from '@/lib/api';
import type { CallLogItem, CallPeer, IceServer } from './types';

/** Pedidos das chamadas (POST /api/v1/calls…). A sinalização WebRTC vai por /signal e chega ao outro lado pelo stream do chat. */
export const callsApi = {
  start: (username: string, video: boolean): Promise<{ id: string; video: boolean; peer: CallPeer; iceServers?: IceServer[] }> => raw('/calls', post({ username, video })),
  accept: (id: string): Promise<{ iceServers?: IceServer[] }> => raw(`/calls/${encodeURIComponent(id)}/accept`, post({})),
  decline: (id: string, message?: string): Promise<void> => raw(`/calls/${encodeURIComponent(id)}/decline`, post(message ? { message } : {})),
  end: (id: string): Promise<void> => raw(`/calls/${encodeURIComponent(id)}/end`, post({})),
  signal: (id: string, type: 'offer' | 'answer' | 'ice', data: unknown): Promise<void> => raw(`/calls/${encodeURIComponent(id)}/signal`, post({ type, data })),
  ice: (): Promise<{ iceServers: IceServer[] }> => raw('/calls/ice'),
  history: (cursor?: string): Promise<Page<CallLogItem>> => raw(`/calls${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`),
};
