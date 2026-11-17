/**
 * Falhas a abrir as mensagens, sem React (testado em tests/chatErrors.test.mjs).
 *
 * O react-query (v5) põe `isError` também quando um refetch falha e os dados já estão lá (rede a falhar uns segundos, a
 * app a voltar do fundo, o refetch de 30 em 30 s). Nesse caso a conversa ou a lista continuam à vista: o ecrã de erro é
 * só para quando não há nada para mostrar.
 */

/** Tapa a conversa com "Não consegui abrir esta conversa"? Só sem nada carregado. */
import { t } from '@/lib/i18n';
export const blockingError = (isError: boolean, hasData: boolean): boolean => isError && !hasData;

/**
 * Sem rede (o erro não traz resposta do servidor) mas com mensagens à espera nesta conversa (lib/chatPending): em vez do
 * erro, a conversa abre e mostra-as, com o nome guardado com elas. Um 403 ou 404 do servidor continua a tapar.
 */
export function offlineWithPending(error: unknown, pendingCount: number): boolean {
  if (pendingCount <= 0) return false;
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status !== 'number' || status >= 500 || status === 408 || status === 429;
}

/**
 * A lista de Mensagens vazia porque não carregou (e não porque não há conversas)? Conversas e Pedidos vêm da lista
 * das conversas; TxillGroups, da dos grupos; a pesquisa, das duas. Sem isto, sem rede aparecia "Ainda sem cochichos".
 */
export function inboxFailed(view: 'chats' | 'groups' | 'requests', searching: boolean, direct: { isError: boolean; hasData: boolean }, groups: { isError: boolean; hasData: boolean }): boolean {
  const d = blockingError(direct.isError, direct.hasData);
  const g = blockingError(groups.isError, groups.hasData);
  if (searching) return d || g;
  return view === 'groups' ? g : d;
}

/** O texto por baixo de "Não consegui abrir esta conversa" (404: a conta já não existe; o resto: a rede). */
export function threadErrorText(status?: number): string {
  if (status === 404) return t('Esta conta não existe ou já não está disponível.');
  if (status === 403) return t('Não podes abrir esta conversa.');
  return t('Verifica a internet e tenta outra vez.');
}
