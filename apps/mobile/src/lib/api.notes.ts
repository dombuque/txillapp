import { post, raw, type Badged, type ReportReason } from '@/lib/api';
import { musicPayload, type Track } from '@/lib/api.music';
import type { ChatGif } from '@/lib/gifs';
import type { NoteAudience, NoteColor } from '@/lib/noteLook';

export type { NoteAudience, NoteColor } from '@/lib/noteLook';
/** O local de uma nota: só o nome do sítio (a posição nunca se guarda). */
export interface NotePlace { name: string }
/** O que se publica numa nota: texto (até 60), música, cor da bolha, local, GIF e público. */
export interface NoteDraft { body: string; music?: Track | null; color?: NoteColor | null; place?: NotePlace | null; gif?: ChatGif | null; audience?: NoteAudience }
/** Igual ao tipo `Note` do site. */
export interface Note extends Badged { music?: Track | null; username: string; displayName: string; hasAvatar: boolean; body: string; audience: NoteAudience; createdAt: string; expiresAt: string; cheers?: number; cheered?: boolean; color?: NoteColor | null; place?: NotePlace | null; gif?: ChatGif | null }
/** Alguém com quem já conversei, sem nota: aparece na faixa a seguir às notas. */
export interface NotePerson extends Badged { username: string; displayName: string; hasAvatar: boolean; lastAt: string }

export const notesApi = {
  /**
   * As notas de quem sigo e, em `people`, as pessoas das minhas conversas sem nota (já sem quem está em `items`, a começar
   * pelas conversas mais em baixo na lista, no máximo 30). Servidores antigos não mandam `people`.
   */
  list: (): Promise<{ mine: Note | null; items: Note[]; people?: NotePerson[] }> => raw('/notes'),
  set: (d: NoteDraft): Promise<void> =>
    raw('/notes/me', { method: 'PUT', body: JSON.stringify({ body: d.body, music: musicPayload(d.music ?? null), color: d.color ?? null, place: d.place ?? null, gif: d.gif ?? null, audience: d.audience ?? 'mutual' }) }),
  remove: (): Promise<void> => raw('/notes/me', { method: 'DELETE' }),
  cheer: (username: string): Promise<{ cheered: boolean; cheers: number }> => raw(`/notes/${encodeURIComponent(username)}/cheer`, post({})),
  /** A resposta (vira mensagem): texto e/ou um GIF (a reação «Txillapp»: a linha «Em resposta à tua nota» e o GIF a seguir). */
  reply: (username: string, text: string, gif?: ChatGif): Promise<{ id: string }> => raw(`/notes/${encodeURIComponent(username)}/reply`, post(gif ? { text, gif } : { text })),
  /** Denunciar a nota de alguém (os motivos de sempre; a nota até 500). Quem denuncia deixa de a ver (o servidor esconde-a). */
  report: (username: string, reason: ReportReason, note?: string): Promise<void> => raw(`/notes/${encodeURIComponent(username)}/report`, post({ reason, note })),
  /** Quem está online (o servidor aplica a privacidade). */
  online: (usernames: string[]): Promise<{ online: string[] }> => raw('/presence/online', post({ usernames })),
};
