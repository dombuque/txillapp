/** Filtros de foto. Cada um é só um conjunto de afinações; o mesmo valor serve para a pré-visualização (CSS) e para a foto final. */
export interface Filter {
  id: string;
  name: string;
  brightness: number;
  contrast: number;
  saturate: number;
  sepia: number;
  grayscale: number;
  /** Cor misturada por cima (r, g, b, força 0..1) para dar um tom. */
  tint?: [number, number, number, number];
}

const f = (id: string, name: string, o: Partial<Filter> = {}): Filter => ({ id, name, brightness: 1, contrast: 1, saturate: 1, sepia: 0, grayscale: 0, ...o });

export const FILTERS: Filter[] = [
  f('normal', 'Normal'),
  f('sol', 'Sol de Maputo', { brightness: 1.08, contrast: 1.06, saturate: 1.3, tint: [255, 170, 60, 0.1] }),
  f('praia', 'Praia', { brightness: 1.1, contrast: 0.96, saturate: 1.2, tint: [60, 200, 230, 0.1] }),
  f('laurentina', 'Laurentina', { brightness: 1.04, contrast: 1.12, saturate: 1.15, sepia: 0.18 }),
  f('marrabenta', 'Marrabenta', { contrast: 1.2, saturate: 1.5, tint: [230, 60, 120, 0.1] }),
  f('noite', 'Noite', { brightness: 0.9, contrast: 1.25, saturate: 0.9, tint: [40, 60, 160, 0.16] }),
  f('vintage', 'Vintage', { brightness: 1.02, contrast: 0.92, saturate: 0.85, sepia: 0.45 }),
  f('suave', 'Suave', { brightness: 1.1, contrast: 0.88, saturate: 0.92 }),
  f('drama', 'Drama', { brightness: 0.96, contrast: 1.4, saturate: 1.05 }),
  f('cinza', 'Cinza', { contrast: 1.08, grayscale: 1 }),
  f('antigo', 'Antigo', { brightness: 1.05, contrast: 1.1, sepia: 0.85, saturate: 0.9 }),
];

/** String `filter` para CSS/canvas (a tonalidade não tem equivalente e só entra na foto final e na pré-visualização por cima). */
export const cssFilter = (x: Filter) =>
  x.id === 'normal' ? 'none' : `brightness(${x.brightness}) contrast(${x.contrast}) saturate(${x.saturate}) sepia(${x.sepia}) grayscale(${x.grayscale})`;

let ctxFilterOk: boolean | null = null;
/** O canvas deste browser aplica `ctx.filter`? (o Safari antigo ignora-o em silêncio) */
function canvasFilterWorks() {
  if (ctxFilterOk !== null) return ctxFilterOk;
  try {
    const c = document.createElement('canvas');
    c.width = c.height = 1;
    const g = c.getContext('2d')!;
    g.filter = 'grayscale(1)';
    g.fillStyle = 'rgb(255,0,0)';
    g.fillRect(0, 0, 1, 1);
    const d = g.getImageData(0, 0, 1, 1).data;
    ctxFilterOk = d[0] === d[1] && d[1] === d[2];
  } catch {
    ctxFilterOk = false;
  }
  return ctxFilterOk;
}

const clamp = (n: number) => (n < 0 ? 0 : n > 255 ? 255 : n);

/** Mesma afinação, pixel a pixel, para os browsers que não sabem filtrar no canvas. */
function applyPixels(g: CanvasRenderingContext2D, w: number, h: number, x: Filter) {
  const img = g.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    let r = d[i], gr = d[i + 1], b = d[i + 2];
    // sepia
    if (x.sepia) {
      const sr = 0.393 * r + 0.769 * gr + 0.189 * b, sg = 0.349 * r + 0.686 * gr + 0.168 * b, sb = 0.272 * r + 0.534 * gr + 0.131 * b;
      r += (sr - r) * x.sepia; gr += (sg - gr) * x.sepia; b += (sb - b) * x.sepia;
    }
    // cinzentos
    if (x.grayscale) {
      const l = 0.2126 * r + 0.7152 * gr + 0.0722 * b;
      r += (l - r) * x.grayscale; gr += (l - gr) * x.grayscale; b += (l - b) * x.grayscale;
    }
    // saturação
    if (x.saturate !== 1) {
      const l = 0.2126 * r + 0.7152 * gr + 0.0722 * b;
      r = l + (r - l) * x.saturate; gr = l + (gr - l) * x.saturate; b = l + (b - l) * x.saturate;
    }
    // contraste e brilho
    r = (r - 128) * x.contrast + 128; gr = (gr - 128) * x.contrast + 128; b = (b - 128) * x.contrast + 128;
    r *= x.brightness; gr *= x.brightness; b *= x.brightness;
    d[i] = clamp(r); d[i + 1] = clamp(gr); d[i + 2] = clamp(b);
  }
  g.putImageData(img, 0, 0);
}

/** Devolve uma cópia da foto com o filtro aplicado (JPEG). `normal` devolve o ficheiro tal como está. */
export async function bakeFilter(file: File, filter: Filter): Promise<File> {
  if (filter.id === 'normal') return file;
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const c = document.createElement('canvas');
  c.width = bmp.width;
  c.height = bmp.height;
  const g = c.getContext('2d')!;
  if (canvasFilterWorks()) {
    g.filter = cssFilter(filter);
    g.drawImage(bmp, 0, 0);
    g.filter = 'none';
  } else {
    g.drawImage(bmp, 0, 0);
    applyPixels(g, c.width, c.height, filter);
  }
  if (filter.tint) {
    const [r, gr, b, a] = filter.tint;
    g.globalCompositeOperation = 'soft-light';
    g.fillStyle = `rgba(${r},${gr},${b},${Math.min(1, a * 3)})`;
    g.fillRect(0, 0, c.width, c.height);
    g.globalCompositeOperation = 'source-over';
  }
  bmp.close();
  const blob = await new Promise<Blob | null>((res) => c.toBlob(res, 'image/jpeg', 0.9));
  if (!blob) return file;
  return new File([blob], file.name.replace(/\.\w+$/, '') + '-filtro.jpg', { type: 'image/jpeg' });
}
