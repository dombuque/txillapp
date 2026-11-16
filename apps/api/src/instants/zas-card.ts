import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createCanvas, GlobalFonts, loadImage, Path2D, type SKRSContext2D } from '@napi-rs/canvas';
import sharp from 'sharp';
import { ensureStudioFonts } from '../compose/studio-canvas';
import { signatureSvg, type SealTier } from '../media/signature';
import { fontString } from '../stories/text-layer-render';
import { zasCaptionGlyphs } from './zas-caption';

/**
 * O Zás guardado com o desenho da app (Instants.tsx, ZasDeckCard.tsx, CurvedCaption.tsx): um quadro 9:16 escuro com a luz
 * coral do Zás em baixo, a marca do Zás em cima (o raio coral e «Zás» em itálico), o cartão squircle 3:4 com a foto a encher
 * a forma, os dois degradês escuros (em cima e em baixo) e a legenda a correr pela curva na letra escolhida, a data e a hora
 * por baixo do cartão e, no canto de baixo, fora da foto, a assinatura do Txillapp (logótipo, @ e selo: media/signature.ts).
 */
export const ZAS_OUT = { W: 1080, H: 1920 } as const;

/** O raio do ícone «bolt» da app (apps/mobile/src/icons/tx.ts), numa caixa de 24×24. */
export const BOLT = 'M13.5 2.5 5 13.5h6l-1 8 8.5-11h-6z';
export const BRAND = '#d6334f';
export const BG = '#08080b';
export const ZINC900 = '#18181b';
/** O expoente da superelipse da moldura (apps/mobile/src/components/zas/squircle.ts). */
const SQ_N = 3.4;
const sup = (c: number) => Math.sign(c) * Math.abs(c) ** (2 / SQ_N);
/** O cartão de referência da app (zasCardSize: no máximo 520 de altura): os degradês e as sombras medem-se nele. */
const REF_H = 520;

const FONT_FILES = [resolve(__dirname, '../../assets/fonts/DejaVuSans-Bold.ttf'), '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'];
const FAMILY = 'TxZasCard';
let fontOk: boolean | null = null;
export function baseFont(): string {
  if (fontOk === null) {
    const f = FONT_FILES.find((p) => existsSync(p));
    fontOk = !!f && !!GlobalFonts.registerFromPath(f, FAMILY);
  }
  return fontOk ? `"${FAMILY}"` : 'sans-serif';
}

/** Onde fica cada coisa no quadro W×H (o cartão 3:4 com largura múltipla de 3, como o zasCardSize da app). */
export function zasCardLayout(W: number = ZAS_OUT.W, H: number = ZAS_OUT.H) {
  const cardW = Math.floor((W * 0.89) / 3) * 3;
  const cardH = (cardW / 3) * 4;
  const x = Math.round((W - cardW) / 2);
  const headY = Math.round(H * 0.11);
  const y = Math.round(headY + W * 0.075);
  const k = cardH / REF_H;
  return { cardW, cardH, x, y, k, headY, headSize: Math.round(W * 0.052), timeY: Math.round(y + cardH + W * 0.075), timeSize: Math.round(W * 0.03) };
}

