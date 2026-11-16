/**
 * A moeda da app chama-se «vibes» (antes «Txills»; a API, a base de dados e o livro continuam a dizer `txills`, só o
 * nome que se mostra mudou). Tudo o que mostra um valor passa por aqui, para o singular, o plural e a forma curta
 * serem sempre iguais:
 *
 * - `formatVibes(50)` → «50 vibes», `formatVibes(1)` → «1 vibe» (a forma inteira, nas frases).
 * - `formatVibes(50, { short: true })` → «50 vib» (onde há pouco espaço: o saldo num chip, botões, preços, selos).
 * - `fmtVibesNumber(12500)` → «12 500» (só o número, como em pt: o espaço só a partir de 5 algarismos).
 *
 * Os testes em tests/vibes.test.mjs importam este ficheiro diretamente.
 */

/** O nome inteiro, no singular e no plural, e a forma curta. */
export const VIBE = 'vibe';
export const VIBES = 'vibes';
export const VIB = 'vib';

/** «50», «1000», «12 500» (o espaço fino não quebra a linha). */
export function fmtVibesNumber(n: number): string {
  const v = Math.max(0, Math.round(Number.isFinite(n) ? n : 0));
  const s = String(v);
  return s.length < 5 ? s : s.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

/** Só a palavra que acompanha o número: «vibe» (1), «vibes» (o resto) ou «vib» (curta, invariável). */
export function vibesWord(n: number, opts: { short?: boolean } = {}): string {
  if (opts.short) return VIB;
  return Math.round(Number.isFinite(n) ? n : 0) === 1 ? VIBE : VIBES;
}

/** «50 vibes», «1 vibe», ou, com `short`, «50 vib». */
export function formatVibes(n: number, opts: { short?: boolean } = {}): string {
  return `${fmtVibesNumber(n)} ${vibesWord(n, opts)}`;
}
