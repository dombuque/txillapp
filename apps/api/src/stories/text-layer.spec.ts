import { TEXT_FONT_IDS, textFontOf } from '@txillapp/shared';
import { FONTS } from '../compose/effects';
import { stickersOf, stickersSchema } from './stickers';
import { layoutTextLayer, TEXT_BASE_PX } from './text-layer';

/** Uma régua de faz-de-conta: cada carácter mede meia letra. */
const half = (line: string, px: number) => [...line].length * px * 0.5;
const base = { text: 'Olá', color: '#ffffff', bg: 'none' as const, align: 'center' as const, x: 0.5, y: 0.5, s: 0.5, r: 0 };

describe('textos dos mimos: a conta da caixa (layoutTextLayer)', () => {
  it('a caixa fica com s × W de largura, no centro x·W, y·H, com a rotação do texto', () => {
    const L = layoutTextLayer({ ...base, x: 0.25, y: 0.75, r: -12 }, 1080, 1920, half);
    expect(L.w).toBeCloseTo(540, 6);
    expect(L.cx).toBe(270);
    expect(L.cy).toBe(1440);
    expect(L.rot).toBe(-12);
  });

  it('sem fundo: margem pequena, sombra e a cor do texto; tudo escala por igual', () => {
    const L = layoutTextLayer({ ...base, text: 'abcd' }, 1000, 1000, half);
    // largura natural: 4 × 50 + 2 × 12 = 224 px a 100 px de letra; a caixa tem 500 px.
    const k = 500 / 224;
    expect(L.fontPx).toBeCloseTo(TEXT_BASE_PX * k, 6);
    expect(L.h).toBeCloseTo((122 + 12) * k, 6);
    expect(L.lines).toHaveLength(1);
    expect(L.lines[0].x).toBeCloseTo(12 * k, 6);
    expect(L.lines[0].y).toBeCloseTo((6 + 61) * k, 6);
    expect(L).toMatchObject({ fill: '#ffffff', box: null, shadow: true, radius: 0 });
  });

  it("'solid': caixa na cor do texto e letras pretas ou brancas, conforme se lê melhor", () => {
    const amarelo = layoutTextLayer({ ...base, bg: 'solid', color: '#ffd60a' }, 1000, 1000, half);
    expect(amarelo).toMatchObject({ box: '#ffd60a', fill: '#111111', shadow: false });
    expect(amarelo.radius).toBeGreaterThan(0);
    const roxo = layoutTextLayer({ ...base, bg: 'solid', color: '#3a1a7a' }, 1000, 1000, half);
    expect(roxo).toMatchObject({ box: '#3a1a7a', fill: '#ffffff' });
  });

  it("'soft': caixa preta a 50 % e o texto na sua cor", () => {
    expect(layoutTextLayer({ ...base, bg: 'soft', color: '#d6334f' }, 1000, 1000, half)).toMatchObject({ box: 'rgba(0,0,0,0.5)', fill: '#d6334f', shadow: false });
  });

  it('várias linhas (só as do texto) e o alinhamento de cada uma dentro da caixa', () => {
    const t = { ...base, text: 'aaaa\naa\n\na', bg: 'soft' as const };
    const left = layoutTextLayer({ ...t, align: 'left' }, 1000, 1000, half);
    const right = layoutTextLayer({ ...t, align: 'right' }, 1000, 1000, half);
    const center = layoutTextLayer({ ...t, align: 'center' }, 1000, 1000, half);
    expect(left.lines.map((l) => l.text)).toEqual(['aaaa', 'aa', '', 'a']);
    // A linha mais comprida ocupa a caixa toda (menos as margens) em qualquer alinhamento.
    for (const L of [left, right, center]) expect(L.lines[0].x).toBeCloseTo(left.lines[0].x, 6);
    expect(left.lines[1].x).toBeCloseTo(left.lines[0].x, 6);
    expect(right.lines[1].x + right.lines[1].w).toBeCloseTo(right.lines[0].x + right.lines[0].w, 6);
    expect(center.lines[1].x + center.lines[1].w / 2).toBeCloseTo(center.w / 2, 6);
    // As linhas descem uma altura de linha de cada vez.
    expect(left.lines[1].y - left.lines[0].y).toBeCloseTo(left.lines[3].y - left.lines[2].y, 6);
    expect(left.lines[3].y).toBeLessThan(left.h);
  });

  it('um texto curtíssimo não fica com uma caixa de largura zero', () => {
    const L = layoutTextLayer({ ...base, text: '.' }, 1000, 1000, () => 1);
    expect(L.fontPx).toBeLessThan(1000);
    expect(Number.isFinite(L.fontPx)).toBe(true);
  });
});

