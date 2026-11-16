import { createCanvas, loadImage } from '@napi-rs/canvas';
import sharp from 'sharp';
import { signatureSvg, type SealTier } from '../media/signature';
import { BG, ZINC900, baseFont, drawZasMark, squirclePath } from './zas-card';

/**
 * O resumo semanal dos Zás (como o «Recap» dos Instants do Instagram): um quadro 9:16 escuro com a luz coral do Zás em
 * baixo, a marca do Zás em cima, o título «Resumo dos Zás» e as datas da semana («8 a 15 nov»), as fotos da semana (até
 * RECAP_MAX) em cartões squircle 3:4 numa grelha que cresce para caberem o maior possível, cada um ligeiramente inclinado
 * (para um lado e para o outro, como fotos espalhadas na mesa), e em baixo, à esquerda, quantos Zás houve; à direita a
 * assinatura do Txillapp (logótipo, @ e selo: media/signature.ts), a mesma das outras cópias guardadas.
 */
export const RECAP_OUT = { W: 1080, H: 1920 } as const;
/** No máximo quantas fotos entram no resumo. */
export const RECAP_MAX = 15;
/** Quantos Zás na semana, no mínimo, para haver resumo. */
export const RECAP_MIN = 3;

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

/** «8 a 15 nov», «29 nov a 6 dez» (datas «AAAA-MM-DD», o primeiro e o último dia da semana). */
export function recapRange(from: string, to: string): string {
  const [, m1, d1] = from.split('-').map(Number);
  const [, m2, d2] = to.split('-').map(Number);
  return m1 === m2 ? `${d1} a ${d2} ${MESES[m2 - 1]}` : `${d1} ${MESES[m1 - 1]} a ${d2} ${MESES[m2 - 1]}`;
}

/** Até `max` fotos espalhadas pela semana (a primeira e a última entram sempre), pela ordem em que foram tiradas. */
export function pickRecapPhotos<T>(all: readonly T[], max = RECAP_MAX): T[] {
  if (all.length <= max) return [...all];
  const out: T[] = [];
  for (let i = 0; i < max; i++) out.push(all[Math.round((i * (all.length - 1)) / (max - 1))]);
  return out;
}

/** A zona do quadro onde vai a grelha (entre as datas e a assinatura). */
export const RECAP_GRID = { top: 440, bottom: 1700, side: 64, gap: 26 } as const;

export interface RecapCell { x: number; y: number; w: number; h: number; deg: number }

/**
 * Onde fica cada cartão: escolhe o número de colunas (2 a 5) que dá os cartões maiores dentro da zona da grelha, centra
 * a última fila quando não está cheia e o conjunto na vertical. A inclinação alterna (−2°, +1,5°, …) e nunca passa de 2,5°.
 */
export function recapLayout(n: number, W: number = RECAP_OUT.W): RecapCell[] {
  const { top, bottom, side, gap } = RECAP_GRID;
  const areaW = W - side * 2, areaH = bottom - top;
  let best = { cols: 2, w: 0 };
  for (let cols = n <= 4 ? 2 : 3; cols <= 5; cols++) {
    const rows = Math.ceil(n / cols);
    const w = Math.floor(Math.min((areaW - (cols - 1) * gap) / cols, ((areaH - (rows - 1) * gap) / rows) * 0.75));
    if (w > best.w) best = { cols, w };
  }
  // Poucas fotos: não crescem até ocupar o quadro todo (três cartões gigantes ficam mal); no máximo 2/5 da largura.
  const w = Math.min(best.w, Math.floor(W * 0.4));
  const h = Math.round((w / 3) * 4);
  const cols = best.cols, rows = Math.ceil(n / cols);
  const totalH = rows * h + (rows - 1) * gap;
  const y0 = top + Math.round((areaH - totalH) / 2);
  const TILT = [-2, 1.5, -1, 2, -1.5, 1];
  const cells: RecapCell[] = [];
  for (let i = 0; i < n; i++) {
    const r = Math.floor(i / cols), c = i % cols;
    const inRow = r === rows - 1 ? n - r * cols : cols;
    const rowW = inRow * w + (inRow - 1) * gap;
    const x0 = Math.round((W - rowW) / 2);
    cells.push({ x: x0 + c * (w + gap), y: y0 + r * (h + gap), w, h, deg: TILT[(i + r) % TILT.length] });
  }
  return cells;
}

