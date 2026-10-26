import { track } from './analytics';
import type { QueryClient } from '@tanstack/react-query';

/**
 * "Recarregar" a página onde estás (puxar para baixo, ou tocar outra vez no Início):
 * o Início recomeça o feed com uma sessão nova; as outras páginas voltam a pedir os dados ao servidor.
 */
export async function refreshPage(qc: QueryClient, pathname: string) {
  if (pathname === '/') {
    track('feed_refresh');
    await Promise.all([
      qc.resetQueries({ queryKey: ['feed'] }),
      qc.invalidateQueries({ queryKey: ['stories'] }),
      qc.invalidateQueries({ queryKey: ['unread'] }),
      qc.invalidateQueries({ queryKey: ['chat-unread'] }),
    ]);
    return;
  }
  await qc.invalidateQueries({ refetchType: 'active' });
}
