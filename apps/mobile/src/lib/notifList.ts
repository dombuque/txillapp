/**
 * A lista das Notificações (app/notifications.tsx), em contas puras: testadas em tests/notifList.test.mjs.
 *
 * - Várias notificações iguais seguidas (a mesma publicação, ou o mesmo tipo, no mesmo dia) juntam-se numa linha:
 *   «ana, rui e 3 outros…».
 * - «Ver mais» não fazia nada à vista: a página seguinte (30 de cada vez) chegava, mas o que trazia juntava-se à última
 *   linha (ex.: 30 seguidores novos no mesmo dia são uma linha só, que passava de «e 28 outros» para «e 58 outros»), ou
 *   ficava de fora do filtro escolhido («Presentes», «Comentários»…). Agora, quando uma página não traz nenhuma linha nova
 *   (ou o filtro está vazio e ainda há mais), pede-se logo a seguinte, até `MAX_CHAIN` páginas de seguida.
 */
// Sem imports: os testes correm este ficheiro direto no node (o grupo lê-se como em lib/groupAccess `notifGroup`).

/** O mínimo de uma notificação que o agrupamento lê. */
export interface NotifLike {
  id: string;
  kind: string;
  createdAt: string;
  data: { postId?: string; replyKind?: string; storyId?: string; groupId?: string; groupName?: string };
  actor: { username: string };
}

export interface NotifGroup<N extends NotifLike> { id: string; kind: N['kind']; items: N[]; actors: N['actor'][]; first: N; fresh: boolean }

/** A chave que junta notificações parecidas (null: fica sozinha). */
export function groupKey(n: NotifLike): string | null {
  switch (n.kind) {
    case 'follow': case 'request_accepted': case 'verified': return n.kind;
    case 'comment': case 'repost': case 'tag': case 'mention': return n.data.postId ? `${n.kind}:${n.data.postId}` : null;
    case 'story_reply': return n.data.replyKind === 'reaction' && n.data.storyId ? `react:${n.data.storyId}` : null;
    case 'group_member_joined': { const g = n.data?.groupId ?? (n as { groupId?: string }).groupId ?? null; return g ? `joined:${g}` : null; }
    default: return null;
  }
}

/** Junta as notificações seguidas com a mesma chave, no máximo 24 h depois da primeira da linha (e com o mesmo «novas»). */
export function groupAll<N extends NotifLike>(items: N[], fresh: Set<string> | null): NotifGroup<N>[] {
  const out: NotifGroup<N>[] = [];
  const seen = new Set<string>();
  for (const n of items) {
    // A mesma notificação duas vezes (uma página pedida outra vez enquanto a lista mudava): fica só a primeira.
    if (seen.has(n.id)) continue;
    seen.add(n.id);
    const k = groupKey(n);
    const last = out[out.length - 1];
    const sameDay = last && new Date(last.first.createdAt).getTime() - new Date(n.createdAt).getTime() < 24 * 3600_000;
    const isFresh = !!fresh?.has(n.id);
    if (k && last && last.id.startsWith(`${k}|`) && sameDay && last.fresh === isFresh) {
      last.items.push(n);
      if (!last.actors.some((a) => a.username === n.actor.username)) last.actors.push(n.actor);
    } else {
      out.push({ id: `${k ?? n.kind}|${n.id}`, kind: n.kind, items: [n], actors: [n.actor], first: n, fresh: isFresh });
    }
  }
  return out;
}

/** Quantas páginas se pedem sozinhas de seguida sem aparecer nenhuma linha nova (depois fica o botão). */
export const MAX_CHAIN = 5;

export type ChainState = { pages: number; rows: number; chain: number };

/**
 * Depois de cada mudança da lista: pede-se já a página seguinte? `pages` é quantas páginas há, `rows` quantas linhas se
 * veem (com o filtro). Pede quando chegou uma página e não trouxe linhas novas, ou quando o filtro não mostra nada e ainda
 * há mais; nunca mais de `MAX_CHAIN` vezes seguidas. Devolve o estado novo e se é para pedir.
 */
export function chainMore(prev: ChainState, now: { pages: number; rows: number; hasNext: boolean; fetching: boolean }): { state: ChainState; fetch: boolean } {
  const grew = now.pages > prev.pages;
  // Apareceram linhas novas (ou a lista recomeçou): a corrente volta a zero.
  const chain = now.rows > prev.rows || now.pages < prev.pages ? 0 : prev.chain;
  const state = { pages: now.pages, rows: now.rows, chain };
  if (!now.hasNext || now.fetching || now.pages === 0 || chain >= MAX_CHAIN) return { state, fetch: false };
  const nothingNew = grew && prev.pages > 0 && now.rows <= prev.rows;
  const emptyFilter = now.rows === 0;
  if (!nothingNew && !emptyFilter) return { state, fetch: false };
  return { state: { ...state, chain: chain + 1 }, fetch: true };
}
