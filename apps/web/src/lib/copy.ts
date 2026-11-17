import { tr, tk } from './i18n';

/**
 * Frases com graça para os momentos pequenos (copiado, nada encontrado, enviado, falhou…), no tom da malta.
 * Escolhe-se uma por abertura da app (não muda enquanto se usa, para não parecer um erro) e está traduzida em inglês.
 * Só gíria de que temos a certeza (malta, bora, paulada, txilar, maningue).
 */
const LINES = {
  copied: [tk('Link copiado. Bora espalhar!'), tk('Copiado! Agora é colar e mandar à malta.')],
  none: [tk('Procurámos em tudo e nada. Tenta outra vibe.'), tk('Nada por aqui. Experimenta outra palavra.')],
  sent: [tk('Enviado! A malta já recebeu.'), tk('Foi! Já está a caminho.')],
  failed: [tk('Ups, escorregou! Tenta outra vez.'), tk('Ups, a vibe falhou. Tenta de novo.')],
} as const;

export type FunnyKind = keyof typeof LINES;

const chosen: Partial<Record<FunnyKind, string>> = {};

/** Uma frase com graça para este momento (a mesma durante toda a sessão). */
export function funny(kind: FunnyKind): string {
  const c = chosen[kind];
  if (c) return c;
  const list = LINES[kind];
  const pick = list[Math.floor(Math.random() * list.length)];
  return (chosen[kind] = tr(pick));
}
