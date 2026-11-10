// Testes do desenho das bolhas do chat (src/lib/chatLayout.ts): cantos, avatar e vistos.
// O agrupamento e os separadores testam-se em tests/chatTimeline.test.mjs (a única lógica de agrupamento).
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
  // a minha última já enviada lida, com outra minha ainda a enviar por cima: o ✓✓ mantém-se
  assert.deepEqual(obj(L.ticksFor(pending, 'm4', false)), { m4: 'seen', m3: 'seen', m1: 'seen' });
  assert.deepEqual(obj(L.ticksFor([], null, false)), {});
});
