// As letras ao publicar (src/lib/textLayers.ts, contrato `fontes`): as 10 fontes do estúdio nos textos por cima dos mimos
// (na lista `stickers`, com `kind: 'text'`), nas publicações só com texto (`textFont`) e na legenda do Zás (`captionFont`).
// Uma fonte desconhecida ou em falta lê-se como 'classica'.
// Correr em apps/mobile:  node --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const t = await import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'textLayers.ts')).href);
const fx = await import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'studio', 'effects.ts')).href);
const d = await import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'discardGuard.ts')).href);
const read = (...p) => readFileSync(path.join(ROOT, 'src', ...p), 'utf8').replace(/\r\n/g, '\n');

// ---------------------------------------------------------------- fontes

test('as fontes são as 10 do estúdio, pela mesma ordem e com o mesmo acerto de tamanho', () => {
  assert.deepEqual([...t.TEXT_FONT_IDS], fx.FONTS.map((f) => f.id));
  for (const f of fx.FONTS) assert.equal(t.TEXT_FONT_K[f.id], f.k, f.id);
  assert.equal(t.DEFAULT_TEXT_FONT, 'classica');
});

test('fonte desconhecida, vazia ou em falta: clássica', () => {
  assert.equal(t.normTextFont('cartaz'), 'cartaz');
  for (const v of [undefined, null, '', 'comic-sans', 'CARTAZ', 3, {}]) assert.equal(t.normTextFont(v), 'classica', String(v));
  assert.equal(t.isTextFont('futuro'), true);
  assert.equal(t.isTextFont('x'), false);
});

test('a clássica não precisa de ir ao servidor; as outras vão', () => {
  assert.equal(t.fontToSend('classica'), undefined);
  assert.equal(t.fontToSend('nada'), undefined);
  assert.equal(t.fontToSend(null), undefined);
  assert.equal(t.fontToSend('grito'), 'grito');
});

test('publicação só com texto: as fontes de cartaz e a «À mão» acertam o tamanho, as outras ficam perto do normal', () => {
  const base = t.postFontSize('classica');
  assert.equal(base.fontSize, 19);
  assert.ok(t.postFontSize('cartaz').fontSize > base.fontSize, 'a Bebas é estreita: maior');
  assert.ok(t.postFontSize('futuro').fontSize < base.fontSize, 'a Orbitron é larga: menor');
  assert.equal(t.postFontSize('desconhecida').fontSize, 19);
  for (const id of t.TEXT_FONT_IDS) {
    const s = t.postFontSize(id);
    assert.ok(s.fontSize >= 16 && s.fontSize <= 26, `${id}: ${s.fontSize}`);
    assert.ok(s.lineHeight >= s.fontSize * 1.4, `${id}: entrelinha`);
  }
});

// ---------------------------------------------------------------- textos dos mimos

test('contraste do fundo cheio (como o servidor): letra escura em cores claras, branca em escuras', () => {
  assert.equal(t.contrastOn('#ffffff'), '#111111');
  assert.equal(t.contrastOn('#ffd60a'), '#111111');
  assert.equal(t.contrastOn('#3ddc97'), '#111111');
  assert.equal(t.contrastOn('#2ec5ff'), '#111111');
  assert.equal(t.contrastOn('#111111'), '#ffffff');
  assert.equal(t.contrastOn('#7a5cff'), '#ffffff');
  assert.equal(t.contrastOn('#d6334f'), '#ffffff');
  assert.equal(t.contrastOn('#ff4fd8'), '#ffffff');
  assert.equal(t.contrastOn('lixo'), '#111111');
});

