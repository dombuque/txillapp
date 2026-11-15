/**
 * Conversas escondidas (apps/api 0160): a lógica pura, sem dependências (testes em tests/chatHidden.test.mjs).
 *
 * Esconder uma conversa (a dois ou TxillGroup) é só para mim: sai da lista de Mensagens e do número de por ler e fica em
 * Mensagens → ⋯ → «Conversas escondidas» (HIDDEN_PATH), de onde se abre e se «Mostrar outra vez». Mensagens novas não a
 * trazem de volta e o aviso no telemóvel chega sem pré-visualização («Nova mensagem», sem som). O outro lado não sabe.
 * O servidor guarda por pessoa e conversa (sincroniza entre aparelhos pelo eco 'read' do tempo real).
 *
 * Bloqueio extra (impressão digital / PIN) para abrir as escondidas: fica para depois (precisa de um pacote nativo novo).
 * O sítio está previsto em app/messages/escondidas.tsx (HIDDEN_LOCK): quando existir, o ecrã pede-o antes de mostrar a lista.
 */

/** O ecrã das escondidas (no computador abre na coluna da direita, ao lado da lista). */
export const HIDDEN_PATH = '/messages/escondidas';

/** O nome da entrada no "⋯" das Mensagens e o título do ecrã. */
export const HIDDEN_TITLE = 'Conversas escondidas';

/** O texto do botão no menu de uma conversa (lista ou "⋯" dentro da conversa). */
export const hideLabel = (hidden: boolean) => (hidden ? 'Mostrar outra vez' : 'Esconder conversa');

/** A pergunta antes de esconder: o que acontece (o nome é o da pessoa ou do grupo). */
export function hideAsk(name: string, group: boolean): { title: string; body: string; ok: string } {
  const who = name.trim() || (group ? 'este TxillGroup' : 'esta pessoa');
  return {
    title: group ? 'Esconder este TxillGroup?' : 'Esconder esta conversa?',
    body: `${group ? `“${who}”` : `A conversa com ${who}`} sai da tua lista e do número de mensagens por ler. Encontras em Mensagens → ⋯ → ${HIDDEN_TITLE}. Mensagens novas não a trazem de volta e os avisos chegam sem pré-visualização. ${group ? 'Os outros membros não sabem.' : `${who.split(' ')[0]} não sabe.`}`,
    ok: 'Esconder',
  };
}

/** O que se diz logo a seguir a esconder (aviso curto). */
export const hiddenToast = (group: boolean) => `${group ? 'TxillGroup escondido' : 'Conversa escondida'}. Está em Mensagens → ⋯ → ${HIDDEN_TITLE}.`;

/** O texto do ecrã das escondidas (por cima da lista). */
export const HIDDEN_NOTE = 'Só tu vês que estão escondidas. Mensagens novas não as trazem de volta e os avisos chegam sem pré-visualização.';
export const HIDDEN_EMPTY = { title: 'Nada escondido', body: 'Para esconder uma conversa, mantém-na premida na lista de Mensagens (ou abre o ⋯ dentro dela) e escolhe «Esconder conversa».' };

interface HasLast { lastMessage: { at: string } }
/** As conversas e os TxillGroups escondidos juntos, da mensagem mais recente para a mais antiga. */
export function hiddenRows<C extends HasLast, G extends HasLast>(d: { conversations?: C[]; groups?: G[] } | undefined): ({ kind: 'chat'; c: C } | { kind: 'group'; g: G })[] {
  const rows = [
    ...(d?.conversations ?? []).map((c) => ({ kind: 'chat' as const, c, at: c.lastMessage.at })),
    ...(d?.groups ?? []).map((g) => ({ kind: 'group' as const, g, at: g.lastMessage.at })),
  ];
  rows.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  return rows.map(({ at: _at, ...r }) => r as { kind: 'chat'; c: C } | { kind: 'group'; g: G });
}

/** Quantas por ler há nas escondidas (só se mostra dentro do ecrã delas; não conta para o número das Mensagens). */
export const hiddenUnread = (d: { conversations?: { unread: number }[]; groups?: { unread: number }[] } | undefined) =>
  [...(d?.conversations ?? []), ...(d?.groups ?? [])].filter((x) => x.unread > 0).length;

/**
 * A chave das escondidas no react-query: debaixo de ['chat-list'], para o tempo real (lib/streamEvents, que já põe em dia
 * ['chat-list']) e todos os sítios que atualizam a lista também a porem em dia, sem mexer neles.
 */
export const HIDDEN_QUERY_KEY = ['chat-list', 'hidden'] as const;

/** As chaves do react-query que mudam ao esconder/mostrar (as listas, com as escondidas, e o contador). */
export const HIDDEN_KEYS = [['chat-list'], ['chat-groups'], ['chat-unread']] as const;
