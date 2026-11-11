/** API dos grupos de chat (copiada do site, apps/web/src/lib/api.ts). Só usa o que a app já exporta em '@/lib/api'. */
import { post, raw, threadQuery, type ChatMessage, type GroupSummary, type MsgKind } from '@/lib/api';

export type { GroupSummary };
export type GroupRole = 'admin' | 'member';
export interface GroupMember { username: string; displayName: string; hasAvatar: boolean; role: GroupRole }
export interface GroupSender { username: string; displayName: string; hasAvatar: boolean }
export type GroupMessage = ChatMessage & { sender: GroupSender };
export interface GroupThread {
  group: { id: string; name: string; myRole: GroupRole; members: GroupMember[] };
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
  send: (id: string, msg: GroupSendBody): Promise<{ id: string }> => raw(`/chat/groups/${id}/messages`, post(msg)),
  create: (name: string, members: string[]): Promise<{ id: string }> => raw('/chat/groups', post({ name, members })),
  rename: (id: string, name: string): Promise<void> => raw(`/chat/groups/${id}`, { method: 'PATCH', body: JSON.stringify({ name }) }),
  add: (id: string, members: string[]): Promise<void> => raw(`/chat/groups/${id}/members`, post({ members })),
  /** Tirar alguém do grupo; com o meu próprio username é "sair do grupo". */
  remove: (id: string, username: string): Promise<void> => raw(`/chat/groups/${id}/members/${encodeURIComponent(username)}`, { method: 'DELETE' }),
};
