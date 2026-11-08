import { z } from 'zod';
import { STICKER_ART } from './sticker-art';

/**
 * Um sticker pousado sobre o mimo. `x`/`y` é o centro, em fração da largura/altura do ecrã (0..1, pode sair um pouco);
 * `s` é a largura em fração da largura do ecrã; `r` a rotação em graus. A app desenha-os por cima da foto ou do vídeo
 * (os animados mexem-se); nas cópias guardadas ficam gravados parados.
 */
export const placedStickerSchema = z.object({
  id: z.string().min(1).max(40).refine((id) => id in STICKER_ART, 'Sticker desconhecido'),
  x: z.number().min(-0.5).max(1.5),
  y: z.number().min(-0.5).max(1.5),
  s: z.number().min(0.05).max(1.6),
  r: z.number().min(-3600).max(3600),
});
export type PlacedSticker = z.infer<typeof placedStickerSchema>;
export const stickersSchema = z.array(placedStickerSchema).max(12);

/** A lista guardada na base de dados, já validada (ou vazia se vier algo estranho). */
export function stickersOf(raw: unknown): PlacedSticker[] {
  const r = stickersSchema.safeParse(raw ?? []);
  return r.success ? r.data : [];
}

/** Os stickers como SVG (fragmento) à escala de uma imagem W×H, para os gravar numa cópia. */
export function stickersSvg(W: number, H: number, stickers: PlacedSticker[]): string {
  return stickers
    .map((p) => {
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
