import { drawText } from './inviteCardImage.web';
import { qrCardLayout, qrFileName, type QrShareOutcome } from './profileQrCard';
import { qrMatrix } from './qr';
import { t } from '@/lib/i18n';

/**
 * O cartão do QR do perfil no browser: desenhado num <canvas> (o SVG do fundo, do QR e do logótipo, e o @ com a letra do
 * sistema) e guardado como PNG em memória (um blob). Nada sai do aparelho até a pessoa partilhar.
 */
export interface QrImage { uri: string; width: number; height: number; name: string; label: string; blob?: Blob }

const loadImage = (src: string) =>
  new Promise<HTMLImageElement>((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => rej(new Error('imagem'));
    img.src = src;
  });

export async function renderProfileQr(url: string, username: string): Promise<QrImage> {
  const l = qrCardLayout(qrMatrix(url), username);
  const c = document.createElement('canvas');
  c.width = l.width;
  c.height = l.height;
  const g = c.getContext('2d');
  if (!g) throw new Error(t('Não consegui desenhar o QR'));
  g.imageSmoothingEnabled = false;
  g.drawImage(await loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(l.svg)}`), 0, 0, l.width, l.height);
  drawText(g, l.text);
  const blob = await new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error(t('Não consegui criar a imagem')))), 'image/png'));
  return { uri: URL.createObjectURL(blob), width: l.width, height: l.height, name: qrFileName(username), label: l.label, blob };
}

/** Liberta a imagem antiga (um pouco depois, para não cortar um descarregamento que ainda esteja a começar). */
export function forgetProfileQr(img: QrImage | null) {
  const uri = img?.uri;
  if (uri?.startsWith('blob:')) setTimeout(() => URL.revokeObjectURL(uri), 5000);
}

const aborted = (e: unknown) => (e as Error)?.name === 'AbortError';

function download(img: QrImage) {
  const a = document.createElement('a');
  a.href = img.uri;
  a.download = img.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/**
 * «Partilhar»: a folha do sistema com a imagem, o texto e a ligação (`navigator.share`), se o browser partilha ficheiros.
 * Senão (ou se a partilha falhar), descarrega a imagem e copia a ligação.
 */
export async function shareProfileQr(img: QrImage | null, text: string, url: string, title?: string): Promise<QrShareOutcome> {
  const f = img?.blob ? new File([img.blob], img.name, { type: 'image/png' }) : null;
  if (f && typeof navigator !== 'undefined' && navigator.canShare) {
    // Primeiro com a ligação à parte; há browsers que só aceitam ficheiros com texto, e aí a ligação vai no fim do texto.
    const full: ShareData = { files: [f], text, url, ...(title ? { title } : {}) };
    const data = navigator.canShare(full) ? full : navigator.canShare({ files: [f], text }) ? { files: [f], text: `${text} ${url}` } : null;
    if (data) {
      try {
        await navigator.share(data);
        return 'shared';
      } catch (e) {
        if (aborted(e)) return 'cancelled';
      }
    }
  }
  if (!img) {
    // Sem imagem (não se conseguiu desenhar): a ligação, como antes.
    try {
      if (navigator.share) {
        await navigator.share({ text, url });
        return 'link';
      }
    } catch (e) {
      if (aborted(e)) return 'cancelled';
    }
  } else download(img);
  try {
    await navigator.clipboard.writeText(url);
    return img ? 'downloaded' : 'copied';
  } catch {
    return img ? 'downloaded-only' : 'failed';
  }
}
