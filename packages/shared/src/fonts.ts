/**
 * As letras dos textos (docs/fontes-contrato.md): as 10 fontes do estúdio das tchekas (apps/mobile/src/lib/studio/effects.ts,
 * `FONTS`), também nos textos por cima dos mimos, nas publicações só com texto e na legenda do Zás. Uma fonte desconhecida
 * ou que falte lê-se como 'classica'.
 */
export const TEXT_FONT_IDS = ['classica', 'cartaz', 'grito', 'praia', 'marcador', 'elegante', 'maquina', 'retro', 'mao', 'futuro'] as const;
export type TextFontId = (typeof TEXT_FONT_IDS)[number];
export const DEFAULT_TEXT_FONT: TextFontId = 'classica';

export function isTextFontId(v: unknown): v is TextFontId {
  return typeof v === 'string' && (TEXT_FONT_IDS as readonly string[]).includes(v);
}

/** Qualquer valor para uma fonte que existe (desconhecida ou em falta: 'classica'). */
export function textFontOf(v: unknown): TextFontId {
  return isTextFontId(v) ? v : DEFAULT_TEXT_FONT;
}
