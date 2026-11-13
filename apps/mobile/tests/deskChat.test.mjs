// Mensagens no computador (rato e teclado): as teclas e os atalhos (src/lib/deskChatKeys.ts), o menu de contexto da lista
// (src/lib/inboxMenu.ts, inboxDeskMenu) e, lendo o código, que no computador não há deslizar nem segurar com o rato e que
// no telemóvel fica tudo como estava (tudo isto só liga com useDeskChat: browser largo E rato).
// Correr em apps/mobile:  node --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const k = await import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'deskChatKeys.ts')).href);
const im = await import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'inboxMenu.ts')).href);
const src = (p) => readFileSync(path.join(ROOT, 'src', ...p.split('/')), 'utf8').replace(/\r\n/g, '\n');

const key = (key, o = {}) => ({ key, ...o });

test('caixa de escrever: Enter envia, Shift+Enter muda de linha, Esc cancela', () => {
  const ctx = { text: 'olá', canEditLast: true };
  assert.equal(k.composerKey(key('Enter'), ctx), 'send');
  assert.equal(k.composerKey(key('Enter', { shiftKey: true }), ctx), null, 'Shift+Enter fica com o browser (nova linha)');
  assert.equal(k.composerKey(key('Enter', { ctrlKey: true }), ctx), null);
  assert.equal(k.composerKey(key('Enter', { altKey: true }), ctx), null);
  assert.equal(k.composerKey(key('Escape'), ctx), 'cancel');
  assert.equal(k.composerKey(key('a'), ctx), null);
});

test('caixa de escrever: a compor um acento (IME) o Enter não envia', () => {
  assert.equal(k.composerKey(key('Enter', { isComposing: true }), { text: 'é', canEditLast: false }), null);
  assert.equal(k.composerKey(key('Process', { keyCode: 229 }), { text: '', canEditLast: true }), null);
});

test('caixa de escrever: ↑ só edita a última com a caixa vazia e se der para editar', () => {
  assert.equal(k.composerKey(key('ArrowUp'), { text: '', canEditLast: true }), 'edit-last');
  assert.equal(k.composerKey(key('ArrowUp'), { text: 'a', canEditLast: true }), null, 'com texto, ↑ anda no texto');
  assert.equal(k.composerKey(key('ArrowUp'), { text: '', canEditLast: false }), null);
  assert.equal(k.composerKey(key('ArrowUp', { shiftKey: true }), { text: '', canEditLast: true }), null);
});

test('barra de editar: Enter grava, Shift+Enter muda de linha, Esc cancela', () => {
  assert.equal(k.editBarKey(key('Enter')), 'save');
  assert.equal(k.editBarKey(key('Enter', { shiftKey: true })), null);
  assert.equal(k.editBarKey(key('Escape')), 'cancel');
  assert.equal(k.editBarKey(key('Enter', { isComposing: true })), null);
});

test('atalhos: Ctrl/⌘+K procura, Alt+↑/↓ muda de conversa, ? mostra a ajuda (fora das caixas de texto)', () => {
  assert.equal(k.inboxShortcut(key('k', { ctrlKey: true }), { typing: true }), 'search', 'Ctrl+K funciona mesmo a escrever');
  assert.equal(k.inboxShortcut(key('K', { metaKey: true }), { typing: false }), 'search');
  assert.equal(k.inboxShortcut(key('k'), { typing: false }), null);
  assert.equal(k.inboxShortcut(key('k', { ctrlKey: true, shiftKey: true }), { typing: false }), null);
  assert.equal(k.inboxShortcut(key('ArrowUp', { altKey: true }), { typing: true }), 'prev');
  assert.equal(k.inboxShortcut(key('ArrowDown', { altKey: true }), { typing: false }), 'next');
  assert.equal(k.inboxShortcut(key('ArrowDown'), { typing: false }), null, 'sem Alt, ↓ rola a lista');
  assert.equal(k.inboxShortcut(key('ArrowDown', { altKey: true, ctrlKey: true }), { typing: false }), null);
  assert.equal(k.inboxShortcut(key('?', { shiftKey: true }), { typing: false }), 'help');
  assert.equal(k.inboxShortcut(key('?', { shiftKey: true }), { typing: true }), null, 'a escrever, "?" é um "?"');
});

