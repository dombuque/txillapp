/**
 * Os filtros («looks») do estúdio de tchekas, com os mesmos ids e os mesmos números de `LOOKS` em
 * apps/mobile/src/components/TxCamera.tsx. O estúdio do site desenha-os com o `filter` do canvas
 * (`brightness() contrast() saturate() sepia() grayscale()`, sem a tinta); aqui fazem-se com uma só matriz de cor do ffmpeg
 * (`colorchannelmixer`), a mesma conta de `applyLook` (brilho e contraste, depois saturação, sépia e cinzento).
 */
export interface Look { id: string; name: string; b: number; c: number; s: number; sep: number; g: number }

export const LOOKS: Look[] = [
  { id: 'normal', name: 'Normal', b: 1, c: 1, s: 1, sep: 0, g: 0 },
  { id: 'vivo', name: 'Vivo', b: 1.04, c: 1.1, s: 1.35, sep: 0, g: 0 },
  { id: 'quente', name: 'Quente', b: 1.03, c: 1.05, s: 1.1, sep: 0.25, g: 0 },
  { id: 'fresco', name: 'Fresco', b: 1.02, c: 1.05, s: 0.95, sep: 0, g: 0 },
  { id: 'suave', name: 'Suave', b: 1.08, c: 0.9, s: 0.9, sep: 0.1, g: 0 },
  { id: 'dourado', name: 'Dourado', b: 1.04, c: 1.08, s: 1.15, sep: 0.35, g: 0 },
  { id: 'fade', name: 'Fade', b: 1.1, c: 0.85, s: 0.8, sep: 0.15, g: 0 },
  { id: 'txilla', name: 'Txilla', b: 1.04, c: 1.04, s: 1.08, sep: 0, g: 0 },
  { id: 'vintage', name: 'Vintage', b: 0.98, c: 0.95, s: 0.85, sep: 0.5, g: 0 },
  { id: 'pb', name: 'P&B', b: 1.02, c: 1.15, s: 1, sep: 0, g: 1 },
];
export const LOOK_IDS = LOOKS.map((l) => l.id) as [string, ...string[]];

/** A matriz 3×3 do look (saturação, depois sépia, depois cinzento), como em `applyLook`. */
export function lookMatrix(l: Look): number[] {
  const sv = l.s, sp = 1 - l.sep, gr = 1 - l.g;
  const S = [0.213 + 0.787 * sv, 0.715 - 0.715 * sv, 0.072 - 0.072 * sv, 0.213 - 0.213 * sv, 0.715 + 0.285 * sv, 0.072 - 0.072 * sv, 0.213 - 0.213 * sv, 0.715 - 0.715 * sv, 0.072 + 0.928 * sv];
  const P = [0.393 + 0.607 * sp, 0.769 - 0.769 * sp, 0.189 - 0.189 * sp, 0.349 - 0.349 * sp, 0.686 + 0.314 * sp, 0.168 - 0.168 * sp, 0.272 - 0.272 * sp, 0.534 - 0.534 * sp, 0.131 + 0.869 * sp];
  const G = [0.2126 + 0.7874 * gr, 0.7152 - 0.7152 * gr, 0.0722 - 0.0722 * gr, 0.2126 - 0.2126 * gr, 0.7152 + 0.2848 * gr, 0.0722 - 0.0722 * gr, 0.2126 - 0.2126 * gr, 0.7152 - 0.7152 * gr, 0.0722 + 0.9278 * gr];
  const mul = (A: number[], B: number[]) => [0, 1, 2].flatMap((i) => [0, 1, 2].map((j) => A[i * 3] * B[j] + A[i * 3 + 1] * B[3 + j] + A[i * 3 + 2] * B[6 + j]));
  return mul(G, mul(P, S));
}

/**
 * O look como filtro do ffmpeg (vazio no «Normal»). Cada canal sai `M · (b·c·entrada + 128·(1−c))`: o termo constante vai
 * no coeficiente do canal alfa (num quadro RGBA opaco o alfa vale sempre 1), por isso a imagem passa por RGBA e volta.
 */
export function lookFilter(id: string | null | undefined): string {
  const l = LOOKS.find((x) => x.id === id);
  if (!l || l.id === 'normal') return '';
  const M = lookMatrix(l);
  const bc = l.b * l.c, off = 128 * (1 - l.c);
  const f = (n: number) => (Math.round(n * 10000) / 10000).toString();
  const rows = ['r', 'g', 'b'].map((ch, i) => {
    const m = M.slice(i * 3, i * 3 + 3);
    const k = (m[0] + m[1] + m[2]) * off / 255;
    return `${ch}r=${f(m[0] * bc)}:${ch}g=${f(m[1] * bc)}:${ch}b=${f(m[2] * bc)}:${ch}a=${f(k)}`;
  });
  return `format=rgba,colorchannelmixer=${rows.join(':')}:aa=1,format=yuv420p`;
}
