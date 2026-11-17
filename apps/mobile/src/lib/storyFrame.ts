/**
 * O desenho do visor dos mimos (como nos visores pro): o mimo num cartão 9:16 de cantos redondos e, por baixo, FORA da
 * imagem, a barra de responder, brindar e partilhar. A assinatura «txillapp @…» vem gravada no canto de baixo à direita da
 * foto ou do vídeo (apps/api/src/media/signature.ts e lib/wordmark.ts: margem de 4% do lado menor, logótipo com 20%):
 * com a barra fora do cartão nada a tapa. Num ecrã baixo o cartão encolhe (fica mais estreito, ao meio); a barra nunca
 * sobe para cima da imagem. Contas puras, testadas em tests/storyFrame.test.mjs.
 */

import { WORDMARK_BOX } from '@/lib/wordmark';

/** A forma do cartão (a das fotos e vídeos da câmara dos mimos). */
export const CARD_RATIO = 9 / 16;
/** A altura da barra de baixo (campo de 44 e folga). */
export const BAR_H = 60;
/** No computador ou tablet: o cartão não passa disto. */
export const WIDE_MAX_W = 460;
export const WIDE_MAX_H = 860;
/** A altura do cabeçalho (progresso, autor, ações) por cima do cartão: o topo da imagem, longe da assinatura. */
export const HEADER_H = 64;

export type FrameIn = { w: number; h: number; top: number; bottom: number; wide?: boolean };
export type Frame = { cardW: number; cardH: number; cardLeft: number; cardTop: number; barTop: number; barH: number; radius: number };

/** Onde fica o cartão e a barra (px do ecrã do visor). */
export function storyFrame({ w, h, top, bottom, wide = false }: FrameIn): Frame {
  const padTop = wide ? 24 : Math.max(top, 6);
  const padBottom = wide ? 24 : Math.max(bottom, 6);
  const sideMax = Math.max(0, wide ? Math.min(w - 32, WIDE_MAX_W) : w);
  const room = Math.max(0, h - padTop - padBottom - BAR_H);
  const cardW = Math.max(0, Math.floor(Math.min(sideMax, room * CARD_RATIO, wide ? WIDE_MAX_H * CARD_RATIO : Infinity)));
  const cardH = Math.min(Math.floor(room), Math.round(cardW / CARD_RATIO));
  // A folga que sobra (ecrãs mais altos do que 9:16 + barra) fica repartida em cima e em baixo.
  const cardTop = Math.round(padTop + (room - cardH) / 2);
  const radius = Math.min(20, Math.round(cardW * 0.05));
  return { cardW, cardH, cardLeft: Math.round((w - cardW) / 2), cardTop, barTop: cardTop + cardH, barH: BAR_H, radius };
}

export type Rect = { x: number; y: number; w: number; h: number };

/** Onde a foto ou o vídeo fica desenhado dentro do cartão (pode sair dele em `cover`). */
export function shownRect(mediaRatio: number, cardW: number, cardH: number, fit: 'cover' | 'contain'): Rect {
  const cr = cardW / cardH;
  const wider = mediaRatio > cr;
  const w = fit === 'cover' ? (wider ? cardH * mediaRatio : cardW) : (wider ? cardW : cardH * mediaRatio);
  const h = w / mediaRatio;
  return { x: (cardW - w) / 2, y: (cardH - h) / 2, w, h };
}

/**
 * A caixa da assinatura numa foto ou vídeo de w×h (px a partir do canto de cima à esquerda da media): a mesma conta da
 * `signLayout` (logótipo, @ por baixo e o selo), com folga para as letras que descem. `username` mede o @ (um nome comprido
 * passa para a esquerda do logótipo).
 */
export function signatureRect(w: number, h: number, username = 'txillapp', seal = true): Rect {
  const base = Math.min(w, h);
  const m = base * 0.04;
  const ww = base * 0.2;
  const wh = (WORDMARK_BOX.h / WORDMARK_BOX.w) * ww;
  const userSize = base * 0.028;
  const right = w - m;
  const baseline = h - m;
  const top = baseline - userSize * 1.25 - wh;
  const bottom = baseline + userSize * 0.25;
  const text = (username.length + 1) * userSize * 0.62 + (seal ? userSize * 1.2 : 0);
  const left = Math.min(right - ww, right - text);
  return { x: left, y: top, w: right - left, h: bottom - top };
}

/** A assinatura de uma media desenhada em `shown`, em px do cartão. */
export function signatureInCard(shown: Rect, username?: string): Rect {
  const s = signatureRect(shown.w, shown.h, username);
  return { x: shown.x + s.x, y: shown.y + s.y, w: s.w, h: s.h };
}