/** A forma squircle (superelipse) do cartão, como o clip-path do site. */
export function squirclePath(x: number, y: number, w: number, h: number, steps = 180): Path2D {
  const p = new Path2D();
  for (let i = 0; i < steps; i++) {
    const t = (i / steps) * 2 * Math.PI;
    const px = x + w / 2 + (w / 2) * sup(Math.cos(t)), py = y + h / 2 + (h / 2) * sup(Math.sin(t));
    if (i) p.lineTo(px, py);
    else p.moveTo(px, py);
  }
  p.closePath();
  return p;
}

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
/** «15 nov · 14:32», na hora de Moçambique (UTC+2, sem hora de verão). */
export function zasWhen(at: Date): string {
  const d = new Date(at.getTime() + 2 * 3_600_000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCDate()} ${MESES[d.getUTCMonth()]} · ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

export interface ZasCardInput {
  /** A foto do Zás (qualquer formato que o sharp leia; a rotação EXIF respeita-se). */
  photo: Buffer;
  caption: string;
  /** A letra da legenda (lib/textLayers); null: a de sempre, em negrito. */
  font: string | null;
  username: string;
  seal: SealTier | null;
  at: Date;
}

/** A legenda na curva do cartão: contorno escuro suave e letra branca por cima, como a CurvedCaption. */
function drawCaption(g: SKRSContext2D, w: number, h: number, text: string, font: string | null) {
  const label = (text ?? '').trim().toUpperCase();
  if (!label) return;
  const css = (px: number) => (font ? fontString(font, px) : `bold ${px.toFixed(2)}px ${baseFont()}`);
  if (font) ensureStudioFonts();
  const REF = 100;
  g.font = css(REF);
  const em = (cp: number) => g.measureText(String.fromCodePoint(cp)).width / REF;
  const { fs, k, glyphs } = zasCaptionGlyphs(w, h, label, em);
  g.font = css(fs);
  g.textAlign = 'center';
  g.textBaseline = 'alphabetic';
  g.lineJoin = 'round';
  g.lineWidth = 2.4 * k;
  g.strokeStyle = 'rgba(0,0,0,0.35)';
  g.fillStyle = '#ffffff';
  for (const pass of ['stroke', 'fill'] as const) {
    for (const gl of glyphs) {
      g.save();
      g.translate(gl.x, gl.y);
      g.rotate((gl.deg * Math.PI) / 180);
      if (pass === 'stroke') g.strokeText(gl.ch, 0, 0);
      else g.fillText(gl.ch, 0, 0);
      g.restore();
    }
  }
}

/** A marca do Zás (o raio coral e «Zás» em itálico, como no topo do ecrã), centrada em `cx`, com o meio da linha em `y`. */
export function drawZasMark(g: SKRSContext2D, cx: number, y: number, size: number) {
  g.font = `bold ${size}px ${baseFont()}`;
  const word = 'Zás';
  const tw = g.measureText(word).width;
  const bolt = size * 0.95, gap = size * 0.28;
  const hx = cx - (bolt + gap + tw) / 2;
  g.save();
  g.translate(hx, y - bolt / 2);
  g.scale(bolt / 24, bolt / 24);
  g.fillStyle = BRAND;
  g.strokeStyle = BRAND;
  g.lineWidth = 1.6;
  g.lineJoin = 'round';
  const bp = new Path2D(BOLT);
  g.fill(bp);
  g.stroke(bp);
  g.restore();
  g.save();
  g.translate(hx + bolt + gap, y + size * 0.36);
  g.transform(1, 0, -0.2, 1, 0, 0);
  g.fillStyle = '#ffffff';
  g.textAlign = 'left';
  g.textBaseline = 'alphabetic';
  g.fillText(word, 0, 0);
  g.restore();
}

/** O Zás desenhado como na app, em JPEG 1080×1920. */
export async function renderZasCard(o: ZasCardInput): Promise<Buffer> {
  const { W, H } = ZAS_OUT;
  const L = zasCardLayout(W, H);
  const c = createCanvas(W, H);
  const g = c.getContext('2d');

  // O fundo do ecrã do Zás: quase preto, com a luz coral a subir de baixo (o degradê do InstantsHub).
  g.fillStyle = BG;
  g.fillRect(0, 0, W, H);
  const glow = g.createLinearGradient(0, H * 0.4, 0, H);
  glow.addColorStop(0, 'rgba(255,92,92,0)');
  glow.addColorStop(1, 'rgba(255,92,92,0.28)');
  g.fillStyle = glow;
  g.fillRect(0, 0, W, H);

  // A marca do Zás (o raio coral e «Zás» em itálico, como no topo do ecrã), ao meio.
  const font = baseFont();
  drawZasMark(g, W / 2, L.headY, L.headSize);

  // O cartão: a sombra por fora (drop-shadow 0 14 28 da app) e a moldura squircle.
  const shape = squirclePath(L.x, L.y, L.cardW, L.cardH);
  g.save();
  g.shadowColor = 'rgba(0,0,0,0.55)';
  g.shadowBlur = 28 * L.k;
  g.shadowOffsetY = 14 * L.k;
  g.fillStyle = ZINC900;
  g.fill(shape);
  g.restore();

  g.save();
  g.clip(shape);
  // A foto enche a forma ("cover"): amplia até cobrir e corta o que sobra, ao meio.
  const flat = await sharp(o.photo).rotate().png().toBuffer();
  const img = await loadImage(flat);
  const sk = Math.max(L.cardW / img.width, L.cardH / img.height);
  const dw = img.width * sk, dh = img.height * sk;
  g.drawImage(img, L.x + (L.cardW - dw) / 2, L.y + (L.cardH - dh) / 2, dw, dh);
  // Os degradês da app: escuro em cima (por trás da legenda) e em baixo.
  const topH = 96 * L.k, botH = 140 * L.k;
  const tg = g.createLinearGradient(0, L.y, 0, L.y + topH);
  tg.addColorStop(0, 'rgba(0,0,0,0.35)');
  tg.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = tg;
  g.fillRect(L.x, L.y, L.cardW, topH);
  const bg = g.createLinearGradient(0, L.y + L.cardH - botH, 0, L.y + L.cardH);
  bg.addColorStop(0, 'rgba(0,0,0,0)');
  bg.addColorStop(1, 'rgba(0,0,0,0.5)');
  g.fillStyle = bg;
  g.fillRect(L.x, L.y + L.cardH - botH, L.cardW, botH);
  // A legenda na curva, nas medidas do próprio cartão.
  g.translate(L.x, L.y);
  drawCaption(g, L.cardW, L.cardH, o.caption, o.font);
  g.restore();

  // A data e a hora, por baixo do cartão, ao meio (como a hora ao lado do nome no visor).
  g.font = `bold ${L.timeSize}px ${font}`;
  g.fillStyle = 'rgba(255,255,255,0.65)';
  g.textAlign = 'center';
  g.textBaseline = 'alphabetic';
  g.fillText(zasWhen(o.at), W / 2, L.timeY);

  // A assinatura no canto de baixo, fora da foto (o mesmo desenho dos mimos).
  return sharp(c.toBuffer('image/png'))
    .composite([{ input: Buffer.from(signatureSvg(W, H, o.username, '', true, o.seal)), top: 0, left: 0 }])
    .jpeg({ quality: 92 })
    .toBuffer();
}
