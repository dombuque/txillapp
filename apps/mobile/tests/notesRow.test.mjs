// Testes da fila da faixa de notas, em Mensagens (src/lib/notesRow.ts): notas primeiro, depois as pessoas das conversas.
// Correr em apps/mobile:  node --experimental-strip-types --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const t = await import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'notesRow.ts')).href);

const note = (username, body = 'olá') => ({ username, displayName: username, hasAvatar: true, body });
const person = (username) => ({ username, displayName: username, hasAvatar: false, lastAt: '2026-11-10T10:00:00.000Z' });
const who = (row) => row.map((e) => `${e.kind === 'note' ? 'N' : 'P'}:${(e.note ?? e.person).username}`);

test('notesRow: notas primeiro (ordem do servidor), depois as pessoas (ordem do servidor)', () => {
  const row = t.notesRow([note('bia'), note('ana')], [person('rui'), person('eva')], 'eu');
  assert.deepEqual(who(row), ['N:bia', 'N:ana', 'P:rui', 'P:eva']);
  assert.equal(row[0].note.body, 'olá');
  assert.equal(row[2].person.lastAt, '2026-11-10T10:00:00.000Z');
});

test('notesRow: quem tem nota ganha, mesmo com maiúsculas diferentes', () => {
  const row = t.notesRow([note('Ana')], [person('ana'), person('rui'), person('RUI')], 'eu');
  assert.deepEqual(who(row), ['N:Ana', 'P:rui']);
});

test('notesRow: sem repetidos entre as próprias notas', () => {
  assert.deepEqual(who(t.notesRow([note('ana', 'a'), note('ANA', 'b')], [], 'eu')), ['N:ana']);
});

test('notesRow: tira-me a mim (nota ou pessoa), sem distinguir maiúsculas', () => {
  const row = t.notesRow([note('Eu'), note('ana')], [person('EU'), person('rui')], 'eu');
  assert.deepEqual(who(row), ['N:ana', 'P:rui']);
});

test('notesRow: servidor antigo (sem people) mostra só as notas', () => {
  assert.deepEqual(who(t.notesRow([note('ana')], undefined, 'eu')), ['N:ana']);
  assert.deepEqual(who(t.notesRow([note('ana')], null, 'eu')), ['N:ana']);
  assert.deepEqual(who(t.notesRow(undefined, undefined, 'eu')), []);
  assert.deepEqual(who(t.notesRow([], [person('rui')], null)), ['P:rui']);
});

test('notesRow: limite no total, as notas primeiro', () => {
  const notes = Array.from({ length: 5 }, (_, i) => note(`n${i}`));
  const people = Array.from({ length: 5 }, (_, i) => person(`p${i}`));
  assert.deepEqual(who(t.notesRow(notes, people, 'eu', 7)), ['N:n0', 'N:n1', 'N:n2', 'N:n3', 'N:n4', 'P:p0', 'P:p1']);
  assert.deepEqual(who(t.notesRow(notes, people, 'eu', 3)), ['N:n0', 'N:n1', 'N:n2']);
  assert.deepEqual(t.notesRow(notes, people, 'eu', 0), []);
});

test('notesRow: por omissão, no máximo NOTES_ROW_MAX (60)', () => {
  assert.equal(t.NOTES_ROW_MAX, 60);
  const notes = Array.from({ length: 40 }, (_, i) => note(`n${i}`));
  const people = Array.from({ length: 30 }, (_, i) => person(`p${i}`));
  const row = t.notesRow(notes, people, 'eu');
  assert.equal(row.length, 60);
  assert.equal(row.filter((e) => e.kind === 'note').length, 40);
  assert.equal(row.at(-1).person.username, 'p19');
});

test('notesRow: chaves únicas e estáveis (tipo + username em minúsculas)', () => {
  const row = t.notesRow([note('Ana')], [person('Rui')], 'eu');
  assert.deepEqual(row.map((e) => e.key), ['n:ana', 'p:rui']);
});

test('notesRow: ignora entradas sem username', () => {
  const row = t.notesRow([{ username: '' }, note('ana')], [{}, { username: '  ' }, person('rui')], 'eu');
  assert.deepEqual(who(row), ['N:ana', 'P:rui']);
});
