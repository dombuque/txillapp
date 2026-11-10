// Testes da linha do tempo da conversa (src/lib/chatTimeline.ts): separadores de dia ("Hoje, 10 nov", "Ontem",
// "Seg, 9 nov", "12 nov") e de saltos grandes ("Hoje, 11:40"), "Mensagens novas", bolhas que se juntam e o "Ativo há…".
// Correr em apps/mobile:  node --experimental-strip-types --test tests/*.test.mjs
// As datas são feitas em hora local (new Date(a, m, d, h, min)) para os testes darem o mesmo em qualquer fuso.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const t = await import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'chatTimeline.ts')).href);

// "Agora": terça, 10 nov 2026, 12:00 (hora local).
const NOW = new Date(2026, 10, 10, 12, 0);
const at = (d, h, m, mo = 10, y = 2026) => new Date(y, mo, d, h, m).toISOString();
let n = 0;
const msg = (iso, o = {}) => ({ id: `m${++n}`, at: iso, fromMe: false, kind: 'text', ...o });

test('dayLabel: "Hoje, 10 nov", "Ontem", dia da semana nos últimos 7 dias, depois dia e mês (e ano se for outro)', () => {
  assert.equal(t.dayLabel(at(10, 11, 40), NOW), 'Hoje, 10 nov');
  assert.equal(t.dayLabel(at(10, 0, 5), NOW), 'Hoje, 10 nov');
  assert.equal(t.dayLabel(at(9, 23, 59), NOW), 'Ontem');
  assert.equal(t.dayLabel(at(9, 9, 0), NOW), 'Ontem');
  assert.equal(t.dayLabel(at(8, 9, 12), NOW), 'Dom, 8 nov');
  assert.equal(t.dayLabel(at(4, 9, 12), NOW), 'Qua, 4 nov');
  assert.equal(t.dayLabel(at(3, 9, 12), NOW), '3 nov'); // 7 dias: já não é "Ter" (seria confuso com hoje)
  assert.equal(t.dayLabel(at(12, 14, 5, 7), NOW), '12 ago');
  assert.equal(t.dayLabel(at(31, 18, 0, 11, 2025), NOW), '31 dez 2025');
  assert.equal(t.dayLabel(at(10, 12, 30), NOW), 'Hoje, 10 nov'); // relógio adiantado: continua "Hoje"
});

test('timeLabel (salto grande no mesmo dia): o dia curto e a hora', () => {
  assert.equal(t.timeLabel(at(10, 11, 40), NOW), 'Hoje, 11:40');
  assert.equal(t.timeLabel(at(10, 0, 5), NOW), 'Hoje, 00:05');
  assert.equal(t.timeLabel(at(9, 21, 3), NOW), 'Ontem, 21:03');
  assert.equal(t.timeLabel(at(9, 9, 12), NOW), 'Ontem, 09:12');
  assert.equal(t.timeLabel(at(8, 9, 12), NOW), 'Dom, 09:12');
  assert.equal(t.timeLabel(at(3, 14, 5), NOW), '3 nov, 14:05');
  assert.equal(t.timeLabel(at(31, 18, 0, 11, 2025), NOW), '31 dez 2025, 18:00');
});

test('chatTimeline: o dia na primeira e quando muda o dia; a hora com mais de 15 min no mesmo dia; nada com 15 min certos', () => {
  const l = [
    msg(at(9, 23, 50)),
    msg(at(10, 0, 2)), // mudou o dia (12 min depois)
    msg(at(10, 0, 17)), // 15 min certos: sem separador
    msg(at(10, 0, 33)), // 16 min: separador com hora
    msg(at(10, 11, 40)),
  ];
  assert.deepEqual(t.chatTimeline(l, { now: NOW }).map((r) => r.divider), ['Ontem', 'Hoje, 10 nov', null, 'Hoje, 00:33', 'Hoje, 11:40']);
  assert.deepEqual(t.chatTimeline([], { now: NOW }), []);
});

