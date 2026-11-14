/**
 * Como cada clipe enche o quadro 9:16 da tcheka (sem React nem browser; testado em tests/studioFit.test.mjs). O contrato é
 * o mesmo do servidor (`clips[i].fit` em `POST /tchekas/compose`, docs/montagem.md, 4-C):
 *
 * - `'cover'` («Encher»): o clipe cobre o quadro e corta-se ao centro (como sempre foi).
 * - `'blur'` («Inteiro»): o clipe inteiro, contido e ao centro; por trás, o mesmo clipe a cobrir o quadro, desfocado
 *   (gaussiano, sigma 40 num quadro de 1080 de largura: `blurSigma`) e escurecido para 70 % do brilho (`BLUR_BRIGHTNESS`).
 * - Sem o campo (automático): `'cover'` quando o clipe é ao alto (largura/altura de exibição, já com a rotação, até 0,8:
 *   `FIT_AUTO_MAX_ASPECT`) e `'blur'` quando é mais largo (quadrado, 4:3, 16:9…).
 * - As fotos com o enquadramento da Montagem mágica (`fx.focus`) ficam como estão (a encher, apontadas ao ponto de
 *   interesse), a não ser que a pessoa escolha «Inteiro». A moldura de capulana já mostra a foto inteira: não muda.
 * - O zoom lento (Ken Burns) de uma foto «Inteiro» mexe só na imagem da frente; o fundo desfocado fica parado.
 * - Os efeitos de cor (filtro, ajustes, vinheta, grão) vêm depois, no quadro inteiro (fundo e frente juntos), como num
 *   clipe a encher.
 *
 * Só importa tipos (o node corre este ficheiro direto). As contas que a pré-visualização nativa usa no fio da interface
 * são «worklets».
 */

export type ClipFit = 'cover' | 'blur';

/** Até esta largura/altura (já com a rotação) o automático enche; acima, mostra o clipe inteiro. 4:5 = 0,8. */
export const FIT_AUTO_MAX_ASPECT = 0.8;
/** O desfoque do fundo num quadro de 1080 px de largura (escala-se para o tamanho da pré-visualização). */
export const BLUR_SIGMA_1080 = 40;
/** O brilho do fundo desfocado (0,7 = 70 %). */
export const BLUR_BRIGHTNESS = 0.7;

export const isFit = (x: unknown): x is ClipFit => x === 'cover' || x === 'blur';

/** As medidas de exibição: um vídeo com rotação de 90° ou 270° (os do telemóvel ao alto) troca a largura com a altura. */
export function displaySize(w: number, h: number, rotation = 0): { w: number; h: number } {
  const r = ((Math.round((Number.isFinite(rotation) ? rotation : 0) / 90) * 90) % 360 + 360) % 360;
  return r === 90 || r === 270 ? { w: h, h: w } : { w, h };
}

/**
 * O automático: `'cover'` com o clipe ao alto (largura/altura de exibição até 0,8) e `'blur'` com os mais largos. Sem as
 * medidas (ainda a carregar, ou um ficheiro estranho), enche, como antes.
 */
export function autoFit(w: number, h: number, rotation = 0): ClipFit {
  if (!(w > 0) || !(h > 0) || !Number.isFinite(w) || !Number.isFinite(h)) return 'cover';
  const d = displaySize(w, h, rotation);
  return d.w / d.h <= FIT_AUTO_MAX_ASPECT + 1e-9 ? 'cover' : 'blur';
}

/** O que um clipe tem de saber para escolher como enche. */
export interface FitClip {
  /** A escolha da pessoa no painel do clipe (sem ela, automático). */
  fit?: ClipFit;
  video: boolean;
  fx?: { focus?: unknown; moldura?: unknown; freeze?: unknown } | null;
}

