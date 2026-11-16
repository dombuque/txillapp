import { post, raw } from '@/lib/api';
import type { MixarItem, MixarPerson } from '@/lib/api.mixar';

/**
 * Mixar, social e guardados (docs/mixar-contrato.md, «Social e guardados»): a conversa só dos dois em cada item, o «ver
 * juntos», o «Mais 5» e os Guardados. Os tipos são os do contrato. A lógica pura (textos, estados) está em lib/mixarSocial.ts.
 */

export interface MixarComment {
  id: string;
  body: string;
  createdAt: string;
  /** Fui eu que escrevi (só esse se pode apagar). */
  mine: boolean;
  author: MixarPerson;
}
export interface MixarCommentsPage { items: MixarComment[]; nextCursor: string | null }

/** Para o carril: quantos comentários tem cada item e se está nos Guardados. */
export interface MixarItemSocial { postId: string; comments: number; saved: boolean }

export interface MixarSavedItem extends MixarItem {
  savedAt: string;
  /** Quem guardou: eu, o outro, ou os dois (entrou sozinho porque os dois reagiram). */
  savedBy: 'me' | 'them' | 'both';
}
export interface MixarSavedPage { items: MixarSavedItem[]; nextCursor: string | null }

/** Onde está o outro: com o Mixar aberto (`here`) e em que item (`postId`, null se ainda em nenhum). */
export interface MixarPartnerPresence { here: boolean; postId: string | null }

/** O evento em tempo real do social do Mixar (no mesmo canal SSE): `{ type: 'mixar.live', id, what, … }`. */
export interface MixarLiveEvent {
  type: 'mixar.live';
  id: string;
  what: 'comment' | 'saved' | 'more' | 'presence';
  postId?: string | null;
  here?: boolean;
  saved?: boolean;
  self?: boolean;
}

export const mixarSocialApi = {
  comments: (id: string, postId: string, cursor?: string): Promise<MixarCommentsPage> => raw(`/mixar/${id}/items/${postId}/comments?limit=30${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`),
  /** 201 MixarComment; 422 se o filtro de texto o recusar; 400 vazio ou com mais de 500 caracteres. */
  comment: (id: string, postId: string, body: string): Promise<MixarComment> => raw(`/mixar/${id}/items/${postId}/comments`, post({ body })),
  /** Só o meu. */
  deleteComment: (id: string, commentId: string): Promise<{ ok: true }> => raw(`/mixar/${id}/comments/${commentId}`, { method: 'DELETE' }),
  social: (id: string, postIds: string[]): Promise<{ items: MixarItemSocial[] }> => raw(`/mixar/${id}/social?posts=${postIds.map(encodeURIComponent).join(',')}`),
  save: (id: string, postId: string): Promise<{ saved: true }> => raw(`/mixar/${id}/saved/${postId}`, post({})),
  unsave: (id: string, postId: string): Promise<{ saved: false }> => raw(`/mixar/${id}/saved/${postId}`, { method: 'DELETE' }),
  saved: (id: string, cursor?: string, limit = 8): Promise<MixarSavedPage> => raw(`/mixar/${id}/saved?limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`),
  moreLeft: (id: string): Promise<{ left: number }> => raw(`/mixar/${id}/more`),
  /** Até 5 itens novos no fim da seleção de hoje; 429 depois de 3 vezes no dia. */
  more: (id: string): Promise<{ added: number; left: number }> => raw(`/mixar/${id}/more`, post({})),
  presence: (id: string, b: { postId?: string | null; leave?: boolean }): Promise<{ partner: MixarPartnerPresence }> => raw(`/mixar/${id}/presence`, post(b)),
};

/** Chaves do react-query: tudo debaixo de ['mixar', id] (invalidar esse prefixo põe tudo em dia). */
export const mixarSocialKeys = {
  comments: (id: string, postId: string) => ['mixar', id, 'comments', postId] as const,
  social: (id: string, postIds?: string) => (postIds === undefined ? (['mixar', id, 'social'] as const) : (['mixar', id, 'social', postIds] as const)),
  saved: (id: string) => ['mixar', id, 'saved'] as const,
  more: (id: string) => ['mixar', id, 'more'] as const,
};