test('cores de cada fundo: nenhum, cheio (caixa na cor) e suave (vidro escuro, letra na cor)', () => {
  assert.deepEqual(t.layerColors({ color: '#ff8a5c', bg: 'none' }), { fg: '#ff8a5c', box: null });
  assert.deepEqual(t.layerColors({ color: '#ffd60a', bg: 'solid' }), { fg: '#111111', box: '#ffd60a' });
  assert.deepEqual(t.layerColors({ color: '#111111', bg: 'solid' }), { fg: '#ffffff', box: '#111111' });
  assert.deepEqual(t.layerColors({ color: '#2ec5ff', bg: 'soft' }), { fg: '#2ec5ff', box: 'rgba(0,0,0,0.5)' });
  assert.equal(t.layerColors({ color: 'vermelho', bg: 'none' }).fg, '#ffffff');
});

test('os botões do fundo e do alinhamento andam à roda', () => {
  assert.equal(t.nextBg('none'), 'solid');
  assert.equal(t.nextBg('solid'), 'soft');
  assert.equal(t.nextBg('soft'), 'none');
  assert.equal(t.nextAlign('center'), 'left');
  assert.equal(t.nextAlign('left'), 'right');
  assert.equal(t.nextAlign('right'), 'center');
});

test('ao escrever: no máximo 150 letras e 6 linhas', () => {
  assert.equal(t.clampLayerText('a'.repeat(200)).length, 150);
  const seven = ['1', '2', '3', '4', '5', '6', '7'].join('\n');
  assert.equal(t.clampLayerText(seven).split('\n').length, 6);
  assert.equal(t.clampLayerText(seven).split('\n')[5], '6 7');
  assert.equal(t.clampLayerText('a\r\nb'), 'a\nb');
  // Emojis contam como uma letra (não se cortam a meio).
  assert.equal(Array.from(t.clampLayerText('😀'.repeat(160))).length, 150);
});

test('ao pousar: linhas compridas partem-se pelos espaços, sem passar das 6 linhas', () => {
  assert.equal(t.wrapLayerText('   '), '');
  assert.equal(t.wrapLayerText('\n\n olá \n\n'), 'olá');
  assert.equal(t.wrapLayerText('bom dia'), 'bom dia');
  const w = t.wrapLayerText('hoje é sexta e a malta vai toda à praia da Costa do Sol beber uma gelada');
  for (const l of w.split('\n')) assert.ok(Array.from(l).length <= t.TEXT_WRAP, l);
  assert.equal(w.replace(/\n/g, ' '), 'hoje é sexta e a malta vai toda à praia da Costa do Sol beber uma gelada');
  // Muito texto: as linhas alargam para caber em 6.
  const long = Array.from({ length: 30 }, (_, i) => `pal${i}`).join(' ');
  const lw = t.wrapLayerText(long);
  assert.ok(lw.split('\n').length <= t.TEXT_MAX_LINES);
  assert.ok(lw.length <= t.TEXT_MAX_CHARS);
  // As quebras de linha de quem escreve ficam.
  assert.equal(t.wrapLayerText('um\ndois'), 'um\ndois');
  // Uma palavra enorme parte-se a meio.
  assert.ok(t.wrapLayerText('x'.repeat(40)).split('\n').every((l) => l.length <= t.TEXT_WRAP));
});

test('ao pousar: o que vai ao servidor passa sempre na validação (150 carateres com os \\n, sem carateres de controlo)', () => {
  // 150 letras sem espaços: partir a meio junta \n, que o servidor também conta.
  for (const raw of ['x'.repeat(150), `${'a'.repeat(149)} b`, Array.from({ length: 75 }, () => 'ab').join('')]) {
    const out = t.wrapLayerText(raw);
    assert.ok(Array.from(out).length <= t.TEXT_MAX_CHARS, `${Array.from(out).length}`);
    assert.ok(out.split('\n').length <= t.TEXT_MAX_LINES);
  }
  const ctl = t.wrapLayerText('olá\u0007 malta\u2028\u0000fim');
  assert.ok(!/[\u0000-\u0009\u000B-\u001F\u007F-\u009F\u2028\u2029]/.test(ctl), JSON.stringify(ctl));
  assert.equal(ctl, 'olá malta fim');
});

