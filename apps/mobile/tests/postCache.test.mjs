// Testes da página da publicação (src/lib/postCache.ts): abre logo com o cartão que já estava no feed (sem ecrã vazio
// enquanto a rede responde) e distingue "já não existe" de "falhou a rede" (aí mostra Tentar outra vez).
// Correr em apps/mobile:  node --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const c = await import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'postCache.ts')).href);

const post = (id, extra = {}) => ({ id, code: `c${id}`, body: `post ${id}`, media: [], author: { id: 'a', username: 'ana', displayName: 'Ana' }, ...extra });
const pages = (...lists) => ({ pages: lists.map((items) => ({ items, nextCursor: null })), pageParams: [] });

test('encontra pelo id ou pelo código curto, em qualquer página', () => {
  const feed = pages([post('1'), post('2')], [post('3')]);
  assert.equal(c.findCachedPost([feed], '3')?.id, '3');
  assert.equal(c.findCachedPost([feed], 'c2')?.id, '2');
  assert.equal(c.findCachedPost([feed], 'nada'), undefined);
});

test('um repost simples no feed traz a original lá dentro', () => {
  const orig = post('9');
  const feed = pages([post('r1', { kind: 'repost', repostOf: orig })]);
  assert.equal(c.findCachedPost([feed], '9'), orig);
  assert.equal(c.findCachedPost([feed], 'r1')?.id, 'r1');
});

test('aceita listas, publicações soltas e entradas vazias ou com outra forma', () => {
  const one = post('5');
  assert.equal(c.findCachedPost([undefined, null, { posts: [] }, [post('4')], one], '5'), one);
  assert.equal(c.findCachedPost([[post('4')]], '4')?.id, '4');
  assert.equal(c.findCachedPost([pages([post('1')])], ''), undefined);
});

test('isGone: só 404/403/410 contam como "já não está disponível"', () => {
  assert.equal(c.isGone({ status: 404 }), true);
  assert.equal(c.isGone({ status: 403 }), true);
  assert.equal(c.isGone({ status: 410 }), true);
  assert.equal(c.isGone({ status: 500 }), false);
  assert.equal(c.isGone(new TypeError('Network request failed')), false);
  assert.equal(c.isGone(null), false);
});

test('a página da publicação usa o que já está carregado e tem "Tentar outra vez"', () => {
  const src = readFileSync(path.join(ROOT, 'src', 'app', 'p', '[id].tsx'), 'utf8');
  assert.match(src, /placeholderData: \(\) => findCachedPost\(/);
  assert.match(src, /'feed', 'profile-posts'/);
  assert.match(src, /Tentar outra vez/);
  assert.match(src, /q\.isLoading && <ActivityIndicator/);
  const reel = readFileSync(path.join(ROOT, 'src', 'app', 'r', '[id].tsx'), 'utf8');
  assert.match(reel, /q\.isError && !isGone\(q\.error\)/);
});

// Os casos do ramo ux-navegacao (a mesma função): perfis com { posts }, falsos positivos e limites.
test('encontra num perfil ({ posts }) e dentro de uma repostagem fora das páginas', () => {
  assert.equal(c.findCachedPost([{ posts: [post('9')] }], '9').id, '9');
  assert.equal(c.findCachedPost([{ items: [post('r1', { kind: 'repost', repostOf: post('7') })] }], '7').id, '7');
});

test('não confunde outras coisas com o mesmo id (um utilizador, uma notificação sem autor)', () => {
  assert.equal(c.findCachedPost([{ id: '1', username: 'x' }, [{ id: '1', author: null, media: [] }]], '1'), undefined);
  assert.equal(c.findCachedPost([{ pages: [] }], '1'), undefined);
});

test('tem limites: dados enormes ou com ciclos não pesam nem rebentam', () => {
  const a = { x: null };
  a.x = a; // ciclo
  assert.equal(c.findCachedPost([a], '1'), undefined);
  const big = Array.from({ length: 50_000 }, (_, i) => ({ id: String(i) }));
  big.push(post('fim'));
  assert.equal(c.findCachedPost([big], 'fim'), undefined, 'passa o limite de nós: desiste (mostra o carregador)');
  assert.equal(c.findCachedPost([big], 'fim', 100_000).id, 'fim');
});

test('sem a publicação nas listas, procura no resto da memória (pesquisa, notificações…)', () => {
  const src = readFileSync(path.join(ROOT, 'src', 'app', 'p', '[id].tsx'), 'utf8');
  assert.match(src, /findCachedPost<Post>\(qc\.getQueryCache\(\)\.getAll\(\)\.map\(\(x\) => x\.state\.data\), id\)/);
});
