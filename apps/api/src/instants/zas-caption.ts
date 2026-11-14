import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createCanvas } from '@napi-rs/canvas';
import { ensureStudioFonts } from '../compose/studio-canvas';
import { fontString } from '../stories/text-layer-render';

/**
 * A legenda de um Zás gravada na cópia que se guarda, a correr pela curva como no ecrã. As mesmas contas de
 * apps/mobile/src/components/zas/squircle.ts (`sup`, `arcPoints`) e da CurvedCaption.tsx (tamanho e espaço), com a letra do
 * servidor (DejaVu Sans Bold, a mesma do @ da assinatura). O SVG sai à escala da foto, para ir por baixo da assinatura.
 */
const SQ_N = 3.4;
const sup = (c: number) => Math.sign(c) * Math.abs(c) ** (2 / SQ_N);

/** Pontos do troço da curva onde corre a legenda (sobe pela esquerda e segue pelo topo). */
export function arcPoints(w: number, h: number, steps = 160) {
  const inset = Math.min(w, h) * 0.1;
  const a = Math.PI + 0.22;
  const b = 2 * Math.PI - 0.3;
  const pts: { x: number; y: number }[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = a + ((b - a) * i) / steps;
    pts.push({ x: w / 2 + (w / 2 - inset) * sup(Math.cos(t)), y: h / 2 + (h / 2 - inset) * sup(Math.sin(t)) });
  }
  return pts;
}

/** A largura de cada letra (em "em"), lida da própria fonte (tabelas cmap e hmtx do TTF): o SVG não sabe medir texto. */
const FONT_CANDIDATES = [resolve(__dirname, '../../assets/fonts/DejaVuSans-Bold.ttf'), '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'];
const FALLBACK_EM = 0.72;
let advance: ((cp: number) => number) | null = null;

function loadAdvance(): (cp: number) => number {
  for (const path of FONT_CANDIDATES) {
    try {
      return parseAdvance(readFileSync(path));
    } catch {
      /* tenta a seguinte */
    }
  }
  return () => FALLBACK_EM;
}

function parseAdvance(f: Buffer): (cp: number) => number {
  const tables = new Map<string, number>();
  const n = f.readUInt16BE(4);
  for (let i = 0; i < n; i++) tables.set(f.toString('latin1', 12 + i * 16, 16 + i * 16), f.readUInt32BE(20 + i * 16));
  const head = tables.get('head'), hhea = tables.get('hhea'), hmtx = tables.get('hmtx'), cmap = tables.get('cmap');
  if (head == null || hhea == null || hmtx == null || cmap == null) throw new Error('fonte incompleta');
  const upem = f.readUInt16BE(head + 18);
  const nMetrics = f.readUInt16BE(hhea + 34);
  // A tabela de caracteres Unicode (formato 4, plano básico): é aí que estão as letras, os acentos e a pontuação.
  let sub = -1;
  for (let i = 0, k = f.readUInt16BE(cmap + 2); i < k; i++) {
    const r = cmap + 4 + i * 8;
    const pid = f.readUInt16BE(r), eid = f.readUInt16BE(r + 2), off = cmap + f.readUInt32BE(r + 4);
    if (f.readUInt16BE(off) === 4 && ((pid === 3 && eid === 1) || pid === 0)) { sub = off; break; }
  }
  if (sub < 0) throw new Error('sem cmap 4');
  const seg = f.readUInt16BE(sub + 6) / 2;
  const ends = sub + 14, starts = ends + seg * 2 + 2, deltas = starts + seg * 2, ranges = deltas + seg * 2;
  const glyph = (cp: number): number => {
    if (cp > 0xffff) return 0;
    for (let i = 0; i < seg; i++) {
      if (f.readUInt16BE(ends + i * 2) < cp) continue;
      const start = f.readUInt16BE(starts + i * 2);
      if (start > cp) return 0;
      const delta = f.readInt16BE(deltas + i * 2);
      const ro = f.readUInt16BE(ranges + i * 2);
      if (!ro) return (cp + delta) & 0xffff;
      const g = f.readUInt16BE(ranges + i * 2 + ro + (cp - start) * 2);
      return g ? (g + delta) & 0xffff : 0;
    }
    return 0;
  };
  const cache = new Map<number, number>();
  return (cp) => {
    let w = cache.get(cp);
    if (w == null) {
      const g = glyph(cp);
      w = g ? f.readUInt16BE(hmtx + Math.min(g, nMetrics - 1) * 4) / upem : FALLBACK_EM;
      cache.set(cp, w);
    }
    return w;
  };
}

const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');


export interface ZasGlyph { ch: string; x: number; y: number; deg: number }

/**
 * Onde fica cada letra da legenda (já em maiúsculas) ao longo da curva: o centro da letra na linha de base, a rotação e o
 * tamanho da letra. `em(cp)`: a largura de uma letra em "em" na fonte com que se vai desenhar.
 */
