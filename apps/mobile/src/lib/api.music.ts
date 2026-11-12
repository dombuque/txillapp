import { raw, post } from '@/lib/api';
import type { PlacedSticker } from '@/lib/stickers';
import { trackOk } from '@/lib/analytics';

/**
 * Faixa de música: do catálogo curado do servidor (ver docs/musica.md) ou um clipe próprio gravado (`kind: 'clip'`).
 * Os campos base são os de sempre (iguais ao tipo do site); os opcionais vêm do catálogo novo (`PickerTrack` no servidor).
 */
export interface Track {
  kind?: 'clip' | 'music' | 'sound';
  mediaId?: string;
  id: string;
  title: string;
  artist: string;
  url: string;
  landing: string | null;
  license: string;
  licenseUrl: string | null;
  durationMs: number | null;
  cover: string | null;
  /** Fonte: ccmixter, archive, jamendo, freesound ou local (artistas de Moçambique). */
  source?: string;
  styles?: string[];
  /** Só na fonte local: o @ do artista no Txillapp (sem o @). */
  artistUsername?: string;
  /** Vezes usada em mimos e tchekas nos últimos 7 dias (só em «Em alta»). */
  uses?: number;
  /** Destacada pela equipa. */
  featured?: boolean;
  /** Duração em segundos e endereço do áudio, com os nomes do contrato novo (iguais a `durationMs` e `url`). */
  duration?: number;
  previewUrl?: string;
}

/** Um estilo ou momento do catálogo (o servidor só manda os que têm faixas). */
export interface MusicStyle { id: string; label: string; kind: 'estilo' | 'momento'; count: number }

/** O início do seletor: estilos, «Em alta no Txillapp», «Artistas de Moçambique» (null sem a fonte local), se há «Sons» e as que usei há pouco. */
export interface MusicHome { styles: MusicStyle[]; trending: Track[]; local: Track[] | null; sounds: boolean; recent: Track[] }

/** O que se envia ao servidor: os campos de sempre de uma faixa (mais a fonte e o @ do artista), ou só os dados do clipe próprio. */
export const musicPayload = (t: Track | null | undefined) => {
  if (!t) return undefined;
  if (t.kind === 'clip') return { kind: 'clip' as const, mediaId: t.mediaId!, durationMs: t.durationMs ?? 1000, title: t.title };
  const { id, title, artist, url, landing, license, licenseUrl, durationMs, cover, source, artistUsername } = t;
  return { id, title, artist, url, landing, license, licenseUrl, durationMs, cover, ...(source ? { source } : {}), ...(artistUsername ? { artistUsername } : {}) };
};

export const musicApi = {
  /** Pesquisa no catálogo curado (e nos artistas de Moçambique), por título, artista ou estilo. */
  search: (q: string): Promise<Track[]> => raw(`/music/search?q=${encodeURIComponent(q)}`),
  /** O início do seletor. */
  home: (): Promise<MusicHome> => raw('/music/home'),
  /** As faixas de um estilo ou momento. */
  style: (id: string): Promise<Track[]> => raw(`/music/styles/${encodeURIComponent(id)}`),
  /** «Artistas de Moçambique» (vazio sem a fonte local). */
  local: (style?: string): Promise<Track[]> => raw(`/music/local${style ? `?style=${encodeURIComponent(style)}` : ''}`),
  /** «Sons»: efeitos e sons soltos. */
  sounds: (): Promise<Track[]> => raw('/music/sounds'),
  /** «Não gosto desta»: deixa de me aparecer (e, quando muita gente marca, desce para todos). */
  dislike: (id: string): Promise<{ disliked: true }> => raw(`/music/dislikes/${encodeURIComponent(id)}`, { method: 'PUT' }),
  undislike: (id: string): Promise<{ disliked: false }> => raw(`/music/dislikes/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  /** Sugestões (versões antigas): o que a malta mais está a usar e o que eu usei há pouco. */
  suggested: (): Promise<{ trending: Track[]; recent: Track[] }> => raw('/music/suggested'),
  favorites: (): Promise<Track[]> => raw('/music/favorites'),
  addFavorite: (t: Track): Promise<{ favorite: true }> => raw('/music/favorites', { method: 'PUT', body: JSON.stringify(musicPayload(t)) }),
  removeFavorite: (id: string): Promise<{ favorite: false }> => raw(`/music/favorites/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  /** Como `api.createPost`, mas com música (o `createPost` da app ainda não leva o campo). */
  createPost: (b: { body: string; music?: Track | null; locationLabel?: string; mediaIds: string[] }) => trackOk(raw('/posts', post({ ...b, music: musicPayload(b.music) })), 'post_create', { media: b.mediaIds.length, music: !!b.music }),
  createStory: (mediaId: string, caption: string, audience: 'all' | 'close_friends' = 'all', music?: Track | null, stickers: PlacedSticker[] = []) =>
    trackOk(raw('/stories', post({ mediaId, caption, audience, music: musicPayload(music), stickers })), 'story_create', { source: 'camera', closeFriends: audience === 'close_friends', music: !!music, stickers: stickers.length }),
  setNote: (body: string, music?: Track | null): Promise<void> => raw('/notes/me', { method: 'PUT', body: JSON.stringify({ body, music: musicPayload(music) }) }),
};
