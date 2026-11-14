import { TEXT_FONT_IDS } from '@txillapp/shared';
import { z } from 'zod';
import { STICKER_ART } from './sticker-art';
import { textLayerSvg } from './text-layer-render';

/** Limites por mimo: stickers (emojis) e textos contam à parte. */
export const MAX_STICKERS = 12;
export const MAX_TEXT_LAYERS = 10;

const pos = {
  x: z.number().min(-0.5).max(1.5),
  y: z.number().min(-0.5).max(1.5),
  s: z.number().min(0.05).max(1.6),
  r: z.number().min(-3600).max(3600),
};

/**
 * Um sticker pousado sobre o mimo. `x`/`y` é o centro, em fração da largura/altura do ecrã (0..1, pode sair um pouco);
 * `s` é a largura em fração da largura do ecrã; `r` a rotação em graus. A app desenha-os por cima da foto ou do vídeo
 * (os animados mexem-se); nas cópias guardadas ficam gravados parados.
 */
export const placedStickerSchema = z.object({
  id: z.string().min(1).max(40).refine((id) => id in STICKER_ART, 'Sticker desconhecido'),
  ...pos,
});
export type PlacedSticker = z.infer<typeof placedStickerSchema>;

/** Carateres de controlo (fora a mudança de linha). */
const CONTROL = new RegExp(`[\x00-\x09\x0B-\x1F\x7F-\x9F${String.fromCharCode(0x2028, 0x2029)}]`);
export const TEXT_LAYER_MAX_CHARS = 150;
export const TEXT_LAYER_MAX_LINES = 6;

/**
 * Um texto por cima do mimo (docs/fontes-contrato.md): a letra é uma das fontes do estúdio. `x`/`y`/`s`/`r` como nos
 * stickers (`s` é a largura da caixa toda, com o fundo, em fração da largura do ecrã). O texto vem já partido em linhas
 * (`\n`); o servidor não volta a partir.
 */
export const textLayerSchema = z.object({
  kind: z.literal('text'),
  text: z
    .string()
    .max(2000)
    .transform((t) => t.replace(/\r\n?/g, '\n').trim())
    .refine((t) => t.length > 0, 'O texto está vazio')
    .refine((t) => [...t].length <= TEXT_LAYER_MAX_CHARS, `O texto pode ter até ${TEXT_LAYER_MAX_CHARS} carateres`)
    .refine((t) => t.split('\n').length <= TEXT_LAYER_MAX_LINES, `O texto pode ter até ${TEXT_LAYER_MAX_LINES} linhas`)
    .refine((t) => !CONTROL.test(t), 'O texto tem carateres inválidos'),
  font: z.enum(TEXT_FONT_IDS).default('classica'),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Cor inválida').default('#ffffff'),
  bg: z.enum(['none', 'solid', 'soft']).default('none'),
  align: z.enum(['left', 'center', 'right']).default('center'),
  ...pos,
});
export type TextLayer = z.infer<typeof textLayerSchema>;

/** O que vai por cima de um mimo: stickers (sem `kind`, como sempre) e textos (`kind: 'text'`). */
export type StoryLayer = PlacedSticker | TextLayer;
export const isTextLayer = (l: StoryLayer | { kind?: unknown }): l is TextLayer => (l as { kind?: unknown }).kind === 'text';

// Um sticker não leva `kind`: um objeto com `kind` é um texto (ou é inválido), nunca cai para sticker.
const layerSchema = z.union([textLayerSchema, placedStickerSchema.extend({ kind: z.undefined().optional() })]);

export const stickersSchema = z
  .array(layerSchema)
  .max(MAX_STICKERS + MAX_TEXT_LAYERS)
  .refine((ls) => ls.filter((l) => !isTextLayer(l)).length <= MAX_STICKERS, `Até ${MAX_STICKERS} stickers por mimo`)
  .refine((ls) => ls.filter(isTextLayer).length <= MAX_TEXT_LAYERS, `Até ${MAX_TEXT_LAYERS} textos por mimo`)
  .transform((ls) => ls.map((l) => (isTextLayer(l) ? l : ({ id: l.id, x: l.x, y: l.y, s: l.s, r: l.r } as PlacedSticker))));

/** Os textos dos textos por cima (para passarem pelo filtro, como as legendas). */
export const layerTexts = (layers: StoryLayer[]): string[] => layers.filter(isTextLayer).map((l) => l.text);

/** A lista guardada na base de dados, já validada (o que vier estranho fica de fora). */
export function stickersOf(raw: unknown): StoryLayer[] {
  if (!Array.isArray(raw)) return [];
  const whole = stickersSchema.safeParse(raw);
  if (whole.success) return whole.data;
  const out: StoryLayer[] = [];
  for (const item of raw) {
    const r = layerSchema.safeParse(item);
    if (r.success) out.push(isTextLayer(r.data) ? r.data : { id: r.data.id, x: r.data.x, y: r.data.y, s: r.data.s, r: r.data.r });
  }
  return out;
}

/** Os stickers e os textos como SVG (fragmento) à escala de uma imagem W×H, para os gravar numa cópia (pela ordem da lista). */
export function stickersSvg(W: number, H: number, layers: StoryLayer[]): string {
  return layers
    .map((p) => {
      if (isTextLayer(p)) return textLayerSvg(W, H, p);
      const art = STICKER_ART[p.id];
      if (!art) return '';
      const [, , vw, vh] = art.vb.split(/\s+/).map(Number);
      const w = p.s * W;
      const h = w * ((vh || 100) / (vw || 100));
      const cx = p.x * W, cy = p.y * H;
      return `<g transform="rotate(${p.r.toFixed(2)} ${cx.toFixed(2)} ${cy.toFixed(2)})"><svg x="${(cx - w / 2).toFixed(2)}" y="${(cy - h / 2).toFixed(2)}" width="${w.toFixed(2)}" height="${h.toFixed(2)}" viewBox="${art.vb}">${art.body}</svg></g>`;
    })
    .join('');
}
