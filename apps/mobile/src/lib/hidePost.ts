/**
 * «Ocultar publicação» / «Voltar a mostrar» (0169): o autor esconde uma publicação sua e volta a mostrá-la quando quiser (como
 * o «Arquivar»). Enquanto está oculta só ele a vê, no separador «Ocultas» do perfil e pelo link; para os outros é como uma
 * apagada. Lógica pura, sem React nem a API, para se poder testar (tests/ocultarPublicacao.test.mjs). O pedido e o aviso com
 * «Desfazer» ficam em lib/hidePostAction.
 */

/** A resposta do servidor (409) quando há uma campanha do Bombar a decorrer nesta publicação. */
export const HIDE_BOOSTED = 'Esta publicação está a bombar. Podes ocultá-la quando o Bombar acabar.';

type Hideable = { hidden?: boolean; kind?: string; body?: string; author?: { id?: string } };

/** Só o autor oculta (num post de um local, o autor é quem o publicou: a API manda o id dele só a ele). */
export function canHide(post: Hideable | null | undefined, me: string | null | undefined): boolean {
  return !!post && !!me && post.author?.id === me;
}

/** A linha do menu «⋯»: o que diz conforme a publicação já está oculta ou não. `repost`: é o meu repost simples. */
export function hideMenuRow(post: Hideable, repost = false): { title: string; text: string } {
  if (post.hidden) return { title: 'Voltar a mostrar', text: 'Volta ao mesmo sítio, com os brindes e os comentários.' };
  if (repost) return { title: 'Ocultar o repost', text: 'Só tu o vês. Podes voltar a mostrá-lo quando quiseres.' };
  return { title: 'Ocultar publicação', text: 'Só tu a vês. Podes voltar a mostrá-la quando quiseres.' };
}

/** O aviso curto depois de ocultar ou de voltar a mostrar (com «Desfazer»). */
export function hideToastText(hidden: boolean, repost = false): string {
  if (repost) return hidden ? 'Repost ocultado. Só tu o vês.' : 'O repost voltou a aparecer.';
  return hidden ? 'Publicação ocultada. Só tu a vês.' : 'A publicação voltou a aparecer.';
}

/** O texto de um erro ao ocultar: o do Bombar (409) tal como vem, a publicação que já não existe, ou a falta de rede. */
export function hideErrorText(status: number | null | undefined, message?: string | null): string {
  if (status === 409) return message || HIDE_BOOSTED;
  if (status === 404) return 'Esta publicação já não existe.';
  if (status === 429) return 'Muitas mudanças seguidas. Espera um bocadinho.';
  return 'Não deu. Verifica a ligação e tenta outra vez.';
}

/** O aviso por cima da publicação oculta (só o autor a vê assim). */
export const HIDDEN_BANNER = 'Oculta: só tu vês esta publicação.';

/** As listas de publicações em memória que deixam de a mostrar (ou que a voltam a mostrar). */
export const HIDE_LIST_KEYS = ['feed', 'feed-peek', 'profile-posts', 'reels', 'explore', 'saved', 'tag', 'place', 'search', 'venue-posts', 'venue-page-posts', 'sound', 'remixes'] as const;

type Postish = { id: string; repostOf?: Postish | null } & Record<string, unknown>;

/**
 * Tira a publicação `id` (e os reposts dela) de uma lista em memória: as páginas ({ pages: [{ items }] }) e as respostas com
 * listas ({ items }, { posts }). Uma publicação sozinha (a página dela) fica como está. Devolve o mesmo objeto se não mudou.
 */
export function dropPost<T>(value: T, id: string): T {
  const keep = (x: unknown) => {
    const p = x as Postish | null;
    return !(p && typeof p === 'object' && (p.id === id || (p.repostOf && typeof p.repostOf === 'object' && p.repostOf.id === id)));
  };
  const walk = (v: unknown, depth: number): unknown => {
    if (!v || typeof v !== 'object' || depth > 3) return v;
    if (Array.isArray(v)) {
      const out = v.filter(keep);
      return out.length === v.length ? v : out;
    }
    const o = v as Record<string, unknown>;
    let changed = false;
    const next: Record<string, unknown> = { ...o };
    for (const k of ['pages', 'items', 'posts', 'results']) {
      if (!Array.isArray(o[k])) continue;
      const arr = k === 'pages' ? (o[k] as unknown[]).map((pg) => walk(pg, depth + 1)) : walk(o[k], depth + 1);
      const same = k === 'pages' ? (arr as unknown[]).every((pg, i) => pg === (o[k] as unknown[])[i]) : arr === o[k];
      if (!same) { next[k] = arr; changed = true; }
    }
    return changed ? next : v;
  };
  return walk(value, 0) as T;
}
