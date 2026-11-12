/** API dos grupos de chat (copiada do site, apps/web/src/lib/api.ts). Só usa o que a app já exporta em '@/lib/api'. */
import { post, raw, threadQuery, type Badged, type ChatMessage, type GroupSummary, type MsgKind } from '@/lib/api';
import { track, trackOk } from '@/lib/analytics';

export type { GroupSummary };
export type GroupRole = 'admin' | 'member';
export interface GroupMember extends Badged { username: string; displayName: string; hasAvatar: boolean; role: GroupRole }
export interface GroupSender extends Badged { username: string; displayName: string; hasAvatar: boolean }
export type GroupMessage = ChatMessage & { sender: GroupSender };
export interface GroupThread {
  /** `ttl`: mensagens temporárias (segundos) ou null; servidores antigos não mandam. */
  group: { id: string; name: string; myRole: GroupRole; members: GroupMember[]; ttl?: number | null };
  items: GroupMessage[];
  nextCursor: string | null;
}
export interface GroupSendBody {
  body?: string;
  kind?: MsgKind;
  mediaId?: string;
  durationMs?: number;
  waveform?: string;
  lat?: number;
  lng?: number;
  /** Localização de um sítio: o nome e a morada (opcionais). */
  name?: string;
  address?: string;
  replyTo?: string;
  /** GIF do GIPHY (kind 'gif'). */
  gif?: import('./gifs').ChatGif;
}

export const gruposApi = {
  list: (): Promise<GroupSummary[]> => raw('/chat/groups'),
  thread: (id: string, cursor?: string, read = true): Promise<GroupThread> => raw(`/chat/groups/${id}${threadQuery(cursor, read)}`),
  /** `expiresAt`: com as mensagens temporárias ligadas, quando a mensagem desaparece (null = fica). */
  send: (id: string, msg: GroupSendBody): Promise<{ id: string; expiresAt?: string | null }> =>
    trackOk(raw(`/chat/groups/${id}/messages`, post(msg)), 'message_send', () => {
      if (msg.kind === 'post') track('share', { target: 'chat' });
      return { kind: msg.kind ?? 'text', group: true };
    }),
  create: (name: string, members: string[]): Promise<{ id: string }> => raw('/chat/groups', post({ name, members })),
  rename: (id: string, name: string): Promise<void> => raw(`/chat/groups/${id}`, { method: 'PATCH', body: JSON.stringify({ name }) }),
  add: (id: string, members: string[]): Promise<void> => raw(`/chat/groups/${id}/members`, post({ members })),
  /** Tirar alguém do grupo; com o meu próprio username é "sair do grupo". */
  remove: (id: string, username: string): Promise<void> => raw(`/chat/groups/${id}/members/${encodeURIComponent(username)}`, { method: 'DELETE' }),
  /** Mensagens temporárias no grupo (só quem administra): segundos ou null para desligar. */
  setTtl: (id: string, ttl: number | null): Promise<{ ttl: number | null }> => raw(`/chat/groups/${id}/ttl`, { method: 'PUT', body: JSON.stringify({ ttl }) }),
  /** Limpar a conversa do grupo só para mim. */
  clear: (id: string): Promise<{ ok: true }> => raw(`/chat/groups/${id}/clear`, post({})),
};