test('um texto novo e as medidas: a caixa toda com s × largura (como os stickers e o servidor)', () => {
  const n = t.newTextLayer({ text: 'oi' });
  assert.deepEqual(Object.keys(n).sort(), ['align', 'bg', 'color', 'font', 'kind', 'r', 's', 'text', 'x', 'y']);
  assert.equal(n.kind, 'text');
  assert.equal(n.font, 'classica');
  // A linha mais comprida mede 300 px à letra de referência (100 px).
  const l = { text: 'uma\nduas', bg: 'none', s: 0.5 };
  const a = t.textLayout(l, 300, 400);
  const b = t.textLayout(l, 300, 800);
  assert.ok(Math.abs(a.w - 200) < 1e-9, 'a caixa tem s × largura');
  assert.ok(Math.abs(b.w / a.w - 2) < 1e-9 && Math.abs(b.fontPx / a.fontPx - 2) < 1e-9, 'o mesmo tamanho relativo em qualquer ecrã');
  // Sem fundo: margens de 0,12 e 0,06 da letra; 2 linhas de 1,22.
  const natW = 300 + 2 * 12, k = 200 / natW;
  assert.ok(Math.abs(a.fontPx - 100 * k) < 1e-9);
  assert.ok(Math.abs(a.h - (2 * 122 + 2 * 6) * k) < 1e-9);
  assert.equal(a.radius, 0, 'sem fundo, sem cantos');
  // Com fundo: margens maiores e cantos de 0,3 da letra.
  const boxed = t.textLayout({ ...l, bg: 'solid' }, 300, 400);
  assert.ok(Math.abs(boxed.w - 200) < 1e-9);
  assert.ok(Math.abs(boxed.padX / boxed.fontPx - 0.4) < 1e-9 && Math.abs(boxed.radius / boxed.fontPx - 0.3) < 1e-9);
  // Uma letra só: a caixa não fica mais estreita do que 0,6 da letra.
  assert.ok(Math.abs(t.textLayout({ text: 'i', bg: 'none', s: 0.5 }, 10, 400).contentW / t.textLayout({ text: 'i', bg: 'none', s: 0.5 }, 10, 400).fontPx - 0.6) < 1e-9);
});

test('ao pousar e ao reescrever, o s acerta-se para a letra ficar do mesmo tamanho', () => {
  const l = { text: 'olá malta', bg: 'none' };
  const s = t.sForFontPx(l, 400, 30, 400);
  assert.ok(Math.abs(t.textLayout({ ...l, s }, 400, 400).fontPx - 30) < 1e-9);
  // Texto mais comprido com a mesma letra: caixa mais larga.
  assert.ok(t.sForFontPx(l, 800, 30, 400) > s);
  // Dentro dos limites do servidor.
  assert.equal(t.sForFontPx(l, 100000, 200, 400), t.TEXT_S.max);
  assert.equal(t.sForFontPx(l, 1, 1, 4000), t.TEXT_S.min);
  assert.equal(t.sForFontPx(l, 100, 30, 0), t.TEXT_S.def);
  // A letra de um texto novo segue a largura do ecrã e o acerto da fonte.
  assert.equal(t.newTextPx('classica', 400), 30);
  assert.ok(t.newTextPx('cartaz', 400) > t.newTextPx('classica', 400));
});

