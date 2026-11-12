import type { Post } from './api';

/** O que pode estar guardado nas listas de publicações: páginas (feed, perfil, explorar) ou uma publicação só. */
type Cached = { pages?: { items?: Post[] }[] } | Post | Post[] | null | undefined;

const matches = (p: Post | null | undefined, key: string): boolean => !!p && (p.id === key || (!!p.code && p.code === key));

/**
 * Procura uma publicação (pelo id ou pelo código curto do endereço) no que as listas já carregaram. Serve para a página
 * da publicação abrir logo com o cartão que estava no feed, em vez de um ecrã vazio até a rede responder.
 * Um repost simples no feed traz a original dentro: também conta.
 */
export function findCachedPost(entries: Cached[], key: string): Post | undefined {
  if (!key) return undefined;
  const look = (p: Post | null | undefined): Post | undefined => (!p ? undefined : matches(p, key) ? p : p.repostOf && matches(p.repostOf, key) ? p.repostOf : undefined);
  for (const d of entries) {
    if (!d) continue;
    if (Array.isArray(d)) {
      for (const p of d) { const f = look(p); if (f) return f; }
    } else if ('pages' in d && Array.isArray(d.pages)) {
      for (const pg of d.pages) for (const p of pg?.items ?? []) { const f = look(p); if (f) return f; }
    } else {
      const f = look(d as Post);
      if (f) return f;
    }
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
