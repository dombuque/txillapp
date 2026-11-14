/**
 * As letras dos textos ao publicar (contrato com o servidor, `fontes`): as mesmas 10 fontes do estúdio das tchekas
 * (lib/studio/effects.ts, `FONTS`) nos textos por cima dos mimos, nas publicações só com texto (`textFont`) e na legenda
 * do Zás (`captionFont`). Uma fonte desconhecida ou em falta lê-se como 'classica'.
 *
 * Os textos dos mimos vão na mesma lista `stickers` dos stickers (que não têm `kind`):
 * `{ kind: 'text', text, font, color, bg, align, x, y, s, r }`.
 * - `x`/`y`: o centro, em fração da largura/altura do ecrã do mimo (como os stickers); `r`: rotação em graus.
 * - `s`: como nos stickers, a LARGURA da caixa toda (com o fundo e as margens) em fração da largura do ecrã. O texto mede-se
 *   a uma letra de referência (`TEXT_BASE_PX`) e escala por igual até a caixa ter `s × largura` (`textLayout`): as mesmas
 *   contas do servidor (apps/api/src/stories/text-layer.ts), que grava os textos nas cópias.
 * - As linhas são só as do próprio texto (`\n`): nunca se quebra sozinho ao desenhar (ao escrever, `wrapLayerText` parte as
 *   linhas compridas antes de pousar). Assim a app e a cópia guardada pelo servidor têm as mesmas linhas.
 * - `bg`: 'none' (só a letra, com sombra), 'solid' (caixa arredondada na `color`, letra escura ou branca, a que contrastar)
 *   ou 'soft' (caixa rgba(0,0,0,0.5), letra na `color`). Margens, entrelinha e cantos: `TEXT_METRICS`.
 *
 * Sem imports: o Node corre este ficheiro diretamente nos testes (tests/textFonts.test.mjs).
 */

export const TEXT_FONT_IDS = ['classica', 'cartaz', 'grito', 'praia', 'marcador', 'elegante', 'maquina', 'retro', 'mao', 'futuro'] as const;
export type TextFontId = (typeof TEXT_FONT_IDS)[number];
export const DEFAULT_TEXT_FONT: TextFontId = 'classica';

/** O acerto de tamanho de cada fonte (para as letras parecerem do mesmo tamanho): o mesmo `k` de `FONTS` no estúdio. */
export const TEXT_FONT_K: Record<TextFontId, number> = { classica: 1, cartaz: 1.25, grito: 1.05, praia: 0.95, marcador: 1, elegante: 1.05, maquina: 0.9, retro: 1.05, mao: 1.3, futuro: 0.88 };

export const isTextFont = (v: unknown): v is TextFontId => typeof v === 'string' && (TEXT_FONT_IDS as readonly string[]).includes(v);
/** Qualquer valor para uma fonte que existe (desconhecida, vazia ou em falta: 'classica'). */
export const normTextFont = (v: unknown): TextFontId => (isTextFont(v) ? v : DEFAULT_TEXT_FONT);
/** A fonte a mandar ao servidor: a clássica não precisa de ir (é a de sempre). */
export const fontToSend = (v: unknown): TextFontId | undefined => (normTextFont(v) === DEFAULT_TEXT_FONT ? undefined : normTextFont(v));

// ---------------------------------------------------------------- os textos dos mimos

export type TextBg = 'none' | 'solid' | 'soft';
export type TextAlign = 'left' | 'center' | 'right';
export interface TextLayer { kind: 'text'; text: string; font: TextFontId; color: string; bg: TextBg; align: TextAlign; x: number; y: number; s: number; r: number }

export const MAX_TEXT_LAYERS = 10;
export const TEXT_MAX_CHARS = 150;
export const TEXT_MAX_LINES = 6;
/** A largura da caixa (`s`): por omissão (antes de medir), a mais pequena e a maior (os limites do servidor). */
export const TEXT_S = { def: 0.5, min: 0.05, max: 1.6 } as const;
/** A letra de referência a que o texto se mede (px). */
export const TEXT_BASE_PX = 100;
/** Em frações da letra: entrelinha, margens da caixa (sem fundo e com fundo) e cantos; a caixa nunca fica mais estreita do que `minTextWidth`. */
export const TEXT_METRICS = {
  lineHeight: 1.22,
  padX: { none: 0.12, boxed: 0.4 },
  padY: { none: 0.06, boxed: 0.22 },
  radius: 0.3,
  minTextWidth: 0.6,
} as const;
/** A letra de um texto novo, em fração da largura do ecrã (vezes o acerto da fonte). */
export const TEXT_NEW_PX = 0.075;
/** Até quantas letras por linha antes de `wrapLayerText` partir (sobe se não couber em 6 linhas). */
export const TEXT_WRAP = 22;

