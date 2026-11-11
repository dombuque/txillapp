// GIFs do GIPHY, sempre pelo nosso servidor (a chave fica lá e o GIPHY não vê quem pesquisa). Ver apps/api/src/gifs.
import { raw } from '@/lib/api';
import type { GifPage } from '@/lib/gifs';

export const gifsApi = {
  /** Ligado (há chave no servidor) e o canal do Txillapp no GIPHY, se houver. */
  config: (): Promise<{ enabled: boolean; channel: string | null }> => raw('/gifs/config'),
  trending: (offset = 0): Promise<GifPage> => raw(`/gifs/trending?offset=${offset}`),
  search: (q: string, offset = 0): Promise<GifPage> => raw(`/gifs/search?q=${encodeURIComponent(q)}&offset=${offset}`),
  /** "GIFs Txillapp": os do canal do Txillapp no GIPHY. */
  channel: (offset = 0): Promise<GifPage> => raw(`/gifs/channel?offset=${offset}`),
};
