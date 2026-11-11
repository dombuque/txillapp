import { post, raw } from '@/lib/api';
import { musicPayload, type Track } from '@/lib/api.music';

export type NoteAudience = 'mutual' | 'close_friends';
/** Igual ao tipo `Note` do site. */
export interface Note { music?: Track | null; username: string; displayName: string; hasAvatar: boolean; body: string; audience: NoteAudience; createdAt: string; expiresAt: string; cheers?: number; cheered?: boolean }
/** Alguém com quem já conversei, sem nota: aparece na faixa a seguir às notas. */
export interface NotePerson { username: string; displayName: string; hasAvatar: boolean; lastAt: string }

export const notesApi = {
  /**
   * As notas de quem sigo e, em `people`, as pessoas das minhas conversas sem nota (já sem quem está em `items`, a começar
   * pelas conversas mais em baixo na lista, no máximo 30). Servidores antigos não mandam `people`.
   */
  list: (): Promise<{ mine: Note | null; items: Note[]; people?: NotePerson[] }> => raw('/notes'),
  set: (body: string, music?: Track | null): Promise<void> => raw('/notes/me', { method: 'PUT', body: JSON.stringify({ body, music: musicPayload(music) }) }),
  remove: (): Promise<void> => raw('/notes/me', { method: 'DELETE' }),
  cheer: (username: string): Promise<{ cheered: boolean; cheers: number }> => raw(`/notes/${encodeURIComponent(username)}/cheer`, post({})),
  reply: (username: string, text: string): Promise<{ id: string }> => raw(`/notes/${encodeURIComponent(username)}/reply`, post({ text })),
  /** Quem está online (o servidor aplica a privacidade). */
  online: (usernames: string[]): Promise<{ online: string[] }> => raw('/presence/online', post({ usernames })),
};