test('chatTimeline: junta a mesma pessoa até 3 min; outra pessoa, 3+ min, separador ou reação a mimo cortam', () => {
  const l = [
    msg(at(10, 11, 0)),
    msg(at(10, 11, 1)), // junta-se à anterior
    msg(at(10, 11, 4)), // 3 min certos: ainda junta
    msg(at(10, 11, 5), { fromMe: true }), // outra pessoa
    msg(at(10, 11, 9), { fromMe: true }), // 4 min: não junta
    msg(at(10, 11, 10), { fromMe: true, kind: 'story_reaction' }),
    msg(at(10, 11, 30), { fromMe: true }), // separador (20 min): não junta
  ];
  const rows = t.chatTimeline(l, { now: NOW });
  assert.deepEqual(rows.map((r) => r.prevSame), [false, true, true, false, false, false, false]);
  assert.deepEqual(rows.map((r) => r.nextSame), [true, true, false, false, false, false, false]);
});

test('chatTimeline em grupo: junta só o mesmo autor; as minhas juntam-se entre si', () => {
  const ana = { username: 'ana', displayName: 'Ana', hasAvatar: false };
  const rui = { username: 'rui', displayName: 'Rui', hasAvatar: false };
  const l = [
    msg(at(10, 11, 0), { sender: ana }),
    msg(at(10, 11, 1), { sender: ana }),
    msg(at(10, 11, 2), { sender: rui }),
    msg(at(10, 11, 3), { fromMe: true }),
    msg(at(10, 11, 3), { fromMe: true }),
  ];
  assert.deepEqual(t.chatTimeline(l, { group: true, now: NOW }).map((r) => r.prevSame), [false, true, false, false, true]);
  // Fora de grupo, a Ana e o Rui seriam "a outra pessoa" e juntavam-se.
  assert.equal(t.chatTimeline(l, { now: NOW })[2].prevSame, true);
});

test('firstUnreadId + chatTimeline: "Mensagens novas" antes da primeira por ler, e corta o grupo', () => {
  const l = [
    msg(at(10, 11, 0)),
    msg(at(10, 11, 1), { fromMe: true }),
    msg(at(10, 11, 2)),
    msg(at(10, 11, 3), { fromMe: true }), // as minhas não contam como por ler
    msg(at(10, 11, 4)),
  ];
  assert.equal(t.firstUnreadId(l, 0), null);
  assert.equal(t.firstUnreadId(l, 1), l[4].id);
  assert.equal(t.firstUnreadId(l, 2), l[2].id);
  assert.equal(t.firstUnreadId(l, 3), null); // tudo o que está carregado é novo: sem separador
  assert.equal(t.firstUnreadId(l, 9), null);

  const same = [msg(at(10, 11, 0)), msg(at(10, 11, 1)), msg(at(10, 11, 2))];
  const rows = t.chatTimeline(same, { newFrom: same[1].id, now: NOW });
  assert.deepEqual(rows.map((r) => r.newMark), [false, true, false]);
  assert.deepEqual(rows.map((r) => r.prevSame), [false, false, true]);
  assert.equal(rows[0].nextSame, false);
});

test('activeLabel: agora, minutos, horas, ontem, data', () => {
  const ago = (min) => new Date(NOW.getTime() - min * 60_000).toISOString();
  assert.equal(t.activeLabel(null, NOW), null);
  assert.equal(t.activeLabel('lixo', NOW), null);
  assert.equal(t.activeLabel(ago(0), NOW), 'Ativo agora');
  assert.equal(t.activeLabel(ago(5), NOW), 'Ativo há 5 min');
  assert.equal(t.activeLabel(ago(59), NOW), 'Ativo há 59 min');
  assert.equal(t.activeLabel(ago(180), NOW), 'Ativo há 3 h');
  assert.equal(t.activeLabel(ago(20 * 60), NOW), 'Ativo há 20 h'); // ontem às 16:00, mas ainda há menos de 24 h
  assert.equal(t.activeLabel(at(9, 8, 0), NOW), 'Ativo ontem');
  assert.equal(t.activeLabel(at(3, 8, 0), NOW), 'Ativo a 3 nov');
  assert.equal(t.activeLabel(at(3, 8, 0, 10, 2025), NOW), 'Ativo a 3 nov 2025');
});
