/**
 * «Capulana»: os panos do Txillapp, gerados por código (testados em tests/studioCapulana.test.mjs).
 *
 * Um pano é uma função pura `(padrão, paleta, semente, u, v) → cor`: `u` e `v` vão de 0 a 1 e o desenho repete-se sem
 * costura (é um azulejo). Nada vem de tecidos, marcas ou imagens reais: são só contas (losangos, ziguezagues, círculos,
 * flores, faixas, escamas, sóis e degraus) sobre 6 paletas nossas. As mesmas entradas dão sempre os mesmos pixels, no
 * telemóvel, no browser e no servidor (docs/estudio-unico.md tem as fórmulas, para o ffmpeg + canvas do Node).
 *
 * Não importa nada: o Node corre este ficheiro diretamente.
 */

export const CAPULANA_VERSION = 1;

export type PatternId = 'losangos' | 'ziguezague' | 'circulos' | 'flores' | 'faixas' | 'escamas' | 'sol' | 'degraus';
export type PaletteId = 'marginal' | 'indico' | 'machamba' | 'mafalala' | 'neon' | 'coral';
/** Um pano: o padrão, a paleta e a semente (muda a escala, as cores de cada parte e os pormenores). */
export interface CapulanaSpec { pattern: PatternId; palette: PaletteId; seed: number }

export interface PatternDef { id: PatternId; name: string; /** Uma linha para o seletor e o leitor de ecrã. */ mood: string }
export const CAPULANA_PATTERNS: PatternDef[] = [
  { id: 'losangos', name: 'Losangos', mood: 'Losangos dentro de losangos' },
  { id: 'ziguezague', name: 'Ziguezague', mood: 'Ondas em bico, de lado a lado' },
  { id: 'circulos', name: 'Círculos', mood: 'Círculos uns dentro dos outros' },
  { id: 'flores', name: 'Flores', mood: 'Flores de pétalas largas' },
  { id: 'faixas', name: 'Faixas', mood: 'Barras com triângulos e contas' },
  { id: 'escamas', name: 'Escamas', mood: 'Leques sobrepostos, como escamas' },
  { id: 'sol', name: 'Sol', mood: 'Sóis de raios abertos' },
  { id: 'degraus', name: 'Degraus', mood: 'Pirâmides em degraus' },
];

/** Uma paleta: [fundo, forte, claro, acento, linha]. */
export interface PaletteDef { id: PaletteId; name: string; colors: [string, string, string, string, string] }
export const CAPULANA_PALETTES: PaletteDef[] = [
  { id: 'coral', name: 'Coral', colors: ['#3a0b17', '#d6334f', '#ffd9c7', '#ff8a5c', '#fff6ef'] },
  { id: 'marginal', name: 'Marginal', colors: ['#2b0f2e', '#f26a3d', '#ffc247', '#d6334f', '#fff3e0'] },
  { id: 'indico', name: 'Índico', colors: ['#07243b', '#0fa3b1', '#f7f3e3', '#ff8a5c', '#ffd60a'] },
  { id: 'machamba', name: 'Machamba', colors: ['#17301c', '#3f8f4a', '#f0b400', '#c8452b', '#f6ecd2'] },
  { id: 'mafalala', name: 'Mafalala', colors: ['#141414', '#f4f1ea', '#d6334f', '#e9b23a', '#8a8a8a'] },
  { id: 'neon', name: 'Néon', colors: ['#0d0b2a', '#7a5cff', '#ff4fd8', '#2ec5ff', '#f5f3ff'] },
];

const PATTERN_INDEX = new Map(CAPULANA_PATTERNS.map((p, i) => [p.id, i]));
const PALETTE_BY_ID = new Map(CAPULANA_PALETTES.map((p) => [p.id, p]));
export const isPattern = (v: unknown): v is PatternId => typeof v === 'string' && PATTERN_INDEX.has(v as PatternId);
export const isPalette = (v: unknown): v is PaletteId => typeof v === 'string' && PALETTE_BY_ID.has(v as PaletteId);
export const paletteById = (id: string | null | undefined): PaletteDef => PALETTE_BY_ID.get(id as PaletteId) ?? CAPULANA_PALETTES[0];
export const patternById = (id: string | null | undefined): PatternDef => CAPULANA_PATTERNS[PATTERN_INDEX.get(id as PatternId) ?? 0];

