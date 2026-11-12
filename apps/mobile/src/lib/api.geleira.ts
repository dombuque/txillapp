import { post, raw, type Badged } from '@/lib/api';

/** Tipos e chamadas da Geleira e dos Zás (copiados do site; as chamadas usam a mesma sessão da app). */
export type TasteKind = 'vibe' | 'bebida' | 'comida' | 'sitio';
export type TasteVisibility = 'everyone' | 'followers' | 'close_friends' | 'me';
export interface TasteItem { id: string; slug: string; name: string; kind: TasteKind; category: string; alcoholic: boolean; pending: boolean }
export interface CatalogItem extends TasteItem { mine: boolean; rating: number | null; favorite: boolean; fans: number; region: 'local' | 'global' | 'foreign' }
export interface MyTaste extends TasteItem { rating: number | null; favorite: boolean }
export interface TheirTaste extends TasteItem { rating: number | null; favorite: boolean }
/**
 * `cheers`/`cheered`: os brindes à geleira (servidor antigo não manda → sem botão de brindar). `cheersListable`: posso ver
 * quem brindou (o dono sempre; os outros se o dono mostra a lista nas definições).
 */
export interface GeleiraLevel { points: number; level: number; title: string; toNext: number | null; nextTitle: string | null; cheers?: number; cheered?: boolean; cheersListable?: boolean }
export interface GeleiraCheer { cheered: boolean; cheers: number }
export interface GeleiraCheerer extends Badged { username: string; displayName: string; hasAvatar: boolean; at: string }

export interface InstantItem { id: string; url: string; caption: string; at: string; expiresAt: string; views?: number; reactions?: { reaction: string; count: number }[] }
export interface InstantTray {
  mine: { count: number; views: number; endsAt: string | null };
  others: ({ username: string; displayName: string; hasAvatar: boolean; count: number; latestAt: string; close: boolean; preview: string | null } & Badged)[];
}
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
};

export const instantsApi = {
  tray: (): Promise<InstantTray> => raw('/instants'),
  of: (username: string): Promise<InstantItem[]> => raw(`/instants/of/${encodeURIComponent(username)}`),
  create: (mediaId: string, caption: string, audience: 'friends' | 'close' = 'friends'): Promise<{ id: string; expiresAt: string }> => raw('/instants', post({ mediaId, caption, audience })),
  view: (id: string): Promise<void> => raw(`/instants/${id}/view`, post({})),
  react: (id: string, reaction: string): Promise<void> => raw(`/instants/${id}/reaction`, { method: 'PUT', body: JSON.stringify({ reaction }) }),
  viewers: (id: string): Promise<InstantViewer[]> => raw(`/instants/${id}/viewers`),
  remove: (id: string): Promise<void> => raw(`/instants/${id}`, { method: 'DELETE' }),
};
