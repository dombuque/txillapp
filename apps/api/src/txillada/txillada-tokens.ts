/**
 * Ganchos da Txillada para outros módulos sem import circular (a moderação corta uma Txillada denunciada; o serviço da
 * Txillada fecha a sala no LiveKit e avisa quem estava a ver). Vai-se buscar com ModuleRef.get(TXILLADA_HOOKS, { strict: false }).
 */
export const TXILLADA_HOOKS = 'TXILLADA_HOOKS';

export interface TxilladaHooks {
  /** Depois de a linha passar a 'cut' (já gravado): avisa os espectadores e fecha a sala no LiveKit. */
  afterCut(id: string): Promise<void>;
  /** Depois de um bloqueio entre `a` e `b` (já gravado): quem via a Txillada do outro sai da sala e deixa de receber os eventos. */
  afterBlock(a: string, b: string): Promise<void>;
}
