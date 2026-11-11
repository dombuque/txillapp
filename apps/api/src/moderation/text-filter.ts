/**
 * Filtro de texto da moderação: assinala (não bloqueia) publicações, comentários e mimos com termos que costumam pedir
 * uma vista de olhos: insultos e ódio, ameaças, conteúdo sexual e burlas com dinheiro móvel. Corre só no backoffice,
 * na página «Conteúdo», sobre o texto sem acentos e em minúsculas. Para mudar a lista, edita aqui.
 */
export interface TextRule { id: string; label: string; pattern: string }

/** Padrões em expressões regulares do PostgreSQL (\m e \M = início e fim de palavra), sem acentos e em minúsculas. */
export const TEXT_RULES: readonly TextRule[] = [
  { id: 'insulto', label: 'Insulto', pattern: '\\m(filh[oa]s? da puta|puta|caralho|foda-se|fodase|cabr[ao]o|cabra|otario|corno|merdoso|vai te foder|vai-te foder)\\M' },
  { id: 'odio', label: 'Ódio', pattern: '\\m(paneleiro|maricas|preto de merda|macaco de merda|raca inferior|morte aos?)\\M' },
  { id: 'ameaca', label: 'Ameaça', pattern: '\\m(vou-te matar|vou te matar|vais morrer|mato-te|mato te|te mato|vou-te bater|sei onde moras)\\M' },
  { id: 'sexual', label: 'Sexual', pattern: '\\m(nudes|manda nudes|pack|onlyfans|sexo|porno|xxx)\\M' },
  { id: 'burla', label: 'Burla', pattern: '\\m(m-?pesa|e-?mola|lucro garantido|investimento garantido|ganha dinheiro|ganhe dinheiro|dinheiro facil|duplica o teu dinheiro|clica no link|bit\\.ly|envia o codigo)\\M' },
];

/** Um só padrão com todos os termos (para o SQL `~`). */
export const TEXT_FILTER_PATTERN = TEXT_RULES.map((r) => `(${r.pattern})`).join('|');

const JS_RULES = TEXT_RULES.map((r) => ({ ...r, re: new RegExp(r.pattern.replace(/\\m/g, '(?<![\\p{L}\\p{N}_])').replace(/\\M/g, '(?![\\p{L}\\p{N}_])'), 'gu') }));

/** Texto sem acentos e em minúsculas, como o SQL compara (content.f_unaccent + lower). */
export const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/** O que o filtro apanha num texto: as regras e os termos (para mostrar ao lado do conteúdo). */
export function textHits(text: string | null | undefined): { rule: string; label: string; term: string }[] {
  if (!text) return [];
  const t = fold(text);
  const out: { rule: string; label: string; term: string }[] = [];
  for (const r of JS_RULES) {
    for (const m of t.matchAll(r.re)) {
      if (!out.some((x) => x.term === m[0])) out.push({ rule: r.id, label: r.label, term: m[0] });
      if (out.length >= 8) return out;
    }
  }
  return out;
}
