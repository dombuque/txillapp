/** A frase que se mostra quando o pedido nem chegou ao servidor (sem rede, rede a cair, servidor inalcançável). */
export const OFFLINE_TEXT = 'Sem ligação à internet. Verifica a rede e tenta outra vez.';

/**
 * O fetch falha sem rede com um TypeError em inglês, diferente em cada sítio: "Failed to fetch" (Chrome/Android),
 * "Load failed" (Safari do iPhone), "NetworkError when attempting to fetch resource." (Firefox) e
 * "Network request failed" (React Native). Esses textos iam parar ao ecrã (ex.: no login). Devolve o erro a mostrar:
 * um TypeError com a frase em português (continua TypeError, para quem já o distingue), ou o próprio erro se não for de rede.
 * Cancelamentos (AbortError) passam como estão.
 */
export function friendlyFetchError(e: unknown): unknown {
  if (!(e instanceof TypeError)) return e;
  if (!/failed to fetch|load failed|networkerror|network request failed|network error|internet/i.test(e.message)) return e;
  return new TypeError(OFFLINE_TEXT);
}