/** Um pano limpo a partir de qualquer coisa (para ler rascunhos e o contrato). */
export function sanitizeCapulana(x: unknown): CapulanaSpec | undefined {
  if (!x || typeof x !== 'object') return undefined;
  const o = x as Record<string, unknown>;
  if (!isPattern(o.pattern) || !isPalette(o.palette)) return undefined;
  const seed = typeof o.seed === 'number' && Number.isFinite(o.seed) ? Math.abs(Math.floor(o.seed)) % 1000000 : 0;
  return { pattern: o.pattern, palette: o.palette, seed };
}
export const capulanaKey = (s: CapulanaSpec) => `${s.pattern}/${s.palette}/${s.seed}`;

// ---------------------------------------------------------------- números com semente

/** mulberry32: o gerador com semente de tudo o que é «mágico» ou de pano (igual em todo o lado). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** O que a semente decide num pano. */
export interface CapulanaParams {
  /** Quantas vezes o motivo cabe no azulejo (para cada lado). */
  n: number;
  /** As cores (índices da paleta, 1 a 3 baralhados) das três partes do motivo. */
  a: number; b: number; c: number;
  /** Um inteiro de pormenor: pétalas, raios, degraus, bandas (depende do padrão). */
  k: number;
}

const PICKS: Record<PatternId, { n: number[]; k: number[] }> = {
  losangos: { n: [2, 3, 4], k: [0, 1] },
  ziguezague: { n: [2, 3, 4], k: [2, 3, 4] },
  circulos: { n: [2, 3], k: [4, 5, 6] },
  flores: { n: [2, 3], k: [5, 6, 8] },
  faixas: { n: [1, 2], k: [4, 6, 8] },
  escamas: { n: [2, 3], k: [0, 1] },
  sol: { n: [1, 2], k: [8, 12, 16] },
  degraus: { n: [2, 3], k: [4, 5, 6] },
};
const ORDERS = [[1, 2, 3], [1, 3, 2], [2, 1, 3], [2, 3, 1], [3, 1, 2], [3, 2, 1]];

/** Os parâmetros de um pano: `mulberry32(semente × 8 + índice do padrão)` e três tiragens (ordem das cores, n, k). */
export function capulanaParams(pattern: PatternId, seed: number): CapulanaParams {
  const r = mulberry32((Math.abs(Math.floor(seed)) % 1000000) * 8 + (PATTERN_INDEX.get(pattern) ?? 0));
  const o = ORDERS[Math.floor(r() * 6)];
  const pk = PICKS[pattern] ?? PICKS.losangos;
  const n = pk.n[Math.floor(r() * pk.n.length)];
  const k = pk.k[Math.floor(r() * pk.k.length)];
  return { n, a: o[0], b: o[1], c: o[2], k };
}

// ---------------------------------------------------------------- as fórmulas

const frac = (x: number) => x - Math.floor(x);
const FUNDO = 0, LINHA = 4;

/**
 * O índice da cor (0 a 4 na paleta) no ponto (u, v) do azulejo. Em cada padrão, `x` e `y` são a posição dentro da célula
 * (de -½ a ½) e `par` diz se a célula é par ou ímpar (em xadrez).
 */
