// Abrir /p/id a partir do Início ou de um perfil mostra logo a publicação que já está em memória, em vez de um ecrã vazio
// até a rede responder (src/lib/postCache.ts, app/p/[id].tsx).
// Correr em apps/mobile:  node --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const m = await import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'postCache.ts')).href);
const post = (id, extra = {}) => ({ id, body: 'olá', media: [], author: { id: 'a', username: 'ana', displayName: 'Ana' }, ...extra });

test('encontra a publicação num feed paginado, num perfil e dentro de uma repostagem', () => {
  const feed = { pages: [{ items: [post('1'), post('2')] }, { items: [post('3')] }], pageParams: [null, 'c'] };
  const profile = { posts: [post('9')] };
  const repost = { items: [post('r1', { kind: 'repost', repostOf: post('7') })] };
  assert.equal(m.findCachedPost([undefined, feed], '3').id, '3');
  assert.equal(m.findCachedPost([profile], '9').id, '9');
  assert.equal(m.findCachedPost([repost], '7').id, '7');
});

test('não confunde outras coisas com o mesmo id (um utilizador, uma notificação sem autor) e não encontra o que não há', () => {
  assert.equal(m.findCachedPost([{ id: '1', username: 'x' }, [{ id: '1', author: null, media: [] }]], '1'), undefined);
  assert.equal(m.findCachedPost([{ pages: [] }], '1'), undefined);
  assert.equal(m.findCachedPost([post('1')], ''), undefined);
});

test('tem limites: dados enormes ou com ciclos não pesam nem rebentam', () => {
  const a = { x: null };
  a.x = a; // ciclo
  assert.equal(m.findCachedPost([a], '1'), undefined);
  const big = Array.from({ length: 50_000 }, (_, i) => ({ id: String(i) }));
  big.push(post('fim'));
  assert.equal(m.findCachedPost([big], 'fim'), undefined, 'passa o limite de nós: desiste (mostra o carregador)');
  assert.equal(m.findCachedPost([big], 'fim', 100_000).id, 'fim');
});

test('a página da publicação usa a memória como placeholder e mostra um carregador em vez do vazio', () => {
  const s = readFileSync(path.join(ROOT, 'src', 'app', 'p', '[id].tsx'), 'utf8');
  assert.match(s, /placeholderData: \(\) => findCachedPost<Post>\(qc\.getQueryCache\(\)\.getAll\(\)\.map\(\(x\) => x\.state\.data\), id\)/);
  assert.match(s, /\{q\.isPending && !q\.data \? <ActivityIndicator/);
});
