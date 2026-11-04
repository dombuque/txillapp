import { useQuery } from '@tanstack/react-query';
import { api } from './api';
import { useAuth } from './auth';

export type StoryRing = 'unseen' | 'close' | 'seen' | null;

const OWN_SEEN_KEY = 'txill_own_story_seen';
const ownSeen = () => {
  try { return localStorage.getItem(OWN_SEEN_KEY) ?? ''; } catch { return ''; }
};

/**
 * O estado do story de uma pessoa, para o anel à volta da foto (em publicações, comentários, listas…):
 *  - "unseen": tem story que ainda não viste (anel a coral);
 *  - "close": tem story só para amigos próximos que ainda não viste (anel verde);
 *  - "seen": tem story, mas já viste tudo (anel cinzento);
 *  - null: não tem story (sem anel).
 * Usa a mesma lista dos stories do início, por isso não pede nada a mais ao servidor.
 */
export function useStoryRing(username?: string): StoryRing {
  const auth = useAuth();
  const q = useQuery({
    queryKey: ['stories'],
    queryFn: api.stories,
    staleTime: 30_000,
    refetchInterval: 60_000,
    enabled: !!username && !!auth?.user,
    select: (d) => d.find((u) => u.username.toLowerCase() === (username ?? '').toLowerCase()) ?? null,
  });
  const u = q.data;
  if (!u) return null;
  if (u.isMe) return u.latestAt === ownSeen() ? 'seen' : 'unseen';
  if (u.seen) return 'seen';
  return u.closeFriends ? 'close' : 'unseen';
}
