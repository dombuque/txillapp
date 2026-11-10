// Testes da arrumação das bolhas do chat (src/lib/chatLayout.ts): grupos, separadores de hora, cantos, avatar e "Visto".
// Correr em apps/mobile:  node --experimental-strip-types --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const L = await import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'chatLayout.ts')).href);

const T0 = new Date(2026, 10, 10, 11, 0, 0).getTime(); // 10 nov 2026, 11:00 (hora local)
const at = (min) => new Date(T0 + min * 60_000).toISOString();
const msg = (id, fromMe, min, o = {}) => ({ id, fromMe, kind: 'text', at: at(min), ...o });

test('joined: mesma pessoa com ≤ 3 min junta; mais de 3 min, outra pessoa ou outro dia não', () => {
  assert.equal(L.joined(msg('a', true, 0), msg('b', true, 3), false), true);
  assert.equal(L.joined(msg('a', true, 0), msg('b', true, 3.1), false), false);
  assert.equal(L.joined(msg('a', true, 0), msg('b', false, 1), false), false);
  assert.equal(L.joined(msg('a', false, 0), msg('b', false, 1), false), true);
  // 23:59 e 00:01 do dia seguinte: o separador de dia parte o grupo
  const late = new Date(2026, 10, 10, 23, 59).toISOString();
  const early = new Date(2026, 10, 11, 0, 1).toISOString();
  assert.equal(L.joined({ id: 'a', fromMe: true, kind: 'text', at: late }, { id: 'b', fromMe: true, kind: 'text', at: early }, false), false);
});

test('joined nos grupos: conta quem enviou (duas pessoas diferentes não se juntam)', () => {
  const ana = { username: 'ana' };
  const rui = { username: 'rui' };
  assert.equal(L.joined(msg('a', false, 0, { sender: ana }), msg('b', false, 1, { sender: ana }), true), true);
  assert.equal(L.joined(msg('a', false, 0, { sender: ana }), msg('b', false, 1, { sender: rui }), true), false);
  assert.equal(L.joined(msg('a', false, 0), msg('b', false, 1), true), false); // sem autor: não arrisca
  assert.equal(L.joined(msg('a', true, 0), msg('b', true, 1), true), true); // as minhas juntam-se sempre
});

test('joined: chamadas e reações a mimos ficam sozinhas', () => {
  assert.equal(L.joined(msg('a', true, 0, { kind: 'call' }), msg('b', true, 1), false), false);
  assert.equal(L.joined(msg('a', false, 0), msg('b', false, 1, { kind: 'story_reaction' }), false), false);
});

test('needsStamp: a primeira, depois de > 1 h ou noutro dia', () => {
  assert.equal(L.needsStamp(undefined, msg('a', true, 0)), true);
  assert.equal(L.needsStamp(msg('a', true, 0), msg('b', false, 60)), false);
  assert.equal(L.needsStamp(msg('a', true, 0), msg('b', false, 61)), true);
});

test('place: primeira/meio/última de um grupo e bolha sozinha', () => {
  const a = msg('a', false, 0);
  const b = msg('b', false, 1);
  const c = msg('c', false, 2);
  const d = msg('d', true, 2.5);
  assert.deepEqual(L.place(undefined, a, b, false), { stamp: true, first: true, last: false });
  assert.deepEqual(L.place(a, b, c, false), { stamp: false, first: false, last: false });
  assert.deepEqual(L.place(b, c, d, false), { stamp: false, first: false, last: true });
  assert.deepEqual(L.place(c, d, undefined, false), { stamp: false, first: true, last: true });
});

test('corners: 20 por fora; 6 nos cantos interiores do lado de quem envia', () => {
  assert.deepEqual(L.corners(true, true, true), { borderTopLeftRadius: 20, borderBottomLeftRadius: 20, borderTopRightRadius: 20, borderBottomRightRadius: 20 });
  assert.deepEqual(L.corners(true, true, false), { borderTopLeftRadius: 20, borderBottomLeftRadius: 20, borderTopRightRadius: 20, borderBottomRightRadius: 6 });
  assert.deepEqual(L.corners(true, false, false), { borderTopLeftRadius: 20, borderBottomLeftRadius: 20, borderTopRightRadius: 6, borderBottomRightRadius: 6 });
  assert.deepEqual(L.corners(false, false, true), { borderTopRightRadius: 20, borderBottomRightRadius: 20, borderTopLeftRadius: 6, borderBottomLeftRadius: 20 });
});

test('showAvatar: só nas da outra pessoa e só na última do grupo', () => {
  assert.equal(L.showAvatar(false, { last: true }), true);
  assert.equal(L.showAvatar(false, { last: false }), false);
  assert.equal(L.showAvatar(true, { last: true }), false);
});

test('stampLabel: Hoje, Ontem, dia da semana, data (com o ano se for outro)', () => {
  const now = new Date(2026, 10, 10, 18, 0); // terça, 10 nov 2026
  assert.equal(L.stampLabel(new Date(2026, 10, 10, 11, 40).toISOString(), now), 'Hoje 11:40');
  assert.equal(L.stampLabel(new Date(2026, 10, 9, 21, 3).toISOString(), now), 'Ontem 21:03');
  assert.equal(L.stampLabel(new Date(2026, 10, 9, 0, 5).toISOString(), now), 'Ontem 00:05');
  assert.equal(L.stampLabel(new Date(2026, 10, 7, 9, 12).toISOString(), now), 'Sáb 09:12');
  assert.equal(L.stampLabel(new Date(2026, 10, 3, 9, 12).toISOString(), now), '3 nov 09:12');
  assert.equal(L.stampLabel(new Date(2025, 11, 24, 20, 0).toISOString(), now), '24 dez 2025 20:00');
});

test('ticksFor: ✓ entregue / ✓✓ visto nas minhas; vistas se ela leu a última ou respondeu depois; nada nos grupos', () => {
  // do mais recente para o mais antigo
  const items = [msg('m4', true, 6), msg('m3', true, 5), msg('o2', false, 4), msg('m1', true, 1)];
  const obj = (m) => Object.fromEntries(m);
  assert.deepEqual(obj(L.ticksFor(items, 'm4', false)), { m4: 'seen', m3: 'seen', m1: 'seen' });
  assert.deepEqual(obj(L.ticksFor(items, null, false)), { m4: 'sent', m3: 'sent', m1: 'seen' }); // m1: ela respondeu depois
  assert.deepEqual(obj(L.ticksFor(items, 'm4', true)), {});
  // a enviar ou falhada: sem vistos (diz "A enviar…" / "Não enviada"); as outras não mudam
  const pending = [msg('tmp-1', true, 7, { state: 'sending' }), msg('m5', true, 6.5, { state: 'failed' }), ...items];
  assert.deepEqual(obj(L.ticksFor(pending, null, false)), { m4: 'sent', m3: 'sent', m1: 'seen' });
  assert.deepEqual(obj(L.ticksFor([], null, false)), {});
});
