// Os brindes à geleira: os textos da contagem e dos botões e a atualização otimista do nível.
// Sem dependências (os testes correm em Node: tests/geleiraCheers.test.mjs).

export interface CheerState { cheers?: number; cheered?: boolean }

/** Número inteiro e não negativo (o servidor pode mandar lixo; nunca mostrar "-1 brindes"). */
const count = (n: unknown): number => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.floor(n) : 0);

/** "1 brinde", "12 brindes" (0 → "0 brindes"). */
export function cheersCount(n: unknown): string {
  const k = count(n);
  return `${k} ${k === 1 ? 'brinde' : 'brindes'}`;
}

/** O texto do botão do visitante: sem brindes, só "Brindar"; com brindes, a contagem. */
export function cheerButtonText(n: unknown): string {
  return count(n) === 0 ? 'Brindar' : cheersCount(n);
}

/** O que o leitor de ecrã diz no botão do visitante (a contagem vai à parte, em `accessibilityValue`). */
export function cheerA11yLabel(cheered: boolean, name: string): string {
  if (cheered) return 'Tirar o brinde';
  const who = name.trim();
  return `Brindar a geleira${who ? ` de ${who}` : ''}`;
}

/** O que o leitor de ecrã diz no botão do dono. */
export function ownerCheersA11yLabel(n: unknown): string {
  return `${cheersCount(n)}, ver quem brindou`;
}

/** O servidor sabe de brindes? (Servidor antigo não manda `cheers` → não há botão.) */
export function canCheer(level: CheerState | null | undefined): boolean {
  return !!level && typeof level.cheers === 'number' && Number.isFinite(level.cheers);
}

/** Atualização otimista: alterna o brinde e acerta a contagem (nunca abaixo de 0). Devolve um objeto novo. */
export function toggleCheer<T extends CheerState>(level: T): T {
  const was = !!level.cheered;
  const n = count(level.cheers);
  return { ...level, cheered: !was, cheers: was ? Math.max(0, n - 1) : n + 1 };
}

/** Junta a resposta do servidor (`{ cheered, cheers }`) ao nível guardado. */
export function applyCheer<T extends CheerState>(level: T, r: { cheered: boolean; cheers: number }): T {
  return { ...level, cheered: !!r.cheered, cheers: count(r.cheers) };
}