test('textos vindos do servidor: limpos para desenhar; stickers e lixo ficam de fora', () => {
  assert.equal(t.normTextLayer({ id: 'fire', x: 0.5, y: 0.5, s: 0.3, r: 0 }), null, 'sticker de emoji (sem kind)');
  assert.equal(t.normTextLayer({ kind: 'text', text: '   ' }), null);
  assert.equal(t.normTextLayer(null), null);
  const l = t.normTextLayer({ kind: 'text', text: 'Bora!', font: 'inventada', color: 'azul', bg: 'neon', align: 'meio', x: 9, y: 'a', s: 5, r: 10 });
  assert.equal(t.TEXT_S.max, 1.6);
  assert.deepEqual(l, { kind: 'text', text: 'Bora!', font: 'classica', color: '#ffffff', bg: 'none', align: 'center', x: 1.5, y: 0.5, s: t.TEXT_S.max, r: 10 });
  const ok = t.normTextLayer({ kind: 'text', text: 'a\nb', font: 'praia', color: '#FFD60A', bg: 'solid', align: 'right', x: 0.2, y: 0.7, s: 0.1, r: -15 });
  assert.equal(ok.font, 'praia');
  assert.equal(ok.color, '#ffd60a');
  assert.equal(ok.bg, 'solid');
  assert.equal(ok.align, 'right');
});

test('contar stickers e textos (limites à parte: 12 stickers, 10 textos) e as fontes a carregar', () => {
  const list = [{ id: 'a', x: 0, y: 0, s: 0.3, r: 0 }, t.newTextLayer({ text: 'x', font: 'grito' }), t.newTextLayer({ text: 'y', font: 'grito' }), t.newTextLayer({ text: 'z' })];
  assert.deepEqual(t.countLayers(list), { stickers: 1, texts: 3 });
  assert.deepEqual(t.countLayers(null), { stickers: 0, texts: 0 });
  assert.deepEqual(t.layerFonts(list).sort(), ['classica', 'grito']);
  assert.equal(t.MAX_TEXT_LAYERS, 10);
  assert.equal(t.TEXT_MAX_CHARS, 150);
  assert.equal(t.TEXT_MAX_LINES, 6);
  assert.ok(t.TEXT_S.min >= 0.05 && t.TEXT_S.max <= 1.6, 'os limites do servidor para s (como nos stickers)');
});

test('«Tirar outra» também pergunta quando só há textos', () => {
  assert.equal(d.mimoEdited({ caption: '', stickers: 0, texts: 1, music: false }), true);
  assert.equal(d.mimoEdited({ caption: '', stickers: 0, texts: 0, music: false }), false);
  assert.match(d.discardCopy('retake').message, /textos/);
});

// ---------------------------------------------------------------- ligação nos ecrãs

