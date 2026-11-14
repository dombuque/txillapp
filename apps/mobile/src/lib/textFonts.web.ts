/**
 * As fontes dos textos ao publicar, na web (no telemóvel: textFonts.ts). Os woff2 do estúdio, servidos pelo próprio site
 * (public/fonts/estudio: a CSP só deixa fontes do Txillapp), carregados um a um com o FontFace (lib/studio/renderFonts)
 * quando um texto os usa ou o seletor os mostra. Enquanto não chegam, o texto sai na letra do sistema.
 */
import type { TextStyle } from 'react-native';
import { fontById } from './studio/effects';
import { ensureFont } from './studio/renderFonts';
import { normTextFont } from './textLayers';

const ready = new Set<string>();

/** Carrega uma fonte (true quando já se pode desenhar com ela). */
export function loadTextFont(id: string): Promise<boolean> {
  const f = normTextFont(id);
  return ensureFont(f).then((ok) => {
    if (ok) ready.add(f);
    return ok;
  });
}
export const textFontReady = (id: string): boolean => ready.has(normTextFont(id));
/** O estilo da letra (a família com o peso e o estilo do ficheiro), ou null enquanto a fonte não está carregada. */
export function textFontStyle(id: string): TextStyle | null {
  const f = fontById(normTextFont(id));
  if (!ready.has(f.id)) return null;
  return { fontFamily: `${f.family}, system-ui, sans-serif`, fontWeight: String(f.weight) as TextStyle['fontWeight'], fontStyle: f.style ?? 'normal' };
}