describe('textos dos mimos: o que se aceita', () => {
  const t = (o: Record<string, unknown> = {}) => ({ kind: 'text', text: 'olá', x: 0.5, y: 0.5, s: 0.5, r: 0, ...o });
  const ok = (l: unknown[]) => stickersSchema.safeParse(l).success;

  it('as fontes são as mesmas do estúdio (ids e ordem); uma desconhecida lê-se como clássica', () => {
    expect(FONTS.map((f) => f.id)).toEqual([...TEXT_FONT_IDS]);
    expect(textFontOf('nao-existe')).toBe('classica');
    expect(textFontOf(undefined)).toBe('classica');
    expect(textFontOf('retro')).toBe('retro');
  });

  it('valores por omissão, texto aparado e CRLF como mudança de linha', () => {
    const r = stickersSchema.parse([t({ text: '  linha 1\r\nlinha 2  ' })]);
    expect(r).toEqual([{ kind: 'text', text: 'linha 1\nlinha 2', font: 'classica', color: '#ffffff', bg: 'none', align: 'center', x: 0.5, y: 0.5, s: 0.5, r: 0 }]);
  });

  it('recusa texto vazio, comprido, com linhas a mais ou carateres de controlo', () => {
    expect(ok([t({ text: '   ' })])).toBe(false);
    expect(ok([t({ text: 'x'.repeat(150) })])).toBe(true);
    expect(ok([t({ text: 'x'.repeat(151) })])).toBe(false);
    expect(ok([t({ text: '😀'.repeat(150) })])).toBe(true);
    expect(ok([t({ text: 'a\nb\nc\nd\ne\nf' })])).toBe(true);
    expect(ok([t({ text: 'a\nb\nc\nd\ne\nf\ng' })])).toBe(false);
    expect(ok([t({ text: 'a\tb' })])).toBe(false);
    expect(ok([t({ text: 'a\u0000b' })])).toBe(false);
  });

  it('recusa fonte, cor, fundo, alinhamento ou posição inválidos', () => {
    expect(ok([t({ font: 'comic' })])).toBe(false);
    expect(ok([t({ color: 'red' })])).toBe(false);
    expect(ok([t({ color: '#fff' })])).toBe(false);
    expect(ok([t({ bg: 'pano' })])).toBe(false);
    expect(ok([t({ align: 'justify' })])).toBe(false);
    expect(ok([t({ x: 2 })])).toBe(false);
    expect(ok([t({ s: 0.01 })])).toBe(false);
    expect(ok([t({ kind: 'imagem' })])).toBe(false);
    // Um objeto com `kind` não passa por sticker, mesmo com um id válido.
    expect(ok([{ kind: 'text', id: 'm-fogo', x: 0.5, y: 0.5, s: 0.3, r: 0 }])).toBe(false);
  });

  it('até 10 textos e 12 stickers no mesmo mimo; os stickers de sempre ficam iguais', () => {
    const st = { id: 'm-fogo', x: 0.5, y: 0.5, s: 0.3, r: 0 };
    expect(ok([...Array(12).fill(st), ...Array.from({ length: 10 }, () => t())])).toBe(true);
    expect(ok([...Array(12).fill(st), ...Array.from({ length: 11 }, () => t())])).toBe(false);
    expect(ok([...Array(13).fill(st), t()])).toBe(false);
    expect(stickersSchema.parse([st])).toEqual([st]);
  });

  it('ao ler o que está guardado, uma letra que deixou de existir lê-se como a clássica (o texto não desaparece)', () => {
    const st = { id: 'm-fogo', x: 0.5, y: 0.5, s: 0.3, r: 0 };
    const gone = { kind: 'text', text: 'Olá', font: 'gotica', color: '#ffffff', bg: 'none', align: 'center', x: 0.5, y: 0.5, s: 0.5, r: 0 };
    expect(stickersOf([st, gone])).toEqual([st, { ...gone, font: 'classica' }]);
    expect(stickersOf([{ ...gone, font: undefined }])).toEqual([{ ...gone, font: 'classica' }]);
    // O resto continua a ser validado: um texto vazio fica de fora; a lista guardada não muda.
    expect(stickersOf([st, { ...gone, text: '  ' }])).toEqual([st]);
    expect(gone.font).toBe('gotica');
  });
});
