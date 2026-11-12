// Testes das mensagens temporárias e do "Limpar conversa" (src/lib/chatTemporary.ts), e do que muda na linha do tempo
// (src/lib/chatTimeline.ts), nos vistos (src/lib/chatLayout.ts) e no tempo real (src/lib/streamEvents.ts) com os avisos.
// Correr em apps/mobile:  node --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const load = (f) => import(pathToFileURL(path.join(ROOT, 'src', 'lib', f)).href);
const t = await load('chatTemporary.ts');
const tl = await load('chatTimeline.ts');
const lay = await load('chatLayout.ts');
const se = await load('streamEvents.ts');

const NOW = Date.parse('2026-11-12T12:00:00Z');
const iso = (ms) => new Date(ms).toISOString();

test('as quatro escolhas, pela ordem do ecrã, e os nomes', () => {
  assert.deepEqual(t.TTL_CHOICES.map((c) => c.ttl), [null, 86400, 604800, 7776000]);
  assert.deepEqual(t.TTL_CHOICES.map((c) => c.label), ['Desligadas', '24 horas', '7 dias', '90 dias']);
  assert.equal(t.ttlLabel(null), 'Desligadas');
  assert.equal(t.ttlLabel(undefined), 'Desligadas');
  assert.equal(t.ttlLabel(604800), '7 dias');
  assert.equal(t.ttlLabel(2 * 86400), '2 dias'); // um valor que a app não conhece
  assert.equal(t.ttlBadgeLabel(86400), 'Mensagens temporárias: 24 horas');
  assert.equal(t.ttlBadgeLabel(null), '');
});

test('a explicação diz quem pode mudar (a dois, admin, membro)', () => {
  assert.match(t.ttlExplain(false, true), /Qualquer um dos dois pode mudar/);
  assert.match(t.ttlExplain(true, true), /Só quem administra/);
  assert.match(t.ttlExplain(true, false), /pede a um administrador/);
  for (const s of [t.ttlExplain(false, true), t.ttlExplain(true, false)]) assert.match(s, /As que já lá estão ficam/);
});

test('mensagens expiradas saem da conversa; as outras ficam (mesma lista se nada expirou)', () => {
  const items = [
    { id: 'a', expiresAt: null },
    { id: 'b', expiresAt: iso(NOW - 1000) },
    { id: 'c', expiresAt: iso(NOW + 60_000) },
    { id: 'd' },
  ];
  assert.deepEqual(t.liveItems(items, NOW).map((m) => m.id), ['a', 'c', 'd']);
  const fresh = [{ id: 'x', expiresAt: iso(NOW + 5) }];
  assert.equal(t.liveItems(fresh, NOW), fresh);
  assert.equal(t.isLive({ expiresAt: 'lixo' }, NOW), true); // data inválida: não esconde
  assert.equal(t.isLive({ expiresAt: iso(NOW) }, NOW), false); // na hora certa já se vai
});

test('a próxima a expirar (para o ecrã a tirar na hora)', () => {
  assert.equal(t.nextExpiryIn([{ expiresAt: null }, {}], NOW), null);
  assert.equal(t.nextExpiryIn([{ expiresAt: iso(NOW + 9000) }, { expiresAt: iso(NOW + 4000) }, { expiresAt: iso(NOW - 10) }], NOW), 4000);
});

test('limpar conversa: a confirmação a dois e nos grupos', () => {
  assert.deepEqual(t.clearPrompt(false), { title: 'Limpar a conversa?', message: 'As mensagens desaparecem só para ti. A outra pessoa continua a vê-las.', confirm: 'Limpar' });
  assert.equal(t.clearPrompt(true).message, 'As mensagens desaparecem só para ti. Os outros continuam a vê-las.');
});

test('a pré-visualização vazia: "Sem mensagens" depois de limpar; num grupo novo, quantas pessoas', () => {
  assert.equal(t.emptyPreview({ empty: false }), null);
  assert.equal(t.emptyPreview({}), null); // servidores antigos
  assert.equal(t.emptyPreview({ empty: true }), 'Sem mensagens');
  assert.equal(t.emptyPreview({ empty: true, cleared: true }, { members: 5 }), 'Sem mensagens');
  assert.equal(t.emptyPreview({ empty: true, cleared: false }, { members: 5 }), '5 pessoas');
  assert.equal(t.emptyPreview({ empty: true }, { members: 1 }), '1 pessoa');
});

test('os avisos de sistema ficam sozinhos na linha do tempo e não contam para "Mensagens novas" nem para os vistos', () => {
  const base = Date.parse('2026-11-10T11:00:00Z');
  const m = (id, o) => ({ id, at: iso(base + Number(id.slice(1)) * 30_000), fromMe: false, kind: 'text', ...o });
  const msgs = [m('m1'), m('m2', { kind: 'system' }), m('m3')];
  const rows = tl.chatTimeline(msgs, { now: new Date('2026-11-10T12:00:00Z') });
  assert.equal(rows[1].prevSame, false);
  assert.equal(rows[2].prevSame, false);
  // 2 por ler (o servidor não conta o aviso): a primeira por ler é a m1, não o aviso.
  assert.equal(tl.firstUnreadId([m('m0', { fromMe: true }), ...msgs], 2), 'm1');
  // Vistos: um aviso do outro lado depois da minha não a marca como vista.
  const items = [{ id: 'm9', fromMe: false, kind: 'system', at: iso(base) }, { id: 'm8', fromMe: true, kind: 'text', at: iso(base) }];
  assert.equal(lay.ticksFor(items, null, false).get('m8'), 'sent');
});

test('tempo real: a mudança chega como "message" (põe a conversa e a lista em dia); limpar chega aos meus aparelhos como "deleted"', () => {
  const other = se.planChatEvent({ type: 'message', from: 'dom' });
  assert.equal(other.notify, true);
  assert.deepEqual(other.keys, [['chat-list'], ['chat-unread'], ['chat-groups'], ['chat-thread', 'dom']]);
  const cleared = se.planChatEvent({ type: 'deleted', from: 'dom', self: true });
  assert.equal(cleared.notify, false);
  assert.deepEqual(cleared.keys, [['chat-list'], ['chat-unread'], ['chat-groups'], ['chat-thread', 'dom']]);
  const group = se.planChatEvent({ type: 'deleted', group: 'g1', self: true });
  assert.deepEqual(group.keys, [['chat-list'], ['chat-unread'], ['chat-groups'], ['chat-group', 'g1']]);
});
