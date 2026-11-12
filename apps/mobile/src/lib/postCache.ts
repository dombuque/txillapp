import type { Post } from './api';

/** O que pode estar guardado nas listas de publicações: páginas (feed, perfil, explorar), listas, objetos com listas. */
type Cached = unknown;

/** É mesmo uma publicação (e não um utilizador ou uma notificação com o mesmo id): tem autor e a lista de media. */
const looksLikePost = (o: Record<string, unknown>): boolean => typeof o.author === 'object' && o.author !== null && Array.isArray(o.media);

/** Pelo id ou pelo código curto do endereço (/p/código). */
const matches = (o: Record<string, unknown>, key: string): boolean => (o.id === key || (typeof o.code === 'string' && !!o.code && o.code === key)) && looksLikePost(o);

/**
 * Procura uma publicação (pelo id ou pelo código curto do endereço) no que as listas já carregaram. Serve para a página
 * da publicação abrir logo com o cartão que estava no feed, num perfil, no explorar…, em vez de um ecrã vazio até a rede
 * responder. Percorre páginas, listas e objetos (um repost simples traz a original dentro: também conta), com limites
 * para nunca pesar: no máximo `maxNodes` nós e `maxDepth` níveis (dados enormes ou com ciclos desistem e fica o carregador).
 */
export function findCachedPost(entries: Cached[], key: string, maxNodes?: number, maxDepth?: number): Post | undefined;
export function findCachedPost<T extends { id: string }>(entries: Cached[], key: string, maxNodes?: number, maxDepth?: number): T | undefined;
export function findCachedPost<T extends { id: string }>(entries: Cached[], key: string, maxNodes = 20_000, maxDepth = 6): T | undefined {
  if (!key) return undefined;
  let seen = 0;
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
    if (matches(o, key)) return o as unknown as T;
    for (const k in o) {
      const r = walk(o[k], depth + 1);
      if (r) return r;
    }
    return undefined;
  };
  for (const d of entries) {
    const r = walk(d, 0);
    if (r) return r;
  }
  return undefined;
}

/**
 * A publicação deixou mesmo de existir (ou deixou de se poder ver)? Só então se diz "já não está disponível";
 * uma falha de rede ou do servidor mostra "Tentar outra vez".
 */
export function isGone(e: unknown): boolean {
  const s = (e as { status?: unknown } | null)?.status;
  return s === 404 || s === 403 || s === 410;
}
