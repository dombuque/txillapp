// Testes das sugestões de @menções (src/lib/mentions.ts): que "@palavra" está no cursor, trocar pelo @username,
// ignorar emails e @ a meio de palavra, andar na lista com ↑/↓.
// Correr em apps/mobile:  node --experimental-strip-types --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const m = await import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'mentions.ts')).href);

/** O texto com "|" a marcar o cursor: devolve o texto sem ele e a posição. */
const at = (s) => ({ text: s.replace('|', ''), cursor: s.indexOf('|') });
const token = (s) => { const { text, cursor } = at(s); return m.activeMention(text, cursor); };

test('deteta o @ que se está a escrever, no cursor', () => {
  assert.deepEqual(token('@|'), { start: 0, end: 1, query: '' });
  assert.deepEqual(token('olá @sa|'), { start: 4, end: 7, query: 'sa' });
  assert.deepEqual(token('@sara|'), { start: 0, end: 5, query: 'sara' });
  // Com o cursor a meio da palavra: a pesquisa é o que está até ao cursor, mas troca-se a palavra toda.
  assert.deepEqual(token('olá @sa|ra, tudo?'), { start: 4, end: 9, query: 'sa' });
  // Em várias linhas e depois de pontuação.
  assert.deepEqual(token('linha 1\n@jo|'), { start: 8, end: 11, query: 'jo' });
  assert.deepEqual(token('(@ma|'), { start: 1, end: 4, query: 'ma' });
  // Com acentos (procura-se pelo nome).
  assert.deepEqual(token('@ân|'), { start: 0, end: 3, query: 'ân' });
  assert.deepEqual(token('@jo.ao_1|'), { start: 0, end: 8, query: 'jo.ao_1' });
});

test('fecha com espaço e não reage fora de um @', () => {
  assert.equal(token('@sara |'), null);
  assert.equal(token('olá |'), null);
  assert.equal(token('|@sara'), null); // o cursor antes do @
  assert.equal(token('sem arroba|'), null);
  assert.equal(token('|'), null);
});

test('ignora emails e @ a meio de palavra', () => {
  assert.equal(token('escreve para a@b|'), null);
  assert.equal(token('ana@gmail.com|'), null);
  assert.equal(token('x_@y|'), null);
  assert.equal(token('#@y|'), null);
  assert.equal(token('@@y|'), null);
  assert.equal(token('1@y|'), null);
});

test('mais de 30 caracteres já não é uma menção', () => {
  assert.equal(token(`@${'a'.repeat(31)}|`), null);
  assert.ok(token(`@${'a'.repeat(30)}|`));
});

test('trocar o @par pelo @username com um espaço, e o cursor logo a seguir', () => {
  const { text, cursor } = at('olá @sa|');
  const t = m.activeMention(text, cursor);
  assert.deepEqual(m.applyMention(text, t, 'sara_lopes'), { text: 'olá @sara_lopes ', cursor: 16 });

  // A meio da frase: troca a palavra toda e não duplica o espaço que já lá estava.
  const b = at('olá @sa|ra tudo bem?');
  const r = m.applyMention(b.text, m.activeMention(b.text, b.cursor), 'sara');
  assert.deepEqual(r, { text: 'olá @sara tudo bem?', cursor: 10 });
  assert.equal(r.text[r.cursor - 1], ' ');

  // Só "@": fica "@username ".
  const c = at('@|');
  assert.deepEqual(m.applyMention(c.text, m.activeMention(c.text, c.cursor), 'ze'), { text: '@ze ', cursor: 4 });

  // Colado a pontuação: põe o espaço antes da vírgula.
  const d = at('@sa|, vens?');
  assert.deepEqual(m.applyMention(d.text, m.activeMention(d.text, d.cursor), 'sara'), { text: '@sara , vens?', cursor: 6 });

  // Depois de trocar, o cursor já não está num @ (a lista fecha).
  assert.equal(m.activeMention(r.text, r.cursor), null);
});

test('↑/↓ dão a volta na lista', () => {
  assert.equal(m.moveHighlight(0, 1, 3), 1);
  assert.equal(m.moveHighlight(2, 1, 3), 0);
  assert.equal(m.moveHighlight(0, -1, 3), 2);
  assert.equal(m.moveHighlight(5, 1, 0), 0);
});

test('as razões discretas', () => {
  assert.equal(m.reasonLabel('conversa'), 'Conversam');
  assert.equal(m.reasonLabel('segue-te'), 'Segue-te');
  assert.equal(m.reasonLabel('neste-post'), 'Neste post');
  assert.equal(m.reasonLabel(undefined), null);
});
