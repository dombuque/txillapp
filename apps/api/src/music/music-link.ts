import { z } from 'zod';

/**
 * Música por ligação: a pessoa cola a ligação de uma música do Spotify, YouTube, Audiomack, Boomplay, Deezer ou Apple Music
 * e o Txillapp mostra um cartão (capa, título, artista) com o leitor oficial da plataforma, embutido. Nada de áudio no
 * Txillapp: a música toca no leitor deles (que eles deixam embutir) e conta para o artista lá. Só em notas, mimos e
 * publicações sem vídeo (nas tchekas a música mistura-se no vídeo e isso precisa de licença).
 */

export const LINK_PROVIDERS = ['spotify', 'youtube', 'audiomack', 'boomplay', 'deezer', 'apple'] as const;
export type LinkProvider = (typeof LINK_PROVIDERS)[number];

export const PROVIDER_NAMES: Record<LinkProvider, string> = {
  spotify: 'Spotify', youtube: 'YouTube', audiomack: 'Audiomack', boomplay: 'Boomplay', deezer: 'Deezer', apple: 'Apple Music',
};

export interface ParsedLink {
  provider: LinkProvider;
  /** O que é: uma música, um álbum, uma playlist ou um vídeo. */
  linkKind: 'track' | 'album' | 'playlist' | 'video';
  /** O id na plataforma. */
  ref: string;
  /** A ligação limpa (sem rastreio), para abrir na app ou no site da plataforma. */
  url: string;
  /** O leitor oficial embutido. */
  embedUrl: string;
}

const ID = /^[A-Za-z0-9_-]{1,64}$/;

/** Reconhece a ligação e devolve a forma limpa; null se não for de uma plataforma aceite (ou se não for uma música). */
export function parseMusicLink(raw: string): ParsedLink | null {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  const host = u.hostname.toLowerCase().replace(/^www\./, '').replace(/^m\./, '');
  const parts = u.pathname.split('/').filter(Boolean);

  if (host === 'open.spotify.com') {
    const p = parts[0]?.startsWith('intl-') ? parts.slice(1) : parts;
    const kind = p[0];
    const id = p[1];
    if (!id || !ID.test(id) || !['track', 'album', 'playlist'].includes(kind)) return null;
    return { provider: 'spotify', linkKind: kind as ParsedLink['linkKind'], ref: id, url: `https://open.spotify.com/${kind}/${id}`, embedUrl: `https://open.spotify.com/embed/${kind}/${id}` };
  }
  if (host === 'youtube.com' || host === 'music.youtube.com' || host === 'youtu.be') {
    let id: string | null = null;
    if (host === 'youtu.be') id = parts[0] ?? null;
    else if (parts[0] === 'watch') id = u.searchParams.get('v');
    else if (parts[0] === 'shorts' || parts[0] === 'embed' || parts[0] === 'live') id = parts[1] ?? null;
    if (!id || !/^[A-Za-z0-9_-]{6,20}$/.test(id)) return null;
    return { provider: 'youtube', linkKind: 'video', ref: id, url: `https://www.youtube.com/watch?v=${id}`, embedUrl: `https://www.youtube-nocookie.com/embed/${id}?playsinline=1` };
  }
  if (host === 'audiomack.com') {
    // audiomack.com/{artista}/song/{música} (também album e playlist)
    const [artist, kind, slug] = parts;
    if (!artist || !slug || !['song', 'album', 'playlist'].includes(kind) || !ID.test(artist) || !ID.test(slug)) return null;
    const linkKind = kind === 'song' ? 'track' : (kind as 'album' | 'playlist');
    return { provider: 'audiomack', linkKind, ref: `${artist}/${kind}/${slug}`, url: `https://audiomack.com/${artist}/${kind}/${slug}`, embedUrl: `https://audiomack.com/embed/${artist}/${kind}/${slug}` };
  }
  if (host === 'boomplay.com') {
    // boomplay.com/songs/{id} (também albums e playlists)
    const [kind, id] = parts;
    if (!id || !/^\d{1,20}$/.test(id) || !['songs', 'albums', 'playlists'].includes(kind)) return null;
    const linkKind = kind === 'songs' ? 'track' : kind === 'albums' ? 'album' : 'playlist';
    const embedKind = kind === 'songs' ? 'MUSIC' : kind === 'albums' ? 'ALBUM' : 'PLAYLIST';
    return { provider: 'boomplay', linkKind, ref: id, url: `https://www.boomplay.com/${kind}/${id}`, embedUrl: `https://www.boomplay.com/embed/${id}/${embedKind}` };
  }
  if (host === 'deezer.com') {
    const p = /^[a-z]{2}$/.test(parts[0] ?? '') ? parts.slice(1) : parts;
    const [kind, id] = p;
    if (!id || !/^\d{1,20}$/.test(id) || !['track', 'album', 'playlist'].includes(kind)) return null;
    return { provider: 'deezer', linkKind: kind as ParsedLink['linkKind'], ref: id, url: `https://www.deezer.com/${kind}/${id}`, embedUrl: `https://widget.deezer.com/widget/auto/${kind}/${id}` };
  }
  if (host === 'music.apple.com') {
    // music.apple.com/{país}/album/{nome}/{id}?i={música}  ou  /song/{nome}/{id}
    const cc = /^[a-z]{2}$/.test(parts[0] ?? '') ? parts[0] : 'us';
    const p = cc === parts[0] ? parts.slice(1) : parts;
    const kind = p[0];
    const id = p[p.length - 1];
    const song = u.searchParams.get('i');
    if (!id || !/^\d{1,20}$/.test(id) || !['album', 'song', 'playlist'].includes(kind)) return null;
    if (song && !/^\d{1,20}$/.test(song)) return null;
    const track = kind === 'song' ? id : song;
    const path = `${cc}/${kind}/${p.slice(1).join('/')}${song ? `?i=${song}` : ''}`;
    return { provider: 'apple', linkKind: track ? 'track' : kind === 'playlist' ? 'playlist' : 'album', ref: track ?? id, url: `https://music.apple.com/${path}`, embedUrl: `https://embed.music.apple.com/${path}` };
  }
  return null;
}

