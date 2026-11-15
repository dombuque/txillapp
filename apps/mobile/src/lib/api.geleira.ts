import { ApiError, post, raw, type Badged } from '@/lib/api';
import type { LevelDetail } from '@/lib/geleiraLevel';

/** Tipos e chamadas da Geleira e dos Zás (copiados do site; as chamadas usam a mesma sessão da app). */
export type TasteKind = 'vibe' | 'bebida' | 'comida' | 'sitio';
export type TasteVisibility = 'everyone' | 'followers' | 'close_friends' | 'me';
export interface TasteItem { id: string; slug: string; name: string; kind: TasteKind; category: string; alcoholic: boolean; pending: boolean }
export interface CatalogItem extends TasteItem { mine: boolean; rating: number | null; favorite: boolean; fans: number; region: 'local' | 'global' | 'foreign' }
/** `cheers`: brindes a este gosto (no perfil e nos posts da geleira; servidor antigo não manda). `cheered`: eu já brindei. */
export interface MyTaste extends TasteItem { rating: number | null; favorite: boolean; cheers?: number }
export interface TheirTaste extends TasteItem { rating: number | null; favorite: boolean; cheers?: number; cheered?: boolean }
/**
 * `cheers`/`cheered`: os brindes à geleira (servidor antigo não manda → sem botão de brindar). `cheersListable`: posso ver
 * quem brindou (o dono sempre; os outros se o dono mostra a lista nas definições).
 */
/**
 * O nível (0146): o que a pessoa vive com a malta nos últimos 90 dias. `progress`: a barra (0 a 1). `detail` (de onde vêm os
 * pontos) e `tip` (o que falta, em coisas concretas) só vêm para o dono. Servidor antigo: sem `progress`, `steps`, `detail`.
 */
export interface GeleiraLevel { points: number; level: number; title: string; toNext: number | null; nextTitle: string | null; steps?: number[]; progress?: number; detail?: LevelDetail; tip?: string; cheers?: number; cheered?: boolean; cheersListable?: boolean }
export interface GeleiraCheer { cheered: boolean; cheers: number }
/** `post`: o brinde veio do post da geleira (só o dono vê; sem post quando foi apagado). */
export interface GeleiraCheerer extends Badged { username: string; displayName: string; hasAvatar: boolean; at: string; post?: { code: string } }
/** Um gosto no cartão de um post da geleira: o retrato do momento da partilha e os brindes de agora. */
export interface PostGeleiraItem { id: string; slug: string; name: string; kind: TasteKind; category: string; alcoholic: boolean; favorite: boolean; rating: number | null; cheers: number; cheered: boolean }
/** A geleira partilhada num post (`post.geleira`): sem bebidas alcoólicas para quem tem menos de 18 anos. */
export interface PostGeleira { level: number; total: number; items: PostGeleiraItem[] }
export interface ItemCheer { itemId: string; cheered: boolean; cheers: number }
export interface GeleiraSettings { matching: boolean; visibility: TasteVisibility; cheersPublic: boolean }

/**
 * `captionFont`: a letra da legenda (lib/textLayers; null ou desconhecida: a clássica). Servidores antigos não mandam.
 * Só nos meus (`GET /instants/archive`): `active` (ainda dentro das 24 h, os outros veem-no; `false` = guardado, só eu o
 * vejo) e `keepUntil` (até quando fica guardado para mim; null quando não fica).
 */
export interface InstantItem { id: string; url: string; caption: string; captionFont?: string | null; at: string; expiresAt: string; views?: number; reactions?: { reaction: string; count: number }[]; active?: boolean; keepUntil?: string | null }
/** Um Zás meu do arquivo «Os meus Zás» (os últimos 7 dias, do mais antigo para o mais recente). */
export interface ArchivedInstant extends InstantItem { active: boolean; keepUntil: string | null }
/** «Guardar os meus Zás para o resumo semanal» (Definições → Privacidade → Zás). Ligada por omissão. */
export interface ZasSettings { keepForRecap: boolean }
/** Para quem vai o resumo publicado nos mimos: `all` = Amigos (quem vê os meus mimos), `close_friends` = Amigos próximos. */
export type RecapAudience = 'all' | 'close_friends';
/**
 * O resumo semanal dos Zás: uma imagem 1080×1920 desenhada no servidor ao domingo à noite (hora de Moçambique) para quem
 * teve 3 Zás ou mais na semana. Só o dono a vê até a publicar nos mimos. `url`: endereço assinado (relativo, aceita &w=).
 * `label`: «8–15 nov». `count`: Zás na semana; `photos`: quantas fotos entraram na imagem.
 */
