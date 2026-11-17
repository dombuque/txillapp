/**
 * Nomes de ícones que passaram a ser outro (sem partir quem ainda os usa):
 * - `present` (o quadrado com a seta, que parecia «carregar») → `gift`: dar vibes é sempre o embrulho;
 * - `flip-camera` → `cam-flip`: virar a câmara tem um só desenho;
 * - `send` ≡ `messages`: eram o mesmo avião de papel.
 * O tx.ts continua a ter os nomes antigos (é gerado por apps/web/scripts/make-txicons.py e o site ainda os usa).
 */
export const ICON_ALIAS = {
  present: 'gift',
  'flip-camera': 'cam-flip',
  send: 'messages',
} as const;

export type IconAlias = keyof typeof ICON_ALIAS;

/** O nome do desenho que se mostra (o próprio, ou aquele para onde o alias aponta). */
export function iconFor<T extends string>(name: T): T | (typeof ICON_ALIAS)[IconAlias] {
  return (ICON_ALIAS as Record<string, (typeof ICON_ALIAS)[IconAlias]>)[name] ?? name;
}
