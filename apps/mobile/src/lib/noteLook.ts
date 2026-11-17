/**
 * O aspeto e os textos das notas (components/Notes.tsx, a fila das Mensagens, a nota aberta, o editor e o balão do
 * cabeçalho da conversa). Sem imports da app: os testes (tests/noteView.test.mjs) correm-no direto no Node.
 */

/** As cores da bolha (a mesma lista fechada da API, apps/api/src/chat/notes.service.ts `NOTE_COLORS`). Sem cor = branca. */
import { t } from '@/lib/i18n';
export const NOTE_COLORS = ['coral', 'ambar', 'verde', 'ceu', 'noite'] as const;
export type NoteColor = (typeof NOTE_COLORS)[number];

/** As cores de uma bolha: fundo, texto, linha pequena (música, local) e contorno. */
export interface NoteTone { bg: string; text: string; sub: string; border: string; label: string }

/** A bolha branca de sempre. */
export const NOTE_WHITE: NoteTone = { bg: '#ffffff', text: '#27272a', sub: '#71717a', border: '#f4f4f5', get label() { return t('Branca'); } };

/** As cores do tema da app: o coral da marca, o âmbar dos brindes, o verde do online, o azul do céu e a noite. */
export const NOTE_TONES: Record<NoteColor, NoteTone> = {
  coral: { bg: '#d6334f', text: '#ffffff', sub: 'rgba(255,255,255,0.85)', border: '#d6334f', get label() { return t('Coral'); } },
  ambar: { bg: '#fef3c7', text: '#92400e', sub: '#b45309', border: '#fde68a', get label() { return t('Âmbar'); } },
  verde: { bg: '#dcfce7', text: '#166534', sub: '#15803d', border: '#bbf7d0', get label() { return t('Verde'); } },
  ceu: { bg: '#e0f2fe', text: '#075985', sub: '#0369a1', border: '#bae6fd', get label() { return t('Céu'); } },
  noite: { bg: '#18181b', text: '#ffffff', sub: '#a1a1aa', border: '#18181b', get label() { return t('Noite'); } },
};

/** As cores da bolha de uma nota (uma cor desconhecida, de um servidor mais novo, fica branca). */
export function noteTone(color?: string | null): NoteTone {
  return color && (NOTE_COLORS as readonly string[]).includes(color) ? NOTE_TONES[color as NoteColor] : NOTE_WHITE;
}

/** As três reações rápidas da resposta a uma nota (das reações rápidas dos comentários). Tocar numa envia-a logo. */
export const NOTE_QUICK = ['😂', '😍', '🔥'] as const;

/** Até quantos caracteres tem uma nota (o mesmo limite da API). */
export const NOTE_LIMIT = 60;

/** Uma nota tem conteúdo para se publicar: texto, música, GIF ou local (a cor sozinha não chega). */
export function noteHasContent(n: { body?: string | null; music?: unknown; gif?: unknown; place?: unknown }): boolean {
  return !!(n.body ?? '').trim() || !!n.music || !!n.gif || !!n.place;
}

/**
 * Como se mostra a nota aberta: com música, a bolha leva a música e o texto sai para baixo, grande; sem música, o texto
 * vai dentro da bolha, ao lado da foto.
 */
export function noteLayout(n: { music?: unknown }): 'music' | 'text' {
  return n.music ? 'music' : 'text';
}

/** O texto do campo de responder: «Responder à nota…» com música, «Responder a @nome» sem ela. */
export function noteReplyPlaceholder(n: { username: string; music?: unknown }): string {
  return n.music ? t('Responder à nota…') : `Responder a @${n.username}`;
}

/** O aviso depois de responder (com o botão «Ver», que abre a conversa). */
export function noteSentText(username: string): string {
  return `Enviada a @${username}`;
}

/** Há quanto tempo, para o topo da nota aberta: «agora», «há 5 min», «há 18 h». */
export function noteAgo(iso: string, now = Date.now()): string {
  const s = (now - new Date(iso).getTime()) / 1000;
  if (!Number.isFinite(s) || s < 60) return 'agora';
  if (s < 3600) return t('há {n} min', { n: Math.floor(s / 60) });
  if (s < 86400) return t('há {n} h', { n: Math.floor(s / 3600) });
  return t('há {n} d', { n: Math.floor(s / 86400) });
}

/** Quem vê a nota: 'mutual' = quem me segue (os meus seguidores); 'close_friends' = a minha lista de amigos próximos. */
export type NoteAudience = 'mutual' | 'close_friends';

/** O nome do público (o botão em baixo no editor, a folha de escolha e a etiqueta da minha nota). */
export function noteAudienceLabel(a: NoteAudience): string {
  return a === 'close_friends' ? t('Amigos próximos') : t('Seguidores');
}
