import { locale } from './i18n';

/**
 * A moeda da app chama-se «vibes» (antes «Txills»; a API e a base de dados continuam a dizer `txills`, só o nome que se
 * mostra mudou). O mesmo que apps/mobile/src/lib/vibes.ts: «50 vibes», «1 vibe» e, onde há pouco espaço, «50 vib».
 * Em inglês as palavras são as mesmas; só o número segue o idioma.
 */
export const VIBE = 'vibe';
export const VIBES = 'vibes';
export const VIB = 'vib';

/** Só a palavra que acompanha o número: «vibe» (1), «vibes» (o resto) ou «vib» (curta, invariável). */
export function vibesWord(n: number, opts: { short?: boolean } = {}): string {
  if (opts.short) return VIB;
  return Math.round(Number.isFinite(n) ? n : 0) === 1 ? VIBE : VIBES;
}

/** «50 vibes», «1 vibe», ou, com `short`, «50 vib» (o número no formato do idioma). */
export function formatVibes(n: number, opts: { short?: boolean } = {}): string {
  const v = Math.round(Number.isFinite(n) ? n : 0);
  return `${v.toLocaleString(locale)} ${vibesWord(v, opts)}`;
}
