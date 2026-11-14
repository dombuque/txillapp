import { contrastOn } from '../compose/effects';

/**
 * A conta de um texto por cima do mimo (docs/fontes-contrato.md), sem desenhar nada: serve à cópia gravada no servidor e
 * é a mesma que a app segue. O texto mede-se a uma letra de referência (`BASE` px); a caixa (com o fundo) fica com
 * `s × W` de largura e tudo escala por igual. As linhas são as do próprio texto (`\n`), sem voltar a partir.
 */
export const TEXT_BASE_PX = 100;
/** Em frações da letra: altura da linha, margens da caixa e raio dos cantos. */
export const TEXT_METRICS = {
  lineHeight: 1.22,
  padX: { none: 0.12, boxed: 0.4 },
  padY: { none: 0.06, boxed: 0.22 },
  radius: 0.3,
  /** A caixa nunca fica mais estreita do que isto (um texto de uma letra). */
  minTextWidth: 0.6,
} as const;

export interface TextLayerInput {
  text: string;
  color: string;
  bg: 'none' | 'solid' | 'soft';
  align: 'left' | 'center' | 'right';
  x: number;
  y: number;
  s: number;
  r: number;
}

export interface TextLayerLayout {
  /** Centro da caixa e rotação (graus, à volta do centro), em px da imagem. */
  cx: number;
  cy: number;
  rot: number;
  /** A caixa (com o fundo) em px da imagem. */
  w: number;
  h: number;
  /** Tamanho da letra em px da imagem. */
  fontPx: number;
  radius: number;
  /** Cada linha: `x` é a esquerda do texto e `y` o meio da linha, ambos a contar do canto de cima à esquerda da caixa. */
  lines: { text: string; x: number; y: number; w: number }[];
  /** A cor das letras, a do fundo (null sem fundo) e se leva sombra (só sem fundo, para se ler em qualquer foto). */
  fill: string;
  box: string | null;
  shadow: boolean;
}

/** `measure(linha, px)`: a largura da linha com a fonte do texto a `px` de letra. */
export function layoutTextLayer(t: TextLayerInput, W: number, H: number, measure: (line: string, px: number) => number): TextLayerLayout {
  const B = TEXT_BASE_PX, M = TEXT_METRICS;
  const boxed = t.bg !== 'none';
  const raw = t.text.split('\n');
  const widths = raw.map((l) => (l ? measure(l, B) : 0));
  const padX = (boxed ? M.padX.boxed : M.padX.none) * B;
  const padY = (boxed ? M.padY.boxed : M.padY.none) * B;
  const lh = M.lineHeight * B;
  const natW = Math.max(M.minTextWidth * B, ...widths) + padX * 2;
  const natH = raw.length * lh + padY * 2;
  const k = (t.s * W) / natW;
  const lines = raw.map((text, i) => {
    const w = widths[i];
    const x = t.align === 'left' ? padX : t.align === 'right' ? natW - padX - w : (natW - w) / 2;
    return { text, x: x * k, y: (padY + lh * (i + 0.5)) * k, w: w * k };
  });
  return {
    cx: t.x * W,
    cy: t.y * H,
    rot: t.r,
    w: natW * k,
    h: natH * k,
    fontPx: B * k,
    radius: boxed ? M.radius * B * k : 0,
    lines,
    fill: t.bg === 'solid' ? contrastOn(t.color) : t.color,
    box: t.bg === 'solid' ? t.color : t.bg === 'soft' ? 'rgba(0,0,0,0.5)' : null,
    shadow: !boxed,
  };
}
