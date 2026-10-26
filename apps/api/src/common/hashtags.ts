/** #hashtags de um texto: só letras/números/_, 2 a 30 caracteres, sem acentos nem maiúsculas (iguais ao pesquisar), no máximo 10. */
const HASHTAG = /(?<![\p{L}\p{N}_&#])#([\p{L}\p{N}_]{2,30})/gu;

export const normalizeTag = (t: string) => t.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
export const isValidTag = (t: string) => /^[a-z0-9_]{2,30}$/.test(t);

export function extractHashtags(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(HASHTAG)) {
    const tag = normalizeTag(m[1]);
    if (isValidTag(tag)) out.add(tag);
    if (out.size >= 10) break;
  }
  return [...out];
}

/** Termos para uma pesquisa por prefixo em texto completo ("praia mar" → "praia:* & mar:*"). Null se não houver palavras. */
export function prefixQuery(text: string): string | null {
  const words = normalizeTag(text).split(/[^a-z0-9]+/).filter((w) => w.length >= 2).slice(0, 6);
  return words.length ? words.map((w) => `${w}:*`).join(' & ') : null;
}
