// Testes das «Conversas ocultas» (src/lib/chatHidden.ts) e de onde o ecrã as liga: o menu da linha (lib/inboxMenu),
// o "⋯" das Mensagens, o "⋯" dentro da conversa (a dois e TxillGroup), o ecrã próprio e as notificações discretas.
// Correr em apps/mobile:  node --experimental-strip-types --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const h = await import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'chatHidden.ts')).href);
const m = await import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'inboxMenu.ts')).href);
const k = await import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'deskChatKeys.ts')).href);
const read = (f) => readFileSync(path.join(ROOT, ...f.split('/')), 'utf8').replace(/\r\n/g, '\n');

test('os textos: o botão, a pergunta (diz onde fica e que o outro não sabe) e o ecrã', () => {
  assert.equal(h.hideLabel(false), 'Ocultar conversa');
  assert.equal(h.hideLabel(true), 'Mostrar outra vez');
  assert.equal(h.HIDDEN_TITLE, 'Conversas ocultas');
  assert.equal(h.HIDDEN_PATH, '/messages/escondidas');
  const a = h.hideAsk('Ana Lopes', false);
  assert.equal(a.title, 'Ocultar esta conversa?');
  assert.match(a.body, /A conversa com Ana Lopes sai da tua lista/);
  assert.match(a.body, /Mensagens → ⋯ → Conversas ocultas/);
  assert.match(a.body, /sem pré-visualização/);
  assert.match(a.body, /Ana não sabe\.$/);
  const g = h.hideAsk('Malta do Tofo', true);
  assert.equal(g.title, 'Esconder este TxillGroup?');
  assert.match(g.body, /^“Malta do Tofo” sai/);
  assert.match(g.body, /Os outros membros não sabem\.$/);
  assert.match(h.hideAsk('  ', false).body, /esta pessoa/);
});

test('hiddenRows: conversas e TxillGroups juntos, da mensagem mais recente para a mais antiga', () => {
  const rows = h.hiddenRows({
    conversations: [{ username: 'ana', lastMessage: { at: '2026-11-10T10:00:00Z' } }, { username: 'bia', lastMessage: { at: '2026-11-14T10:00:00Z' } }],
    groups: [{ id: 'g1', lastMessage: { at: '2026-11-12T10:00:00Z' } }],
  });
  assert.deepEqual(rows.map((r) => (r.kind === 'chat' ? r.c.username : r.g.id)), ['bia', 'g1', 'ana']);
  assert.deepEqual(h.hiddenRows(undefined), []);
  assert.deepEqual(h.hiddenRows({ conversations: [] }), []);
});

test('hiddenUnread: quantas escondidas têm por ler', () => {
  assert.equal(h.hiddenUnread({ conversations: [{ unread: 2 }, { unread: 0 }], groups: [{ unread: 1 }] }), 2);
  assert.equal(h.hiddenUnread(undefined), 0);
});

test('a chave das escondidas fica debaixo de chat-list (o tempo real e as listas põem-na em dia)', () => {
  assert.deepEqual(h.HIDDEN_QUERY_KEY, ['chat-list', 'hidden']);
  assert.deepEqual(h.HIDDEN_KEYS.map((x) => x[0]), ['chat-list', 'chat-groups', 'chat-unread']);
});

test('menu da linha: «Ocultar conversa» antes de limpar e apagar; num TxillGroup, antes de sair; nas escondidas, «Mostrar outra vez»', () => {
  const chat = { group: false, unread: 0, username: 'ana', me: 'eu' };
  assert.deepEqual(m.inboxDeskMenu(chat), ['unread', 'profile', 'ttl', 'hide', 'clear', 'delete']);
  assert.deepEqual(m.inboxDeskMenu({ ...chat, hidden: true }), ['unread', 'profile', 'ttl', 'unhide', 'clear', 'delete']);
  assert.deepEqual(m.inboxDeskMenu({ group: true, unread: 0, me: 'eu' }), ['info', 'hide', 'leave']);
  const item = m.inboxMenuItems(chat).find((i) => i.id === 'hide');
  assert.deepEqual(item, { id: 'hide', label: 'Ocultar conversa', icon: 'eye-off', danger: false });
  assert.equal(m.inboxMenuItems({ ...chat, hidden: true }).find((i) => i.id === 'unhide').label, 'Mostrar outra vez');
  // Conversa sem @ não tem menu nenhum.
  assert.deepEqual(m.inboxDeskMenu({ group: false, unread: 0 }), []);
});