/** As capas só destes sítios (os das próprias plataformas): nunca uma imagem de qualquer lado. */
const COVER_HOSTS = [/^i\.scdn\.co$/, /^mosaic\.scdn\.co$/, /^image-cdn-[a-z0-9-]+\.spotifycdn\.com$/, /^i\.ytimg\.com$/, /^img\.youtube\.com$/, /^assets\.audiomack\.com$/, /^[a-z0-9-]+\.boomplay\.com$/, /^[a-z0-9-]+\.dzcdn\.net$/, /^is\d+-ssl\.mzstatic\.com$/];
export function safeCover(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  try {
    const u = new URL(raw);
    return u.protocol === 'https:' && COVER_HOSTS.some((h) => h.test(u.hostname)) ? u.toString().slice(0, 500) : null;
  } catch {
    return null;
  }
}

/** O que a app manda: só a ligação (o servidor vai buscar o resto às plataformas). */
export const linkMusicSchema = z.object({ kind: z.literal('link'), url: z.string().trim().url().max(500) });

/** Como fica guardada. `url` vazio: as apps antigas não tentam tocar a página como se fosse áudio (mostram «♪ título»). */
export interface StoredLinkMusic {
  kind: 'link';
  id: string;
  provider: LinkProvider;
  linkKind: ParsedLink['linkKind'];
  link: string;
  embedUrl: string;
  title: string;
  artist: string;
  cover: string | null;
  url: '';
  landing: string;
  license: 'link';
  licenseUrl: null;
  durationMs: null;
}

const clean = (s: unknown, max: number) => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim().slice(0, max) : '');

/** Junta a ligação limpa e o que a plataforma disse dela (título, artista, capa). Sem metadados: «Música no Spotify». */
export function storedLink(p: ParsedLink, meta: { title?: unknown; artist?: unknown; cover?: unknown } = {}): StoredLinkMusic {
  let title = clean(meta.title, 120);
  let artist = clean(meta.artist, 120);
  // O YouTube e o Spotify às vezes dão «Artista - Música» no título e nada no artista.
  if (!artist && / - /.test(title) && p.provider === 'youtube') {
    const [a, ...rest] = title.split(' - ');
    artist = a.trim();
    title = rest.join(' - ').trim();
  }
  return {
    kind: 'link', id: `link:${p.provider}:${p.ref}`.slice(0, 80), provider: p.provider, linkKind: p.linkKind, link: p.url, embedUrl: p.embedUrl,
    title: title || `Música no ${PROVIDER_NAMES[p.provider]}`, artist, cover: safeCover(meta.cover),
    url: '', landing: p.url, license: 'link', licenseUrl: null, durationMs: null,
  };
}

/** O oEmbed (ou equivalente) de cada plataforma: de onde vêm o título, o artista e a capa. */
export function metaUrl(p: ParsedLink): string | null {
  const e = encodeURIComponent(p.url);
  switch (p.provider) {
    case 'spotify': return `https://open.spotify.com/oembed?url=${e}`;
    case 'youtube': return `https://www.youtube.com/oembed?format=json&url=${e}`;
    case 'audiomack': return `https://audiomack.com/oembed?format=json&url=${e}`;
    case 'deezer': return `https://api.deezer.com/oembed?format=json&url=${e}`;
    case 'apple': return `https://itunes.apple.com/lookup?id=${encodeURIComponent(p.ref)}&entity=song`;
    case 'boomplay': return null;
  }
}

/** Lê a resposta da plataforma para { title, artist, cover }. */
export function readMeta(p: ParsedLink, body: unknown): { title?: unknown; artist?: unknown; cover?: unknown } {
  const b = (body ?? {}) as Record<string, unknown>;
  if (p.provider === 'apple') {
    const r = (Array.isArray(b.results) ? b.results : []).find((x: Record<string, unknown>) => x.wrapperType === 'track') ?? (Array.isArray(b.results) ? b.results[0] : null);
    const x = (r ?? {}) as Record<string, unknown>;
    return { title: x.trackName ?? x.collectionName, artist: x.artistName, cover: typeof x.artworkUrl100 === 'string' ? x.artworkUrl100.replace('100x100', '600x600') : null };
  }
  return { title: b.title, artist: b.author_name, cover: b.thumbnail_url };
}
