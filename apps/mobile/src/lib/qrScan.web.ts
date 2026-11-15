/** Site: o QR de uma imagem (o <input type=file> dá um blob:) pelo BarcodeDetector ou pelo jsqr (ver qrWeb.ts). */
import { scanImageWeb } from './qrWeb';

export async function scanImage(uri: string): Promise<string | null> {
  try {
    return await scanImageWeb(uri);
  } catch {
    return null;
  }
}