/**
 * Como este clipe enche, com as medidas de exibição do ficheiro (`w`×`h`, já rodadas, ou com `rotation`). A escolha da
 * pessoa ganha; sem ela, uma foto com o enquadramento da Montagem mágica enche e o resto segue `autoFit`. A moldura de
 * capulana tem o desenho dela (devolve `'cover'`: quem desenha a moldura não olha para isto).
 */
export function clipFit(c: FitClip, w: number, h: number, rotation = 0): ClipFit {
  if (!c.video && c.fx?.moldura) return 'cover';
  if (isFit(c.fit)) return c.fit;
  if (!c.video && c.fx?.focus && !c.fx?.freeze) return 'cover';
  return autoFit(w, h, rotation);
}

/** O que o painel do clipe mostra: a escolha da pessoa ou o automático (com o que dá agora). */
export function fitLabel(fit: ClipFit): string {
  return fit === 'blur' ? 'Inteiro' : 'Encher';
}

/** Muda a escolha da pessoa: tocar no que o automático já faz deixa-a escrita (fica assim mesmo que o ficheiro mude). */
export function withFit<T extends { fit?: ClipFit }>(c: T, fit: ClipFit | null): T {
  if (fit === null) { if (!('fit' in c)) return c; const { fit: _f, ...rest } = c; return rest as T; }
  return c.fit === fit ? c : { ...c, fit };
}

export interface FitRect { x: number; y: number; w: number; h: number }

/** O clipe inteiro (`sw`×`sh`) contido em `w`×`h`, ao centro. */
export function containRect(sw: number, sh: number, w: number, h: number): FitRect {
  'worklet';
  if (!(sw > 0) || !(sh > 0)) return { x: 0, y: 0, w, h };
  const k = Math.min(w / sw, h / sh);
  const cw = sw * k, ch = sh * k;
  return { x: (w - cw) / 2, y: (h - ch) / 2, w: cw, h: ch };
}

/** O recorte da fonte (`sw`×`sh`) que cobre `w`×`h`, ao centro (o fundo do «Inteiro», e o «Encher»). */
export function coverSource(sw: number, sh: number, w: number, h: number): FitRect {
  'worklet';
  if (!(sw > 0) || !(sh > 0) || !(w > 0) || !(h > 0)) return { x: 0, y: 0, w: sw, h: sh };
  const k = Math.max(w / sw, h / sh);
  const cw = Math.min(sw, w / k), ch = Math.min(sh, h / k);
  return { x: (sw - cw) / 2, y: (sh - ch) / 2, w: cw, h: ch };
}

/** O sigma do desfoque num quadro de `frameW` de largura (40 em 1080). */
export function blurSigma(frameW: number): number {
  'worklet';
  return (BLUR_SIGMA_1080 * Math.max(0, frameW)) / 1080;
}

/**
 * A matriz 4×5 (linhas R, G, B, A) que escurece para `BLUR_BRIGHTNESS`: a mesma conta do `brightness(0.7)` do canvas e do
 * `colorchannelmixer=.7:0:0:0:0:.7:0:0:0:0:.7` do ffmpeg.
 */
export const BLUR_DIM_MATRIX: readonly number[] = [
  BLUR_BRIGHTNESS, 0, 0, 0, 0,
  0, BLUR_BRIGHTNESS, 0, 0, 0,
  0, 0, BLUR_BRIGHTNESS, 0, 0,
  0, 0, 0, 1, 0,
];

/**
 * O zoom lento de uma foto «Inteiro»: a caixa da frente (o retângulo contido) fica do mesmo tamanho e a foto cresce lá
 * dentro, de 1 a `scale`, ao centro (o Ken Burns de sempre, só na frente; o fundo desfocado não mexe). Devolve o recorte
 * da foto (`sw`×`sh`) que enche a caixa nesse instante.
 */
export function zoomSource(sw: number, sh: number, scale: number): FitRect {
  'worklet';
  const s = Number.isFinite(scale) && scale > 1 ? scale : 1;
  const w = sw / s, h = sh / s;
  return { x: (sw - w) / 2, y: (sh - h) / 2, w, h };
}
