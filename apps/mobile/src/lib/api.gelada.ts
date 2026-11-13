import { post, raw, type Badged, type Post } from '@/lib/api';

/**
 * «Paga-me uma» (API: apps/api/src/gelada, migração 0145). Fase 1, sem dinheiro: pedidos, o livro das geladas e as rodadas.
 * Os tipos seguem gelada-cards.ts (RequestDto, RoundDto, PostGeladaDto) e gelada.service.ts (DebtDto).
 */

/** Uma bebida guardada como estava. `masked`: escondida para quem tem menos de 18 anos («uma bebida»). */
export interface GeladaDrink { slug: string; name: string; category: string; alcoholic: boolean; masked?: boolean }
export interface GeladaPerson extends Badged { username: string; displayName: string; hasAvatar: boolean }
export type GeladaStatus = 'pending' | 'accepted' | 'declined' | 'owed' | 'untagged';
export type GeladaAnswer = 'accept' | 'decline' | 'owe';
export type GeladaChannel = 'chat' | 'post';

export interface GeladaRequest {
  id: string;
  status: GeladaStatus;
  channel: GeladaChannel;
  /** null se a conta já não existe («Conta eliminada» vem como displayName e username vazio). */
  requester: GeladaPerson | null;
  recipient: GeladaPerson | null;
  drink: GeladaDrink;
  /** Sem álcool (refresco ou sumo). */
  soft: boolean;
  /** «Paga-me uma 2M 🍺», na voz de quem pede. */
  text: string;
  mine: boolean;
  forMe: boolean;
  canAnswer: boolean;
  canUntag: boolean;
  debtId: string | null;
  postId: string | null;
  at: string;
  answeredAt: string | null;
}

/** O pedido publicado (`post.gelada`). */
export interface PostGelada { drink: GeladaDrink; text: string; requests: GeladaRequest[]; gone: number }

export interface GeladaDebt {
  id: string;
  debtor: GeladaPerson;
  creditor: GeladaPerson;
  drink: GeladaDrink;
  source: 'request' | 'round' | 'manual';
  status: 'open' | 'paid' | 'forgiven';
  claimed: boolean;
  claimedAt: string | null;
  photoUrl: string | null;
  venue: { slug: string; name: string } | null;
  iOwe: boolean;
  owedToMe: boolean;
  canClaim: boolean;
  canConfirm: boolean;
  canForgive: boolean;
  at: string;
  closedAt: string | null;
}
/** `scope`: 'all' (o livro todo) ou 'between' (só o que há entre mim e a pessoa). `public` só vem no meu. */
export interface GeladaBook { scope: 'all' | 'between'; public?: boolean; owe: number; owed: number; items: GeladaDebt[] }

export interface RoundEntry { person: GeladaPerson; drink: GeladaDrink; mine: boolean }
export interface GeladaRound {
  id: string;
  groupId: string;
  status: 'open' | 'closed';
  openedBy: GeladaPerson | null;
  payer: GeladaPerson | null;
  entries: RoundEntry[];
  me: { joined: boolean; payer: boolean; drink: GeladaDrink | null };
  lastPayer: GeladaPerson | null;
  suggestedPayer: GeladaPerson | null;
  canClose: boolean;
  canBill: boolean;
  at: string;
  closedAt: string | null;
}

export interface DrinkChoice { id: string; slug: string; name: string; category: string; alcoholic: boolean; mine: boolean; favorite: boolean }
export interface DrinkList { soft: boolean; drinks: DrinkChoice[]; suggested: string | null; left: number; max: number }

export const geladaApi = {
  /** As bebidas que posso pedir a estas pessoas (sem álcool se alguém tem menos de 18) e quantos pedidos ainda tenho hoje. */
  drinks: (to: string[] = []): Promise<DrinkList> => raw(`/gelada/drinks${to.length ? `?to=${encodeURIComponent(to.join(','))}` : ''}`),
  ask: (b: { to: string[]; itemId: string; channel: GeladaChannel; caption?: string }): Promise<{ requests: GeladaRequest[]; post: Post | null }> => raw('/gelada/requests', post(b)),
  request: (id: string): Promise<GeladaRequest> => raw(`/gelada/requests/${id}`),
  answer: (id: string, answer: GeladaAnswer): Promise<{ request: GeladaRequest; debt: GeladaDebt | null; chatWith: string | null }> => raw(`/gelada/requests/${id}/answer`, post({ answer })),
  /** Tirar a minha identificação de um pedido publicado (fecha o pedido para mim). É o mesmo de tirar a identificação de uma foto. */
  untag: (postId: string): Promise<Post> => raw(`/posts/${postId}/tags/me`, { method: 'DELETE' }),
  myBook: (): Promise<GeladaBook> => raw('/gelada/book'),
  book: (username: string): Promise<GeladaBook> => raw(`/users/${encodeURIComponent(username)}/gelada/book`),
  owe: (to: string, itemId: string): Promise<GeladaDebt> => raw('/gelada/debts', post({ to, itemId })),
  paid: (id: string, proof: { mediaId?: string; venueSlug?: string } = {}): Promise<GeladaDebt> => raw(`/gelada/debts/${id}/paid`, post(proof)),
  confirm: (id: string): Promise<GeladaDebt> => raw(`/gelada/debts/${id}/confirm`, post({})),
  reject: (id: string): Promise<GeladaDebt> => raw(`/gelada/debts/${id}/reject`, post({})),
  forgive: (id: string): Promise<GeladaDebt> => raw(`/gelada/debts/${id}/forgive`, post({})),
  openRound: (groupId: string): Promise<GeladaRound> => raw(`/chat/groups/${groupId}/rodadas`, post({})),
  round: (id: string): Promise<GeladaRound> => raw(`/gelada/rounds/${id}`),
  join: (id: string, itemId: string): Promise<GeladaRound> => raw(`/gelada/rounds/${id}/entry`, { method: 'PUT', body: JSON.stringify({ itemId }) }),
  leave: (id: string): Promise<GeladaRound> => raw(`/gelada/rounds/${id}/entry`, { method: 'DELETE' }),
  pay: (id: string, on: boolean): Promise<GeladaRound> => raw(`/gelada/rounds/${id}/payer`, on ? { method: 'PUT', body: '{}' } : { method: 'DELETE' }),
  close: (id: string, bill = false): Promise<GeladaRound> => raw(`/gelada/rounds/${id}/close`, post({ bill })),
};

/** Chaves do react-query (o livro, os pedidos e as rodadas). */
export const geladaKeys = {
  book: (username?: string) => ['gelada-book', username ?? 'me'] as const,
  drinks: (to: string[]) => ['gelada-drinks', to.join(',')] as const,
  round: (id: string) => ['gelada-round', id] as const,
};
