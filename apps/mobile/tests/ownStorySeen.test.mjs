// Testes do "já vi os meus mimos" no cliente (src/lib/ownStorySeen.ts): o `seen` do servidor manda, o que este aparelho
// guardou é só reforço, e as horas comparam-se como datas (nunca como texto igual).
// Correr em apps/mobile:  node --experimental-strip-types --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const o = await import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'ownStorySeen.ts')).href);

const T1 = '2026-11-11T10:00:00.123Z';
const T2 = '2026-11-11T11:00:00.456Z';
const T3 = '2026-11-11T12:00:00.789Z';
const st = (id, createdAt, seen = false) => ({ id, createdAt, seen });

test('seenUpTo compara datas (>=), não texto', () => {
  assert.equal(o.seenUpTo(T2, T2), true);
  assert.equal(o.seenUpTo(T3, T2), true);
  assert.equal(o.seenUpTo(T1, T2), false);
  // O mesmo instante escrito de outra forma (fuso, sem milissegundos) continua a contar como visto.
  assert.equal(o.seenUpTo('2026-11-11T11:00:00.456+00:00', T2), true);
  assert.equal(o.seenUpTo('2026-11-11T12:00:00.456+01:00', T2), true);
  assert.equal(o.seenUpTo('2026-11-11T11:00:01Z', T2), true);
  assert.equal(o.seenUpTo('2026-11-11T11:00:00Z', T2), false);
});

test('seenUpTo: vazio ou inválido nunca conta como visto', () => {
  assert.equal(o.seenUpTo('', T1), false);
  assert.equal(o.seenUpTo(null, T1), false);
  assert.equal(o.seenUpTo(undefined, T1), false);
  assert.equal(o.seenUpTo('lixo', T1), false);
  assert.equal(o.seenUpTo(T1, ''), false);
});

test('storySeen: o servidor manda; o aparelho só reforça os meus', () => {
  assert.equal(o.storySeen(st('a', T1, true), true, ''), true); // visto noutro aparelho
  assert.equal(o.storySeen(st('a', T1, true), false, ''), true);
  assert.equal(o.storySeen(st('a', T1), true, T2), true); // visto aqui, o servidor ainda não respondeu
  assert.equal(o.storySeen(st('a', T1), false, T2), false); // dos outros, o aparelho não conta
  assert.equal(o.storySeen(st('a', T3), true, T2), false); // um mimo novo volta a cores
});

test('firstToWatch: começa no primeiro por ver, ou no primeiro se já vi todos', () => {
  const list = [st('a', T1, true), st('b', T2), st('c', T3)];
  assert.equal(o.firstToWatch(list, true, ''), 1);
  assert.equal(o.firstToWatch(list, true, T2), 2);
  assert.equal(o.firstToWatch(list, true, T3), 0);
  assert.equal(o.firstToWatch([st('a', T1, true), st('b', T2, true)], false, ''), 0);
  assert.equal(o.firstToWatch([], true, ''), 0);
});

test('seenSegments: quantos segmentos do anel ficam a cinzento', () => {
  const list = [st('a', T1), st('b', T2), st('c', T3)];
  assert.equal(o.seenSegments(list, true, T2), 2);
  assert.equal(o.seenSegments(list, false, T2), 0);
  assert.equal(o.seenSegments([st('a', T1, true), st('b', T2)], false, ''), 1);
});

test('trayMine: "O teu mimo" usa o seen do servidor, reforçado pelo aparelho', () => {
  const mine = { count: 3, seenCount: 1, seen: false, latestAt: T3 };
  assert.deepEqual(o.trayMine(undefined, T3), { seen: false, seenCount: 0 });
  assert.deepEqual(o.trayMine(mine, ''), { seen: false, seenCount: 1 });
  assert.deepEqual(o.trayMine({ ...mine, seen: true, seenCount: 3 }, ''), { seen: true, seenCount: 3 }); // visto noutro aparelho
  assert.deepEqual(o.trayMine(mine, T3), { seen: true, seenCount: 3 }); // visto aqui agora
  assert.deepEqual(o.trayMine(mine, '2026-11-11T12:00:00.789+00:00'), { seen: true, seenCount: 3 }); // mesma hora, outro texto
  assert.deepEqual(o.trayMine(mine, T2), { seen: false, seenCount: 1 }); // um mimo novo depois do que vi
});

test('nextOwnSeen nunca recua', () => {
  assert.equal(o.nextOwnSeen('', T1), T1);
  assert.equal(o.nextOwnSeen(T1, T2), T2);
  assert.equal(o.nextOwnSeen(T3, T2), T3);
});

test('markSeen: marca o visto (e, nos meus, os anteriores) sem mexer no resto', () => {
  const list = [st('a', T1), st('b', T2), st('c', T3)];
  assert.deepEqual(o.markSeen(list, list[1], true).map((x) => x.seen), [true, true, false]);
  assert.deepEqual(o.markSeen(list, list[1], false).map((x) => x.seen), [false, true, false]);
  assert.equal(o.markSeen(undefined, list[0], true), undefined);
  const out = o.markSeen(list, list[0], false);
  assert.equal(out[2], list[2]); // os que não mudam ficam o mesmo objeto
  assert.equal(list[0].seen, false); // não altera a lista original
});

test('o guardado no aparelho é por conta: não passa para outra conta no mesmo aparelho', () => {
  const raw = o.packOwnSeen('Ana', T2);
  assert.equal(o.ownSeenFor(raw, 'ana'), T2);
  assert.equal(o.ownSeenFor(raw, 'Ana'), T2);
  assert.equal(o.ownSeenFor(raw, 'bruno'), '');
  assert.equal(o.ownSeenFor(raw, null), '');
  assert.equal(o.ownSeenFor('', 'ana'), '');
  assert.equal(o.ownSeenFor(T2, 'ana'), ''); // formato antigo (só a hora): ignora-se, vale o do servidor
});
