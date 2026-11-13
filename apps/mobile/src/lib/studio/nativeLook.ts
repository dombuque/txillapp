/**
 * Os filtros na pré-visualização nativa, para os vídeos (sem React; testado em tests/studioNativeLook.test.mjs).
 *
 * Nas fotos a pré-visualização usa a matriz de cor verdadeira (Skia, `ColorMatrix`). Nos vídeos o expo-video não deixa
 * pôr uma matriz por cima da imagem, por isso o filtro aproxima-se com camadas por cima do vídeo, calculadas da mesma matriz:
 * - a **saturação** (uma camada cinzenta em modo «saturation»: tira a cor na medida em que o filtro a tira; a mais, não dá);
 * - a **tinta** (o cinzento médio passado pela matriz: a cor que o filtro puxa, em modo «soft-light»);
 * - o **brilho** (branco ou preto com pouca opacidade, pela diferença da luminância do cinzento médio);
 * - a **vinheta** (um gradiente radial, que essa é igual).
 * O vídeo montado no servidor leva o filtro completo (docs/montagem.md, 4-B): a pré-visualização diz isso por baixo.
 *
 * Só importa tipos (o node corre este ficheiro direto).
 */
import type { ColorMatrix } from './effects';

export interface VideoLook {
  /** 0 a 1: quanto se tira de cor (1 = preto e branco). */
  desaturate: number;
  /** A cor da tinta e a força dela (0 a 1). */
  tint: { color: string; alpha: number } | null;
  /** Clarear (branco) ou escurecer (preto) e a força. */
  light: { color: '#ffffff' | '#000000'; alpha: number } | null;
  /** 0 a 1, como o `vignette` do contrato. */
  vignette: number;
  /** Não há nada para pôr por cima. */
  none: boolean;
}

const clamp = (x: number, a = 0, b = 1) => Math.min(b, Math.max(a, x));
function apply(m: ColorMatrix, r: number, g: number, b: number): [number, number, number] {
  return [
    clamp(m[0] * r + m[1] * g + m[2] * b + m[4]),
    clamp(m[5] * r + m[6] * g + m[7] * b + m[9]),
    clamp(m[10] * r + m[11] * g + m[12] * b + m[14]),
  ];
}
const chroma = (c: [number, number, number]) => Math.max(...c) - Math.min(...c);
const luma = (c: [number, number, number]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
const hex = (c: [number, number, number]) => `#${c.map((v) => Math.round(clamp(v) * 255).toString(16).padStart(2, '0')).join('')}`;

/** As cores de teste: seis tons a meia força (a saturação mede-se nelas). */
const PROBES: [number, number, number][] = [[0.8, 0.3, 0.3], [0.3, 0.8, 0.3], [0.3, 0.3, 0.8], [0.8, 0.8, 0.3], [0.3, 0.8, 0.8], [0.8, 0.3, 0.8]];

/** A aproximação de um filtro (a matriz e a vinheta de `resolveFx`). */
export function videoLook(matrix: ColorMatrix, vignette = 0): VideoLook {
  let ratio = 0;
  for (const p of PROBES) ratio += chroma(apply(matrix, ...p)) / chroma(p);
  ratio /= PROBES.length;
  const desaturate = Math.round(clamp(1 - ratio) * 100) / 100;
  const gray = apply(matrix, 0.5, 0.5, 0.5);
  const cast = chroma(gray);
  const tint = cast > 0.015 ? { color: hex(gray), alpha: Math.round(clamp(cast * 3.2, 0, 0.55) * 100) / 100 } : null;
  const dl = luma(gray) - 0.5;
  const light = Math.abs(dl) > 0.01 ? { color: (dl > 0 ? '#ffffff' : '#000000') as '#ffffff' | '#000000', alpha: Math.round(clamp(Math.abs(dl) * 1.6, 0, 0.35) * 100) / 100 } : null;
  const v = Math.round(clamp(vignette) * 100) / 100;
  return { desaturate, tint, light, vignette: v, none: desaturate < 0.02 && !tint && !light && v < 0.01 };
}
