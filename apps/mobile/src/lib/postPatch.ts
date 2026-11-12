/**
 * Atualiza uma publicação em QUALQUER lista guardada em memória (feed, perfil, hashtags, pesquisa, locais, guardados,
 * a página da publicação…), também dentro de um repost. Antes só se atualizavam o feed, o perfil e a publicação aberta: numa
 * hashtag, guardar ou brindar ia ao servidor mas o botão não mudava, e parecia que o toque não fazia nada.
 */
type Postish = { id: string; repostOf?: Postish | null } & Record<string, unknown>;

export function mergePost<T>(value: T, id: string, patch: Record<string, unknown>): T {
  const one = (p: unknown): unknown => {
    if (!p || typeof p !== 'object') return p;
    const q = p as Postish;
    if (q.id === id) return { ...q, ...patch };
    if (q.repostOf && typeof q.repostOf === 'object' && q.repostOf.id === id) return { ...q, repostOf: { ...q.repostOf, ...patch } };
    return p;
  };
  const list = (a: unknown[]): unknown[] => {
    let changed = false;
    const out = a.map((x) => { const y = one(x); if (y !== x) changed = true; return y; });
    return changed ? out : a;
  };
  const walk = (v: unknown, depth: number): unknown => {
    if (!v || typeof v !== 'object' || depth > 3) return v;
    if (Array.isArray(v)) return list(v);
    const o = v as Record<string, unknown>;
    // Uma publicação sozinha (a página da publicação).
    if (typeof o.id === 'string' && ('author' in o || 'media' in o)) return one(o);
    // Listas paginadas ({ pages: [{ items }] }) e respostas com listas ({ items }, { posts }).
    let changed = false;
    const next: Record<string, unknown> = { ...o };
    for (const k of ['pages', 'items', 'posts', 'results']) {
      if (Array.isArray(o[k])) {
        const arr = k === 'pages' ? (o[k] as unknown[]).map((pg) => walk(pg, depth + 1)) : list(o[k] as unknown[]);
        if (k === 'pages' ? (arr as unknown[]).some((pg, i) => pg !== (o[k] as unknown[])[i]) : arr !== o[k]) { next[k] = arr; changed = true; }
      }
    }
    return changed ? next : v;
  };
  return walk(value, 0) as T;
}
