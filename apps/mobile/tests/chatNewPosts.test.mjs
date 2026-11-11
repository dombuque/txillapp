// Testes das "publicações novas" no cabeçalho da conversa (src/lib/chatNewPosts.ts): o texto, o destino do toque e a prioridade.
// Correr em apps/mobile:  node --experimental-strip-types --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const t = await import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'chatNewPosts.ts')).href);

test('newPostsText: singular, plural e "9+" a partir de 10', () => {
  assert.equal(t.newPostsText(1), '1 publicação nova');
  assert.equal(t.newPostsText(2), '2 publicações novas');
  assert.equal(t.newPostsText(9), '9 publicações novas');
  assert.equal(t.newPostsText(10), '9+ publicações novas');
  assert.equal(t.newPostsText(57), '9+ publicações novas');
});

test('newPostsText: nada a mostrar sem publicações novas (0, negativo, nulo)', () => {
  assert.equal(t.newPostsText(0), '');
  assert.equal(t.newPostsText(-1), '');
  assert.equal(t.newPostsText(null), '');
  assert.equal(t.newPostsText(undefined), '');
  assert.equal(t.newPostsText(NaN), '');
});

test('newPostsLabel: o leitor de ecrã diz de quem e que abre', () => {
  assert.equal(t.newPostsLabel(1, 'Ana Silva'), '1 publicação nova de Ana Silva, abrir');
  assert.equal(t.newPostsLabel(3, 'Rui'), '3 publicações novas de Rui, abrir');
  assert.equal(t.newPostsLabel(12, 'Rui'), '9+ publicações novas de Rui, abrir');
  assert.equal(t.newPostsLabel(0, 'Rui'), '');
});

test('newPostsTarget: uma só abre a publicação; várias abrem o perfil', () => {
  assert.equal(t.newPostsTarget({ count: 1, latestId: 'abc' }, 'ana'), '/p/abc');
  assert.equal(t.newPostsTarget({ count: 2, latestId: 'abc' }, 'ana'), '/u/ana');
  assert.equal(t.newPostsTarget({ count: 15, latestId: 'abc' }, 'ana'), '/u/ana');
  // Sem id (não devia acontecer): vai para o perfil em vez de abrir uma publicação inexistente.
  assert.equal(t.newPostsTarget({ count: 1, latestId: null }, 'ana'), '/u/ana');
});

test('newPostsTarget: sem publicações novas (ou servidor antigo sem o campo) não há destino', () => {
  assert.equal(t.newPostsTarget({ count: 0, latestId: null }, 'ana'), null);
  assert.equal(t.newPostsTarget(undefined, 'ana'), null);
  assert.equal(t.newPostsTarget(null, 'ana'), null);
});

test('headerLine: "a escrever…" ganha, depois as publicações novas, depois a presença', () => {
  const np = { count: 2, latestId: 'x' };
  assert.equal(t.headerLine({ typing: true, newPosts: np, online: true }), 'typing');
  assert.equal(t.headerLine({ typing: false, newPosts: np, online: true }), 'newPosts');
  assert.equal(t.headerLine({ typing: false, newPosts: np, online: false }), 'newPosts');
  assert.equal(t.headerLine({ typing: false, newPosts: { count: 0, latestId: null }, online: true }), 'online');
  assert.equal(t.headerLine({ typing: false, newPosts: undefined, online: false }), 'presence');
  assert.equal(t.headerLine({ typing: false }), 'presence');
});
