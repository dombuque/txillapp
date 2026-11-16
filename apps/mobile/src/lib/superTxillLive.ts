/** Uma mensagem da conversa com o SuperTxill (o mínimo para saber o estado). */
export interface LiveMsg {
  role: 'user' | 'assistant';
  writing?: boolean;
}

/**
 * Em que pé está a resposta do SuperTxill: `thinking` antes do primeiro bocado de texto («está a pensar…»), `writing`
 * enquanto a última resposta ainda está a ser escrita (a bolha cresce, com os três pontinhos no fim), `idle` quando não há
 * nada a caminho.
 */
export function liveState(messages: readonly LiveMsg[], pending: boolean): 'idle' | 'thinking' | 'writing' {
  const last = messages[messages.length - 1];
  if (last?.role === 'assistant' && last.writing) return 'writing';
  return pending ? 'thinking' : 'idle';
}
