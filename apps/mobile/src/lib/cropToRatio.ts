import { FilterMode, ImageFormat, MipmapMode, Skia, type SkImage, type SkSurface } from '@shopify/react-native-skia';
import { File, Paths } from 'expo-file-system';

/**
 * Cortar e reduzir fotos no telemóvel, com a Skia (carrossel das publicações, como no Instagram, e fotos dos mimos).
 * A Skia lê a orientação EXIF (as fotos rodadas do telemóvel já vêm direitas, com largura e altura certas) e o JPEG gravado
 * sai sem metadados. Se algo falhar, devolve-se a foto original em vez de bloquear.
 *
 * Memória: fotos do telemóvel/Google Fotos têm 12 a 50 MP (até ~200 MB descodificadas). Por isso:
 * - as dimensões leem-se só do cabeçalho (`MakeImageFromEncoded` é diferido: não descodifica os píxeis);
 * - a foto descodifica-se uma só vez, para uma superfície em CPU já do tamanho final (sem a copiar para a GPU);
 * - imagem, dados e superfície largam-se sempre em `finally` (o GC do JS não vê a memória nativa e demorava a soltá-la).
 */

/** Lado maior do JPEG de uma publicação (nunca se aumenta a foto; só se reduz se for maior do que isto). */
export const POST_MAX_SIDE = 2048;

const free = (o: { dispose?: () => void } | null | undefined) => { try { o?.dispose?.(); } catch { /* já largado */ } };

/** Abre a foto sem descodificar os píxeis (só o cabeçalho). Quem chama larga-a com `free`. */
async function open(uri: string): Promise<SkImage | null> {
  try {
    const data = await Skia.Data.fromURI(uri);
    const i = Skia.Image.MakeImageFromEncoded(data);
    free(data); // a imagem guarda a sua própria referência aos bytes
    if (i) return i;
  } catch { /* tenta pelos bytes */ }
  try {
    // content:// do Android, nomes estranhos: lemos os bytes nós (como no editor de fotos).
    const data = Skia.Data.fromBytes(await new File(uri).bytes());
    const i = Skia.Image.MakeImageFromEncoded(data);
    free(data);
    return i;
  } catch {
    return null;
  }
}

/** Desenha o retângulo `src` da foto numa superfície W×H e grava um JPEG na cache. Devolve o caminho ou null. */
function render(img: SkImage, sx: number, sy: number, sw: number, sh: number, W: number, H: number, tag: string): string | null {
  // Superfície em CPU primeiro: a foto grande descodifica-se uma vez em memória normal e não sobe inteira para a GPU.
  let surface: SkSurface | null = null;
  try {
    // Mipmaps (redução mais suave) custam mais 1/3 da foto descodificada: só até ~16 MP.
    const mip = img.width() * img.height() <= 16e6 ? MipmapMode.Linear : MipmapMode.None;
    surface = Skia.Surface.Make(W, H) ?? Skia.Surface.MakeOffscreen(W, H);
    if (!surface) return null;
    surface.getCanvas().drawImageRectOptions(img, Skia.XYWHRect(sx, sy, sw, sh), Skia.XYWHRect(0, 0, W, H), FilterMode.Linear, mip, Skia.Paint());
    surface.flush();
    const snap = surface.makeImageSnapshot();
    const bytes = snap.encodeToBytes(ImageFormat.JPEG, 90);
    free(snap);
    if (!bytes?.length) return null;
    const file = new File(Paths.cache, `txillapp-${tag}-${Date.now()}-${Math.round(Math.random() * 1e6)}.jpg`);
    file.create({ overwrite: true });
    file.write(bytes);
    return file.uri;
  } finally {
    free(surface);
  }
}

/** Proporção (largura/altura, já com a orientação EXIF) da foto, ou null se não se conseguir ler. Só lê o cabeçalho. */
export async function imageRatio(uri: string): Promise<number | null> {
  const img = await open(uri);
  try {
    return img && img.width() && img.height() ? img.width() / img.height() : null;
  } finally {
    free(img);
  }
}

/**
 * JPEG da foto cortada ao centro na proporção `ratio` (largura/altura), com o lado maior até POST_MAX_SIDE.
 * Se já estiver na proporção (±1%) e não for maior do que isso, devolve a própria foto.
 */
export async function cropToRatio(uri: string, ratio: number): Promise<string> {
  if (!(ratio > 0)) return uri;
  let img: SkImage | null = null;
  try {
    img = await open(uri);
    if (!img) return uri;
    const w = img.width(), h = img.height();
    if (!w || !h) return uri;
    const fits = Math.abs(w / h / ratio - 1) <= 0.01;
    if (fits && Math.max(w, h) <= POST_MAX_SIDE) return uri;
    const cw = fits ? w : Math.min(w, h * ratio), ch = fits ? h : cw / ratio;
    const k = Math.min(1, POST_MAX_SIDE / Math.max(cw, ch));
    const outW = Math.max(1, Math.round(cw * k));
    const outH = Math.max(1, Math.round(fits ? ch * k : outW / ratio));
    return render(img, (w - cw) / 2, (h - ch) / 2, cw, ch, outW, outH, 'crop') ?? uri;
  } catch {
    return uri;
  } finally {
    free(img);
  }
}

/**
 * Foto pronta a enviar, reduzida para caber em `maxShort`×`maxLong` (por omissão 1440×2560, o ecrã inteiro de qualquer
 * telemóvel: mimos). O recorte do sistema (seletor do Android + Google Fotos) devolve a foto à resolução original.
 * Se já for pequena, ou se algo falhar, devolve-se a própria foto.
 */
export async function shrinkPhoto(uri: string, maxShort = 1440, maxLong = 2560): Promise<string> {
  let img: SkImage | null = null;
  try {
    img = await open(uri);
    if (!img) return uri;
    const w = img.width(), h = img.height();
    if (!w || !h) return uri;
    const k = Math.min(1, maxLong / Math.max(w, h), maxShort / Math.min(w, h));
    if (k >= 1) return uri;
    return render(img, 0, 0, w, h, Math.max(1, Math.round(w * k)), Math.max(1, Math.round(h * k)), 'small') ?? uri;
  } catch {
    return uri;
  } finally {
    free(img);
  }
}
