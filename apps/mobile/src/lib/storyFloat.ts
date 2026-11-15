/**
 * Os comentários a flutuar no visor dos mimos (components/StoryFloatComments.tsx): os últimos comentários entram de baixo,
 * um de cada vez, num ritmo calmo; sobem e desvanecem. Contas puras, testadas em tests/storyFloat.test.mjs.
 */

/** Quantos dos comentários mais recentes entram no ciclo. */
export const FLOAT_POOL = 10;
/** O tempo entre um balão e o seguinte, e até ao primeiro (o mimo aparece primeiro, os balões depois). */
export const FLOAT_EVERY_MS = 1800;
export const FLOAT_FIRST_MS = 700;

/** Os últimos `n` comentários (a lista vem do mais antigo para o mais recente), na mesma ordem. */
export function floatPool<T>(comments: readonly T[] | null | undefined, n = FLOAT_POOL): T[] {
  return (comments ?? []).slice(-n);
}

/** Um balão à vista: o comentário (`index` no pool), a chave (para a animação de entrada), a idade (0 = o mais novo, em baixo). */
export type FloatEntry = { index: number; key: number; age: number; leaving: boolean };

/**
 * Que balões estão à vista na batida `tick` (-1 = ainda nenhum), do mais velho para o mais novo. Com poucos comentários
 * (cabem todos) entram um a um e ficam; com mais, ciclam: cada batida entra um, os outros sobem, e o que passa de `max` sai
 * (`leaving`: ainda desenhado, a desvanecer para cima).
 */
export function floatWindow(tick: number, n: number, max: number): FloatEntry[] {
  if (tick < 0 || n <= 0 || max <= 0) return [];
  if (n <= max) {
    const shown = Math.min(tick + 1, n);
    return Array.from({ length: shown }, (_, k) => ({ index: k, key: k, age: shown - 1 - k, leaving: false }));
  }
  const out: FloatEntry[] = [];
  for (let t = Math.max(0, tick - max); t <= tick; t++) out.push({ index: t % n, key: t, age: tick - t, leaving: tick - t >= max });
  return out;
}

/** O ciclo já acabou? (Só quando cabem todos e já entraram todos: aí o relógio pára.) */
export function floatDone(tick: number, n: number, max: number): boolean {
  return n <= 0 || max <= 0 || (n <= max && tick >= n - 1);
}

/**
 * A distância de cada balão ao fundo da coluna (px), pela altura medida dos mais novos (`heights[key]`, ou `fallback`
 * antes de medir) e o espaço entre eles. O que está a sair sobe mais um bocadinho.
 */
export function floatOffsets(entries: readonly FloatEntry[], heights: Readonly<Record<number, number>>, fallback: number, gap: number): Record<number, number> {
  const byAge = entries.slice().sort((a, b) => a.age - b.age);
  const out: Record<number, number> = {};
  let y = 0;
  for (const e of byAge) {
    out[e.key] = e.leaving ? y + 14 : y;
    y += (heights[e.key] ?? fallback) + gap;
  }
  return out;
}

/** O @ curto (os nomes compridos acabam em «…») e o texto numa linha só (as mudanças de linha passam a espaços). */
export function floatName(username: string, max = 14): string {
  return username.length > max ? `${username.slice(0, max - 1)}…` : username;
}
export function floatText(body: string): string {
  return body.replace(/\s+/g, ' ').trim();
}