/** As cores do texto (as do estúdio). */
export const TEXT_LAYER_COLORS = ['#ffffff', '#111111', '#d6334f', '#ff8a5c', '#ffd60a', '#3ddc97', '#2ec5ff', '#7a5cff', '#ff4fd8'] as const;
export const TEXT_BGS: readonly TextBg[] = ['none', 'solid', 'soft'];
export const nextBg = (bg: TextBg): TextBg => TEXT_BGS[(TEXT_BGS.indexOf(bg) + 1) % TEXT_BGS.length];
export const nextAlign = (a: TextAlign): TextAlign => (a === 'center' ? 'left' : a === 'left' ? 'right' : 'center');
export const BG_LABEL: Record<TextBg, string> = { none: 'Sem fundo', solid: 'Fundo cheio', soft: 'Fundo suave' };
export const ALIGN_LABEL: Record<TextAlign, string> = { left: 'Alinhado à esquerda', center: 'Centrado', right: 'Alinhado à direita' };

const HEX = /^#[0-9a-f]{6}$/i;
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const num = (v: unknown, d: number, a: number, b: number) => (typeof v === 'number' && Number.isFinite(v) ? clamp(v, a, b) : d);

/** Um texto pousado (e não um sticker de emoji, que não tem `kind`). */
export const isTextLayer = (l: unknown): l is TextLayer => !!l && typeof l === 'object' && (l as { kind?: unknown }).kind === 'text';

/** Letra escura ou branca, a que se lê melhor por cima de `hex` (luminância relativa acima de 0,4: escura; como o servidor). */
export function contrastOn(hex: string): '#111111' | '#ffffff' {
  if (!HEX.test(hex)) return '#111111';
  const lin = (i: number) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  const L = 0.2126 * lin(1) + 0.7152 * lin(3) + 0.0722 * lin(5);
  return L > 0.4 ? '#111111' : '#ffffff';
}

/** As cores de um texto: a letra e a caixa por trás (null sem fundo). */
export function layerColors(l: Pick<TextLayer, 'color' | 'bg'>): { fg: string; box: string | null } {
  const color = HEX.test(l.color) ? l.color : '#ffffff';
  if (l.bg === 'solid') return { fg: contrastOn(color), box: color };
  if (l.bg === 'soft') return { fg: color, box: 'rgba(0,0,0,0.5)' };
  return { fg: color, box: null };
}

/** A largura natural da caixa à letra de referência, para a linha mais comprida com `textW` px (medida a `TEXT_BASE_PX`). */
function natural(l: Pick<TextLayer, 'text' | 'bg'>, textW: number) {
  const B = TEXT_BASE_PX, M = TEXT_METRICS, boxed = l.bg !== 'none';
  const padX = (boxed ? M.padX.boxed : M.padX.none) * B, padY = (boxed ? M.padY.boxed : M.padY.none) * B;
  const contentW = Math.max(M.minTextWidth * B, textW);
  return { boxed, padX, padY, contentW, w: contentW + padX * 2, h: l.text.split('\n').length * M.lineHeight * B + padY * 2 };
}

/**
 * As medidas de um texto num ecrã com `W` px de largura: `textW` é a largura da linha mais comprida medida à letra de
 * referência (`TEXT_BASE_PX`). A caixa fica com `s × W` de largura e tudo o resto escala por igual.
 */
export function textLayout(l: Pick<TextLayer, 'text' | 'bg' | 's'>, textW: number, W: number) {
  const n = natural(l, textW);
  const k = (l.s * W) / n.w;
  return {
    k,
    w: n.w * k,
    h: n.h * k,
    fontPx: TEXT_BASE_PX * k,
    lineH: TEXT_METRICS.lineHeight * TEXT_BASE_PX * k,
    padX: n.padX * k,
    padY: n.padY * k,
    contentW: n.contentW * k,
    radius: n.boxed ? TEXT_METRICS.radius * TEXT_BASE_PX * k : 0,
  };
}

/** O `s` que dá ao texto a letra de `fontPx` px num ecrã de `W` px (dentro dos limites). */
export function sForFontPx(l: Pick<TextLayer, 'text' | 'bg'>, textW: number, fontPx: number, W: number): number {
  if (!W) return TEXT_S.def;
  return clamp((natural(l, textW).w * (fontPx / TEXT_BASE_PX)) / W, TEXT_S.min, TEXT_S.max);
}
/** A letra de um texto novo num ecrã de `W` px. */
export const newTextPx = (font: unknown, W: number) => TEXT_NEW_PX * W * TEXT_FONT_K[normTextFont(font)];

/** O texto enquanto se escreve: no máximo 150 letras e 6 linhas (as linhas a mais juntam-se à última). */
export function clampLayerText(s: string): string {
  const lines = s.replace(/\r\n?/g, '\n').split('\n');
  const kept = lines.length > TEXT_MAX_LINES ? [...lines.slice(0, TEXT_MAX_LINES - 1), lines.slice(TEXT_MAX_LINES - 1).join(' ')] : lines;
  return Array.from(kept.join('\n')).slice(0, TEXT_MAX_CHARS).join('');
}