test('o ícone «olho riscado» existe na biblioteca Tx', () => {
  const tx = read('src/icons/tx.ts');
  assert.match(tx, /"eye-off": \{/);
  assert.match(tx, /"eye": \{/);
});

test('o ecrã: rota própria, fora das conversas do computador; o "⋯" das Mensagens leva lá', () => {
  assert.ok(existsSync(path.join(ROOT, 'src', 'app', 'messages', 'escondidas.tsx')));
  assert.equal(k.openChatPath('/messages/escondidas'), null);
  assert.equal(k.openChatPath('/messages/ana'), '/messages/ana');
  const inbox = read('src/app/(tabs)/messages.tsx');
  assert.match(inbox, /accessibilityLabel="Mais opções das mensagens"/);
  assert.match(inbox, /label: HIDDEN_TITLE, onPress: \(\) => router\.push\(HIDDEN_PATH as never\)/);
  assert.match(inbox, /else if \(a === 'hide'\) hiding\.hide\(\{ username: u \}, r\.name\);/);
  assert.match(inbox, /if \(a === 'hide'\) hiding\.hide\(\{ groupId: r\.g\.id \}, r\.name\);/);
  const screen = read('src/app/messages/escondidas.tsx');
  assert.match(screen, /queryKey: HIDDEN_QUERY_KEY, queryFn: api\.chatHiddenList/);
  assert.match(screen, /hiding\.unhide\(\{ username: c\.username \}\)/);
  assert.match(screen, /hiding\.unhide\(\{ groupId: g\.id \}\)/);
  // O sítio previsto para o bloqueio extra (impressão digital / PIN), ainda sem nada.
  assert.match(screen, /function HiddenLock\(/);
  // 'escondidas' não pode ser o @ de ninguém (a rota ganharia à conversa).
  assert.match(read('../api/src/auth/reserved-usernames.ts'), /'escondidas'/);
});

test('o "⋯" dentro da conversa: esconder ou mostrar outra vez, a dois e no TxillGroup', () => {
  const direct = read('src/app/messages/[username].tsx');
  assert.match(direct, /label: hideLabel\(first\.hidden\)/);
  assert.match(direct, /hiding\.unhide\(\{ username \}\) : hiding\.hide\(\{ username \}, /);
  const group = read('src/app/messages/g/[id].tsx');
  assert.match(group, /label: hideLabel\(first\.group\.hidden\)/);
  assert.match(group, /hiding\.unhide\(\{ groupId: id \}\) : hiding\.hide\(\{ groupId: id \}, group\.name\)/);
});

test('notificações discretas: canal «discreto» no Android, sem som com a app aberta, silenciosas no browser', () => {
  const np = read('src/lib/nativePush.ts');
  assert.match(np, /setNotificationChannelAsync\('discreto', \{[\s\S]*?importance: Notifications\.AndroidImportance\.LOW,[\s\S]*?sound: null/);
  assert.match(np, /isQuiet\(n\.request\.content\.data\)\n\s+\? \{ shouldShowBanner: false, shouldShowList: true, shouldPlaySound: false/);
  const sw = read('public/push-sw.js');
  assert.match(sw, /const discreet = data\.quiet === '1'/);
  assert.match(sw, /silent: quiet \|\| discreet/);
  // O servidor usa o mesmo nome de canal e o mesmo sinal.
  const api = read('../api/src/chat/hidden-push.ts');
  assert.match(api, /HIDDEN_PUSH_CHANNEL = 'discreto'/);
  assert.match(api, /quiet: '1'/);
});
