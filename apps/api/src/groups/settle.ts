/** Contas das despesas do grupo (em cêntimos de metical). Funções puras, testadas à parte. */

/** Divide `total` por `n` partes inteiras; os cêntimos que sobram vão para as primeiras. */
export function splitCents(total: number, n: number): number[] {
  const base = Math.floor(total / n);
  const rest = total - base * n;
  return Array.from({ length: n }, (_, i) => base + (i < rest ? 1 : 0));
}

/**
 * Quem paga a quem, com poucas transferências (algoritmo guloso): o maior devedor paga ao maior credor, e repete.
 * `net` > 0: a pessoa tem a receber; < 0: tem a pagar. A soma tem de ser zero.
 */
export function settle(net: Map<string, number>): { from: string; to: string; cents: number }[] {
  const byNet = (a: [string, number], b: [string, number]) => Math.abs(b[1]) - Math.abs(a[1]) || a[0].localeCompare(b[0]);
  const creditors = [...net].filter(([, v]) => v > 0).sort(byNet).map(([k, v]) => [k, v] as [string, number]);
  const debtors = [...net].filter(([, v]) => v < 0).sort(byNet).map(([k, v]) => [k, -v] as [string, number]);
  const out: { from: string; to: string; cents: number }[] = [];
  let i = 0, j = 0;
  while (i < debtors.length && j < creditors.length) {
    const pay = Math.min(debtors[i][1], creditors[j][1]);
    if (pay > 0) out.push({ from: debtors[i][0], to: creditors[j][0], cents: pay });
    debtors[i][1] -= pay;
    creditors[j][1] -= pay;
    if (debtors[i][1] === 0) i++;
    if (creditors[j][1] === 0) j++;
  }
  return out;
}

/** Cêntimos para meticais (número com até 2 casas decimais). */
export const mzn = (cents: number) => Math.round(cents) / 100;

/** Meticais (até 2 casas decimais) para cêntimos; null se tiver mais casas. */
export function toCents(amountMzn: number): number | null {
  const c = Math.round(amountMzn * 100);
  return Math.abs(c - amountMzn * 100) < 1e-6 ? c : null;
}

/** Divide `total` por pesos (devolução proporcional): partes inteiras, os restos maiores primeiro (empate: pela chave). */
export function proRata(total: bigint, stakes: [string, bigint][]): [string, bigint][] {
  const sum = stakes.reduce((s, [, v]) => s + v, 0n);
  if (sum <= 0n) return [];
  const parts = stakes.map(([k, v]) => ({ k, q: (total * v) / sum, r: (total * v) % sum }));
  let left = total - parts.reduce((s, p) => s + p.q, 0n);
  const order = [...parts].sort((a, b) => (b.r > a.r ? 1 : b.r < a.r ? -1 : a.k.localeCompare(b.k)));
  for (const p of order) {
    if (left <= 0n) break;
    p.q += 1n;
    left -= 1n;
  }
  return parts.map((p) => [p.k, p.q] as [string, bigint]);
}
