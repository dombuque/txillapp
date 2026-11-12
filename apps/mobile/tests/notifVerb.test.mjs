// Testes dos verbos das notificações (src/lib/notifVerb.ts): com várias pessoas na mesma linha saía "comentoram",
// "repostoram", "identificoram-te", "mencionoram-te" e "aceitoram". Agora é "comentaram", "repostaram"…
// Correr em apps/mobile:  node --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { pastVerb } = await import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'notifVerb.ts')).href);

test('uma pessoa: pretérito no singular', () => {
  assert.equal(pastVerb('coment', false), 'comentou');
  assert.equal(pastVerb('aceit', false), 'aceitou');
  assert.equal(pastVerb('repost', false), 'repostou');
  assert.equal(pastVerb('identific', false), 'identificou');
  assert.equal(pastVerb('mencion', false), 'mencionou');
});

test('várias pessoas: pretérito no plural (sem "-oram")', () => {
  assert.equal(pastVerb('coment', true), 'comentaram');
  assert.equal(pastVerb('aceit', true), 'aceitaram');
  assert.equal(pastVerb('repost', true), 'repostaram');
  assert.equal(pastVerb('identific', true), 'identificaram');
  assert.equal(pastVerb('mencion', true), 'mencionaram');
});

test('a lista de notificações já não cola "u"/"ram" a um verbo acabado em "o"', () => {
  const src = readFileSync(path.join(ROOT, 'src', 'app', 'notifications.tsx'), 'utf8');
  assert.doesNotMatch(src, /o\$\{s\}/, 'ainda há `…o${s}` (dava "comentoram")');
  for (const stem of ['coment', 'aceit', 'repost', 'identific', 'mencion']) assert.match(src, new RegExp(`v\\('${stem}'\\)`));
});
