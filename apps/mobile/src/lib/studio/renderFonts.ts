/**
 * As fontes do texto do estúdio (lib/studio/effects.ts, FONTS): ficheiros woff2 em public/fonts/estudio (do Google Fonts,
 * licença OFL), servidos pelo próprio site (a CSP só deixa fontes do Txillapp). Carregam-se uma vez, quando o estúdio abre.
 */
import { FONTS, fontById, type FontId } from './effects';

const loaded = new Map<FontId, Promise<boolean>>();

/** Carrega uma fonte (true quando já se pode desenhar com ela). */
export function ensureFont(id: FontId): Promise<boolean> {
  const have = loaded.get(id);
  if (have) return have;
  const f = fontById(id);
  const p = (async () => {
    try {
      const FF = (globalThis as { FontFace?: typeof FontFace }).FontFace;
      if (!FF || typeof document === 'undefined' || !document.fonts) return false;
      const face = new FF(f.family, `url(${f.file}) format("woff2")`, { weight: String(f.weight), style: f.style ?? 'normal', display: 'swap' });
      await face.load();
      document.fonts.add(face);
      return true;
    } catch {
      return false;
    }
  })();
  loaded.set(id, p);
  return p;
}
/** Todas as fontes (o estúdio chama ao abrir; a montagem espera por elas). */
export const loadStudioFonts = () => Promise.all(FONTS.map((f) => ensureFont(f.id))).then((r) => r.every(Boolean));