export function zasCaptionGlyphs(W: number, H: number, label: string, em: (cp: number) => number): { fs: number; k: number; glyphs: ZasGlyph[] } {
  const pts = arcPoints(W, H);
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  const len = cum[cum.length - 1];
  const chars = [...label];
  const k = W / 300;
  let fs = Math.max(8 * k, Math.min(Math.min(W, H) * 0.052, (len - 14 * k) / (chars.length * 0.8)));
  // A letra do servidor pode ser mais larga do que a do telemóvel: se não couber na curva, encolhe (até ao mínimo do ecrã).
  const total = (size: number) => chars.reduce((s, ch) => s + em(ch.codePointAt(0)!) * size, 0) + size * 0.16 * (chars.length - 1);
  const need = total(fs);
  if (need > len - 14 * k) fs = Math.max(8 * k, (fs * (len - 14 * k)) / need);
  const spacing = fs * 0.16;
  const glyphs: ZasGlyph[] = [];
  let at = 0;
  for (const ch of chars) {
    const cw = em(ch.codePointAt(0)!) * fs;
    const mid = at + cw / 2;
    if (mid > len) break;
    let j = 1;
    while (j < cum.length - 1 && cum[j] < mid) j++;
    const p0 = pts[j - 1], p1 = pts[j];
    const f = (mid - cum[j - 1]) / Math.max(1e-6, cum[j] - cum[j - 1]);
    const x = p0.x + (p1.x - p0.x) * f, y = p0.y + (p1.y - p0.y) * f;
    const deg = (Math.atan2(p1.y - p0.y, p1.x - p0.x) * 180) / Math.PI;
    if (ch.trim()) glyphs.push({ ch, x, y, deg });
    at += cw + spacing;
  }
  return { fs, k, glyphs };
}

/**
 * As letras da legenda (em maiúsculas), uma a uma ao longo da curva, rodadas com ela: contorno escuro suave e letra
 * branca por cima, como no ecrã. Sem legenda devolve ''. Com `font` (uma das fontes do estúdio, docs/fontes-contrato.md)
 * as letras desenham-se no canvas com essa fonte e entram no SVG como imagem; sem ela, a letra de sempre (DejaVu Sans Bold).
 */
export function zasCaptionSvg(W: number, H: number, text: string, font: string | null = null): string {
  const label = (text ?? '').trim().toUpperCase();
  if (!label) return '';
  if (font) return zasCaptionCanvasSvg(W, H, label, font);
  const { fs, k, glyphs } = zasCaptionGlyphs(W, H, label, (advance ??= loadAdvance()));
  if (!glyphs.length) return '';
  const body = glyphs.map((g) => `<text transform="translate(${g.x.toFixed(2)} ${g.y.toFixed(2)}) rotate(${g.deg.toFixed(2)})">${esc(g.ch)}</text>`).join('');
  const attrs = `font-family="DejaVu Sans, Helvetica, Arial, sans-serif" font-weight="700" font-size="${fs.toFixed(2)}" text-anchor="middle"`;
  return `<g ${attrs} fill="none" stroke="#000000" stroke-opacity="0.35" stroke-width="${(2.4 * k).toFixed(2)}" stroke-linejoin="round">${body}</g>
<g ${attrs} fill="#ffffff">${body}</g>`;
}

/** A legenda com a fonte escolhida: as mesmas posições, medidas e desenhadas no canvas (Skia) com as fontes do estúdio. */
function zasCaptionCanvasSvg(W: number, H: number, label: string, font: string): string {
  const ruler = createCanvas(4, 4).getContext('2d');
  ensureStudioFonts();
  const REF = 100;
  ruler.font = fontString(font, REF);
  const em = (cp: number) => ruler.measureText(String.fromCodePoint(cp)).width / REF;
  const { fs, k, glyphs } = zasCaptionGlyphs(W, H, label, em);
  if (!glyphs.length) return '';
  // Só o retângulo onde há letras (com folga), em vez da foto inteira.
  const pad = fs * 1.2;
  const x0 = Math.max(0, Math.floor(Math.min(...glyphs.map((g) => g.x)) - pad)), y0 = Math.max(0, Math.floor(Math.min(...glyphs.map((g) => g.y)) - pad));
  const x1 = Math.min(W, Math.ceil(Math.max(...glyphs.map((g) => g.x)) + pad)), y1 = Math.min(H, Math.ceil(Math.max(...glyphs.map((g) => g.y)) + pad));
  if (x1 - x0 < 2 || y1 - y0 < 2) return '';
  const c = createCanvas(x1 - x0, y1 - y0);
  const g = c.getContext('2d');
  g.translate(-x0, -y0);
  g.font = fontString(font, fs);
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
  return `<image x="${x0}" y="${y0}" width="${x1 - x0}" height="${y1 - y0}" href="data:image/png;base64,${c.toBuffer('image/png').toString('base64')}"/>`;
}