export function capulanaIndex(pattern: PatternId, p: CapulanaParams, u: number, v: number): number {
  const { n, a, b, c, k } = p;
  const cu = frac(u) * n, cv = frac(v) * n;
  const ix = Math.floor(cu), iy = Math.floor(cv);
  const x = cu - ix - 0.5, y = cv - iy - 0.5;
  const par = (ix + iy) % 2 === 0;
  switch (pattern) {
    case 'losangos': {
      const d = 2 * (Math.abs(x) + Math.abs(y));
      if (d < 0.2) return k ? LINHA : c;
      if (d < 0.48) return k ? c : LINHA;
      if (d < 0.78) return par ? a : b;
      if (d < 0.9) return LINHA;
      if (d < 1) return FUNDO;
      return 2 - d < 0.2 ? c : FUNDO;
    }
    case 'ziguezague': {
      const tri = Math.abs(2 * frac(frac(u) * n) - 1);
      const t = frac(frac(v) * k + 0.5 * tri);
      if (t < 0.3) return a;
      if (t < 0.36) return LINHA;
      if (t < 0.6) return b;
      if (t < 0.66) return LINHA;
      if (t < 0.84) return c;
      return FUNDO;
    }
    case 'circulos': {
      const r = 2 * Math.hypot(x, y);
      if (r < 1) return [c, LINHA, a, FUNDO, b, LINHA][(Math.floor(r * k) + (par ? 0 : 2)) % 6];
      const r2 = 2 * Math.hypot(Math.abs(x) - 0.5, Math.abs(y) - 0.5);
      if (r2 < 0.26) return c;
      return r2 < 0.36 ? LINHA : FUNDO;
    }
    case 'flores': {
      const r = 2 * Math.hypot(x, y);
      const R = 0.42 + 0.44 * Math.abs(Math.cos((k * Math.atan2(y, x)) / 2));
      if (r < 0.15) return c;
      if (r < 0.22) return LINHA;
      if (r < R - 0.07) return par ? a : b;
      if (r < R) return LINHA;
      const dd = 2 * (Math.abs(Math.abs(x) - 0.5) + Math.abs(Math.abs(y) - 0.5));
      return dd < 0.2 ? c : FUNDO;
    }
    case 'faixas': {
      const s = cu - ix; // 0 a 1 ao longo da faixa
      const yy = frac(frac(v) * k);
      if (s < 0.12) return a;
      if (s < 0.16) return LINHA;
      if (s < 0.44) return Math.abs(yy - 0.5) * 2 < (s - 0.16) / 0.28 ? b : FUNDO;
      if (s < 0.48) return LINHA;
      if (s < 0.6) return c;
      if (s < 0.64) return LINHA;
      if (s < 0.92) {
        const d = Math.abs((s - 0.64) / 0.28 - 0.5) * 2 + Math.abs(yy - 0.5) * 2;
        return d < 0.3 ? LINHA : d < 0.82 ? a : FUNDO;
      }
      return s < 0.96 ? LINHA : b;
    }
    case 'escamas': {
      // Filas a cada ¼ de célula; cada escama é um círculo de raio ½ com o centro no cimo da fila; a fila de baixo fica por cima.
      const rows = 4 * n;
      const fv = frac(v) * rows;
      const j = Math.floor(fv), yy = (fv - j) * 0.25;
      for (let q = 0; q < 3; q++) {
        const row = j - q;
        const xx = frac(cu + (((row % 2) + 2) % 2 ? 0.5 : 0)) - 0.5;
        const d = 2 * Math.hypot(xx, yy + q * 0.25);
        if (d >= 1) continue;
        if (d > 0.88) return LINHA;
        if (d > 0.58) return [a, b, k ? c : a, b][((row % 4) + 4) % 4];
        return d > 0.48 ? LINHA : FUNDO;
      }
      return FUNDO;
    }
    case 'sol': {
      const r = 2 * Math.hypot(x, y);
      if (r < 0.2) return c;
      if (r < 0.27) return LINHA;
      if (r < 0.9) {
        const ray = Math.floor((Math.atan2(y, x) / (2 * Math.PI) + 1) * k) % 2 === 0;
        return ray ? a : r < 0.58 ? b : FUNDO;
      }
      if (r < 0.96) return LINHA;
      return 2 * Math.hypot(Math.abs(x) - 0.5, Math.abs(y) - 0.5) < 0.24 ? b : FUNDO;
    }
    case 'degraus':
    default: {
      const s = Math.floor(Math.abs(x) * 2 * k) + Math.floor(Math.abs(y) * 2 * k);
      if (s >= k) return FUNDO;
      if (s === k - 1) return LINHA;
      return [c, par ? a : b, LINHA, par ? b : a][s % 4];
    }
  }
}

// ---------------------------------------------------------------- o azulejo (pixels)

/** '#rrggbb' → [r, g, b] (0 a 255). */
export function hexRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** O lado do azulejo por omissão (px) e quantas amostras por pixel, em cada eixo, para os contornos ficarem suaves. */
export const TILE_SIZE = 256;
export const TILE_SS = 3;

/**
 * O azulejo em RGBA (`size`×`size`), com `ss`×`ss` amostras por pixel (a média das cores). A amostra (i, j) do pixel (px, py)
 * fica em u = (px + (i + ½)/ss)/size, v = (py + (j + ½)/ss)/size.
 */
