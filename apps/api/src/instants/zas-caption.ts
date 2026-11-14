import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

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

/**
 * As letras da legenda (em maiúsculas), uma a uma ao longo da curva, rodadas com ela: contorno escuro suave e letra
 * branca por cima, como no ecrã. Sem legenda devolve ''.
 */
export function zasCaptionSvg(W: number, H: number, text: string): string {
  const label = (text ?? '').trim().toUpperCase();
  if (!label) return '';
  const em = (advance ??= loadAdvance());
  const pts = arcPoints(W, H);
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  const len = cum[cum.length - 1];
  const chars = [...label];
  const k = W / 300;
  let fs = Math.max(8 * k, Math.min(Math.min(W, H) * 0.052, (len - 14 * k) / (chars.length * 0.8)));
  // A letra do servidor é mais larga do que a do telemóvel: se não couber na curva, encolhe (até ao mínimo do ecrã).
  const total = (size: number) => chars.reduce((s, ch) => s + em(ch.codePointAt(0)!) * size, 0) + size * 0.16 * (chars.length - 1);
  const need = total(fs);
  if (need > len - 14 * k) fs = Math.max(8 * k, (fs * (len - 14 * k)) / need);
  const spacing = fs * 0.16;
  const out: string[] = [];
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
    if (ch.trim()) out.push(`<text transform="translate(${x.toFixed(2)} ${y.toFixed(2)}) rotate(${deg.toFixed(2)})">${esc(ch)}</text>`);
    at += cw + spacing;
  }
  if (!out.length) return '';
  const body = out.join('');
  const font = `font-family="DejaVu Sans, Helvetica, Arial, sans-serif" font-weight="700" font-size="${fs.toFixed(2)}" text-anchor="middle"`;
  return `<g ${font} fill="none" stroke="#000000" stroke-opacity="0.35" stroke-width="${(2.4 * k).toFixed(2)}" stroke-linejoin="round">${body}</g>
<g ${font} fill="#ffffff">${body}</g>`;
}