test('conversa anterior/seguinte: pela ordem da lista, sem dar a volta', () => {
  const p = ['/messages/ana', '/messages/g/7', '/messages/rui'];
  assert.equal(k.neighbourChat(p, '/messages/ana', 1), '/messages/g/7');
  assert.equal(k.neighbourChat(p, '/messages/g/7', -1), '/messages/ana');
  assert.equal(k.neighbourChat(p, '/messages/rui', 1), null);
  assert.equal(k.neighbourChat(p, '/messages/ana', -1), null);
  assert.equal(k.neighbourChat(p, null, 1), '/messages/ana', 'sem conversa aberta, ↓ abre a primeira');
  assert.equal(k.neighbourChat(p, null, -1), '/messages/rui');
  assert.equal(k.neighbourChat(p, '/messages/outra', 1), '/messages/ana');
  assert.equal(k.neighbourChat([], null, 1), null);
});

test('a conversa aberta pelo endereço (a lista marca-a e os atalhos partem dela)', () => {
  assert.equal(k.openChatPath('/messages/ana'), '/messages/ana');
  assert.equal(k.openChatPath('/messages/g/123'), '/messages/g/123');
  assert.equal(k.openChatPath('/messages'), null);
  assert.equal(k.openChatPath('/messages/new'), null);
  assert.equal(k.openChatPath('/u/ana'), null);
});

test('↑ edita a minha última mensagem já enviada (não as a enviar, nem os avisos)', () => {
  const items = [
    { id: 'tmp-1', fromMe: true, kind: 'text' },
    { id: 's', fromMe: true, kind: 'system' },
    { id: 'f', fromMe: true, kind: 'text', state: 'failed' },
    { id: 'b', fromMe: false, kind: 'text' },
    { id: 'a', fromMe: true, kind: 'text' },
  ];
  assert.equal(k.lastMine(items).id, 'a');
  assert.equal(k.lastMine([{ id: 'x', fromMe: false, kind: 'text' }]), null);
});

test('o menu de contexto não sai da janela', () => {
  const win = { w: 1440, h: 900 };
  assert.deepEqual(k.menuPosition({ x: 100, y: 100 }, { w: 240, h: 300 }, win), { left: 100, top: 100 });
  assert.equal(k.menuPosition({ x: 1400, y: 100 }, { w: 240, h: 300 }, win).left, 1440 - 240 - 8, 'encosta à direita');
  assert.equal(k.menuPosition({ x: 100, y: 800 }, { w: 240, h: 300 }, win).top, 500, 'abre para cima junto ao fundo');
  const big = k.menuPosition({ x: 0, y: 0 }, { w: 240, h: 2000 }, win);
  assert.ok(big.top >= 8 && big.left >= 8);
});

test('zona de largar: só ficheiros, e só some quando o rato sai de vez', () => {
  assert.equal(k.dragHasFiles(['Files']), true);
  assert.equal(k.dragHasFiles(['text/plain', 'text/uri-list']), false);
  assert.equal(k.dragHasFiles(null), false);
  let d = 0;
  d = k.dragDepth(d, 'enter'); d = k.dragDepth(d, 'enter'); d = k.dragDepth(d, 'leave');
  assert.equal(d, 1, 'sair de um filho não esconde a zona');
  assert.equal(k.dragDepth(d, 'drop'), 0);
  assert.equal(k.dragDepth(0, 'leave'), 0);
});