export function capulanaTile(spec: CapulanaSpec, size: number = TILE_SIZE, ss: number = TILE_SS): Uint8ClampedArray {
  const p = capulanaParams(spec.pattern, spec.seed);
  const pal = paletteById(spec.palette).colors.map(hexRgb);
  const out = new Uint8ClampedArray(size * size * 4);
  const k = 1 / (ss * ss);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0;
      for (let j = 0; j < ss; j++) {
        const v = (py + (j + 0.5) / ss) / size;
        for (let i = 0; i < ss; i++) {
          const c = pal[capulanaIndex(spec.pattern, p, (px + (i + 0.5) / ss) / size, v)];
          r += c[0]; g += c[1]; b += c[2];
        }
      }
      const o = (py * size + px) * 4;
      out[o] = Math.round(r * k); out[o + 1] = Math.round(g * k); out[o + 2] = Math.round(b * k); out[o + 3] = 255;
    }
  }
  return out;
}

/** Uma impressão digital dos pixels (FNV-1a de 32 bits), para os testes e para o servidor conferir o desenho dele. */
export function pixelsHash(px: ArrayLike<number>): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < px.length; i++) { h ^= px[i] & 255; h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, '0');
}

// ---------------------------------------------------------------- miniaturas sem canvas

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
export function base64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i], b = i + 1 < bytes.length ? bytes[i + 1] : 0, c = i + 2 < bytes.length ? bytes[i + 2] : 0;
    s += B64[a >> 2] + B64[((a & 3) << 4) | (b >> 4)] + (i + 1 < bytes.length ? B64[((b & 15) << 2) | (c >> 6)] : '=') + (i + 2 < bytes.length ? B64[c & 63] : '=');
  }
  return s;
}

/** Um BMP de 24 bits a partir de RGBA (as linhas de baixo para cima, como o formato pede). */
export function bmpBytes(rgba: ArrayLike<number>, w: number, h: number): Uint8Array {
  const row = (w * 3 + 3) & ~3;
  const out = new Uint8Array(54 + row * h);
  const dv = new DataView(out.buffer);
  out[0] = 0x42; out[1] = 0x4d;
  dv.setUint32(2, out.length, true); dv.setUint32(10, 54, true); dv.setUint32(14, 40, true);
  dv.setInt32(18, w, true); dv.setInt32(22, h, true); dv.setUint16(26, 1, true); dv.setUint16(28, 24, true);
  dv.setUint32(34, row * h, true); dv.setInt32(38, 2835, true); dv.setInt32(42, 2835, true);
  for (let y = 0; y < h; y++) {
    let o = 54 + (h - 1 - y) * row;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      out[o++] = rgba[i + 2]; out[o++] = rgba[i + 1]; out[o++] = rgba[i];
    }
  }
  return out;
}

const uriCache = new Map<string, string>();
/**
 * A miniatura de um pano como `data:` URI (BMP), para um `<Image>` normal: funciona na web e no nativo sem canvas.
 * Fica em memória (no máximo 120 miniaturas).
 */
export function capulanaDataUri(spec: CapulanaSpec, size = 96): string {
  const key = `${capulanaKey(spec)}@${size}`;
  const hit = uriCache.get(key);
  if (hit) return hit;
  const uri = `data:image/bmp;base64,${base64(bmpBytes(capulanaTile(spec, size, 2), size, size))}`;
  if (uriCache.size >= 120) uriCache.delete(uriCache.keys().next().value as string);
  uriCache.set(key, uri);
  return uri;
}

/** Outro pano com a mesma semente a seguir (o botão «Baralhar» do seletor). */
export const nextSeed = (seed: number) => (Math.abs(Math.floor(seed)) + 1) % 1000000;

/** Um pano tirado à sorte com `rnd` (para a montagem mágica). */
export function randomCapulana(rnd: () => number, palette?: PaletteId): CapulanaSpec {
  return {
    pattern: CAPULANA_PATTERNS[Math.floor(rnd() * CAPULANA_PATTERNS.length)].id,
    palette: palette ?? CAPULANA_PALETTES[Math.floor(rnd() * CAPULANA_PALETTES.length)].id,
    seed: Math.floor(rnd() * 1000),
  };
}
