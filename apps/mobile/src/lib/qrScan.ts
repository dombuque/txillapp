/**
 * Telemóvel: o QR de uma imagem da galeria (ou captura de ecrã).
 * 1) O leitor do sistema pelo expo-camera (`scanFromURLAsync`: ML Kit no Android, CIDetector no iPhone).
 * 2) Se não encontrar (o ML Kit falha quando o QR é pequeno na imagem), a Skia lê os píxeis da imagem por pedaços
 *    (os mesmos de qrDecode.scanPasses) e o jsqr procura em cada um.
 * No site é qrScan.web.ts.
 */
import { AlphaType, ColorType, Skia, type SkImage } from '@shopify/react-native-skia';
import { scanFromURLAsync } from 'expo-camera';
import jsQR from 'jsqr';
import { scanPasses } from './qrDecode';

async function systemScan(uri: string): Promise<string | null> {
  try {
    const found = await scanFromURLAsync(uri, ['qr']);
    const hit = found.find((f) => typeof f.data === 'string' && f.data.length > 0);
    return hit?.data ?? null;
  } catch {
    return null;
  }
}

function readPass(img: SkImage, p: ReturnType<typeof scanPasses>[number]): string | null {
  const surface = Skia.Surface.MakeOffscreen(p.dw, p.dh) ?? Skia.Surface.Make(p.dw, p.dh);
  if (!surface) return null;
  try {
    const canvas = surface.getCanvas();
    canvas.drawColor(Skia.Color('#ffffff'));
    canvas.drawImageRect(img, Skia.XYWHRect(p.sx, p.sy, p.sw, p.sh), Skia.XYWHRect(0, 0, p.dw, p.dh), Skia.Paint());
    surface.flush();
    const snap = surface.makeImageSnapshot();
    const px = snap.readPixels(0, 0, { width: p.dw, height: p.dh, colorType: ColorType.RGBA_8888, alphaType: AlphaType.Unpremul });
    snap.dispose?.();
    if (!px || px instanceof Float32Array || px.length < p.dw * p.dh * 4) return null;
    const hit = jsQR(new Uint8ClampedArray(px.buffer, px.byteOffset, p.dw * p.dh * 4), p.dw, p.dh, { inversionAttempts: 'attemptBoth' });
    return hit?.data || null;
  } finally {
    surface.dispose?.();
  }
}

async function pixelScan(uri: string): Promise<string | null> {
  let img: SkImage | null = null;
  try {
    img = Skia.Image.MakeImageFromEncoded(await Skia.Data.fromURI(uri));
    if (!img || !(img.width() > 0)) return null;
    // No telemóvel o jsqr é mais lento: a imagem inteira, o meio e as quatro janelas da linha do meio chegam.
    for (const p of scanPasses(img.width(), img.height()).slice(0, 6)) {
      const hit = readPass(img, p);
      if (hit) return hit;
      await new Promise((r) => setTimeout(r, 0));
    }
    return null;
  } catch {
    return null;
  } finally {
    img?.dispose?.();
  }
}

/** O texto do QR na imagem `uri` (file://), ou null se não houver nenhum que se leia. */
export async function scanImage(uri: string): Promise<string | null> {
  return (await systemScan(uri)) ?? (await pixelScan(uri));
}
