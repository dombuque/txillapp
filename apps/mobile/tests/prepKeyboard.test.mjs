// O preparar da Txillada com o teclado aberto: o cartão não encolhe e o painel sobe para cima do teclado, a rolar por
// dentro, com o campo à vista (src/lib/prepKeyboard.ts, components/txillada/TxilladaPrep.tsx).
// Correr em apps/mobile:  node --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const l = await import(new URL('../src/lib/prepKeyboard.ts', import.meta.url).href);
const f = await import(new URL('../src/lib/storyFrame.ts', import.meta.url).href);
const read = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8').replace(/\r/g, '');

test('o tamanho do cartão fica parado enquanto se escreve (o teclado do iPhone encolhia o cartão para metade)', () => {
  const full = { w: 390, h: 844 };
  const kb = { w: 390, h: 492 };
  assert.deepEqual(l.stableScreen({ w: 0, h: 0 }, full, false), full, 'primeira medida');
  assert.deepEqual(l.stableScreen(full, kb, true), full, 'teclado aberto: fica o de antes');
  assert.deepEqual(l.stableScreen(full, kb, false), kb, 'sem escrever (a janela mudou mesmo)');
  assert.deepEqual(l.stableScreen(full, { w: 844, h: 300 }, true), { w: 844, h: 300 }, 'rodar muda sempre');
  // Antes: storyFrame com a altura da zona visível dava um cartão com metade da largura.
  const before = f.storyFrame({ w: 390, h: 492, top: 47, bottom: 34 });
  const after = f.storyFrame({ ...l.stableScreen(full, kb, true), top: 47, bottom: 34 });
  assert.ok(before.cardW < 230, `antes ${before.cardW}`);
  assert.equal(after.cardW, 390);
});

test('a zona visível: na web a do visualViewport; no telemóvel tira-se o teclado (só o que a janela não encolheu)', () => {
  assert.deepEqual(l.visibleArea({ web: true, vv: null, rootH: 844, screenH: 844, kb: 0 }), { top: 0, bottom: 844 });
  assert.deepEqual(l.visibleArea({ web: true, vv: { top: 0, height: 492 }, rootH: 844, screenH: 844, kb: 0 }), { top: 0, bottom: 492 });
  assert.deepEqual(l.visibleArea({ web: true, vv: { top: -4, height: 492 }, rootH: 844, screenH: 844, kb: 0 }), { top: 0, bottom: 488 });
  // Android no site: a página encolhe sozinha (o visualViewport é igual à janela).
  assert.deepEqual(l.visibleArea({ web: true, vv: null, rootH: 514, screenH: 844, kb: 0 }), { top: 0, bottom: 514 });
  // iPhone nativo: a janela não encolhe, o teclado tapa.
  assert.deepEqual(l.visibleArea({ web: false, vv: null, rootH: 844, screenH: 844, kb: 336 }), { top: 0, bottom: 508 });
  // Android nativo (adjustResize): a janela já encolheu com o teclado; não se tira outra vez.
  assert.deepEqual(l.visibleArea({ web: false, vv: null, rootH: 560, screenH: 860, kb: 300 }), { top: 0, bottom: 560 });
  assert.deepEqual(l.visibleArea({ web: false, vv: null, rootH: 700, screenH: 860, kb: 300 }), { top: 0, bottom: 560 }, 'encolheu só uma parte');
});

test('o painel: sem teclado no fundo do cartão; com teclado logo acima dele, sem passar para cima do cabeçalho', () => {
  const fr = f.storyFrame({ w: 390, h: 844, top: 47, bottom: 34 });
  const rest = l.prepPanel({ cardTop: fr.cardTop, cardH: fr.cardH, visTop: 0, visBottom: 844 });
  assert.equal(rest.bottom, 0);
  assert.equal(rest.maxHeight, fr.cardH - l.PREP_HEADER_H);
  const open = l.prepPanel({ cardTop: fr.cardTop, cardH: fr.cardH, visTop: 0, visBottom: 492 });
  assert.equal(fr.cardTop + fr.cardH - open.bottom, 492 - l.PREP_KB_GAP, 'o fundo do painel fica 8 px acima do teclado');
  assert.equal(fr.cardTop + fr.cardH - open.bottom - open.maxHeight, fr.cardTop + l.PREP_HEADER_H, 'o topo do painel fica por baixo do cabeçalho');
  assert.ok(open.maxHeight >= 280, `cabe o essencial (${open.maxHeight})`);
  // Ecrã muito baixo (320 x 568 com o teclado): nunca fica sem altura nenhuma (rola por dentro).
  const small = f.storyFrame({ w: 320, h: 568, top: 20, bottom: 0 });
  const tiny = l.prepPanel({ cardTop: small.cardTop, cardH: small.cardH, visTop: 0, visBottom: 216 });
  assert.ok(tiny.maxHeight >= 96);
  // A zona visível começa mais abaixo (o Safari arrastou a página): o painel começa abaixo dela.
  const low = l.prepPanel({ cardTop: 20, cardH: 700, visTop: 200, visBottom: 600 });
  assert.equal(720 - low.bottom - low.maxHeight, 208);
});

test('rolar só o que falta para o campo ficar à vista', () => {
  assert.equal(l.scrollToShow(100, 40, 0, 300), null, 'já se vê');
  assert.equal(l.scrollToShow(400, 40, 0, 300), 148, 'mais abaixo: o fundo do campo fica 8 px acima do fundo');
  assert.equal(l.scrollToShow(20, 40, 100, 300), 12, 'mais acima: o topo do campo fica 8 px abaixo do topo');
  assert.equal(l.scrollToShow(4, 40, 30, 300), 0, 'nunca abaixo de 0');
  assert.equal(l.scrollToShow(200, 400, 0, 300), 192, 'maior do que a janela: mostra-se o início');
  assert.equal(l.scrollToShow(200, 400, 192, 300), null);
  assert.equal(l.scrollToShow(100, 40, 0, 0), null, 'ainda sem medida');
});

test('o ecrã usa as contas: cartão parado, painel a rolar por cima do teclado, nomes dos tipos em duas linhas', () => {
  const s = read('components/txillada/TxilladaPrep.tsx');
  assert.match(s, /stableScreen\(still\.current, \{ w: root\.w \|\| width, h: rootH \}, writing\)/, 'medido no próprio ecrã (no computador, a coluna do meio)');
  assert.match(s, /storyFrame\(\{ w: still\.current\.w, h: still\.current\.h/);
  assert.match(s, /style=\{\[st\.bottom, \{ bottom: panel\.bottom, maxHeight: panel\.maxHeight \}\]\}/);
  assert.match(s, /keyboardShouldPersistTaps="handled"/);
  assert.doesNotMatch(s, /translateY: -lift/, 'o painel já não sobe às cegas por cima do cabeçalho');
  assert.match(s, /st\.kindLabel, narrow && st\.kindLabelNarrow[^>]*numberOfLines=\{2\}/);
  assert.match(s, /<Text style=\{st\.toggleSub\} numberOfLines=\{2\}>/);
  for (const name of ["onFocus={onFocus('title')}", "onFocus={onFocus('price')}", "onFocus={onFocus('fund')}"]) assert.ok(s.includes(name), name);
});
