// As barras das conversas em ecrãs estreitos (src/lib/chatBars.ts): a 320 px o «Mensagem…» partia em duas linhas e o
// nome no cabeçalho ficava só «Z». Os ícones da barra de escrever encolhem (e a galeria passa para o «+»), os botões do
// cabeçalho ficam com 40 e, a 360 px ou menos, o Mixar e a videochamada passam para o menu «⋯».
// Correr em apps/mobile:  node --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const b = await import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'chatBars.ts')).href);
const read = (f) => readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');

// O que sobra para o campo: a pílula (bordas 3, margem 8), a câmara (40), os ícones e os 2 espaços de 2 px.
const room = (pillW) => { const f = b.composerTools(pillW); return pillW - 11 - 40 - f.toolW * (f.gallery ? 4 : 3) - 4; };

test('a barra de escrever: o campo tem sempre lugar para «Mensagem…» numa linha (pelo menos 104 px)', () => {
  for (const screen of [320, 340, 360, 375, 390, 414, 430]) assert.ok(room(screen - 20) >= 104, screen + ' px: ' + room(screen - 20));
  assert.deepEqual(b.composerTools(300), { toolW: 40, gallery: false });
  assert.deepEqual(b.composerTools(355), { toolW: 40, gallery: true });
  assert.deepEqual(b.composerTools(800), { toolW: 44, gallery: true });
  assert.deepEqual(b.composerTools(0), { toolW: 44, gallery: true }, 'antes de medir');
});

test('a galeria que sai da barra fica no menu «+» (conversa a dois) e nos anexos (TxillGroups)', () => {
  const one = read('src/components/ChatComposer.tsx');
  assert.match(one, /\{fit\.gallery \? <Tool w=\{fit\.toolW\} icon="image"/);
  assert.match(one, /onLibrary=\{\(\) => void pick\('library'\)\}/);
  const g = read('src/components/GroupComposer.tsx');
  assert.match(g, /\{fit\.gallery \? <Tool w=\{fit\.toolW\} icon="image"/);
  assert.match(g, /\{!fit\.gallery && \(\s*<Pressable onPress=\{\(\) => \{ setPanel\(null\); void pick\('library'\); \}\}/);
  assert.match(g, /<Text style=\{styles\.attachLabel\}>Galeria<\/Text>/);
  // Os quatro anexos (com a Galeria) cabem a 320 px: encolhem em vez de terem 84 fixos.
  assert.match(g, /attachItem: \{ flexBasis: 84, flexShrink: 1, minWidth: 0,/);
});

test('o cabeçalho: botões de 40 com o toque até 44, e a 360 px ou menos o Mixar e a videochamada vão para o «⋯»', () => {
  assert.equal(b.HEADER_ACTION_W, 40);
  assert.equal(b.headerInMenu(320), true);
  assert.equal(b.headerInMenu(360), true);
  assert.equal(b.headerInMenu(375), false);
  assert.equal(b.headerInMenu(390), false);
  assert.equal(b.headerInMenu(0), false);
  const h = read('src/components/ChatHeader.tsx');
  assert.match(h, /style=\{\(\{ pressed \}\) => \[st\.act,/);
  assert.match(h, /hitSlop=\{\{ top: 0, bottom: 0, left: \(44 - HEADER_ACTION_W\) \/ 2, right: \(44 - HEADER_ACTION_W\) \/ 2 \}\}/);
  assert.match(h, /\{actions \? <View style=\{st\.actions\}>\{actions\}<\/View> : null\}/);
  const t = read('src/app/messages/[username].tsx');
  assert.match(t, /const inMenu = headerInMenu\(useWindowDimensions\(\)\.width\);/);
  assert.match(t, /\{!inMenu \? <HeaderButton label=\{t\('Videochamada a \{displayName\}'/);
  assert.match(t, /\{ icon: 'video' as const, label: t\('Videochamada'\), onPress: \(\) => call\(true\) \}/);
  assert.match(t, /\{ icon: 'mixar' as const, label: 'Mixar',/);
});
