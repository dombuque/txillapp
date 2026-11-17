/**
 * Quem está a ver uma Txillada agora: um conjunto no RealtimeBus com quem fez `join` (ou entrou na sala pelo webhook) e não
 * saiu. Partilhado entre o TxilladaService e as sugestões de @menções (contexto 'txillada'), para a chave ser uma só.
 * A janela é a duração máxima de uma Txillada (4 h) mais 1 h de folga.
 */
export const TX_WATCH_MS = 4 * 3_600_000 + 3_600_000;
export const txWatchKey = (id: string) => `tx:to:${id}`;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Só os ids válidos (o conjunto pode ter lixo de versões antigas). */
export const watchIds = (members: string[]) => members.filter((m) => UUID_RE.test(m));
