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
  assert.match(screen, /position: 'absolute', left: 0, right: 0, top: vv\.top, height: vv\.height/);
});

test('imagem colada: a legenda só ganha o cursor sozinha no computador (no iPhone o teclado tapava o Enviar)', () => {
  const s = read('src/components/PastedImageSheet.tsx');
  assert.match(s, /const FOCUS_CAPTION = Platform\.OS === 'web' && typeof window !== 'undefined' && !!window\.matchMedia\?\.\('\(pointer: fine\)'\)\.matches;/);
  assert.match(s, /autoFocus=\{FOCUS_CAPTION\}/);
  assert.doesNotMatch(s, /\n\s+autoFocus\n/);
});
