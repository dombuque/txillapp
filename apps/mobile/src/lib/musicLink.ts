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
