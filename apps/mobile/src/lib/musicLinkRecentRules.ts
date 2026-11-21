/** As músicas por ligação usadas há pouco (neste aparelho): regras sem React Native, testadas em Node. */

export const RECENT_LINKS_KEY = 'txill_music_links_recent_v1';
/** Quantas se guardam. */
export const RECENT_LINKS_MAX = 12;

interface LinkLike { id: string; kind?: string }

export function readRecentLinks(raw: string | null | undefined): LinkLike[] {
  try {
    const v = JSON.parse(raw ?? '[]');
    return Array.isArray(v) ? v.filter((x) => x && typeof x === 'object' && x.kind === 'link' && typeof x.id === 'string').slice(0, RECENT_LINKS_MAX) : [];
  } catch {
    return [];
  }
}

/** Põe a música à frente (sem repetir), no máximo RECENT_LINKS_MAX. */
export function pushRecentLink<T extends LinkLike>(list: readonly T[], t: T): T[] {
  if (t.kind !== 'link') return [...list];
  return [t, ...list.filter((x) => x.id !== t.id)].slice(0, RECENT_LINKS_MAX);
}
