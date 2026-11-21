import type { Track } from '@/lib/api.music';
import { kvGet, kvSet } from '@/lib/kv';
import { pushRecentLink, readRecentLinks, RECENT_LINKS_KEY } from '@/lib/musicLinkRecentRules';

/** As músicas por ligação usadas neste aparelho (as mais recentes primeiro), para não ter de copiar a ligação outra vez. */
export async function recentLinks(): Promise<Track[]> {
  return readRecentLinks(await kvGet(RECENT_LINKS_KEY)) as Track[];
}

export async function rememberLink(t: Track): Promise<void> {
  const list = pushRecentLink(readRecentLinks(await kvGet(RECENT_LINKS_KEY)), t);
  await kvSet(RECENT_LINKS_KEY, JSON.stringify(list));
}
