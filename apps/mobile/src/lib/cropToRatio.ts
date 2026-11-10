import { FilterMode, ImageFormat, MipmapMode, Skia, type SkImage } from '@shopify/react-native-skia';
import { File, Paths } from 'expo-file-system';

/**
 * Cortar fotos ao centro numa proporção (carrossel das publicações, como no Instagram), no telemóvel, com a Skia.
 * A Skia lê a orientação EXIF ao descodificar (as fotos rodadas do telemóvel já vêm direitas, com largura e altura certas)
 * e o JPEG gravado sai sem metadados. Se algo falhar, devolve-se a foto original em vez de bloquear.
 */

/** Lado maior do JPEG cortado (nunca se aumenta a foto; só se reduz se for maior do que isto). */
const MAX_SIDE = 2048;

async function decode(uri: string): Promise<SkImage | null> {
  try {
    const i = Skia.Image.MakeImageFromEncoded(await Skia.Data.fromURI(uri));
    if (i) return i;
  } catch { /* tenta pelos bytes */ }
  try {
    // content:// do Android, nomes estranhos: lemos os bytes nós (como no editor de fotos).
    return Skia.Image.MakeImageFromEncoded(Skia.Data.fromBytes(await new File(uri).bytes()));
  } catch {
    return null;
  }
}

/** Proporção (largura/altura, já com a orientação EXIF) da foto, ou null se não se conseguir ler. */
export async function imageRatio(uri: string): Promise<number | null> {
  const img = await decode(uri);
  return img && img.width() && img.height() ? img.width() / img.height() : null;
}

/** JPEG da foto cortada ao centro na proporção `ratio` (largura/altura). A ±1% da proporção, devolve a própria foto. */
export async function cropToRatio(uri: string, ratio: number): Promise<string> {
  if (!(ratio > 0)) return uri;
  try {
    const img = await decode(uri);
    if (!img) return uri;
    const w = img.width(), h = img.height();
    if (!w || !h || Math.abs(w / h / ratio - 1) <= 0.01) return uri;
    const cw = Math.min(w, h * ratio), ch = cw / ratio;
    const k = Math.min(1, MAX_SIDE / Math.max(cw, ch));
    const outW = Math.max(1, Math.round(cw * k));
    const outH = Math.max(1, Math.round(outW / ratio));
    const surface = Skia.Surface.MakeOffscreen(outW, outH) ?? Skia.Surface.Make(outW, outH);
    if (!surface) return uri;
    surface.getCanvas().drawImageRectOptions(img, Skia.XYWHRect((w - cw) / 2, (h - ch) / 2, cw, ch), Skia.XYWHRect(0, 0, outW, outH), FilterMode.Linear, MipmapMode.Linear, Skia.Paint());
    surface.flush();
    const bytes = surface.makeImageSnapshot().encodeToBytes(ImageFormat.JPEG, 90);
    if (!bytes?.length) return uri;
    const file = new File(Paths.cache, `txillapp-crop-${Date.now()}-${Math.round(Math.random() * 1e6)}.jpg`);
    file.create({ overwrite: true });
    file.write(bytes);
    return file.uri;
  } catch {
    return uri;
  }
}
