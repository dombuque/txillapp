import { post, raw, type Badged, type Post } from '@/lib/api';

/**
 * Mixar: o feed a dois (como o Blend do Instagram). O contrato fixo entre a API e a app está em docs/mixar-contrato.md;
 * os tipos são os de lá, tal e qual. A lógica pura (textos, estados, sinais) está em lib/mixar.ts.
 */

export type MixarPerson = { username: string; displayName: string; hasAvatar: boolean } & Badged;
/** As reações exclusivas do Mixar (não são brindes na publicação: ficam só no Mixar e só os dois as veem). */
export type MixarReactionId = 'kkk' | 'fogo' | 'amor' | 'uau' | 'brinde' | 'nah';
export type MixarStatus = 'pending' | 'active';
/** Um tema dos gostos (o perfil de temas do explore). */
export interface MixarTopic { topic: string; label: string }

export interface MixarSummary {
  id: string;
  status: MixarStatus;
  /** pending: fui eu que convidei? */
  invitedByMe: boolean;
  partner: MixarPerson;
  /** «Dom + Ana» (os primeiros nomes). */
  name: string;
  /** Itens de hoje que eu ainda não vi. */
  newToday: number;
  /** Há desafio de hoje à espera da minha escolha. */
  challengePending: boolean;
  updatedAt: string;
}

export interface Mixar extends MixarSummary {
  createdAt: string;
  acceptedAt: string | null;
  /** 0–100: quanto os gostos batem. */
  match: number;
  /** Temas em comum, do mais forte para o mais fraco (até 8). */
  common: (MixarTopic & { score: number })[];
  /** O que é mais meu (até 4). */
  onlyMe: MixarTopic[];
  /** O que é mais do outro (até 4). */
  onlyThem: MixarTopic[];
  /** Dias seguidos com os dois a jogar o desafio. */
  streak: number;
  /** Desafios em que escolheram o mesmo. */
  matches: number;
}

/** De quem é o gosto que trouxe o item, do ponto de vista de quem pede. */
export type MixarFrom = 'me' | 'them' | 'both';

export interface MixarItem {
  /** Exatamente a mesma forma que GET /feed/reels devolve em cada item. */
  post: Post;
  from: MixarFrom;
  topic: MixarTopic | null;
  mine: MixarReactionId | null;
  theirs: MixarReactionId | null;
  seenByThem: boolean;
}

export interface MixarFeedPage { items: MixarItem[]; nextCursor: string | null; day: string }

export type MixarChallengeKind = 'mais_engracado' | 'mais_txilado' | 'partilhavas' | 'repetias';
export interface MixarChallenge {
  id: string;
  kind: MixarChallengeKind;
  question: string;
  /** 'YYYY-MM-DD' */
  day: string;
  /** 3 ou 4. */
  options: Post[];
  /** postId */
  myPick: string | null;
  /** O outro já escolheu? (sem dizer qual) */
  theirPicked: boolean;
  /** Só quando os dois escolheram. */
  theirPick: string | null;
  /** Só quando os dois escolheram. */
  match: boolean | null;
}

/** O cartão do chat (mensagem kind 'mixar'): o estado é sempre o atual, não o do envio. */
export interface ChatMixar { id: string; status: 'pending' | 'active' | 'declined' | 'ended'; invitedByMe: boolean; name: string }

export const mixarApi = {
  /** 201 Mixar; 409 `{ id }` se já há um ativo ou pendente com essa pessoa; 403 bloqueio ou regras do chat; 429 limites. */
  invite: (username: string): Promise<Mixar> => raw('/mixar/invite', post({ username })),
  accept: (id: string): Promise<Mixar> => raw(`/mixar/${id}/accept`, post({})),
  decline: (id: string): Promise<{ ok: true }> => raw(`/mixar/${id}/decline`, post({})),
  /** Sair do Mixar (fica `ended` para os dois). */
  leave: (id: string): Promise<{ ok: true }> => raw(`/mixar/${id}`, { method: 'DELETE' }),
  /** Os ativos e os convites pendentes que recebi ou mandei. */
  list: (): Promise<{ items: MixarSummary[] }> => raw('/mixar'),
  /** O Mixar com essa pessoa, se existir (404 se não). */
  with: (username: string): Promise<Mixar> => raw(`/mixar/with/${encodeURIComponent(username)}`),
  get: (id: string): Promise<Mixar> => raw(`/mixar/${id}`),
  feed: (id: string, cursor?: string, limit = 8): Promise<MixarFeedPage> => raw(`/mixar/${id}/feed?limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`),
  react: (id: string, postId: string, reaction: MixarReactionId | null): Promise<{ mine: MixarReactionId | null; theirs: MixarReactionId | null }> => raw(`/mixar/${id}/items/${postId}/react`, post({ reaction })),
  seen: (id: string, postId: string, b: { watchedMs?: number; done?: boolean }): Promise<void> => raw(`/mixar/${id}/items/${postId}/seen`, post(b)),
  /** Depois de mandar o item para o chat (com o envio de sempre, kind 'post'). */
  shared: (id: string, postId: string): Promise<void> => raw(`/mixar/${id}/items/${postId}/shared`, post({})),
  /** O desafio de hoje (null se não há). */
  challenge: (id: string): Promise<MixarChallenge | null> => raw(`/mixar/${id}/challenge`),
  pick: (id: string, challengeId: string, postId: string): Promise<MixarChallenge> => raw(`/mixar/${id}/challenge/${challengeId}/pick`, post({ postId })),
};

/**
 * Chaves do react-query. Tudo o que é de um Mixar começa por ['mixar', id] (invalidar esse prefixo põe tudo em dia); a
 * lista e o «com esta pessoa» ficam à parte.
 */
export const mixarKeys = {
  list: () => ['mixar-list'] as const,
  with: (username?: string) => (username ? (['mixar-with', username] as const) : (['mixar-with'] as const)),
  one: (id: string) => ['mixar', id] as const,
  feed: (id: string) => ['mixar', id, 'feed'] as const,
  challenge: (id: string) => ['mixar', id, 'challenge'] as const,
};
