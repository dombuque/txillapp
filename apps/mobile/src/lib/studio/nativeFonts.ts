/**
 * As 10 fontes do texto do estúdio no telemóvel (as mesmas famílias do site e do servidor, docs/estudio-efeitos.md, em TTF,
 * licença SIL OFL, em assets/fonts/estudio). Carregam-se uma vez com o expo-font, com os nomes de `FONTS` (TxInter…): o
 * `fontFamily` do texto é o mesmo nos três lados.
 *
 * No Android, uma fonte própria com `fontWeight` diferente do normal pode sair com um negrito inventado por cima: o texto do
 * estúdio usa só o `fontFamily` (cada ficheiro já tem o peso certo) — ver `nativeFontStyle`.
 */
import * as Font from 'expo-font';
import { FONTS, fontById, type FontId } from './effects';

const FILES: Record<FontId, number> = {
  classica: require('../../../assets/fonts/estudio/inter.ttf'),
  cartaz: require('../../../assets/fonts/estudio/bebas.ttf'),
  grito: require('../../../assets/fonts/estudio/anton.ttf'),
  praia: require('../../../assets/fonts/estudio/pacifico.ttf'),
  marcador: require('../../../assets/fonts/estudio/marker.ttf'),
  elegante: require('../../../assets/fonts/estudio/playfair.ttf'),
  maquina: require('../../../assets/fonts/estudio/spacemono.ttf'),
  retro: require('../../../assets/fonts/estudio/lobster.ttf'),
  mao: require('../../../assets/fonts/estudio/caveat.ttf'),
  futuro: require('../../../assets/fonts/estudio/orbitron.ttf'),
};

let loading: Promise<boolean> | null = null;
/** Carrega as 10 (true quando estão todas). Sem elas o texto usa a letra do sistema, e o vídeo final sai na mesma com a fonte certa. */
export function loadNativeStudioFonts(): Promise<boolean> {
  return (loading ??= Font.loadAsync(Object.fromEntries(FONTS.map((f) => [f.family, FILES[f.id]]))).then(() => true, () => { loading = null; return false; }));
}
export const nativeFontsLoaded = () => FONTS.every((f) => Font.isLoaded(f.family));

/** O estilo de letra de uma fonte do estúdio no telemóvel (só a família: o peso e o itálico estão no próprio ficheiro). */
export function nativeFontStyle(id: string): { fontFamily: string } {
  const f = fontById(id);
  return { fontFamily: Font.isLoaded(f.family) ? f.family : 'System' };
}
