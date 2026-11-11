import { cardLayout, whatsappUrl, type CardInput, type CardText } from './inviteCard';

/**
 * O cartão do convite no browser: desenhado num canvas (o fundo em SVG, a foto recortada em círculo e as letras do sistema)
 * e guardado como PNG em memória (um blob). Nada sai do aparelho até a pessoa partilhar.
 */
export interface RenderedCard { uri: string; width: number; height: number; label: string; blob?: Blob; name?: string }

const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

const loadImage = (src: string) =>
  new Promise<HTMLImageElement>((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => rej(new Error('imagem'));
    img.src = src;
  });

function drawText(g: CanvasRenderingContext2D, t: CardText) {
  let size = t.size;
  const set = () => (g.font = `${t.weight} ${size}px ${FONT}`);
  set();
  const chars = [...t.text];
  const widthOf = () => (t.spacing ? chars.reduce((s, ch) => s + g.measureText(ch).width + t.spacing!, -t.spacing) : g.measureText(t.text).width);
  let w = widthOf();
  if (t.maxWidth && w > t.maxWidth) {
    size = Math.max(10, Math.floor((size * t.maxWidth) / w));
    set();
    w = widthOf();
  }
  g.globalAlpha = t.alpha ?? 1;
  g.fillStyle = t.color;
  g.textBaseline = 'alphabetic';
  g.textAlign = 'left';
  let x = t.align === 'center' ? t.x - w / 2 : t.x;
  if (!t.spacing) g.fillText(t.text, x, t.y);
  else for (const ch of chars) {
    g.fillText(ch, x, t.y);
    x += g.measureText(ch).width + t.spacing;
  }
  g.globalAlpha = 1;
}

/** Desenha o cartão e devolve o PNG (blob e endereço local). `avatarUrl`: a foto de perfil (do mesmo site), ou null. */
export async function renderInviteCard(input: CardInput, avatarUrl: string | null): Promise<RenderedCard> {
  // A foto primeiro: se não vier (sem rede, sem foto), o cartão leva as iniciais.
  let bmp: ImageBitmap | null = null;
  if (avatarUrl && input.hasAvatar) {
    try {
      const res = await fetch(avatarUrl);
      if (res.ok && res.status !== 204) bmp = await createImageBitmap(await res.blob());
    } catch {
      bmp = null;
    }
  }
  const l = cardLayout({ ...input, hasAvatar: !!bmp });
  const c = document.createElement('canvas');
  c.width = l.width;
  c.height = l.height;
  const g = c.getContext('2d');
  if (!g) throw new Error('Não consegui desenhar o cartão');
  g.drawImage(await loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(l.svg)}`), 0, 0, l.width, l.height);
  if (bmp) {
    const { cx, cy, r } = l.avatar;
    const side = Math.min(bmp.width, bmp.height);
    g.save();
    g.beginPath();
    g.arc(cx, cy, r, 0, Math.PI * 2);
    g.closePath();
    g.clip();
    g.drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, cx - r, cy - r, 2 * r, 2 * r);
    g.restore();
    bmp.close?.();
  }
  for (const t of l.texts) drawText(g, t);
  const blob = await new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('Não consegui criar a imagem'))), 'image/png'));
  return { uri: URL.createObjectURL(blob), width: l.width, height: l.height, label: l.label, blob, name: `convite-txillapp-${input.code}-${input.format}.png` };
}

/** Liberta a imagem de um cartão antigo. */
export function forgetCard(card: RenderedCard | null) {
  if (card?.uri.startsWith('blob:')) URL.revokeObjectURL(card.uri);
}

export type ShareOutcome = 'shared' | 'text-only' | 'copied' | 'cancelled';

const fileOf = (card: RenderedCard) => (card.blob ? new File([card.blob], card.name ?? 'convite-txillapp.png', { type: 'image/png' }) : null);
const aborted = (e: unknown) => (e as Error)?.name === 'AbortError';

/** «Partilhar»: a folha do sistema com a imagem e o texto (com a ligação). Sem folha de partilha: copia o texto. */
export async function shareCard(card: RenderedCard, text: string): Promise<ShareOutcome> {
  const f = fileOf(card);
  try {
    if (f && navigator.canShare?.({ files: [f] })) {
      await navigator.share({ files: [f], text });
      return 'shared';
    }
    if (navigator.share) {
      await navigator.share({ text });
      return 'text-only';
    }
  } catch (e) {
    if (aborted(e)) return 'cancelled';
  }
  try {
    await navigator.clipboard.writeText(text);
    return 'copied';
  } catch {
    return 'cancelled';
  }
}

/** «Partilhar no WhatsApp»: abre o WhatsApp com o texto e a ligação já escritos (a pré-visualização mostra o cartão). */
export async function shareOnWhatsApp(_card: RenderedCard | null, text: string): Promise<ShareOutcome> {
  window.open(whatsappUrl(text, false), '_blank', 'noopener');
  return 'text-only';
}

/** «Guardar imagem»: no telemóvel, a folha do sistema (tem «Guardar imagem»); no computador, descarrega o PNG. */
export async function saveCard(card: RenderedCard): Promise<'saved' | 'denied'> {
  const f = fileOf(card);
  const touch = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches;
  if (f && touch && navigator.canShare?.({ files: [f] })) {
    try {
      await navigator.share({ files: [f] });
      return 'saved';
    } catch (e) {
      if (aborted(e)) return 'saved';
    }
  }
  const a = document.createElement('a');
  a.href = card.uri;
  a.download = card.name ?? 'convite-txillapp.png';
  document.body.appendChild(a);
  a.click();
  a.remove();
  return 'saved';
}
