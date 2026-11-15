import { ImageFormat, Skia } from '@shopify/react-native-skia';
import { File, Paths } from 'expo-file-system';
import * as MediaLibrary from 'expo-media-library/legacy';
import { Platform, Share } from 'react-native';
import { drawText } from './inviteCardImage';
import { qrCardLayout, qrFileName, type QrShareOutcome } from './profileQrCard';
import { qrMatrix } from './qr';
import { linkShare } from './shareLink';

/**
 * O cartão do QR do perfil no telemóvel: desenhado no aparelho com a Skia (o SVG do fundo, do QR e do logótipo, e o @ com a
 * letra do sistema) e guardado na cache como PNG. Nada sai do telemóvel até a pessoa partilhar.
 */
export interface QrImage { uri: string; width: number; height: number; name: string; label: string }

export async function renderProfileQr(url: string, username: string): Promise<QrImage> {
  const l = qrCardLayout(qrMatrix(url), username);
  const surface = Skia.Surface.MakeOffscreen(l.width, l.height) ?? Skia.Surface.Make(l.width, l.height);
  if (!surface) throw new Error('Não consegui desenhar o QR');
  const canvas = surface.getCanvas();
  const svg = Skia.SVG.MakeFromString(l.svg);
  if (!svg) throw new Error('Não consegui desenhar o QR');
  canvas.drawSvg(svg, l.width, l.height);
  drawText(canvas, l.text);
  surface.flush();
  const bytes = surface.makeImageSnapshot().encodeToBytes(ImageFormat.PNG, 100);
  const name = qrFileName(username);
  const file = new File(Paths.cache, `${name.replace(/\.png$/, '')}-${Date.now()}.png`);
  file.create({ overwrite: true });
  file.write(bytes);
  return { uri: file.uri, width: l.width, height: l.height, name, label: l.label };
}

/** Apaga uma imagem antiga da cache (ao gerar outra ou ao fechar a folha). */
export function forgetProfileQr(img: QrImage | null) {
  if (!img) return;
  try {
    const f = new File(img.uri);
    if (f.exists) f.delete();
  } catch {
    /* fica na cache, que o sistema limpa */
  }
}

// As imagens que já foram para a galeria (para não a guardar duas vezes se a pessoa carregar outra vez em «Partilhar»).
const saved = new WeakSet<QrImage>();

/**
 * «Partilhar». No iPhone, a folha do sistema leva a imagem e o texto com a ligação. No Android a folha do React Native só
 * leva texto (e não há pacote para partilhar ficheiros): a imagem vai para a galeria e partilha-se o texto com a ligação.
 */
export async function shareProfileQr(img: QrImage | null, text: string, url: string, title?: string): Promise<QrShareOutcome> {
  const message = `${text} ${url}`;
  try {
    if (img && Platform.OS === 'ios') {
      const r = await Share.share({ url: img.uri, message, title });
      return r.action === Share.dismissedAction ? 'cancelled' : 'shared';
    }
    let kept = false;
    if (img) {
      try {
        if (!saved.has(img)) {
          const perm = await MediaLibrary.requestPermissionsAsync(true);
          if (perm.granted) {
            await MediaLibrary.saveToLibraryAsync(img.uri);
            saved.add(img);
          }
        }
        kept = saved.has(img);
      } catch {
        kept = false;
      }
    }
    // A ligação uma só vez: no fim do texto no Android, à parte no iPhone (ver linkShare).
    const r = await Share.share({ title, ...linkShare(text, url) });
    if (r.action === Share.dismissedAction) return kept ? 'saved-link' : 'cancelled';
    return kept ? 'saved-link' : 'link';
  } catch {
    return 'failed';
  }
}
