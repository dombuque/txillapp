// O teclado nas conversas (src/lib/chatKeyboard.ts e components/ChatScreen): com o teclado aberto a barra de escrever
// fica colada a ele (a margem do sistema ficava por cima do teclado, um vão branco), e no PWA do iPhone a conversa
// ocupa só a zona visível (o Safari arrastava a página e o cabeçalho saía do ecrã).
// Correr em apps/mobile:  node --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const k = await import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'chatKeyboard.ts')).href);
const read = (f) => readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');

test('web: teclado aberto só quando a zona visível é bem mais baixa do que a janela', () => {
  assert.equal(k.webKeyboardOpen(400, 800), true);
  assert.equal(k.webKeyboardOpen(760, 800), false, 'a barra do Safari a esconder-se não é o teclado');
  assert.equal(k.webKeyboardOpen(800 - k.KEYBOARD_MIN_PX, 800), false);
  assert.equal(k.webKeyboardOpen(0, 800), false);
  assert.equal(k.webKeyboardOpen(400, 0), false);
});

test('a margem de baixo da barra de escrever: a do sistema sem teclado, nenhuma com ele', () => {
  assert.equal(k.composerInset(34, false), 34);
  assert.equal(k.composerInset(34, true), 0);
  assert.equal(k.composerInset(21.6, true), 0);
});

test('as duas conversas usam o ChatScreen e a margem sem teclado na barra de escrever e na de editar', () => {
  for (const f of ['src/app/messages/[username].tsx', 'src/app/messages/g/[id].tsx']) {
    const s = read(f);
    assert.doesNotMatch(s, /KeyboardAvoidingView/, f);
    assert.match(s, /<ChatScreen style=\{\{ flex: 1, backgroundColor: colors\.white, paddingTop: insets\.top \}\}>/, f);
    assert.match(s, /const composerBottom = useComposerBottom\(insets\.bottom\);/, f);
    assert.match(s, /<ChatEditBar[\s\S]*?bottom=\{composerBottom\}/, f);
    assert.match(s, /Composer [^\n]*bottom=\{composerBottom\}/, f);
  }
  const screen = read('src/components/ChatScreen.tsx');
  assert.match(screen, /<KeyboardAvoidingView style=\{style\} behavior="padding">/);
  assert.match(screen, /position: 'absolute', left: 0, right: 0, top: pinnedTop\(vv\.top, parentTop\), height: vv\.height/);
});

test('iPhone: a conversa presa à zona visível desconta a página deslocada pelo Safari (sem faixa branca por cima do teclado)', () => {
  // Página no topo: fica no offsetTop, como antes.
  assert.equal(k.pinnedTop(0, 0), 0);
  assert.equal(k.pinnedTop(300, 0), 300);
  // O Safari deslocou a página 70 px e ignorou o scrollTo(0, 0): o ecrã está 70 px acima, a conversa desce 70 px.
  assert.equal(k.pinnedTop(0, -70), 70);
  assert.equal(k.pinnedTop(12.4, -70.2), 83);
  // A barra de escrever fica colada ao teclado: o fundo da conversa é o fundo da zona visível.
  const vv = { top: 0, height: 464 };
  const parentTop = -70;
  assert.equal(parentTop + k.pinnedTop(vv.top, parentTop) + vv.height, vv.top + vv.height);
  const screen = read('src/components/ChatScreen.tsx');
  assert.match(screen, /box\.current\?\.parentElement/);
  assert.match(screen, /getBoundingClientRect\(\)\.top/);
  assert.match(screen, /window\.addEventListener\('scroll', fix\)/);
});

test('teclado aberto: a janela de referência não encolhe com ele, e o zoom não conta como teclado', () => {
  // Se o innerHeight também encolher com o teclado, conta a altura do documento.
  assert.equal(k.webWindowHeight(464, 844), 844);
  assert.equal(k.webWindowHeight(844, 844), 844);
  assert.equal(k.webWindowHeight(0, 0), 0);
  assert.equal(k.webKeyboardOpen(464, k.webWindowHeight(464, 844)), true);
  assert.equal(k.webKeyboardOpen(400, 800, 2), false, 'página ampliada não é o teclado');
  assert.equal(k.webKeyboardOpen(400, 800, 1), true);
  const screen = read('src/components/ChatScreen.tsx');
  assert.match(screen, /webWindowHeight\(window\.innerHeight, document\.documentElement\?\.clientHeight \?\? 0\)/);
  assert.equal((screen.match(/webKeyboardOpen\([^)]*winH\(\), [a-z]+\.scale\)/g) || []).length, 2, 'as duas contas (barra e conversa) usam a mesma janela');
  assert.doesNotMatch(screen, /webKeyboardOpen\([^)]*window\.innerHeight\)/);
});

test('imagem colada: a legenda só ganha o cursor sozinha no computador (no iPhone o teclado tapava o Enviar)', () => {
  const s = read('src/components/PastedImageSheet.tsx');
  assert.match(s, /const FOCUS_CAPTION = Platform\.OS === 'web' && typeof window !== 'undefined' && !!window\.matchMedia\?\.\('\(pointer: fine\)'\)\.matches;/);
  assert.match(s, /autoFocus=\{FOCUS_CAPTION\}/);
  assert.doesNotMatch(s, /\n\s+autoFocus\n/);
});
