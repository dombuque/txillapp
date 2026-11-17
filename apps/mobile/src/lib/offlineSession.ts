/**
 * Abrir a app sem rede (sem React nem imports da app; testado em tests/offlineSession.test.mjs).
 *
 * A sessão confirma-se ao abrir (renovar o token). Sem rede (ou com o servidor em baixo) isso falha, mas a sessão guardada
 * continua a valer: a app abre com a conta da última vez (a que está guardada neste aparelho: id, @ e nome), mostra o que
 * já está no aparelho (as mensagens à espera de rede, lib/chatPending) e volta a confirmar quando a rede voltar. Só um 401
 * verdadeiro da renovação termina a sessão.
 *
 * Isto não dá acesso a nada no servidor: sem confirmar não há token de acesso, e cada pedido renova primeiro (ou falha).
 * Só aparece o que já estava guardado neste aparelho para esta conta, como acontecia antes de fechar a app.
 */

/** De 15 em 15 s, enquanto a app está à frente e a sessão está por confirmar (e logo que a rede volta). */
export const SESSION_RECHECK_MS = 15_000;

/** A conta guardada (lib/accounts) como utilizador da app, para abrir sem rede. Sem id ou @ não dá (fica «Sem ligação»). */
export function offlineUserOf(a: { id?: string; username?: string; displayName?: string } | null | undefined): { id: string; username: string; displayName: string } | null {
  if (!a || typeof a.id !== 'string' || !a.id || typeof a.username !== 'string' || !a.username) return null;
  return { id: a.id, username: a.username, displayName: typeof a.displayName === 'string' && a.displayName ? a.displayName : a.username };
}

/** A renovação falhou porque a sessão terminou (401)? Qualquer outro erro é rede ou o servidor em baixo: não desloga. */
export function sessionEnded(e: unknown): boolean {
  return (e as { status?: unknown } | null)?.status === 401;
}