test('editor do mimo: «Aa» abre o texto, Feito pousa, tocar reescreve, e vai tudo em `stickers`', () => {
  const src = read('app', 'stories', 'new.tsx');
  assert.match(src, /accessibilityLabel=\{t\('Texto'\)\}/);
  assert.match(src, />\{t\('Aa'\)\}</);
  assert.match(src, /<TextLayerEditor initial=\{textEdit\.layer\} boxW=\{frame\.w\} onDone=\{textDone\} \/>/);
  assert.match(src, /onEdit=\{editText\} hidden=\{textEdit\?\.index \?\? null\}/);
  assert.match(src, /counts\.texts >= MAX_TEXT_LAYERS/);
  assert.match(src, /mimoEdited\(\{ caption, stickers: counts\.stickers, texts: counts\.texts/);
  assert.match(src, /overlayOpen = [^;]*!!textEdit/);
  assert.match(src, /musicApi\.createStory\(id, text, who, track, placed\)/);
});

test('o visor desenha os textos com o mesmo tamanho relativo (StickerLayer), e o editor mexe-lhes como aos stickers', () => {
  const src = read('components', 'Stickers.tsx');
  assert.match(src, /isTextLayer\(p\)[\s\S]*normTextLayer\(p\)[\s\S]*<TextLayerView key=\{`t-\$\{i\}`\} layer=\{t\} width=\{width\} height=\{height\} \/>/);
  assert.match(src, /useTextFonts\(layerFonts\(stickers\)\)/);
  assert.match(src, /onTap=\{onEdit \? \(\) => onEdit\(i\) : undefined\}/);
  assert.match(src, /const TEXT_RANGE[^\n]*TEXT_S\.min, TEXT_S\.max/);
  // A caixa mede-se à letra de referência (escondida, sem fazer a página rolar) e o texto leva folga para não se partir.
  const tl = read('components', 'TextLayers.tsx');
  assert.match(tl, /fontSize: TEXT_BASE_PX/);
  assert.match(tl, /measure: \{ position: 'absolute', left: 0, top: 0, width: 0, height: 0, overflow: 'hidden'/);
  assert.match(tl, /const slack = /);
  assert.match(tl, /sForFontPx\(next, tw, px, boxW\)/);
  assert.match(tl, /wrapLayerText\(l\.text\)/);
  assert.match(tl, /accessibilityLabel="Feito"/);
});

test('fontes no telemóvel: só a família (sem peso, que no Android inventa negrito); na web só ficheiros do próprio site', () => {
  const nat = read('lib', 'textFonts.ts');
  assert.match(nat, /\{ fontFamily: f\.family \}/);
  assert.doesNotMatch(nat, /fontWeight\s*:/);
  const web = read('lib', 'textFonts.web.ts');
  assert.match(web, /ensureFont/);
  assert.doesNotMatch(web, /https?:\/\//);
  assert.doesNotMatch(read('lib', 'studio', 'renderFonts.ts'), /https?:\/\//);
  for (const f of fx.FONTS) assert.match(f.file, /^\/fonts\/estudio\/[a-z]+\.woff2$/, f.id);
  // Sem a fonte carregada: a do sistema (null), nunca uma família que não existe.
  assert.match(nat, /\? \{ fontFamily: f\.family \} : null/);
});

test('a fila das letras: cada uma no seu nome e na sua letra, botões de 44 px', () => {
  const src = read('components', 'FontChips.tsx');
  assert.match(src, /height: 44/);
  assert.match(src, /accessibilityLabel=\{`Letra \$\{f\.name\}`\}/);
  assert.match(src, /useTextFontStyle\(id\)/);
  assert.match(src, /accessibilityRole="tab"/);
});

test('publicação só com texto: escolhe-se a letra, vai `textFont`, desenha-se nela e muda-se ao editar', () => {
  const nw = read('app', '(tabs)', 'new.tsx');
  assert.match(nw, /textOnly \? <FontChips value=\{textFont\}/);
  assert.match(nw, /assets\.length === 0 && fontToSend\(textFont\) \? \{ textFont \} : \{\}/);
  assert.match(read('lib', 'api.compose.ts'), /textFont\?: string \}\) =>/);
  const card = read('components', 'PostCard.tsx');
  assert.match(card, /export function postBodyFont/);
  assert.match(card, /customFont=\{!!bodyFont\}/);
  const sheets = read('components', 'PostSheets.tsx');
  assert.match(sheets, /api\.updatePost\(post\.id, \{ body: draft, \.\.\.\(textOnly \? \{ textFont: draftFont \} : \{\}\) \}\)/);
  assert.match(read('lib', 'api.ts'), /textFont\?: string \| null;/);
});

test('Zás: a letra da legenda escolhe-se no estúdio (app e site), vai `captionFont` e vê-se no visor', () => {
  const inst = read('components', 'Instants.tsx');
  assert.match(inst, /instantsApi\.create\(mediaId, text, who, font\)/);
  assert.match(inst, /captionFont=\{it\.captionFont\}/);
  assert.match(inst, /<FontChips value=\{captionFont\} onChange=\{pickFont\} dark/);
  assert.match(read('components', 'zas', 'WebZasStudio.tsx'), /<FontChips value=\{captionFont\} onChange=\{onCaptionFont\} dark/);
  assert.match(read('components', 'zas', 'ZasDeckCard.tsx'), /font=\{captionFont\}/);
  assert.match(read('components', 'zas', 'CurvedCaption.tsx'), /useTextFontStyle\(fid === DEFAULT_TEXT_FONT \? null : fid\)/);
  assert.match(read('lib', 'api.geleira.ts'), /captionFont \? \{ captionFont \} : \{\}/);
});
