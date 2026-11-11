// Testes dos avisos de brindes nas notificações (src/lib/cheerNotice.ts): o texto, o destino e quem aparece na linha.
// Correr em apps/mobile:  node --experimental-strip-types --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const c = await import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'cheerNotice.ts')).href);

const ana = { username: 'ana', displayName: 'Ana' };
const rui = { username: 'rui', displayName: 'Rui' };

test('cheerVerb: publicação, tcheka e comentário; "brindou" para uma pessoa, "brindaram" para várias', () => {
  assert.equal(c.cheerVerb({ target: 'post', postId: 'p' }, false), 'brindou a tua publicação');
  assert.equal(c.cheerVerb({ target: 'post', postId: 'p' }, true), 'brindaram a tua publicação');
  assert.equal(c.cheerVerb({ target: 'post', postId: 'p', tcheka: true }, false), 'brindou a tua tcheka');
  assert.equal(c.cheerVerb({ target: 'comment', postId: 'p', commentId: 'c' }, false), 'brindou o teu comentário');
  assert.equal(c.cheerVerb({ target: 'comment', postId: 'p', commentId: 'c' }, true), 'brindaram o teu comentário');
  assert.equal(c.cheerVerb({}, false), 'brindou a tua publicação'); // servidor antigo: o mais provável
});

test('cheerTarget: abre a publicação, ou o comentário dentro dela', () => {
  assert.equal(c.cheerTarget({ target: 'post', postId: 'p1' }), '/p/p1');
  assert.equal(c.cheerTarget({ target: 'comment', postId: 'p1', commentId: 'c9' }), '/p/p1?comments=1&c=c9');
  assert.equal(c.cheerTarget({ target: 'comment', postId: 'p1' }), '/p/p1');
  assert.equal(c.cheerTarget({ target: 'post' }), null);
});

test('cheerPeople: os dois últimos e o total; sem brindes postos fica quem brindou por último', () => {
  assert.deepEqual(c.cheerPeople({ count: 5, actors: [ana, rui] }, ana), { actors: [ana, rui], total: 5 });
  assert.deepEqual(c.cheerPeople({ count: 1, actors: [rui] }, ana), { actors: [rui], total: 1 });
  assert.deepEqual(c.cheerPeople({ count: 0, actors: [] }, ana), { actors: [ana], total: 1 });
  assert.deepEqual(c.cheerPeople(undefined, ana), { actors: [ana], total: 1 });
  // Lixo do servidor: nunca menos pessoas do que as que se mostram, e no máximo duas fotos.
  assert.deepEqual(c.cheerPeople({ count: -2, actors: [ana, rui] }, ana), { actors: [ana, rui], total: 2 });
  assert.equal(c.cheerPeople({ count: 9, actors: [ana, rui, ana] }, ana).actors.length, 2);
});

test('o ecrã das notificações conhece o tipo cheer (texto e destino) e o tipo está em NotificationKind', () => {
  const screen = readFileSync(path.join(ROOT, 'src', 'app', 'notifications.tsx'), 'utf8');
  assert.match(screen, /case 'cheer': return \{ text: cheerVerb\(/);
  assert.match(screen, /case 'cheer': return cheerTarget\(/);
  const api = readFileSync(path.join(ROOT, 'src', 'lib', 'api.ts'), 'utf8');
  assert.match(api, /export type NotificationKind = [^;]*'cheer'/);
});