/** Onde ficam o título e as datas (para os testes). */
export const RECAP_HEAD = { markY: 150, markSize: 54, titleY: 290, titleSize: 92, datesY: 372, datesSize: 44 } as const;

export interface RecapInput {
  /** As fotos (qualquer formato que o sharp leia; a rotação EXIF respeita-se), pela ordem em que foram tiradas. */
  photos: Buffer[];
  /** O primeiro e o último dia da semana, «AAAA-MM-DD». */
  from: string;
  to: string;
  /** Quantos Zás houve na semana (pode ser mais do que as fotos que entram). */
  count: number;
  username: string;
  seal: SealTier | null;
}

/** O resumo desenhado, em JPEG 1080×1920. */
export async function renderZasRecap(o: RecapInput): Promise<Buffer> {
  const { W, H } = RECAP_OUT;
  const c = createCanvas(W, H);
  const g = c.getContext('2d');
  const font = baseFont();

  // O fundo do ecrã do Zás: quase preto, com a luz coral a subir de baixo.
  g.fillStyle = BG;
  g.fillRect(0, 0, W, H);
  const glow = g.createLinearGradient(0, H * 0.35, 0, H);
  glow.addColorStop(0, 'rgba(255,92,92,0)');
  glow.addColorStop(1, 'rgba(255,92,92,0.30)');
  g.fillStyle = glow;
  g.fillRect(0, 0, W, H);

  // Em cima: a marca, o título e as datas, ao meio.
  drawZasMark(g, W / 2, RECAP_HEAD.markY, RECAP_HEAD.markSize);
  g.textAlign = 'center';
  g.textBaseline = 'alphabetic';
  g.fillStyle = '#ffffff';
  g.font = `bold ${RECAP_HEAD.titleSize}px ${font}`;
  g.fillText('Resumo dos Zás', W / 2, RECAP_HEAD.titleY, W - 96);
  g.font = `bold ${RECAP_HEAD.datesSize}px ${font}`;
  g.fillStyle = '#ff8f8f';
  g.fillText(recapRange(o.from, o.to), W / 2, RECAP_HEAD.datesY);

  // A grelha: cada foto num cartão squircle 3:4, com a sombra da app e ligeiramente inclinado.
  const photos = pickRecapPhotos(o.photos);
  const cells = recapLayout(photos.length, W);
  for (let i = 0; i < photos.length; i++) {
    const cell = cells[i];
    let img;
    try {
      img = await loadImage(await sharp(photos[i]).rotate().resize(cell.w * 2, cell.h * 2, { fit: 'cover' }).png().toBuffer());
    } catch {
      img = null; // uma foto que não se lê fica como o cartão vazio (cinzento escuro)
    }
    g.save();
    g.translate(cell.x + cell.w / 2, cell.y + cell.h / 2);
    g.rotate((cell.deg * Math.PI) / 180);
    const shape = squirclePath(-cell.w / 2, -cell.h / 2, cell.w, cell.h, 120);
    g.save();
    g.shadowColor = 'rgba(0,0,0,0.6)';
    g.shadowBlur = Math.round(cell.w * 0.09);
    g.shadowOffsetY = Math.round(cell.w * 0.045);
    g.fillStyle = ZINC900;
    g.fill(shape);
    g.restore();
    g.clip(shape);
    if (img) g.drawImage(img, -cell.w / 2, -cell.h / 2, cell.w, cell.h);
    // O fio claro à volta do cartão (como a borda dos cartões no ecrã).
    g.lineWidth = Math.max(2, cell.w * 0.012);
    g.strokeStyle = 'rgba(255,255,255,0.18)';
    g.stroke(shape);
    g.restore();
  }

  // Em baixo, à esquerda (à altura do @ da assinatura): quantos Zás houve na semana.
  const m = Math.round(Math.min(W, H) * 0.04);
  g.textAlign = 'left';
  g.fillStyle = 'rgba(255,255,255,0.7)';
  g.font = `bold ${Math.round(Math.min(W, H) * 0.03)}px ${font}`;
  g.fillText(`${o.count} Zás esta semana`, m, H - m);

  return sharp(c.toBuffer('image/png'))
    .composite([{ input: Buffer.from(signatureSvg(W, H, o.username, '', true, o.seal)), top: 0, left: 0 }])
    .jpeg({ quality: 90 })
    .toBuffer();
}
