/**
 * Provisório (equipa codemod): só para compilar enquanto o i18n.ts da equipa base (branch idiomas-base) não chega.
 * Mesma assinatura: devolve a frase em português com as variáveis `{nome}` trocadas; com `count` diferente de 1 usa `other`.
 */
export function t(frase: string, vars?: Record<string, string | number> & { count?: number }): string {
  if (!vars) return frase;
  const form = typeof vars.count === 'number' && Math.abs(vars.count) !== 1 && typeof vars.other === 'string' ? vars.other : frase;
  return form.replace(/\{(\w+)\}/g, (m, k: string) => (vars[k] === undefined ? m : String(vars[k])));
}
