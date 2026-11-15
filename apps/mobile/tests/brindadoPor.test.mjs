// Testes de «Brindado por @fulano e outras N pessoas» e dos amigos próximos que brindaram a flutuar sobre a foto ou a
// tcheka (src/lib/cheeredBy.ts, components/CheeredBy.tsx, PostCard e o ecrã das Tchekas).
// Correr em apps/mobile:  node --experimental-strip-types --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cb = await import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'cheeredBy.ts')).href);
const read = (...f) => readFileSync(path.join(ROOT, 'src', ...f), 'utf8').replace(/\r\n/g, '\n');

const u = (username, close = false, extra = {}) => ({ username, displayName: username.toUpperCase(), avatarUrl: null, verified: false, verifiedTier: null, close, ...extra });

test('um nome e «outras N pessoas»; dois nomes só quando são os dois brindes; um só', () => {
  const v = cb.cheeredByView({ cheers: 24, cheeredBy: { users: [u('ana', true), u('rui'), u('eva')], total: 24 } });
  assert.equal(v.kind, 'names');
  assert.deepEqual(v.names.map((x) => x.username), ['ana']);
  assert.deepEqual(v.avatars.map((x) => x.username), ['ana', 'rui', 'eva']);
  assert.equal(v.others, 23);
  assert.equal(cb.cheeredByA11y(v), 'Brindado por @ana e outras 23 pessoas');

  const two = cb.cheeredByView({ cheers: 2, cheeredBy: { users: [u('ana'), u('rui')], total: 2 } });
  assert.deepEqual(two.names.map((x) => x.username), ['ana', 'rui']);
  assert.equal(two.others, 0);
  assert.equal(cb.cheeredByA11y(two), 'Brindado por @ana e @rui');

  const one = cb.cheeredByView({ cheers: 1, cheeredBy: { users: [u('ana')], total: 1 } });
  assert.equal(one.others, 0);
  assert.equal(cb.cheeredByA11y(one), 'Brindado por @ana');

  // Dois brindes mas só um se pode mostrar (o outro é meu, ou de uma conta privada): «e outra pessoa».
  const mine = cb.cheeredByView({ cheers: 2, cheeredBy: { users: [u('ana')], total: 2 } });
  assert.equal(cb.cheeredByA11y(mine), 'Brindado por @ana e outra pessoa');
  assert.equal(cb.othersLabel(1), 'outra pessoa');
  assert.equal(cb.othersLabel(1200, (n) => `${n / 1000} mil`), 'outras 1.2 mil pessoas');
});

test('sem nomes: só a contagem (o dono não deixa ver, ninguém visível, ou a publicação veio da cache sem o campo)', () => {
  assert.deepEqual(cb.cheeredByView({ cheers: 23, cheeredBy: null }), { kind: 'count', total: 23 });
  assert.deepEqual(cb.cheeredByView({ cheers: 23 }), { kind: 'count', total: 23 });
  assert.deepEqual(cb.cheeredByView({ cheers: 5, cheeredBy: { users: [], total: 5 } }), { kind: 'count', total: 5 });
  assert.equal(cb.cheeredByView({ cheers: 0, cheeredBy: { users: [], total: 0 } }), null);
  assert.equal(cb.cheeredByA11y({ kind: 'count', total: 1 }), '1 brinde');
  // O número acompanha o meu brinde (cheers muda logo, o cheeredBy só quando o servidor responde).
  const after = cb.cheeredByView({ cheers: 25, cheeredBy: { users: [u('ana')], total: 24 } });
  assert.equal(after.others, 24);
  // Lixo da cache não rebenta.
  assert.deepEqual(cb.cheeredByView({ cheers: 3, cheeredBy: { users: 'x' } }), { kind: 'count', total: 3 });
});

test('a flutuar: só os amigos próximos que brindaram, até 3; nada sem permissão', () => {
  const p = { cheeredBy: { users: [u('ana', true), u('rui'), u('eva', true)], total: 9 } };
  assert.deepEqual(cb.closeCheerers(p).map((x) => x.username), ['ana', 'eva']);
  assert.deepEqual(cb.closeCheerers({ cheeredBy: null }), []);
  assert.deepEqual(cb.closeCheerers({}), []);
  assert.deepEqual(cb.closeCheerers({ cheeredBy: { users: [u('a', true), u('b', true), u('c', true), u('d', true)], total: 4 } }).length, 3);
});

test('o cartão troca o «🍻 N» pela linha e põe os amigos sobre a foto (acima do selo da música); a Tcheka também', () => {
  const card = read('components', 'PostCard.tsx');
  assert.match(card, /<CheeredByLine post=\{post\} onOpen=\{\(\) => people\('cheers'\)\} \/>/);
  assert.match(card, /chips\.filter\(\(c\) => c\.kind !== 'cheers'\)/);
  assert.match(card, /overlay=\{mediaOverlay\(post, musicOn, \(\) => setSheet\(\{ people: 'cheers' \}\)\)\}/);
  assert.match(card, /style=\{above \? \{ bottom: 12 \+ 34 \+ 10 \} : undefined\}/);
  const reels = read('app', '(tabs)', 'reels.tsx');
  assert.match(reels, /<CheeredFriends post=\{post\} onOpen=\{\(\) => setPeople\('cheers'\)\}/);
  const comp = read('components', 'CheeredBy.tsx');
  assert.match(comp, /useReduceMotion\(\)/); // «reduzir movimento»: parados
  assert.match(comp, /InlineBadge who=\{u\}/); // o selo de verificado ao lado do nome
  assert.match(comp, /function MiniMug/); // a caneca pequenina como selo
});
