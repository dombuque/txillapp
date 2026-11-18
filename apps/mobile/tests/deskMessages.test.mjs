// Mensagens no computador (duas colunas, como o WhatsApp Web): as larguras por ecrã, a fila das notas com setas, o painel
// sem conversa aberta (src/lib/deskMessages.ts, src/components/messages/DeskMessages.tsx), os atalhos (Esc fecha a
// conversa, ↑/↓ com a lista em foco; src/lib/deskChatKeys.ts) e, lendo o código, que no telemóvel fica tudo como estava.
// Correr em apps/mobile:  node --test tests/*.test.mjs
import { test } from 'node:test';
import './fixtures/alias.mjs';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const d = await import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'deskMessages.ts')).href);
const k = await import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'deskChatKeys.ts')).href);
const src = (p) => readFileSync(path.join(ROOT, 'src', ...p.split('/')), 'utf8').replace(/\r\n/g, '\n');
const key = (key, o = {}) => ({ key, ...o });

test('largura da lista: uma coluna abaixo de 900, 320 nos ecrãs médios, 360 a 420 nos largos', () => {
  assert.equal(d.msgListWidth(390), null, 'telemóvel: uma coluna');
  assert.equal(d.msgListWidth(899), null);
  assert.equal(d.msgListWidth(900), 320);
  assert.equal(d.msgListWidth(1024), 320);
  assert.equal(d.msgListWidth(1279), 320);
  assert.equal(d.msgListWidth(1280), 360);
  assert.equal(d.msgListWidth(1440), 384);
  assert.equal(d.msgListWidth(1600), 408);
  assert.equal(d.msgListWidth(1680), 420);
  assert.equal(d.msgListWidth(2560), 420, 'nunca passa de 420');
  assert.equal(d.msgListWidth(Number.NaN), null);
  for (let w = 1280; w <= 3000; w += 37) {
    const x = d.msgListWidth(w);
    assert.ok(x >= 360 && x <= 420, `${w} → ${x}`);
  }
});

test('a conversa aberta: mensagens a 640 e a barra de escrever a 760, centradas sem tirar o fundo do painel', () => {
  assert.equal(d.CHAT_COLUMN_MAX, 640);
  assert.ok(d.COMPOSER_MAX > d.CHAT_COLUMN_MAX);
  assert.equal(d.deskGutter(12, 640), 'max(12px, calc((100% - 640px) / 2))');
  const hook = src('lib/deskChat.ts');
  assert.match(hook, /export function useDeskColumn[\s\S]*if \(!desktop \|\| Platform\.OS !== 'web'\) return null;/, 'no telemóvel não mexe em nada');
  assert.match(src('components/ChatList.tsx'), /useDeskColumn\(CHAT_COLUMN_MAX, 12\)/);
  assert.match(src('components/ChatComposer.tsx'), /useDeskColumn\(COMPOSER_MAX\)/);
  assert.match(src('components/GroupComposer.tsx'), /useDeskColumn\(COMPOSER_MAX\)/);
  assert.match(src('components/ChatEditBar.tsx'), /useDeskColumn\(COMPOSER_MAX, 12\)/);
});

