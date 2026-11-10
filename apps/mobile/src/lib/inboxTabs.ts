/**
 * Separadores da lista de Mensagens: "Conversas" (só conversas diretas), "TxillGroups" (só grupos) e "Pedidos" (pedidos de
 * mensagem de quem não segues). Lógica pura, sem React, para se poder testar (tests/inboxTabs.test.mjs).
 */

/** Os dois separadores principais (o que se lembra entre visitas). */
export type InboxTab = 'chats' | 'groups';
/** O que a lista está a mostrar: um dos separadores ou os pedidos. */
export type InboxView = InboxTab | 'requests';

/** Chave em kv.ts do último separador usado (só letras, pontos e traços: serve ao cofre do telemóvel). */
export const INBOX_TAB_KEY = 'txill.messages.tab';

/** O separador guardado; qualquer outra coisa (nada, lixo, versão antiga) abre em "Conversas". */
export function parseInboxTab(v: string | null | undefined): InboxTab {
  return v === 'groups' ? 'groups' : 'chats';
}

/** O mínimo de uma linha da lista para a separar. `request` só faz sentido numa conversa direta. */
export interface InboxRowLike {
  group: boolean;
  request?: boolean;
  unread: number;
  name: string;
  sub: string;
  at: string;
}

/** Em que vista aparece esta linha (fora da pesquisa). */
export function viewOf(r: InboxRowLike): InboxView {
  if (r.group) return 'groups';
  return r.request ? 'requests' : 'chats';
}

/**
 * As linhas a mostrar, das mais recentes para as mais antigas.
 * Sem pesquisa: só as do separador ativo. A pesquisar (fora dos pedidos): conversas e TxillGroups juntos, como a caixa
 * "Procurar pessoas e TxillGroups" promete, para não se esconder um resultado por estar no outro separador. Nos pedidos
 * procura-se só nos pedidos (como antes).
 */
export function inboxRows<R extends InboxRowLike>(rows: R[], view: InboxView, term: string): R[] {
  const t = term.trim().toLowerCase().replace(/^@/, '');
  return rows
    .filter((r) => {
      const v = viewOf(r);
      if (view === 'requests') return v === 'requests';
      if (t) return v !== 'requests';
      return v === view;
    })
    .filter((r) => !t || r.name.toLowerCase().includes(t) || r.sub.toLowerCase().includes(t))
    .sort((a, b) => +new Date(b.at) - +new Date(a.at));
}

/** Contagens para os separadores: conversas e TxillGroups por ler (quantas, não quantas mensagens) e pedidos à espera. */
export interface InboxCounts { chats: number; groups: number; requests: number }

export function inboxCounts(rows: InboxRowLike[]): InboxCounts {
  const c: InboxCounts = { chats: 0, groups: 0, requests: 0 };
  for (const r of rows) {
    const v = viewOf(r);
    if (v === 'requests') c.requests++;
    else if (r.unread > 0) c[v]++;
  }
  return c;
}

/** O número discreto ao lado do nome do separador ("9+" a partir de 10); nada quando é zero. */
export function badgeText(n: number): string {
  return n <= 0 ? '' : n > 9 ? '9+' : String(n);
}

/** O que o leitor de ecrã diz de cada separador. */
export function tabLabel(name: string, n: number, what = 'por ler'): string {
  return n > 0 ? `${name}, ${n} ${what}` : name;
}
