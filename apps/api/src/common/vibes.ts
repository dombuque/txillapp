/**
 * O nome da moeda nos textos que a API escreve (erros, avisos, cartões): «vibes» (antes «Txills»). Só o nome mudou: as
 * colunas, os tipos do livro, as rotas e as chaves do JSON continuam a dizer `txills`, para as apps antigas não partirem.
 * O mesmo que `formatVibes` na app (apps/mobile/src/lib/vibes.ts).
 */
export const vibesWord = (n: number): string => (Math.round(Number.isFinite(n) ? n : 0) === 1 ? 'vibe' : 'vibes');

/** «50 vibes», «1 vibe». */
export const vibes = (n: number): string => `${Math.round(Number.isFinite(n) ? n : 0)} ${vibesWord(n)}`;
