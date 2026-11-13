// A geleira partilhada num post (0143): as prateleiras do cartão, os brindes a cada gosto (resposta já, confirma depois) e os
// textos. Sem dependências (os testes correm em Node: tests/geleiraPost.test.mjs).

export interface ShelfItem { id: string; kind: string; cheers?: number; cheered?: boolean }
export interface GeleiraLike<T extends ShelfItem = ShelfItem> { total: number; items: T[] }

/** Número inteiro e não negativo (o servidor pode mandar lixo). */
const count = (n: unknown): number => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.floor(n) : 0);

/**
 * As prateleiras do frigorífico: primeiro as bebidas, depois as comidas (cada uma pela ordem do retrato), `perShelf` por
 * prateleira e no máximo `maxShelves`. `more`: quantos gostos ficam de fora (os do retrato que não cabem e os que nem
 * entraram no retrato, pelo `total`). Uma prateleira nunca mistura bebidas e comidas.
 */
export function shelvesOf<T extends ShelfItem>(g: GeleiraLike<T>, perShelf = 4, maxShelves = Infinity): { shelves: { kind: string; items: T[] }[]; more: number } {
  const per = Math.max(1, Math.floor(perShelf));
  const shelves: { kind: string; items: T[] }[] = [];
  for (const kind of ['bebida', 'comida']) {
    const list = g.items.filter((i) => i.kind === kind);
    for (let k = 0; k < list.length; k += per) shelves.push({ kind, items: list.slice(k, k + per) });
  }
  const kept = shelves.slice(0, Math.max(0, maxShelves));
  const shown = kept.reduce((n, s) => n + s.items.length, 0);
  return { shelves: kept, more: Math.max(0, Math.max(count(g.total), g.items.length) - shown) };
}

/** Resposta já: alterna o brinde a um gosto e acerta a contagem (nunca abaixo de 0). Devolve um objeto novo. */
export function toggleItemCheer<T extends ShelfItem, G extends GeleiraLike<T>>(g: G, itemId: string): G {
  return { ...g, items: g.items.map((i) => (i.id === itemId ? { ...i, cheered: !i.cheered, cheers: i.cheered ? Math.max(0, count(i.cheers) - 1) : count(i.cheers) + 1 } : i)) };
}

/** Junta a resposta do servidor (`{ itemId, cheered, cheers }`). */
export function applyItemCheer<T extends ShelfItem, G extends GeleiraLike<T>>(g: G, r: { itemId: string; cheered: boolean; cheers: number }): G {
  return { ...g, items: g.items.map((i) => (i.id === r.itemId ? { ...i, cheered: !!r.cheered, cheers: count(r.cheers) } : i)) };
}

/** "12 gostos" / "1 gosto". */
export function tastesCount(n: unknown): string {
  const k = count(n);
  return `${k} ${k === 1 ? 'gosto' : 'gostos'}`;
}

/** O que o leitor de ecrã diz num gosto do cartão (quem vê pode brindar; o dono só vê quantos brindes tem). */
export function itemA11yLabel(i: { name: string; cheers?: number; cheered?: boolean; favorite?: boolean }, mine: boolean): string {
  const k = count(i.cheers);
  const n = k ? `, ${k} ${k === 1 ? 'brinde' : 'brindes'}` : '';
  const fav = i.favorite ? ', favorito' : '';
  if (mine) return `${i.name}${fav}${n}`;
  return i.cheered ? `${i.name}${fav}${n}. Tirar o brinde` : `Brindar a ${i.name}${fav}${n}`;
}

/** Porque é que não dá para partilhar (ou null se dá): só se partilha com bebidas ou comidas aprovadas na geleira. */
export function shareBlockReason(items: { kind: string; pending?: boolean }[] | null | undefined): string | null {
  const ok = (items ?? []).some((i) => !i.pending && (i.kind === 'bebida' || i.kind === 'comida'));
  return ok ? null : 'A tua geleira está vazia. Junta bebidas ou comidas (as que sugeriste só contam depois de aprovadas) e depois partilha-a.';
}

/** Aviso no ecrã de publicar quando a geleira não está à vista de todos: o post segue a visibilidade das publicações. */
export function visibilityNote(v: string | null | undefined, isPrivate: boolean): string | null {
  if (v === 'everyone' || !v) return isPrivate ? 'A tua conta é privada: só quem te segue vê este post.' : null;
  const who = v === 'followers' ? 'só para quem te segue' : v === 'close_friends' ? 'só para os teus amigos próximos' : 'só para ti';
  return `No perfil, a tua geleira está ${who}. Este post mostra-a a quem puder ver as tuas publicações${isPrivate ? ' (a tua conta é privada: quem te segue)' : ''}.`;
}