test('a ajuda dos atalhos: Ctrl no Windows, ⌘ no Mac, e as teclas todas', () => {
  const pc = k.shortcutHelp(false).map((s) => s.keys.join('+'));
  assert.ok(pc.includes('Ctrl+K') && pc.includes('Alt+↑') && pc.includes('Alt+↓') && pc.includes('Enter') && pc.includes('Shift+Enter') && pc.includes('Esc') && pc.includes('?'));
  assert.ok(k.shortcutHelp(true).some((s) => s.keys.join('+') === '⌘+K'));
});

test('lista no computador: o menu de contexto (⋯ e botão direito) tem as ações de deslizar e as da conversa', () => {
  const chat = { group: false, unread: 0, username: 'ana', me: 'eu' };
  assert.deepEqual(im.inboxDeskMenu(chat), ['unread', 'profile', 'ttl', 'clear', 'delete']);
  assert.deepEqual(im.inboxDeskMenuItems(chat).map((i) => i.label), ['Marcar como por ler', 'Ver perfil', 'Mensagens temporárias', 'Limpar conversa', 'Apagar conversa']);
  assert.deepEqual(im.inboxDeskMenu({ ...chat, unread: 2 })[0], 'read');
  assert.ok(!im.inboxDeskMenu({ ...chat, request: true }).includes('ttl'), 'num pedido de mensagem não se mudam as temporárias');
  assert.deepEqual(im.inboxDeskMenu({ group: true, unread: 1, me: 'eu' }), ['read', 'info', 'leave']);
  assert.deepEqual(im.inboxDeskMenu({ group: false, unread: 0 }), []);
  assert.ok(im.inboxDeskMenuItems(chat).find((i) => i.id === 'delete').danger);
  assert.ok(!im.inboxDeskMenuItems(chat).some((i) => i.id === 'cancel'), 'sem "Cancelar": clicar fora ou Esc fecham');
});

test('no telemóvel a folha de segurar e o deslizar da lista não mudam', () => {
  const chat = { group: false, unread: 0, username: 'ana', me: 'eu' };
  assert.deepEqual(im.inboxMenu(chat), ['unread', 'profile', 'delete']);
  assert.deepEqual(im.inboxSwipe(chat), { left: ['unread'], right: ['delete'] });
});

test('computador = browser largo E rato (hover e ponteiro fino); num iPad ou telemóvel fica tudo como no telemóvel', () => {
  const d = src('lib/deskChat.ts');
  assert.match(d, /'\(hover: hover\) and \(pointer: fine\)'/);
  assert.match(d, /return desktop && fine;/);
  assert.match(d, /if \(!desk\) return undefined;/, 'as teclas da caixa não mudam no telemóvel');
});

test('lista no computador: sem deslizar; ⋯ ao passar o rato, botão direito e realce da linha', () => {
  const s = src('components/SwipeRow.tsx');
  const desk = s.slice(s.indexOf('if (desk) {'), s.indexOf("if (Platform.OS === 'web') return <WebSwipeRow"));
  assert.ok(desk.length > 0);
  assert.match(desk, /onContextMenu/);
  assert.match(desk, /accessibilityLabel="Mais opções"/);
  assert.match(desk, /onMouseEnter/);
  assert.match(desk, /st\.deskHover/);
  assert.doesNotMatch(desk, /<Buttons|WebSwipeRow|NativeSwipeRow|touchstart/, 'nada de deslizar no computador');
  assert.match(s, /const desk = useDeskChat\(\);/);
  // No telemóvel (web e app) continua o deslizar.
  assert.match(s, /if \(Platform\.OS === 'web'\) return <WebSwipeRow/);
  assert.match(s, /return <NativeSwipeRow/);
  const m = src('app/(tabs)/messages.tsx');
  assert.match(m, /onDeskMenu=\{hold \? \(at\) => setDeskMenu\(\{ key: r\.key, at \}\) : undefined\}/);
  assert.match(m, /<DeskMenu/);
  assert.match(m, /inboxDeskMenuItems\(menuRow\(deskRow\)\)/);
});

