// O teclado por cima de um visor em ecrã inteiro (mimos, Zás, tchekas), como no Instagram: o que está atrás fica do mesmo
// tamanho e só a barra de escrever sobe, colada ao teclado (src/lib/keyboardFrame.ts).
// Correr em apps/mobile:  node --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const k = await import(new URL('../src/lib/keyboardFrame.ts', import.meta.url).href);
const f = await import(new URL('../src/lib/storyFrame.ts', import.meta.url).href);
const read = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8').replace(/\r/g, '');

// iPhone 14 na app instalada (PWA): 390 × 797 sem o teclado; com ele a zona visível fica com 415.
const FULL = { w: 390, h: 797 };
const KB_VV = { top: 0, height: 415 };

test('o tamanho do visor fica parado com o teclado aberto (o mimo encolhia para um cartão pequeno ao meio)', () => {
  assert.deepEqual(k.heldSize({ w: 0, h: 0 }, FULL, true), FULL, 'primeira medida, mesmo a escrever');
  assert.deepEqual(k.heldSize(FULL, { w: 390, h: 415 }, true), FULL, 'teclado aberto: fica o de antes');
  assert.deepEqual(k.heldSize(FULL, { w: 390, h: 415 }, false), { w: 390, h: 415 }, 'sem teclado segue a medida');
  assert.deepEqual(k.heldSize(FULL, { w: 844, h: 300 }, true), { w: 844, h: 300 }, 'rodar muda sempre');
  assert.deepEqual(k.heldSize(FULL, { w: 390.5, h: 415 }, true), FULL, 'meio píxel de diferença não conta como rodar');
  // O defeito da captura: com a altura da zona visível o cartão ficava com menos de metade da largura.
  const before = f.storyFrame({ w: 390, h: 415, top: 0, bottom: 0 });
  const after = f.storyFrame({ ...k.heldSize(FULL, { w: 390, h: 415 }, true), top: 0, bottom: 0 });
  assert.ok(before.cardW < 200, `antes ${before.cardW}`);
  assert.equal(after.cardW, 390);
});

test('na web o teclado só conta com a zona visível bem mais baixa e sem zoom', () => {
  assert.equal(k.webKeyboardBox(null, 797, 390), null);
  assert.deepEqual(k.webKeyboardBox({ top: 0, height: 415, width: 390, scale: 1 }, 797, 390), { top: 0, height: 415 });
  assert.equal(k.webKeyboardBox({ top: 0, height: 740, width: 390, scale: 1 }, 797, 390), null, 'a barra do Safari não é o teclado');
  assert.equal(k.webKeyboardBox({ top: 80, height: 400, width: 195, scale: 2 }, 797, 390), null, 'página ampliada');
  assert.equal(k.webKeyboardBox({ top: 0, height: 400, width: 300, scale: 1 }, 797, 390), null, 'zona mais estreita');
  assert.deepEqual(k.webKeyboardBox({ top: -6, height: 415 }, 797), { top: 0, height: 415 }, 'o salto elástico do Safari');
});

test('quanto o teclado tapa: web (iPhone e Android), iPhone na app e Android na app', () => {
  // iPhone (web): a página não encolhe, a zona visível sim.
  assert.deepEqual(k.keyboardCover({ web: true, vv: KB_VV, rootH: 797, screenH: 797, kb: 0 }), { cover: 382, shift: 0 });
  // O iPhone deslocou a zona visível 60 px para cima: o visor desce 60 (fica no mesmo sítio) e o teclado tapa o mesmo.
  assert.deepEqual(k.keyboardCover({ web: true, vv: { top: 60, height: 415 }, rootH: 797, screenH: 797, kb: 0 }), { cover: 382, shift: 60 });
  // Android (web): a página encolhe sozinha e a zona visível é igual à janela (vv = null).
  assert.deepEqual(k.keyboardCover({ web: true, vv: null, rootH: 470, screenH: 797, kb: 0 }), { cover: 327, shift: 0 });
  // Sem teclado: nada.
  assert.deepEqual(k.keyboardCover({ web: true, vv: null, rootH: 797, screenH: 797, kb: 0 }), { cover: 0, shift: 0 });
  // iPhone (app): a janela não encolhe; conta a altura do teclado.
  assert.deepEqual(k.keyboardCover({ web: false, vv: null, rootH: 844, screenH: 844, kb: 336 }), { cover: 336, shift: 0 });
  // Android (app) com adjustResize: a janela encolheu com o teclado; não se soma duas vezes.
  assert.deepEqual(k.keyboardCover({ web: false, vv: null, rootH: 520, screenH: 844, kb: 300 }), { cover: 324, shift: 0 });
  assert.deepEqual(k.keyboardCover({ web: false, vv: null, rootH: 544, screenH: 844, kb: 300 }), { cover: 300, shift: 0 });
  // Android (app) sem a janela encolher (de ponta a ponta): só o teclado.
  assert.deepEqual(k.keyboardCover({ web: false, vv: null, rootH: 844, screenH: 844, kb: 300 }), { cover: 300, shift: 0 });
  // Ainda sem medida do ecrã: usa a altura sem o teclado.
  assert.deepEqual(k.keyboardCover({ web: true, vv: KB_VV, rootH: 0, screenH: 797, kb: 0 }), { cover: 382, shift: 0 });
});

test('a barra de responder fica colada ao teclado e volta ao lugar ao fechar', () => {
  const frame = f.storyFrame({ ...FULL, top: 0, bottom: 0 });
  const rest = FULL.h - (frame.barTop + frame.barH);
  assert.equal(k.barBottom(rest, 0), rest, 'sem teclado: o lugar de sempre');
  const cover = k.keyboardCover({ web: true, vv: KB_VV, rootH: 797, screenH: 797, kb: 0 }).cover;
  const b = k.barBottom(rest, cover);
  assert.equal(b, cover + k.KB_GAP, 'colada ao teclado');
  // O fundo da barra fica logo acima do teclado (dentro da zona visível) e o cartão continua inteiro, do mesmo tamanho.
  assert.equal(FULL.h - b, KB_VV.height - k.KB_GAP);
  assert.equal(frame.cardW, 390);
  // Nunca desce abaixo do lugar de sempre (teclado mais baixo do que a barra).
  assert.equal(k.barBottom(40, 10), 40);
});

test('o visor dos mimos usa estas contas e o mimo não encolhe com o teclado', () => {
  const src = read('app/stories/[username].tsx');
  assert.match(src, /heldSize\(still\.current/);
  assert.match(src, /keyboardCover\(/);
  assert.match(src, /barBottom\(restBottom/);
  assert.match(src, /storyFrame\(\{ w: stage\.w, h: stage\.h/);
  // Já não se mete o visor inteiro só na zona visível (era isso que encolhia o mimo).
  assert.doesNotMatch(src, /top: vv\.top, height: vv\.height/);
  // A escrever: pausado, mais escuro e um toque no mimo só fecha o teclado.
  assert.match(src, /storyPaused\(\{ held, typing/);
  assert.match(src, /typing && <Pressable style=\{\[StyleSheet\.absoluteFill, st\.dim\]\} onPress=\{dismiss\}/);
});

test('o visor dos Zás: a pilha não encolhe com o teclado e a resposta sobe para cima dele', () => {
  const src = read('components/Instants.tsx');
  assert.match(src, /heldSize\(/);
  assert.match(src, /keyboardCover\(/);
});
