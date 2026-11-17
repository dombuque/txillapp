/**
 * Os idiomas do Txillapp (docs/idiomas.md). A lista é a mesma para a app, o site e a API: juntar um idioma é acrescentar
 * uma linha aqui e correr `node scripts/i18n/translate.mjs` (que traduz as frases e gera a cópia da app em
 * apps/mobile/src/locales/index.ts, porque a app não importa este pacote).
 * O primeiro é a língua de origem: o português de Moçambique, que é o texto do próprio código.
 */
export const LANGS = [
  { code: 'pt', name: 'Português', locale: 'pt-MZ' },
  { code: 'en', name: 'English', locale: 'en-GB' },
] as const;

export type LangCode = (typeof LANGS)[number]['code'];

/** A língua de origem (as chaves dos catálogos são as frases nesta língua). */
export const SOURCE_LANG: LangCode = 'pt';

/** O idioma da lista que serve um código como «en-US», «pt-BR» ou um cabeçalho Accept-Language inteiro; senão o de origem. */
export function pickLang(input?: string | null): LangCode {
  if (!input) return SOURCE_LANG;
  for (const part of input.split(',')) {
    const code = part.split(';')[0].trim().toLowerCase().split(/[-_]/)[0];
    const hit = LANGS.find((l) => l.code === code);
    if (hit) return hit.code;
  }
  return SOURCE_LANG;
}
