/**
 * As contas do enquadramento da câmara do Zás (puras, sem React nem DOM, testadas em tests/zasFrame.test.mjs).
 * O Zás é uma foto 3:4 (largura/altura = 0,75) dentro de uma forma squircle. A imagem da câmara tem de encher SEMPRE a
 * forma ("cover": amplia até cobrir e corta o que sobra, sem barras) e a foto tirada tem de ser exatamente o que se viu.
 * Por isso a pré-visualização e o recorte da foto saem das mesmas duas funções: `coverBox` (onde pôr a imagem no ecrã)
 * e `coverCrop` (que parte da imagem fica na foto).
 */

/** Proporção do Zás: largura / altura. */
export const ZAS_ASPECT = 0.75;
/** Largura da foto final (a mesma das contas do site: 1080 × 1440). */
export const ZAS_OUT_W = 1080;
/** Zoom máximo da pinça (para além disto a imagem fica papa). */
export const ZAS_MAX_ZOOM = 4;

export type Box = { left: number; top: number; width: number; height: number };
export type Crop = { sx: number; sy: number; sw: number; sh: number };

const ok = (n: number) => Number.isFinite(n) && n > 0;

/**
 * O tamanho do cartão do Zás no espaço disponível: proporção 0,75 exata (largura múltipla de 3, para a altura ser
 * inteira), no máximo `maxH` de altura, com `padX` de margem dos lados. Nunca devolve medidas negativas.
 */
export function zasCardSize(availW: number, availH: number, maxH = 520, padX = 32): { w: number; h: number } {
  const w0 = Math.max(0, (Number.isFinite(availW) ? availW : 0) - padX * 2);
  const h0 = Math.max(0, Math.min(maxH, Number.isFinite(availH) ? availH : 0));
  let w = Math.min(w0, h0 * ZAS_ASPECT);
  w = Math.floor(w / 3) * 3;
  if (w <= 0) return { w: 0, h: 0 };
  return { w, h: (w / 3) * 4 };
}

/**
 * Onde desenhar a imagem da câmara (srcW × srcH) para cobrir a caixa (boxW × boxH): a imagem fica com a sua própria
 * proporção, ampliada até não sobrar nenhum espaço vazio, centrada (o que passa fica de fora e é cortado pela forma).
 * `zoom` (≥ 1) amplia ainda mais, a partir do centro. Sem medidas da câmara, a imagem ocupa a caixa toda.
 */
export function coverBox(boxW: number, boxH: number, srcW: number, srcH: number, zoom = 1): Box {
  if (!ok(boxW) || !ok(boxH)) return { left: 0, top: 0, width: 0, height: 0 };
  const z = Math.max(1, ok(zoom) ? zoom : 1);
  if (!ok(srcW) || !ok(srcH)) return { left: (boxW - boxW * z) / 2, top: (boxH - boxH * z) / 2, width: boxW * z, height: boxH * z };
  const k = Math.max(boxW / srcW, boxH / srcH) * z;
  const width = srcW * k;
  const height = srcH * k;
  return { left: (boxW - width) / 2, top: (boxH - height) / 2, width, height };
}

/**
 * A parte da imagem (srcW × srcH) que fica numa foto de proporção `aspect` (largura/altura): o maior retângulo centrado
 * com essa proporção que cabe na imagem, dividido pelo `zoom`. É exatamente a parte que `coverBox` deixa à vista numa caixa
 * com a mesma proporção, por isso a foto sai como se viu. Centrado na horizontal: espelhar antes ou depois dá o mesmo.
 */
export function coverCrop(srcW: number, srcH: number, aspect = ZAS_ASPECT, zoom = 1): Crop {
  if (!ok(srcW) || !ok(srcH) || !ok(aspect)) return { sx: 0, sy: 0, sw: Math.max(0, srcW || 0), sh: Math.max(0, srcH || 0) };
  const z = Math.max(1, ok(zoom) ? zoom : 1);
  let sw = srcW;
  let sh = srcW / aspect;
  if (sh > srcH) {
    sh = srcH;
    sw = srcH * aspect;
  }
  sw /= z;
  sh /= z;
  return { sx: (srcW - sw) / 2, sy: (srcH - sh) / 2, sw, sh };
}

/** Recorte em píxeis inteiros (para o canvas e para o recorte nativo), sem sair da imagem. */
export function roundCrop(c: Crop, srcW: number, srcH: number): Crop {
  const sw = Math.max(1, Math.min(Math.round(c.sw), Math.floor(srcW)));
  const sh = Math.max(1, Math.min(Math.round(c.sh), Math.floor(srcH)));
  const sx = Math.min(Math.max(0, Math.round(c.sx)), Math.floor(srcW) - sw);
  const sy = Math.min(Math.max(0, Math.round(c.sy)), Math.floor(srcH) - sh);
  return { sx, sy, sw, sh };
}

/**
 * Tamanho da foto final: no máximo `maxW` de largura e, sem `minW`, nunca maior do que o recorte (não inventa píxeis).
 * Com `minW` (o zoom digital do site deixa recortes pequenos), amplia-se até essa largura para o Zás não sair minúsculo.
 */
export function outSize(cropW: number, cropH: number, maxW = ZAS_OUT_W, minW = 0): { w: number; h: number } {
  if (!ok(cropW) || !ok(cropH)) return { w: 0, h: 0 };
  let k = Math.min(1, maxW / cropW);
  if (cropW * k < minW) k = Math.min(minW, maxW) / cropW;
  return { w: Math.max(1, Math.round(cropW * k)), h: Math.max(1, Math.round(cropH * k)) };
}

/** Zoom da pinça: o zoom do início vezes a escala dos dedos, dentro dos limites. */
export function pinchZoom(start: number, scale: number, min = 1, max = ZAS_MAX_ZOOM): number {
  const v = (ok(start) ? start : min) * (ok(scale) ? scale : 1);
  return Math.min(max, Math.max(min, v));
}

/**
 * Um toque na forma (x, y em pontos da caixa boxW × boxH) passado para a imagem da câmara, em 0–1 (o que o
 * `pointsOfInterest` do browser quer). Conta com o corte "cover", o zoom e o espelho da câmara da frente
 * (o ecrã mostra a imagem espelhada, a câmara não). Devolve null fora da imagem.
 */
export function tapToSource(x: number, y: number, boxW: number, boxH: number, srcW: number, srcH: number, zoom = 1, mirrored = false): { x: number; y: number } | null {
  const b = coverBox(boxW, boxH, srcW, srcH, zoom);
  if (!ok(b.width) || !ok(b.height)) return null;
  let u = (x - b.left) / b.width;
  const v = (y - b.top) / b.height;
  if (mirrored) u = 1 - u;
  if (u < 0 || u > 1 || v < 0 || v > 1) return null;
  return { x: u, y: v };
}

/**
 * A foto nativa tem de sair espelhada na câmara da frente (como se viu). Se a câmara já a entregou espelhada não se
 * mexe; se não, espelha-se. Na de trás nunca.
 */
export const needsMirror = (front: boolean, alreadyMirrored: boolean) => front && !alreadyMirrored;

/** Um toque conta como "tocar para focar" se o dedo quase não mexeu e foi rápido (senão é um deslizar). */
export const isTap = (dx: number, dy: number, ms: number) => Math.hypot(dx, dy) < 12 && ms < 350;

/** A zona de cima da forma é a da legenda (tocar lá escreve); o foco só se faz abaixo dela. */
export const ZAS_CAPTION_ZONE = 0.4;
export const inCaptionZone = (y: number, boxH: number) => boxH > 0 && y < boxH * ZAS_CAPTION_ZONE;
