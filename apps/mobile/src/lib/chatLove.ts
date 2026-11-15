/**
 * Duplo toque numa mensagem = coração (como no Instagram). A lógica pura, sem dependências (tests/chatLove.test.mjs).
 *
 * O coração é a reação «Adorar» (`:amor:`) que o menu das reações já tem: a mesma no servidor (uma reação por pessoa e
 * mensagem; social.message_reactions), nas versões antigas da app e na lista de reações por baixo da bolha.
 * - Dois toques seguidos (até LOVE_TAP_MS) numa bolha põem o coração; se a minha reação já é o coração, não a tira (tirar é
 *   pelo menu das reações). Se eu tinha outra reação, passa a coração (uma por pessoa).
 * - Um toque só continua a mostrar a hora (depois de LOVE_TAP_MS, para dar tempo ao segundo toque); os toques que abrem
 *   coisas dentro da bolha (fotos, vídeos, links, voz, cartões) são deles e não contam aqui.
 * - No computador, o duplo clique (o `detail` do clique do rato é 2).
 * - Só nas mensagens já enviadas, que não foram apagadas e que não são de ver uma vez (nem avisos de sistema).
 */
export const LOVE_REACTION = ':amor:';

/** Janela entre o primeiro e o segundo toque (o mesmo tempo que a bolha já esperava para mostrar a hora). */
export const LOVE_TAP_MS = 280;

/** Quanto tempo o coração fica a saltar por cima da bolha. */
export const LOVE_BURST_MS = 850;

interface Reaction { reaction: string; count: number; mine: boolean }
interface LoveMsg { id: string; kind?: string; deleted?: boolean; viewOnce?: boolean; state?: string; reactions?: Reaction[] }

/** Esta mensagem aceita o coração do duplo toque? */
export function canLove(m: LoveMsg): boolean {
  if (m.id.startsWith('tmp-') || m.state) return false;
  return !m.deleted && !m.viewOnce && m.kind !== 'system';
}

/** A minha reação já é o coração (o duplo toque só anima, não muda nada no servidor). */
export const lovedByMe = (m: LoveMsg) => !!m.reactions?.some((r) => r.mine && r.reaction === LOVE_REACTION);

/** As reações depois do coração (otimista): a minha passa a ser o coração; a contagem das outras acerta-se. */
export function withLove(reactions: Reaction[] | undefined): Reaction[] {
  const list = (reactions ?? []).map((r) => (r.mine ? { ...r, count: r.count - 1, mine: false } : r)).filter((r) => r.count > 0);
  const i = list.findIndex((r) => r.reaction === LOVE_REACTION);
  if (i >= 0) return list.map((r, j) => (j === i ? { ...r, count: r.count + 1, mine: true } : r));
  return [...list, { reaction: LOVE_REACTION, count: 1, mine: true }];
}

/** A conversa (páginas do react-query) com o coração já posto nesta mensagem, antes de o servidor responder. */
export function applyLoveToPages<D>(data: D, id: string): D {
  const d = data as unknown as { pages?: { items?: LoveMsg[] }[] } | undefined;
  if (!d || !Array.isArray(d.pages)) return data;
  return {
    ...d,
    pages: d.pages.map((p) => (Array.isArray(p.items) ? { ...p, items: p.items.map((m) => (m.id === id ? { ...m, reactions: withLove(m.reactions) } : m)) } : p)),
  } as unknown as D;
}

/** Computador: este clique do rato é o segundo de um duplo clique? (`detail` conta os cliques seguidos.) */
export const isDoubleClick = (detail: unknown) => detail === 2;

/**
 * Os passos do coração a saltar (0 → 1 ao longo de LOVE_BURST_MS): cresce depressa até passar um pouco do tamanho,
 * assenta, sobe um pouco e desaparece. Com "reduzir movimento", só aparece e desaparece, sem crescer nem subir.
 */
export function loveFrames(reduced: boolean): { input: number[]; scale: number[]; opacity: number[]; lift: number[] } {
  if (reduced) return { input: [0, 0.15, 0.75, 1], scale: [1, 1, 1, 1], opacity: [0, 1, 1, 0], lift: [0, 0, 0, 0] };
  return { input: [0, 0.18, 0.3, 0.7, 1], scale: [0.2, 1.25, 1, 1, 0.9], opacity: [0, 1, 1, 1, 0], lift: [0, -4, -6, -10, -26] };
}
