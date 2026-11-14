/**
 * As fontes dos textos ao publicar, no telemóvel (na web: textFonts.web.ts). São as 10 do estúdio (TTF em
 * assets/fonts/estudio, carregados com o expo-font, lib/studio/nativeFonts) mas carregam-se uma a uma, só quando um texto
 * as usa ou o seletor as mostra. Enquanto não chegam, o texto sai na letra do sistema.
 *
 * No Android, uma fonte própria com `fontWeight` diferente do normal sai com um negrito inventado por cima: aqui o estilo
 * é só o `fontFamily` (cada ficheiro já tem o peso e o itálico certos).
 */
import * as Font from 'expo-font';
import type { TextStyle } from 'react-native';
import { fontById } from './studio/effects';
import { loadNativeFont } from './studio/nativeFonts';
import { normTextFont } from './textLayers';

/** Carrega uma fonte (true quando já se pode desenhar com ela). */
export const loadTextFont = (id: string): Promise<boolean> => loadNativeFont(normTextFont(id));
export const textFontReady = (id: string): boolean => Font.isLoaded(fontById(normTextFont(id)).family);
/** O estilo da letra (só a família), ou null enquanto a fonte não está carregada (fica a do sistema). */
export function textFontStyle(id: string): TextStyle | null {
  const f = fontById(normTextFont(id));
  return Font.isLoaded(f.family) ? { fontFamily: f.family } : null;
}
