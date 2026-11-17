// Os avisos de brindes nas notificações ("A malta brindou-te"): o texto, para onde levam e quem aparece na linha.
// O servidor já junta os brindes (uma linha por publicação ou comentário a cada 24 h) e manda a contagem e os dois últimos.
// Sem dependências (os testes correm em Node: tests/cheerNotice.test.mjs).

import { t } from '@/lib/i18n';
export interface CheerActor { username: string; displayName: string; verified?: boolean; verifiedTier?: 'verified' | 'official' | 'paid' | null }
/** `story_comment` (0161): um comentário num mimo, com `storyId`, `storyAuthor` (o @ de quem publicou o mimo) e `mediaId`. */
export interface CheerData { target?: 'post' | 'comment' | 'story_comment'; postId?: string; commentId?: string; tcheka?: boolean; storyId?: string; storyAuthor?: string; mediaId?: string }
export interface CheerInfo { count?: number; actors?: CheerActor[] }

/** "brindou a tua publicação" / "brindaram o teu comentário" / "brindou a tua tcheka" / "brindou o teu comentário no mimo". */
export function cheerVerb(data: CheerData, many: boolean): string {
  if (data.target === 'story_comment') return many ? t('brindaram o teu comentário no mimo') : t('brindou o teu comentário no mimo');
  if (data.target === 'comment') return many ? t('brindaram o teu comentário') : t('brindou o teu comentário');
  if (data.tcheka) return many ? t('brindaram a tua tcheka') : t('brindou a tua tcheka');
  return many ? t('brindaram a tua publicação') : t('brindou a tua publicação');
}

const MEDIA_ID = /^[0-9a-f-]{36}$/i;

/**
 * Abre a publicação, ou o comentário brindado dentro dela. Num mimo: o visor nesse mimo com a folha dos comentários aberta
 * (o mesmo destino do push); sem o ficheiro do mimo, abre os mimos de quem o publicou.
 */
export function cheerTarget(data: CheerData): string | null {
  if (data.target === 'story_comment') {
    if (!data.storyAuthor) return null;
    const who = `/stories/${encodeURIComponent(data.storyAuthor)}`;
    return data.mediaId && MEDIA_ID.test(data.mediaId) ? `${who}?m=${data.mediaId.toLowerCase()}&comments=1` : who;
  }
  if (!data.postId) return null;
  return data.target === 'comment' && data.commentId ? `/p/${data.postId}?comments=1&c=${data.commentId}` : `/p/${data.postId}`;
}

/**
 * Quem aparece na linha (fotos e nomes) e quantos são ao todo. Só contam os brindes que ainda estão postos; se já não
 * sobra nenhum (tiraram o brinde), a linha fica com quem brindou por último, sem contagem.
 */
export function cheerPeople(cheer: CheerInfo | null | undefined, fallback: CheerActor): { actors: CheerActor[]; total: number } {
  const actors = (cheer?.actors ?? []).filter((a) => a && typeof a.username === 'string').slice(0, 2);
  const n = typeof cheer?.count === 'number' && Number.isFinite(cheer.count) ? Math.floor(cheer.count) : 0;
  if (!actors.length) return { actors: [fallback], total: 1 };
  return { actors, total: Math.max(n, actors.length) };
}
