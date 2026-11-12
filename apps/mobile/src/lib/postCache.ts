/**
 * Procura uma publicação que já esteja em memória (no Início, num perfil, na pesquisa…) para a mostrar logo ao abrir
 * /p/id, em vez de um ecrã vazio até a rede responder. Percorre os dados guardados (listas, páginas, objetos) com limites,
 * para nunca pesar: no máximo `maxNodes` nós e `maxDepth` níveis.
 */
export function findCachedPost<T extends { id: string }>(datas: unknown[], id: string, maxNodes = 20_000, maxDepth = 6): T | undefined {
  if (!id) return undefined;
  let seen = 0;
  const looksLikePost = (o: Record<string, unknown>) => o.id === id && typeof o.author === 'object' && o.author !== null && Array.isArray(o.media);
  const walk = (v: unknown, depth: number): T | undefined => {
    if (v === null || typeof v !== 'object' || depth > maxDepth || ++seen > maxNodes) return undefined;
    if (Array.isArray(v)) {
      for (const x of v) {
        const r = walk(x, depth + 1);
        if (r) return r;
      }
      return undefined;
    }
    const o = v as Record<string, unknown>;
    if (looksLikePost(o)) return o as unknown as T;
    for (const k in o) {
      const r = walk(o[k], depth + 1);
      if (r) return r;
    }
    return undefined;
  };
  for (const d of datas) {
    const r = walk(d, 0);
    if (r) return r;
  }
  return undefined;
}
