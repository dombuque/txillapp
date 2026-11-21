/**
 * Música por ligação (Spotify, YouTube, Audiomack, Boomplay, Deezer, Apple Music): regras sem React Native, testadas em
 * Node. O servidor reconhece a ligação e guarda a música com `kind: 'link'` e `url` vazio (não é áudio do Txillapp).
 */

export const PROVIDER_NAMES: Record<string, string> = {
  spotify: 'Spotify', youtube: 'YouTube', audiomack: 'Audiomack', boomplay: 'Boomplay', deezer: 'Deezer', apple: 'Apple Music',
};

export const providerName = (p?: string | null): string => PROVIDER_NAMES[p ?? ''] ?? 'Música';

/** É uma música por ligação (sem áudio no Txillapp: toca no leitor da plataforma)? */
export const isLinkMusic = (m: { kind?: string } | null | undefined): boolean => m?.kind === 'link';

/** Parece uma ligação de uma das plataformas aceites (para mostrar «Usar» enquanto se cola; o servidor confirma). */
export function looksLikeMusicLink(text: string): boolean {
  return /^(https?:\/\/)?(open\.spotify\.com|(www\.|m\.|music\.)?youtube\.com|youtu\.be|audiomack\.com|(www\.)?boomplay\.com|(www\.)?deezer\.com|music\.apple\.com)\//i.test(text.trim());
}

/** A altura do leitor embutido de cada plataforma, para a largura `w`. */
export function linkPlayerHeight(provider: string | null | undefined, linkKind: string | null | undefined, w: number): number {
  switch (provider) {
    case 'youtube': return Math.round((w * 9) / 16);
    case 'spotify': return linkKind === 'track' ? 152 : 352;
    case 'apple': return linkKind === 'track' ? 175 : 450;
    case 'deezer': return linkKind === 'track' ? 200 : 300;
    case 'audiomack': return linkKind === 'track' ? 252 : 400;
    case 'boomplay': return 200;
    default: return 200;
  }
}

/** O endereço «spotify:track:ID» (ou album/playlist) de uma ligação limpa do Spotify, para a API do leitor; null se não for. */
export function spotifyUri(link: string | null | undefined): string | null {
  const m = /^https:\/\/open\.spotify\.com\/(track|album|playlist)\/([A-Za-z0-9]{1,64})$/.exec(link ?? '');
  return m ? `spotify:${m[1]}:${m[2]}` : null;
}

/** Os leitores oficiais que se podem embutir (a mesma lista do frame-src do nginx e do music-link.ts da API). */
const EMBED_HOSTS = ['open.spotify.com', 'www.youtube-nocookie.com', 'audiomack.com', 'www.boomplay.com', 'widget.deezer.com', 'embed.music.apple.com'];

/** O leitor só abre se o endereço for https de uma das plataformas; outro qualquer não entra na WebView nem no iframe. */
export function embedAllowed(url: string | null | undefined): boolean {
  try {
    const u = new URL(url ?? '');
    return u.protocol === 'https:' && EMBED_HOSTS.includes(u.hostname);
  } catch {
    return false;
  }
}

/** Para abrir fora da app: só http(s) (nunca intent:, javascript: nem esquemas de outras apps). */
export function httpLink(url: string | null | undefined): string | null {
  return url && /^https?:\/\/[^\s]+$/i.test(url) ? url : null;
}
