// Os avisos de brindes nas notificações ("A malta brindou-te"): o texto, para onde levam e quem aparece na linha.
// O servidor já junta os brindes (uma linha por publicação ou comentário a cada 24 h) e manda a contagem e os dois últimos.
// Sem dependências (os testes correm em Node: tests/cheerNotice.test.mjs).

export interface CheerActor { username: string; displayName: string; verified?: boolean; verifiedTier?: 'verified' | 'official' | 'paid' | null }
export interface CheerData { target?: 'post' | 'comment'; postId?: string; commentId?: string; tcheka?: boolean }
export interface CheerInfo { count?: number; actors?: CheerActor[] }

/** "brindou a tua publicação" / "brindaram o teu comentário" / "brindou a tua tcheka". */
export function cheerVerb(data: CheerData, many: boolean): string {
  const what = data.target === 'comment' ? 'o teu comentário' : data.tcheka ? 'a tua tcheka' : 'a tua publicação';
  return `${many ? 'brindaram' : 'brindou'} ${what}`;
}

/** Abre a publicação, ou o comentário brindado dentro dela. */
export function cheerTarget(data: CheerData): string | null {
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