export interface ZasRecap {
  id: string;
  url: string;
  weekStart: string;
  weekEnd: string;
  label: string;
  count: number;
  photos: number;
  createdAt: string;
  expiresAt: string;
  published: { storyId: string | null; audience: RecapAudience; at: string } | null;
}
export interface InstantTray {
  mine: { count: number; views: number; endsAt: string | null };
  others: ({ username: string; displayName: string; hasAvatar: boolean; count: number; latestAt: string; close: boolean; preview: string | null } & Badged)[];
}
/** Quem fez um Zás (no visor em pilha, cada cartão traz o seu). */
export type InstantAuthor = { username: string; displayName: string; hasAvatar: boolean } & Badged;
/** Um Zás da lista do visor: o Zás e quem o fez. */
export interface FeedInstant extends InstantItem { author: InstantAuthor }
export interface InstantViewer extends Badged { username: string; displayName: string; hasAvatar: boolean; at: string; reaction?: string | null }

export const geleiraApi = {
  catalog: (q: string, kind?: TasteKind): Promise<CatalogItem[]> => raw(`/geleira/catalog?q=${encodeURIComponent(q)}${kind ? `&kind=${kind}` : ''}`),
  mine: (): Promise<MyTaste[]> => raw('/geleira/me'),
  of: (username: string): Promise<TheirTaste[]> => raw(`/users/${encodeURIComponent(username)}/geleira`),
  put: (itemId: string, b: { rating?: number | null; favorite?: boolean }): Promise<void> => raw(`/geleira/me/items/${itemId}`, { method: 'PUT', body: JSON.stringify(b) }),
  remove: (itemId: string): Promise<void> => raw(`/geleira/me/items/${itemId}`, { method: 'DELETE' }),
  suggest: (b: { name: string; kind: TasteKind; category: string; alcoholic?: boolean }): Promise<TasteItem> => raw('/geleira/items', post(b)),
  level: (username: string): Promise<GeleiraLevel> => raw(`/users/${encodeURIComponent(username)}/geleira/level`),
  /** Brinda a geleira de alguém (400 na própria, 404 se não a pode ver). */
  cheer: (username: string): Promise<GeleiraCheer> => raw(`/users/${encodeURIComponent(username)}/geleira/cheer`, { method: 'PUT', body: '{}' }),
  uncheer: (username: string): Promise<GeleiraCheer> => raw(`/users/${encodeURIComponent(username)}/geleira/cheer`, { method: 'DELETE' }),
  /** Quem brindou a geleira: o dono sempre; os outros se o dono mostra a lista (403 se não, 404 se não vê a geleira). */
  cheers: (username: string): Promise<{ items: GeleiraCheerer[] }> => raw(`/users/${encodeURIComponent(username)}/geleira/cheers`),
  geo: (): Promise<{ country: string | null }> => raw('/health/geo'),
  settings: (): Promise<GeleiraSettings> => raw('/geleira/me/settings'),
  /** Brindar um gosto (no perfil, ou no cartão de um post da geleira): é o mesmo brinde, uma vez por pessoa e gosto. */
  cheerItem: (username: string, itemId: string, on: boolean): Promise<ItemCheer> => raw(`/users/${encodeURIComponent(username)}/geleira/items/${itemId}/cheer`, on ? { method: 'PUT', body: '{}' } : { method: 'DELETE' }),
  cheerPostItem: (postId: string, itemId: string, on: boolean): Promise<ItemCheer> => raw(`/posts/${postId}/geleira/items/${itemId}/cheer`, on ? { method: 'PUT', body: '{}' } : { method: 'DELETE' }),
};

