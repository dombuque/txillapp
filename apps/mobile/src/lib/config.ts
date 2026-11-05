/** Onde fica a API. Em desenvolvimento pode apontar para outro servidor com EXPO_PUBLIC_API_URL (sem barra no fim). */
import { Platform } from 'react-native';

export const SITE_URL = (process.env.EXPO_PUBLIC_API_URL ?? (Platform.OS === 'web' ? '' : 'https://txillapp.com')).replace(/\/$/, '');

/** Endereço absoluto de um caminho da API (ex.: /api/v1/media/abc). Endereços completos ficam como estão. */
export const abs = (path: string | null | undefined): string | undefined => (!path ? undefined : /^https?:\/\//.test(path) ? path : `${SITE_URL}${path}`);

/** Versão leve de uma foto: o servidor devolve WebP na largura pedida (como na web). */
export const sized = (url: string | null | undefined, width: number): string | undefined =>
  url && url.startsWith('/api/v1/media/') ? abs(`${url}?w=${width}`) : abs(url);
