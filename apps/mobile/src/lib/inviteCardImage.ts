import { ClipOp, ImageFormat, matchFont, Skia, type SkCanvas, type SkFont, type SkImage } from '@shopify/react-native-skia';
import { File, Paths } from 'expo-file-system';
import * as MediaLibrary from 'expo-media-library/legacy';
import { Linking, Platform, Share } from 'react-native';
import { badgePlace, cardLayout, sealSvg, whatsappUrl, type CardInput, type CardText } from './inviteCard';

/**
 * O cartão do convite no telemóvel: desenhado no aparelho com a Skia (o fundo em SVG, a foto recortada em círculo e as letras
 * com a letra do sistema) e guardado na cache como PNG. Nada sai do telemóvel até a pessoa partilhar.
 */
export interface RenderedCard { uri: string; width: number; height: number; label: string }

const FAMILY = Platform.select({ ios: 'Helvetica', default: 'sans-serif' });
const fonts = new Map<string, SkFont>();
const fontOf = (size: number, weight: CardText['weight']) => {
  const key = `${size}:${weight}`;
  let f = fonts.get(key);
  if (!f) {
    f = matchFont({ fontFamily: FAMILY, fontSize: size, fontWeight: weight === 400 ? 'normal' : 'bold' });
    fonts.set(key, f);
  }
  return f;
};

/** Pinta uma linha: encolhe a letra se passar da largura e, com `spacing`, põe letra a letra. */
function drawText(canvas: SkCanvas, t: CardText) {
  const paint = Skia.Paint();
  paint.setAntiAlias(true);
  paint.setColor(Skia.Color(t.color));
  if (t.alpha !== undefined) paint.setAlphaf(t.alpha);
  let size = t.size;
  let font = fontOf(size, t.weight);
  const chars = [...t.text];
  const widthOf = (f: SkFont) => (t.spacing ? chars.reduce((s, ch) => s + f.measureText(ch).width + t.spacing!, -t.spacing) : f.measureText(t.text).width);
  let w = widthOf(font);
  if (t.maxWidth && w > t.maxWidth) {
    size = Math.max(10, Math.floor((size * t.maxWidth) / w));
    font = fontOf(size, t.weight);
    w = widthOf(font);
  }
  let x = t.align === 'center' ? t.x - w / 2 : t.x;
  if (t.badge) {
    // O selo de verificado a seguir ao nome: o nome e o selo centram-se juntos.
    const b = badgePlace(t, w, size);
    canvas.drawText(t.text, b.textX, t.y, paint, font);
    const seal = Skia.SVG.MakeFromString(sealSvg(t.badge, b.size));
    if (seal) {
      canvas.save();
      canvas.translate(b.x, b.y);
      canvas.drawSvg(seal, b.size, b.size);
      canvas.restore();
    }
    return;
  }
  if (!t.spacing) return canvas.drawText(t.text, x, t.y, paint, font);
  for (const ch of chars) {
    canvas.drawText(ch, x, t.y, paint, font);
    x += font.measureText(ch).width + t.spacing;
  }
}

/** Desenha o cartão e devolve o ficheiro PNG (na cache do telemóvel). `avatarUrl`: a foto de perfil (pública), ou null. */
export async function renderInviteCard(input: CardInput, avatarUrl: string | null): Promise<RenderedCard> {
  // A foto primeiro: se não vier (sem rede, sem foto), o cartão leva as iniciais.
  let img: SkImage | null = null;
  if (avatarUrl && input.hasAvatar) {
    try {
      img = Skia.Image.MakeImageFromEncoded(await Skia.Data.fromURI(avatarUrl));
    } catch {
      img = null;
    }
  }
  const l = cardLayout({ ...input, hasAvatar: !!img });
  const surface = Skia.Surface.MakeOffscreen(l.width, l.height) ?? Skia.Surface.Make(l.width, l.height);
  if (!surface) throw new Error('Não consegui desenhar o cartão');
  const canvas = surface.getCanvas();
  const svg = Skia.SVG.MakeFromString(l.svg);
  if (svg) canvas.drawSvg(svg, l.width, l.height);
  if (img) {
    const { cx, cy, r } = l.avatar;
    const side = Math.min(img.width(), img.height());
    const src = Skia.XYWHRect((img.width() - side) / 2, (img.height() - side) / 2, side, side);
    canvas.save();
    canvas.clipRRect(Skia.RRectXY(Skia.XYWHRect(cx - r, cy - r, 2 * r, 2 * r), r, r), ClipOp.Intersect, true);
    const paint = Skia.Paint();
    paint.setAntiAlias(true);
    canvas.drawImageRect(img, src, Skia.XYWHRect(cx - r, cy - r, 2 * r, 2 * r), paint);
    canvas.restore();
  }
  for (const t of l.texts) drawText(canvas, t);
  surface.flush();
  const bytes = surface.makeImageSnapshot().encodeToBytes(ImageFormat.PNG, 100);
  const file = new File(Paths.cache, `convite-${input.code}-${input.format}-${Date.now()}.png`);
  file.create({ overwrite: true });
  file.write(bytes);
  return { uri: file.uri, width: l.width, height: l.height, label: l.label };
}

/** Apaga um cartão antigo da cache (ao gerar outro ou ao sair do ecrã). */
export function forgetCard(card: RenderedCard | null) {
  if (!card) return;
  try {
    const f = new File(card.uri);
    if (f.exists) f.delete();
  } catch {
    /* fica na cache, que o sistema limpa */
  }
}

export type ShareOutcome = 'shared' | 'text-only' | 'copied' | 'cancelled';

/**
 * «Partilhar»: a folha do sistema. No iPhone vai a imagem com o texto e a ligação; no Android a folha do React Native só leva
 * texto, por isso vai o texto com a ligação (o WhatsApp mostra o cartão na pré-visualização) e a app sugere «Guardar imagem».
 */
export async function shareCard(card: RenderedCard, text: string): Promise<ShareOutcome> {
  try {
    const r = Platform.OS === 'ios' ? await Share.share({ url: card.uri, message: text }) : await Share.share({ message: text });
    if (r.action === Share.dismissedAction) return 'cancelled';
    return Platform.OS === 'ios' ? 'shared' : 'text-only';
  } catch {
    return 'cancelled';
  }
}

/** «Partilhar no WhatsApp»: abre o WhatsApp com o texto e a ligação já escritos (a pré-visualização mostra o cartão). */
export async function shareOnWhatsApp(_card: RenderedCard | null, text: string): Promise<ShareOutcome> {
  try {
    await Linking.openURL(whatsappUrl(text, true));
    return 'text-only';
  } catch {
    await Linking.openURL(whatsappUrl(text, false)).catch(() => undefined);
    return 'text-only';
  }
}

/** «Guardar imagem»: na galeria do telemóvel (pede só a permissão de escrever). */
export async function saveCard(card: RenderedCard): Promise<'saved' | 'denied'> {
  const perm = await MediaLibrary.requestPermissionsAsync(true);
  if (!perm.granted) return 'denied';
  await MediaLibrary.saveToLibraryAsync(card.uri);
  return 'saved';
}