test('atalhos da lista: só no computador, em captura (também com o foco na caixa) e só a lista visível responde', () => {
  const m = src('app/(tabs)/messages.tsx');
  assert.match(m, /if \(!desk \|\| typeof window === 'undefined'\) return;/);
  assert.match(m, /window\.addEventListener\('keydown', onKey, true\)/);
  assert.match(m, /el\.offsetParent === null/);
  assert.match(m, /if \(document\.querySelector\('\[aria-modal="true"\]'\)\) return;/);
  assert.match(m, /key === 'Escape'\) \{ e\.preventDefault\(\); setText\(''\); searchRef\.current\?\.blur\(\);/, 'Esc sai da pesquisa');
});

test('bolhas no computador: sem segurar nem deslizar com o rato; Responder, Reagir e ⋯ ao passar o rato; botão direito', () => {
  const b = src('components/ChatBubbles.tsx');
  assert.match(b, /enabled=\{swipe && !desk\}/);
  assert.match(b, /onLongPress=\{real && !desk \? \(\) => onMenu\(m\) : undefined\}/);
  assert.match(b, /btn\('reply', 'Responder'/);
  assert.match(b, /btn\('heart', 'Reagir'/);
  assert.match(b, /btn\('more', 'Mais opções da mensagem'/);
  assert.match(b, /getSelection/, 'selecionar texto com o rato não conta como clique');
  const r = src('components/ReplySwipe.tsx');
  assert.match(r, /on\.current\.onMenu\(\{ x: e\.clientX, y: e\.clientY \}\)/, 'o botão direito abre no ponteiro');
  const p = src('components/ChatParts.tsx');
  assert.match(p, /if \(at && desk\) \{/);
  for (const l of ["'Responder'", "'Copiar'", "'Editar'", "'Apagar…'", "'Denunciar mensagem…'"]) assert.ok(p.includes(`label: ${l}`), `falta ${l} no menu de contexto`);
});

test('caixas de escrever: as teclas do computador nas duas barras e na de editar', () => {
  for (const f of ['components/ChatComposer.tsx', 'components/GroupComposer.tsx']) {
    const s = src(f);
    assert.match(s, /useComposerKeys\(\{/, f);
    // As teclas do @ (↑/↓/Enter/Esc na lista das menções) vêm primeiro; as da caixa só se o @ não as usou.
    assert.ok(s.includes('mention.inputProps.onKeyPress(e); if (!e.defaultPrevented) keys?.(e);'), f);
    assert.match(s, /useChatDrop\(paste\.drop\)/, f);
  }
  const e = src('components/ChatEditBar.tsx');
  assert.match(e, /const onKey = desk \?/);
  assert.match(e, /onKeyPress=\{onKey\}/);
  for (const f of ['app/messages/[username].tsx', 'app/messages/g/[id].tsx']) assert.match(src(f), /onEditLast=\{editLast \?/, f);
});

test('arrastar ficheiros: a zona de largar só no computador e esconde-se ao largar, mesmo na caixa', () => {
  const s = src('components/ChatScreen.tsx');
  assert.match(s, /if \(!desk \|\| !el/);
  assert.match(s, /el\.addEventListener\('drop', reset, true\)/);
  assert.match(s, /Larga aqui para enviar/);
});

test('scroll: os resultados de «Procurar na conversa» rolam; no computador uma folha alta rola em vez de ficar cortada', () => {
  const h = src('components/ChatHeader.tsx');
  const sheet = h.slice(h.indexOf('export function ChatSearchSheet'));
  assert.match(sheet, /<ScrollView style=\{\{ marginTop: 12, maxHeight: room/);
  const s = src('components/Sheet.tsx');
  // A variante de computador do Sheet (desktop-geral) já trata disto: fora da folha de baixo, o conteúdo rola.
  assert.match(s, /mode !== 'bottom' && !full \? <ScrollView style=\{styles\.deskScroll\}/);
});
