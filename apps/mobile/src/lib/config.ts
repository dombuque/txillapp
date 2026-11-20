/** Onde fica a API. Em desenvolvimento pode apontar para outro servidor com EXPO_PUBLIC_API_URL (sem barra no fim). */
import { Platform } from 'react-native';
import { isSaving, savedWidth } from '@/lib/dataSaverRules';

export const SITE_URL = (process.env.EXPO_PUBLIC_API_URL ?? (Platform.OS === 'web' ? '' : 'https://txillapp.com')).replace(/\/$/, '');

/**
 * Endereço absoluto de um caminho da API (ex.: /api/v1/media/abc). Endereços completos ficam como estão, também os
 * ficheiros deste aparelho (file:, blob:, content:): a voz e as fotos à espera de rede mostram a cópia guardada.
 */
export const abs = (path: string | null | undefined): string | undefined => (!path ? undefined : /^(https?:\/\/|file:|blob:|content:)/.test(path) ? path : `${SITE_URL}${path}`);

/**
 * Versão leve de uma foto: o servidor devolve WebP na largura pedida (como na web). Com "?" já no endereço (ex.: ?poster=1)
 * junta-se com "&". Com «Poupar megas» ativo (lib/dataSaverRules) pede-se até 480 nos cartões e até 720 no ecrã inteiro.
 */
export const sized = (url: string | null | undefined, width: number): string | undefined => {
  const w = isSaving() ? savedWidth(width) : width;
  return url && url.startsWith('/api/v1/media/') ? abs(`${url}${url.includes('?') ? '&' : '?'}w=${w}`) : abs(url);
};