test('fila das notas: só notas inteiras na largura, setas ‹ › por páginas e sem passar das pontas', () => {
  const f = d.notesFit(380, 84, 16, 12);
  assert.equal(f.n, 3);
  assert.ok(Math.abs(16 * 2 + f.n * 84 + (f.n - 1) * f.gap - 380) < 1, 'enche a largura sem cortar a última');
  assert.equal(d.notesFit(320, 84, 16, 12).n, 3);
  assert.equal(d.notesFit(100, 84, 16, 12).n, 1, 'pelo menos uma');
  const step = f.n * (84 + f.gap);
  assert.equal(d.notesPage(0, 1, step, 1000), step);
  assert.equal(d.notesPage(step, -1, step, 1000), 0);
  assert.equal(d.notesPage(0, -1, step, 1000), 0, 'não passa do princípio');
  assert.equal(d.notesPage(900, 1, step, 1000), 1000, 'não passa do fim');
  assert.equal(d.notesPage(step + 7, 1, step, 1000), 2 * step, 'encosta a uma nota inteira');
  assert.deepEqual(d.notesArrows(0, 1000, 380), { left: false, right: true });
  assert.deepEqual(d.notesArrows(620, 1000, 380), { left: true, right: false });
  assert.deepEqual(d.notesArrows(0, 300, 380), { left: false, right: false }, 'cabem todas: sem setas');
  const notes = src('components/Notes.tsx');
  assert.match(notes, /const arrows = desktop \? notesArrows\(/, 'as setas só no computador');
  assert.match(notes, /accessibilityLabel=\{dir < 0 \? t\('Notas anteriores'\) : t\('Ver mais notas'\)\}/);
  assert.match(notes, /labelName: \{ marginTop: 0, width: 'auto' \}/, 'o selo fica colado ao nome (width: undefined não tirava os 100% na web)');
});

test('painel sem conversa aberta: as 6 mais recentes (sem pedidos), notas da malta e Nova mensagem', () => {
  const at = (m) => new Date(Date.UTC(2026, 10, 17, 12, m)).toISOString();
  const direct = [
    { username: 'ana', displayName: 'Ana', lastMessage: { at: at(1) }, unread: 0 },
    { username: 'rui', displayName: 'Rui', lastMessage: { at: at(9) }, unread: 2 },
    { username: 'pedido', displayName: 'Pedido', lastMessage: { at: at(30) }, unread: 1, request: true },
    ...Array.from({ length: 6 }, (_, i) => ({ username: `p${i}`, displayName: `P${i}`, lastMessage: { at: at(2 + i) }, unread: 0 })),
  ];
  const groups = [{ id: 'g1', name: 'Malta', lastMessage: { at: at(20) }, unread: 1 }];
  const r = d.recentChats(direct, groups, 6);
  assert.equal(r.length, 6);
  assert.deepEqual(r.slice(0, 2).map((x) => x.key), ['g:g1', 'd:rui'], 'da mais nova para a mais antiga, grupos juntos');
  assert.ok(!r.some((x) => x.key === 'd:pedido'), 'os pedidos ficam no separador deles');
  assert.equal(r[0].to, '/messages/g/g1');
  assert.equal(r[1].to, '/messages/rui');
  assert.deepEqual(d.recentChats(null, undefined), []);
  const home = src('components/messages/DeskMessages.tsx');
  assert.match(home, /recentChats\(direct\.data, groups\.data as TxillGroupSummary\[\] \| undefined, 6\)/);
  assert.match(home, /t\('As tuas mensagens'\)/);
  assert.match(home, /t\('Recentes'\)/);
  assert.match(home, /t\('Notas da malta'\)/);
  assert.match(home, /label=\{t\('Nova mensagem'\)\}/);
  assert.match(home, /<NameWithBadge name=\{r\.name\} who=\{r\.d\}/, 'selo nos cartões');
  assert.match(home, /<NameWithBadge name=\{n\.displayName\} who=\{n\}/, 'selo nas notas');
  assert.match(home, /msgListWidth\(width\) \?\? LIST_W_MEDIUM/, 'a coluna da lista com a largura do ecrã');
  assert.doesNotMatch(home, /em breve/i);
});

test('atalhos: Esc fecha a conversa só quando mais ninguém o usou; ↑/↓ mudam de conversa com a lista em foco', () => {
  const base = { open: true, handled: false, modal: false, typingText: false };
  assert.equal(k.escClosesChat(key('Escape'), base), true);
  assert.equal(k.escClosesChat(key('Escape'), { ...base, open: false }), false, 'sem conversa aberta não faz nada');
  assert.equal(k.escClosesChat(key('Escape'), { ...base, handled: true }), false, 'a caixa cancelou a resposta ou a edição');
  assert.equal(k.escClosesChat(key('Escape'), { ...base, modal: true }), false, 'uma folha ou um menu aberto fecha primeiro');
  assert.equal(k.escClosesChat(key('Escape'), { ...base, typingText: true }), false, 'não se perde o que se está a escrever');
  assert.equal(k.escClosesChat(key('Escape', { shiftKey: true }), base), false);
  assert.equal(k.escClosesChat(key('Escape', { isComposing: true }), base), false);
  assert.equal(k.escClosesChat(key('a'), base), false);
  assert.equal(k.inboxShortcut(key('ArrowDown'), { typing: false, listFocused: true }), 'next');
  assert.equal(k.inboxShortcut(key('ArrowUp'), { typing: false, listFocused: true }), 'prev');
  assert.equal(k.inboxShortcut(key('ArrowDown'), { typing: false }), null, 'fora da lista ↓ rola');
  assert.equal(k.inboxShortcut(key('ArrowDown'), { typing: true, listFocused: true }), null);
  assert.equal(k.inboxShortcut(key('ArrowDown', { shiftKey: true }), { typing: false, listFocused: true }), null);
  const help = k.shortcutHelp(false).map((s) => s.keys.join('+'));
  assert.ok(help.includes('↑+↓') && help.filter((x) => x === 'Esc').length === 2, 'a ajuda mostra as teclas novas');
  const inbox = src('app/(tabs)/messages.tsx');
  assert.match(inbox, /window\.addEventListener\('keydown', onEsc\);/, 'Esc em bolha (depois da caixa, da pesquisa e das folhas)');
  assert.match(inbox, /router\.navigate\('\/messages' as never\)/);
  const header = src('components/ChatHeader.tsx');
  assert.match(header, /accessibilityLabel=\{t\('Fechar a conversa \(Esc\)'\)\}/, 'a dica no tooltip do ×');
  assert.match(header, /\) : <BackButton fallback="\/messages" style=\{st\.btn\} \/>\}/, 'no telemóvel o ‹ de sempre');
});

test('lista no computador: cabeçalho, pesquisa, notas e separadores fixos; no telemóvel tudo dentro da lista como antes', () => {
  const inbox = src('app/(tabs)/messages.tsx');
  assert.match(inbox, /const cols = useDesktop\(\);/);
  assert.match(inbox, /const header = cols \? <View>\{below\}<\/View> : <View>\{topBar\}\{search\}\{notes\}\{mixarLine\}\{tabsBar\}\{below\}<\/View>;/);
  assert.match(inbox, /const fixed = cols \? <View style=\{styles\.deskFixed\}>\{topBar\}\{search\}\{notes\}\{mixarLine\}\{tabsBar\}<\/View> : null;/);
  assert.match(inbox, /\{fixed\}\n\s*<GestureDetector gesture=\{pagerPan\}>/);
  // As ações do cabeçalho no computador: chamadas, nova conversa e o menu, com as dicas (aria-label → tooltip).
  for (const label of ['Chamadas', 'Nova conversa ou TxillGroup', 'Mais opções das mensagens']) assert.ok(inbox.includes(`label={t('${label}')}`), label);
});