/** Parte uma linha em pedaços de até `max` letras, pelos espaços (uma palavra maior que `max` parte-se a meio). */
function wrapLine(line: string, max: number): string[] {
  const words = line.split(/ +/).filter((w, i, a) => w || a.length === 1);
  const out: string[] = [];
  let cur = '';
  for (let w of words) {
    while (Array.from(w).length > max) {
      if (cur) { out.push(cur); cur = ''; }
      const chars = Array.from(w);
      out.push(chars.slice(0, max).join(''));
      w = chars.slice(max).join('');
    }
    if (!cur) cur = w;
    else if (Array.from(cur).length + 1 + Array.from(w).length <= max) cur += ` ${w}`;
    else { out.push(cur); cur = w; }
  }
  out.push(cur);
  return out;
}

/** Carateres de controlo (fora a mudança de linha): o servidor recusa-os com 400 (apps/api/src/stories/stickers.ts). */
const CONTROL = /[\u0000-\u0009\u000B-\u001F\u007F-\u009F\u2028\u2029]/g;

/**
 * O texto pronto a pousar: sem espaços nas pontas, linhas compridas partidas (até `TEXT_WRAP` letras, ou mais se não couber
 * em 6 linhas) e dentro dos limites, também depois de partir (cada `\n` novo conta como um carater no servidor). Vazio: ''.
 */
export function wrapLayerText(raw: string): string {
  const src = clampLayerText(raw).split('\n').map((l) => l.replace(CONTROL, ' ').replace(/[ \t]+/g, ' ').trim());
  while (src.length && !src[0]) src.shift();
  while (src.length && !src[src.length - 1]) src.pop();
  if (!src.length) return '';
  for (let max = TEXT_WRAP; max <= TEXT_MAX_CHARS; max += 2) {
    const lines = src.flatMap((l) => (l ? wrapLine(l, max) : ['']));
    const out = lines.join('\n');
    if (lines.length <= TEXT_MAX_LINES && Array.from(out).length <= TEXT_MAX_CHARS) return out;
  }
  return clampLayerText(src.join(' '));
}

/** Um texto novo: no meio do ecrã, sem rotação. */
export function newTextLayer(p: Partial<TextLayer> = {}): TextLayer {
  return { kind: 'text', text: '', font: DEFAULT_TEXT_FONT, color: '#ffffff', bg: 'none', align: 'center', x: 0.5, y: 0.4, s: TEXT_S.def, r: 0, ...p };
}

/** Um texto vindo do servidor (ou de qualquer lado) já limpo para desenhar, ou null se não for um texto válido. */
export function normTextLayer(raw: unknown): TextLayer | null {
  if (!isTextLayer(raw)) return null;
  const o = raw as unknown as Record<string, unknown>;
  const text = typeof o.text === 'string' ? clampLayerText(o.text) : '';
  if (!text.trim()) return null;
  return {
    kind: 'text',
    text,
    font: normTextFont(o.font),
    color: typeof o.color === 'string' && HEX.test(o.color) ? o.color.toLowerCase() : '#ffffff',
    bg: o.bg === 'solid' || o.bg === 'soft' ? o.bg : 'none',
    align: o.align === 'left' || o.align === 'right' ? o.align : 'center',
    x: num(o.x, 0.5, -0.5, 1.5),
    y: num(o.y, 0.5, -0.5, 1.5),
    s: num(o.s, TEXT_S.def, TEXT_S.min, TEXT_S.max),
    r: num(o.r, 0, -3600, 3600),
  };
}

/** Quantos stickers e quantos textos tem a lista do mimo. */
export function countLayers(list: readonly unknown[] | null | undefined): { stickers: number; texts: number } {
  let texts = 0;
  for (const l of list ?? []) if (isTextLayer(l)) texts++;
  return { stickers: (list?.length ?? 0) - texts, texts };
}

/** As fontes usadas pelos textos de uma lista (para as carregar antes de desenhar). */
export const layerFonts = (list: readonly unknown[] | null | undefined): TextFontId[] =>
  [...new Set((list ?? []).filter(isTextLayer).map((l) => normTextFont(l.font)))];

/** Tamanho da letra de uma publicação só com texto (acerto das fontes de cartaz, que são estreitas ou largas). */
export function postFontSize(font: unknown, base = 19): { fontSize: number; lineHeight: number } {
  const f = normTextFont(font);
  const fontSize = Math.round(base * TEXT_FONT_K[f] * 10) / 10;
  return { fontSize, lineHeight: Math.round(fontSize * (f === 'praia' || f === 'retro' ? 1.6 : 1.45)) };
}
