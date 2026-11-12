import { raw, post } from '@/lib/api';
import type { PlacedSticker } from '@/lib/stickers';
import { trackOk } from '@/lib/analytics';

/** Faixa de música: de licença aberta (catálogo) ou um clipe próprio gravado (`kind: 'clip'`). Igual ao tipo do site. */
export interface Track {
  kind?: 'clip'; mediaId?: string; id: string; title: string; artist: string; url: string; landing: string | null; license: string; licenseUrl: string | null; durationMs: number | null; cover: string | null;
  /** Programa de artistas moçambicanos (interface comum, docs/musica.md): `source: 'local'`, com o @ do artista para a ligação ao perfil. */
  source?: string; artistUsername?: string | null; trackId?: string; previewUrl?: string; styles?: string[]; explicit?: boolean;
}

/** O que se envia ao servidor: uma faixa de licença aberta inteira, só o id de uma faixa de um artista (o servidor vai buscar o resto), ou só os dados do clipe próprio. */
export const musicPayload = (t: Track | null | undefined) =>
  !t ? undefined : t.kind === 'clip' ? { kind: 'clip' as const, mediaId: t.mediaId!, durationMs: t.durationMs ?? 1000, title: t.title } : t.source === 'local' ? { source: 'local' as const, id: t.id } : t;

export const musicApi = {
  search: (q: string): Promise<Track[]> => raw(`/music/search?q=${encodeURIComponent(q)}`),
  /** Sugestões: o que a malta mais está a usar e o que eu usei há pouco. */
  suggested: (): Promise<{ trending: Track[]; recent: Track[] }> => raw('/music/suggested'),
  favorites: (): Promise<Track[]> => raw('/music/favorites'),
  addFavorite: (t: Track): Promise<{ favorite: true }> => raw('/music/favorites', { method: 'PUT', body: JSON.stringify(t) }),
  removeFavorite: (id: string): Promise<{ favorite: false }> => raw(`/music/favorites/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  /** Como `api.createPost`, mas com música (o `createPost` da app ainda não leva o campo). */
  createPost: (b: { body: string; music?: Track | null; locationLabel?: string; mediaIds: string[] }) => trackOk(raw('/posts', post({ ...b, music: musicPayload(b.music) })), 'post_create', { media: b.mediaIds.length, music: !!b.music }),
  createStory: (mediaId: string, caption: string, audience: 'all' | 'close_friends' = 'all', music?: Track | null, stickers: PlacedSticker[] = []) =>
    trackOk(raw('/stories', post({ mediaId, caption, audience, music: musicPayload(music), stickers })), 'story_create', { source: 'camera', closeFriends: audience === 'close_friends', music: !!music, stickers: stickers.length }),
  setNote: (body: string, music?: Track | null): Promise<void> => raw('/notes/me', { method: 'PUT', body: JSON.stringify({ body, music: musicPayload(music) }) }),
};
