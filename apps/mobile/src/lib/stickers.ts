import chat from '../assets/stickers.json';
import mimo from '../assets/mimo-stickers.json';

/** Como o sticker se mexe no mimo ('none' = parado). */
export type StickerAnim = 'none' | 'pulse' | 'bounce' | 'wiggle' | 'spin' | 'swing' | 'float' | 'shake' | 'flicker' | 'twinkle' | 'pop';

export interface StickerDef {
  id: string;
  /** Nome (para o leitor de ecrã e a pesquisa). */
  text: string;
  cat: string;
  svg: string;
  anim: StickerAnim;
  /** Altura ÷ largura do desenho. */
  ratio: number;
}

/** Um sticker pousado sobre o mimo: centro (fração do ecrã), largura (fração da largura) e rotação em graus. */
export interface PlacedSticker { id: string; x: number; y: number; s: number; r: number }

export const MAX_STICKERS = 12;

const ratioOf = (svg: string) => {
  const vb = /viewBox="([^"]+)"/.exec(svg)?.[1]?.split(/\s+/).map(Number);
  return vb && vb[2] && vb[3] ? vb[3] / vb[2] : 1;
};

export const STICKER_CATS: { id: string; label: string }[] = [{ id: 'animados', label: 'Animados' }, ...(chat.cats as { id: string; label: string }[])];

/** Todos os stickers: os animados dos mimos primeiro, depois a biblioteca do chat (parados). */
export const STICKERS: StickerDef[] = [
  ...(mimo.items as { id: string; text: string; anim: StickerAnim; svg: string }[]).map((s) => ({ ...s, cat: 'animados', ratio: ratioOf(s.svg) })),
  ...(chat.items as { id: string; cat: string; text: string; svg: string }[]).map((s) => ({ ...s, anim: 'none' as const, ratio: ratioOf(s.svg) })),
];

const BY_ID = new Map(STICKERS.map((s) => [s.id, s]));
export const stickerById = (id: string): StickerDef | undefined => BY_ID.get(id);

/** Um sticker novo pousa no meio, um pouco acima do centro, com uma leve inclinação ao acaso. */
export const newPlaced = (id: string): PlacedSticker => ({ id, x: 0.5, y: 0.42, s: 0.38, r: Math.round(Math.random() * 16 - 8) });
