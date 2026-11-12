/**
 * Que largura de foto pedir ao servidor (o `?w=` do `sized()`), a partir da largura no ecrã e da densidade dele.
 * Sem React Native, para se testar em Node (tests/photoQuality.test.mjs).
 *
 * O servidor só tem estas larguras (apps/api/src/media/media.service.ts, WIDTHS) e sobe o pedido para a mais próxima.
 * Antes o feed pedia sempre 720: num iPhone (DPR 3) o cartão tem ~1170–1290 píxeis reais, e a foto era esticada ~1,7×.
 */
export const SERVED_WIDTHS = [160, 256, 480, 720, 1080, 1600] as const;

/** A densidade conta até 3 (os ecrãs de DPR 3,5 ou 4 não se notam ao olho e só gastavam dados). */
const MAX_DPR = 3;
/** Aceita-se esticar até ~10 % (invisível): 1080 chega a um cartão de 1194 px; acima disso vai a 1600. */
const STRETCH = 0.9;

/** A largura servida para uma foto com `cssWidth` pontos num ecrã de densidade `dpr`. */
export function servedWidth(cssWidth: number, dpr = 1): number {
  const d = Number.isFinite(dpr) && dpr > 0 ? Math.min(dpr, MAX_DPR) : 1;
  const px = (Number.isFinite(cssWidth) && cssWidth > 0 ? cssWidth : 360) * d * STRETCH;
  return SERVED_WIDTHS.find((w) => w >= px) ?? SERVED_WIDTHS[SERVED_WIDTHS.length - 1];
}

/**
 * A largura do JPEG que o editor do telemóvel (PhotoEditor, Skia) grava para um recorte de `cropW` píxeis na proporção
 * `aspect` (largura/altura). Ao alto (4:5, 9:16) ia até 1080: com o editor a trabalhar a 2560 no lado maior, o recorte
 * 4:5 de uma foto 9:16 tem 1440 de largura e deitavam-se fora 25 % dos píxeis. Agora vai até 1440 (1440×1800 numa
 * publicação, 1440×2560 num mimo); deitada fica em 1920. Nunca se aumenta.
 */
export function editorOutWidth(cropW: number, aspect: number): number {
  return Math.max(1, Math.round(Math.min(cropW, aspect >= 1 ? 1920 : 1440)));
}
