import { raw, post } from '@/lib/api';

/** Faixa de música: de licença aberta (catálogo) ou um clipe próprio gravado (`kind: 'clip'`). Igual ao tipo do site. */
export interface Track { kind?: 'clip'; mediaId?: string; id: string; title: string; artist: string; url: string; landing: string | null; license: string; licenseUrl: string | null; durationMs: number | null; cover: string | null }

/** O que se envia ao servidor: uma faixa de licença aberta inteira, ou só os dados do clipe próprio. */
export const musicPayload = (t: Track | null | undefined) => (!t ? undefined : t.kind === 'clip' ? { kind: 'clip' as const, mediaId: t.mediaId!, durationMs: t.durationMs ?? 1000, title: t.title } : t);

export const musicApi = {
  search: (q: string): Promise<Track[]> => raw(`/music/search?q=${encodeURIComponent(q)}`),
  /** Como `api.createPost`, mas com música (o `createPost` da app ainda não leva o campo). */
  createPost: (b: { body: string; music?: Track | null; locationLabel?: string; mediaIds: string[] }) => raw('/posts', post({ ...b, music: musicPayload(b.music) })),
  createStory: (mediaId: string, caption: string, audience: 'all' | 'close_friends' = 'all', music?: Track | null) => raw('/stories', post({ mediaId, caption, audience, music: musicPayload(music) })),
  setNote: (body: string, music?: Track | null): Promise<void> => raw('/notes/me', { method: 'PUT', body: JSON.stringify({ body, music: musicPayload(music) }) }),
};
