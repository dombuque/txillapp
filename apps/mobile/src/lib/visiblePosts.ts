import { useSyncExternalStore } from 'react';
import type { Post } from './api';

/**
 * Que publicações estão à vista neste momento (nas listas que o dizem). Serve para a música de um post tocar
 * sozinha enquanto ele está no ecrã e parar quando sai, sem botões de play e pausa.
 */
let ids = new Set<string>();
const subs = new Set<() => void>();

export function setVisiblePosts(next: Iterable<string>) {
  ids = new Set(next);
  subs.forEach((f) => f());
}

export function useIsPostVisible(id: string): boolean {
  return useSyncExternalStore((cb) => { subs.add(cb); return () => { subs.delete(cb); }; }, () => ids.has(id), () => false);
}

/** Para as listas de publicações (FlatList): `viewabilityConfig` e `onViewableItemsChanged` prontos a ligar. */
export const postViewability = { itemVisiblePercentThreshold: 60, minimumViewTime: 500 };
export function onPostsViewable({ viewableItems }: { viewableItems: { item: Post; isViewable: boolean }[] }) {
  const seen: string[] = [];
  for (const v of viewableItems) {
    if (!v.isViewable) continue;
    seen.push(v.item.id);
    // Um repost simples mostra o cartão do original: conta também como à vista.
    if (v.item.repostOf) seen.push(v.item.repostOf.id);
  }
  setVisiblePosts(seen);
}
