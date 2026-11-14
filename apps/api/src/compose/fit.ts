/**
 * O encaixe de cada clipe no quadro 9:16 (docs/montagem.md, 2, `fit`). Contas puras, sem ffmpeg nem disco (fit.spec.ts):
 * a app copia os números para a pré-visualização e a exportação do site.
 *
 * - `cover`: o clipe enche o quadro e corta-se o que sobra, ao centro (o de sempre).
 * - `blur`: o clipe inteiro ao centro (contido), por cima de uma cópia dele a encher o quadro, muito desfocada (gaussiana,
 *   sigma 40 px num quadro de 1080 de largura) e escurecida a 70 % (cada canal R, G, B × 0,7, como o `brightness(0.7)` do CSS).
 * - Sem `fit` («auto»): `cover` quando o clipe é de pé (largura/altura de mostrar, já rodado, ≤ 0,8) e `blur` nos outros.
 */

export type Fit = 'cover' | 'blur';
export const FITS: readonly Fit[] = ['cover', 'blur'];

/** Até esta proporção (largura/altura de mostrar) o clipe enche o quadro; acima, vai inteiro com o fundo desfocado. */
export const FIT_COVER_MAX_ASPECT = 0.8;
/** O desfoque do fundo: sigma da gaussiana em px de um quadro de 1080 de largura (escala com a largura). */
export const FIT_BLUR_SIGMA = 40;
/** O fundo escurecido: cada canal × 0,7. */
export const FIT_BLUR_BRIGHTNESS = 0.7;
/**
 * O fundo desfoca-se a 1/8 do tamanho (sigma 5 a 135×240 no lugar de 40 a 1080×1920) e volta a ampliar-se: a mesma imagem
 * (uma gaussiana de sigma 40 já não tem detalhe que se perca) por uma fração do custo.
 */
export const FIT_BLUR_DOWNSCALE = 8;

/** O encaixe automático de um clipe de `w`×`h` (o tamanho de mostrar, já com a rotação aplicada). Sem tamanho: `cover`. */
export function autoFit(w: number, h: number): Fit {
  if (!(w > 0) || !(h > 0)) return 'cover';
  return w / h > FIT_COVER_MAX_ASPECT + 1e-9 ? 'blur' : 'cover';
}

/** O encaixe que conta: o pedido ou, sem ele, o automático. */
export const resolveFit = (fit: Fit | undefined | null, w: number, h: number): Fit => fit ?? autoFit(w, h);

/** O retângulo (px do quadro W×H) onde fica um clipe `w`×`h` contido, ao centro, com `zoom` à volta do ponto (`ax`, `ay`) do quadro. */
export function containRect(w: number, h: number, W: number, H: number, zoom = 1, ax = W / 2, ay = H / 2): { x: number; y: number; w: number; h: number } {
  const s = Math.min(W / w, H / h);
  const cw = w * s, ch = h * s;
  const x0 = (W - cw) / 2, y0 = (H - ch) / 2;
  return { x: ax + (x0 - ax) * zoom, y: ay + (y0 - ay) * zoom, w: cw * zoom, h: ch * zoom };
}

const evenUp = (v: number) => Math.max(2, 2 * Math.round(v / 2));

/**
 * O encaixe num grafo do ffmpeg: de `inp` (frames de qualquer tamanho, SAR 1) para `out` com W×H. `tag` prefixa as etiquetas
 * internas. O fundo do `blur` escurece em YUV de gama limitada com a mesma conta do RGB × 0,7 (Y' = 16 + (Y − 16)·0,7, U e V
 * à volta de 128), que é exata para uma multiplicação dos três canais.
 */
export function fitGraph(fit: Fit, W: number, H: number, inp: string, out: string, tag: string): string[] {
  if (fit === 'cover') return [`${inp}scale=${W}:${H}:force_original_aspect_ratio=increase:flags=bicubic,crop=${W}:${H},setsar=1${out}`];
  const bw = evenUp(W / FIT_BLUR_DOWNSCALE), bh = evenUp(H / FIT_BLUR_DOWNSCALE);
  const sigma = Math.round(((FIT_BLUR_SIGMA * (W / 1080)) / FIT_BLUR_DOWNSCALE) * 100) / 100;
  const k = FIT_BLUR_BRIGHTNESS;
  return [
    `${inp}split[${tag}_a][${tag}_b]`,
    `[${tag}_b]scale=${bw}:${bh}:force_original_aspect_ratio=increase:flags=area,crop=${bw}:${bh},gblur=sigma=${sigma}:steps=3,` +
      `scale=${W}:${H}:flags=bicubic,lutyuv=y='16+(val-16)*${k}':u='128+(val-128)*${k}':v='128+(val-128)*${k}'[${tag}_bg]`,
    `[${tag}_a]scale=${W}:${H}:force_original_aspect_ratio=decrease:force_divisible_by=2:flags=bicubic,setsar=1[${tag}_fg]`,
    `[${tag}_bg][${tag}_fg]overlay=(main_w-overlay_w)/2:(main_h-overlay_h)/2,setsar=1${out}`,
  ];
}