/**
 * Como a foto enche o cartão. `cover` só quando quase não corta: assim o canto de baixo à direita (a assinatura) fica
 * sempre inteiro, com pelo menos metade da margem. Uma foto de outra forma aparece inteira, com o fundo desfocado à volta.
 */
export function mimoFit(mediaRatio: number | null | undefined, cardW: number, cardH: number): 'cover' | 'contain' {
  if (!mediaRatio || !cardW || !cardH || !Number.isFinite(mediaRatio)) return 'contain';
  const shown = shownRect(mediaRatio, cardW, cardH, 'cover');
  // O que o `cover` corta de cada lado, contra metade da margem da assinatura (4% do lado menor).
  const crop = Math.max(shown.w - cardW, shown.h - cardH) / 2;
  return crop <= Math.min(shown.w, shown.h) * 0.02 ? 'cover' : 'contain';
}

/** A altura que se guarda para a legenda quando vai na faixa livre por baixo de uma foto mais deitada. */
export const CAPTION_ROOM = 92;

/**
 * Onde pousar a legenda dentro do cartão para nunca tapar a assinatura: na faixa livre por baixo da foto, se uma foto
 * mais deitada deixar lugar (com altura máxima, para não subir para a foto); senão logo acima da assinatura (sem saber a
 * forma, a de uma media que enche o cartão).
 */
export function captionSpot(cardW: number, cardH: number, mediaRatio?: number | null): { bottom: number; maxHeight?: number } {
  const fit = mimoFit(mediaRatio, cardW, cardH);
  const shown = mediaRatio ? shownRect(mediaRatio, cardW, cardH, fit) : { x: 0, y: 0, w: cardW, h: cardH };
  const below = cardH - (shown.y + shown.h);
  if (below >= CAPTION_ROOM + 16) return { bottom: 8, maxHeight: CAPTION_ROOM };
  const s = signatureInCard(shown);
  return { bottom: Math.ceil(cardH - s.y + 10) };
}

/** A altura máxima de um balão de comentário a flutuar (o @ e duas linhas de texto) e o espaço entre balões. */
export const FLOAT_BUBBLE_H = 60;
export const FLOAT_GAP = 8;
/** Os balões nunca passam desta fração da largura do cartão (o resto, à direita, fica livre para a foto e a assinatura). */
export const FLOAT_MAX_W = 0.62;

export type FloatColumn = { left: number; width: number; top: number; bottom: number; height: number; max: number };

/**
 * A coluna dos comentários a flutuar (px do cartão): à esquerda, na metade de baixo, e acaba acima da legenda (`captionH`
 * é a altura medida dela, 0 sem legenda) e da assinatura do canto de baixo à direita (medida com um @ comprido). `max` diz
 * quantos balões cabem (até 3).
 */
export function floatColumn(cardW: number, cardH: number, mediaRatio?: number | null, captionH = 0): FloatColumn {
  const fit = mimoFit(mediaRatio, cardW, cardH);
  const shown = mediaRatio ? shownRect(mediaRatio, cardW, cardH, fit) : { x: 0, y: 0, w: cardW, h: cardH };
  const sig = signatureInCard(shown, 'um_nome_bem_comprido');
  const cap = captionSpot(cardW, cardH, mediaRatio);
  const bottom = Math.ceil(Math.max(cardH - sig.y + 10, captionH > 0 ? cap.bottom + captionH + 10 : 0));
  // Na metade de baixo; numa foto deitada (a assinatura fica mais acima) sobe o que for preciso para caberem dois balões.
  const two = 2 * FLOAT_BUBBLE_H + FLOAT_GAP;
  const top = Math.max(Math.min(Math.round(cardH * 0.5), cardH - bottom - two), HEADER_H + 46 + FLOAT_GAP);
  const height = Math.max(0, cardH - bottom - top);
  const max = Math.max(0, Math.min(3, Math.floor((height + FLOAT_GAP) / (FLOAT_BUBBLE_H + FLOAT_GAP))));
  return { left: 12, width: Math.floor(cardW * FLOAT_MAX_W), top, bottom, height, max };
}

/** Um ponto (x, y) do cartão fica dentro dos cantos redondos? (A assinatura não pode ser cortada pelo canto.) */
export function insideRounded(x: number, y: number, w: number, h: number, r: number): boolean {
  if (x < 0 || y < 0 || x > w || y > h) return false;
  const cx = x < r ? r : x > w - r ? w - r : x;
  const cy = y < r ? r : y > h - r ? h - r : y;
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}
