/**
 * As contas da análise dos vídeos da «Montagem mágica» no telemóvel (sem React, sem Skia e sem rede; testadas em
 * tests/studioMagicFrames.test.mjs). A parte com o aparelho está em lib/studio/magicAnalyzeNative.ts e
 * components/studio/native/useMagicFrames.tsx:
 * 1. o expo-video tira as miniaturas (`generateThumbnailsAsync`, o frame exato pedido) em lotes, do geral para o pormenor,
 *    enquanto houver tempo (`batchSize`, `videoBudget`);
 * 2. as miniaturas são desenhadas numa grelha escondida e a Skia fotografa-a de uma vez (`gridCells`);
 * 3. cada célula passa a 32×56 duas vezes: cortada ao 9:16 como vai aparecer (`coverCrop`: luz, nitidez, movimento) e
 *    inteira (o ponto de interesse), e os píxeis vão às mesmas contas do site (magic.ts).
 * E o som: a resposta de POST /tchekas/compose/analyze (`parseSoundReply`).
 *
 * Só importa tipos (o node corre este ficheiro direto).
 */
import type { SoundEnergy } from './magic';

/** Colunas da grelha escondida. */
export const GRID_COLS = 8;
/** O lado maior das miniaturas pedidas ao expo-video (px). */
export const THUMB_MAX = 160;
/** Quantos frames vão no primeiro lote de um vídeo (sempre, mesmo sem tempo) e no máximo em cada lote seguinte. */
export const FIRST_BATCH = 8;
export const MAX_BATCH = 12;
/** O tempo de cada vídeo (ms): a parte dele do que sobra, entre estes limites. */
export const VIDEO_BUDGET = { min: 700, max: 3000 } as const;
/** O que se guarda do tempo de cada vídeo para desenhar a grelha e ler os píxeis (ms). */
export const GRID_RESERVE_MS = 250;
/** Quanto tempo, no máximo, a fase do som espera pelos envios e pelo servidor (ms). */
export const SOUND_WAIT_MS = 6000;

export interface Cell { x: number; y: number; w: number; h: number }

/** As células (px da imagem tirada, W×H) de `n` miniaturas numa grelha de `cols` colunas, todas do mesmo tamanho. */
export function gridCells(n: number, cols: number, W: number, H: number): Cell[] {
  const c = Math.max(1, Math.min(cols, n));
  const rows = Math.max(1, Math.ceil(n / c));
  const cw = W / c, ch = H / rows;
  return Array.from({ length: Math.max(0, n) }, (_, i) => ({ x: (i % c) * cw, y: Math.floor(i / c) * ch, w: cw, h: ch }));
}

/** O tamanho da grelha para `n` miniaturas: colunas e linhas. */
export const gridShape = (n: number, cols = GRID_COLS) => { const c = Math.max(1, Math.min(cols, n)); return { cols: c, rows: Math.max(1, Math.ceil(n / c)) }; };

/** A parte de uma célula que fica à vista num quadro com a proporção `fa` (largura/altura; 9:16): o corte ao centro. */
export function coverCrop(c: Cell, fa = 32 / 56): Cell {
  const ar = c.w / c.h;
  if (!(ar > 0)) return c;
  if (ar > fa) { const w = c.h * fa; return { x: c.x + (c.w - w) / 2, y: c.y, w, h: c.h }; }
  const h = c.w / fa;
  return { x: c.x, y: c.y + (c.h - h) / 2, w: c.w, h };
}

/** Meio píxel para dentro (as bordas da célula vizinha não entram na conta). */
export const inset = (c: Cell, d = 0.5): Cell => ({ x: c.x + d, y: c.y + d, w: Math.max(1, c.w - 2 * d), h: Math.max(1, c.h - 2 * d) });

/** O bloco w×h que começa em (x, y) de uma imagem RGBA com `stride` px de largura. */
export function tileOf(rgba: ArrayLike<number>, stride: number, x: number, y: number, w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h * 4);
  for (let r = 0; r < h; r++) {
    const from = ((y + r) * stride + x) * 4;
    for (let k = 0; k < w * 4; k++) out[r * w * 4 + k] = rgba[from + k] ?? 0;
  }
  return out;
}

/**
 * Quantos frames vão no lote seguinte de um vídeo: `left` ainda por ver, `remainingMs` de tempo e `msPerFrame` medido nos
 * lotes anteriores (0 = ainda nenhum). O primeiro lote vai sempre (até `FIRST_BATCH`); os outros só se couberem pelo menos
 * 2 frames no tempo que resta (com tempo a menos, as amostras ficam mais espaçadas: é a ordem do geral para o pormenor).
 */
export function batchSize(left: number, remainingMs: number, msPerFrame: number, seen: number): number {
  if (left <= 0) return 0;
  if (seen === 0) return Math.min(FIRST_BATCH, left);
  if (!(msPerFrame > 0)) return remainingMs > 0 ? Math.min(MAX_BATCH, left) : 0;
  const fit = Math.floor(remainingMs / msPerFrame);
  return fit < 2 ? 0 : Math.min(MAX_BATCH, left, fit);
}

/** O tempo de um vídeo (ms): o que sobra do orçamento a dividir pelos vídeos que faltam, entre os limites. */
export function videoBudget(totalMs: number, elapsedMs: number, videosLeft: number): number {
  const rest = Math.max(0, totalMs - elapsedMs) / Math.max(1, videosLeft);
  return Math.round(Math.min(VIDEO_BUDGET.max, Math.max(VIDEO_BUDGET.min, rest)));
}

/** O que o servidor respondeu sobre o som de um vídeo, já lido. */
export interface SoundReply {
  hasAudio: boolean;
  /** A energia (null sem som). */
  sound: SoundEnergy | null;
  loudestMs: number | null;
}

/** Lê a resposta de POST /tchekas/compose/analyze (`null` se não servir). */
export function parseSoundReply(body: unknown): SoundReply | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as { hasAudio?: unknown; energy?: unknown; rate?: unknown; loudestMs?: unknown };
  if (typeof b.hasAudio !== 'boolean') return null;
  const rate = typeof b.rate === 'number' && b.rate > 0 && b.rate <= 50 ? b.rate : 4;
  const energy = Array.isArray(b.energy) ? b.energy.map((e) => (typeof e === 'number' && Number.isFinite(e) ? Math.max(0, Math.min(1, e)) : 0)) : [];
  const loudestMs = typeof b.loudestMs === 'number' && Number.isFinite(b.loudestMs) ? b.loudestMs : null;
  const sound = b.hasAudio && energy.length ? { energy, rate } : null;
  return { hasAudio: b.hasAudio, sound, loudestMs };
}

/** O texto da fase do som quando acaba: `heard` respostas do servidor e quantas com som. */
export function soundDoneLabel(heard: number, withSound: number): string | null {
  if (heard === 0) return 'Sem som a tempo: fica a imagem';
  if (withSound === 0) return 'Os vídeos não têm som';
  return null;
}
