// Os avisos da equipa do Txillapp nas notificações (0121): conteúdo removido, conteúdo reposto e aviso da moderação.
// Vêm em nome do «Txillapp» (o servidor nunca mostra a pessoa da equipa) e não se desligam nas definições.
// Sem dependências (os testes correm em Node: tests/moderationNotice.test.mjs).

export type ModerationKind = 'content_removed' | 'content_restored' | 'moderation_warning';
export interface ModerationData { type?: string; reason?: string; postId?: string; tcheka?: boolean }

export const MODERATION_KINDS: readonly ModerationKind[] = ['content_removed', 'content_restored', 'moderation_warning'];
export const isModerationKind = (k: string): k is ModerationKind => (MODERATION_KINDS as readonly string[]).includes(k);

/** «a tua publicação», «o teu comentário», «o teu mimo»… */
export function moderationNoun(d: ModerationData): string {
  switch (d.type) {
    case 'comment': return 'o teu comentário';
    case 'story': return 'o teu mimo';
    case 'message': return 'a tua mensagem';
    case 'media': return 'a tua foto';
    case 'user': return 'o teu perfil';
    case 'venue': return 'a página do teu local';
    default: return d.tcheka ? 'a tua tcheka' : 'a tua publicação';
  }
}

/** O texto da linha (depois de «Txillapp») e, por baixo, o motivo. */
export function moderationVerb(kind: ModerationKind, d: ModerationData): { text: string; sub?: string } {
  const why = typeof d.reason === 'string' && d.reason.trim() ? `Motivo: ${d.reason.trim()}` : undefined;
  if (kind === 'content_removed') return { text: `removeu ${moderationNoun(d)} por não cumprir as regras`, sub: why ?? 'Não cumpria as regras do Txillapp.' };
  if (kind === 'content_restored') return { text: `repôs ${moderationNoun(d)}`, sub: why };
  return { text: `deixou-te um aviso sobre ${moderationNoun(d)}`, sub: why };
}

/**
 * Para onde leva: só uma publicação reposta abre (o que foi removido já não existe; o aviso fica na lista). Também a
 * publicação guardada com um pedido de revisão, publicada quando a foto foi aprovada (type 'media' com postId).
 */
export function moderationTarget(kind: ModerationKind, d: ModerationData): string | null {
  return kind === 'content_restored' && (d.type === 'post' || d.type === 'media' || !d.type) && d.postId ? `/p/${d.postId}` : null;
}