export const instantsApi = {
  tray: (): Promise<InstantTray> => raw('/instants'),
  of: (username: string): Promise<InstantItem[]> => raw(`/instants/of/${encodeURIComponent(username)}`),
  /**
   * Todos os Zás por ver numa lista só (o visor em pilha passa de uma pessoa à seguinte sem ir à rede). Servidor antigo
   * (sem /instants/feed): junta os de cada pessoa da faixa, pedidos todos ao mesmo tempo.
   */
  async feed(people: readonly InstantAuthor[] = []): Promise<FeedInstant[]> {
    try {
      return (await raw('/instants/feed')) as FeedInstant[];
    } catch (e) {
      if (!(e instanceof ApiError && e.status === 404)) throw e;
      const lists = await Promise.all(people.map((a) => raw(`/instants/of/${encodeURIComponent(a.username)}`).then((r) => (r as InstantItem[]).map((it) => ({ ...it, author: a }))).catch(() => [] as FeedInstant[])));
      return lists.flat();
    }
  },
  /** `captionFont`: a letra da legenda (a clássica não precisa de ir). */
  create: (mediaId: string, caption: string, audience: 'friends' | 'close' = 'friends', captionFont?: string): Promise<{ id: string; expiresAt: string }> =>
    raw('/instants', post({ mediaId, caption, audience, ...(captionFont ? { captionFont } : {}) })),
  view: (id: string): Promise<void> => raw(`/instants/${id}/view`, post({})),
  react: (id: string, reaction: string): Promise<void> => raw(`/instants/${id}/reaction`, { method: 'PUT', body: JSON.stringify({ reaction }) }),
  viewers: (id: string): Promise<InstantViewer[]> => raw(`/instants/${id}/viewers`),
  remove: (id: string): Promise<void> => raw(`/instants/${id}`, { method: 'DELETE' }),
  /** Fiz uma captura do Zás de outra pessoa (iPhone, ou Android 14+ quando o sistema avisa): o dono fica a saber. */
  screenshot: (id: string): Promise<unknown> => raw(`/instants/${id}/screenshot`, post({})),
  /** A definição do resumo semanal. Servidor antigo: 404 (sem resumo nem arquivo). */
  settings: (): Promise<ZasSettings> => raw('/instants/settings'),
  /** Mudar a definição. Ao desligar, `removed` diz quantos Zás guardados (já fora das 24 h) se apagaram logo. */
  setSettings: (keepForRecap: boolean): Promise<ZasSettings & { removed: number }> => raw('/instants/settings', { method: 'PUT', body: JSON.stringify({ keepForRecap }) }),
  /**
   * «Os meus Zás»: os dos últimos 7 dias (os ativos e os guardados só para mim), do mais antigo para o mais recente.
   * Servidor antigo (404): os ativos, como antes (`/instants/of/<o meu @>`).
   */
  async archive(username: string): Promise<ArchivedInstant[]> {
    try {
      return (await raw('/instants/archive')) as ArchivedInstant[];
    } catch (e) {
      if (!(e instanceof ApiError && e.status === 404)) throw e;
      const list = (await raw(`/instants/of/${encodeURIComponent(username)}`)) as InstantItem[];
      return list.map((it) => ({ ...it, active: true, keepUntil: null }));
    }
  },
  /** Os meus resumos (o mais recente primeiro; normalmente 0 ou 1). Servidor antigo (404): nenhum. */
  async recaps(): Promise<ZasRecap[]> {
    try {
      return ((await raw('/instants/recaps')) as ZasRecap[] | undefined) ?? [];
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) return [];
      throw e;
    }
  },
  /** Um resumo (404 quando já não existe). */
  recap: (id: string): Promise<ZasRecap> => raw(`/instants/recaps/${encodeURIComponent(id)}`),
  /** Publicar o resumo nos mimos (409 se já está num mimo que ainda existe). */
  publishRecap: (id: string, audience: RecapAudience): Promise<{ storyId: string; recap: ZasRecap }> => raw(`/instants/recaps/${encodeURIComponent(id)}/publish`, post({ audience })),
  /** Descartar o resumo (204). */
  removeRecap: (id: string): Promise<void> => raw(`/instants/recaps/${encodeURIComponent(id)}`, { method: 'DELETE' }),
};
