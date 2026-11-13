// Testes da geleira partilhada num post (src/lib/geleiraPost.ts) e do texto dos brindes do dono (src/lib/geleiraCheers.ts).
// Correr em apps/mobile:  node --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const g = await import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'geleiraPost.ts')).href);
const c = await import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'geleiraCheers.ts')).href);

const it = (id, kind, extra = {}) => ({ id, kind, name: id, cheers: 0, cheered: false, ...extra });

test('shelvesOf: bebidas primeiro, depois comidas, sem misturar; a ordem do retrato fica', () => {
  const geleira = { total: 6, items: [it('c1', 'comida'), it('b1', 'bebida'), it('b2', 'bebida'), it('c2', 'comida'), it('b3', 'bebida'), it('c3', 'comida')] };
  const r = g.shelvesOf(geleira, 2);
  assert.deepEqual(r.shelves.map((s) => [s.kind, s.items.map((i) => i.id)]), [['bebida', ['b1', 'b2']], ['bebida', ['b3']], ['comida', ['c1', 'c2']], ['comida', ['c3']]]);
  assert.equal(r.more, 0);
});

test('shelvesOf: com limite de prateleiras, "more" conta o que fica de fora, também o que não entrou no retrato', () => {
  const items = Array.from({ length: 10 }, (_, k) => it(`b${k}`, 'bebida'));
  const r = g.shelvesOf({ total: 60, items }, 4, 2);
  assert.equal(r.shelves.length, 2);
  assert.equal(r.shelves.flatMap((s) => s.items).length, 8);
  assert.equal(r.more, 52);
  assert.equal(g.shelvesOf({ total: 'x', items }, 4, 1).more, 6);
  assert.deepEqual(g.shelvesOf({ total: 0, items: [] }, 4).shelves, []);
});

test('toggleItemCheer / applyItemCheer: resposta já e acerto com o servidor, sem mexer nos outros', () => {
  const geleira = { total: 2, items: [it('a', 'bebida', { cheers: 2 }), it('b', 'comida', { cheers: 0 })] };
  const on = g.toggleItemCheer(geleira, 'a');
  assert.deepEqual(on.items[0], { ...geleira.items[0], cheered: true, cheers: 3 });
  assert.equal(on.items[1], geleira.items[1]);
  assert.notEqual(on, geleira);
  const off = g.toggleItemCheer(on, 'a');
  assert.equal(off.items[0].cheers, 2);
  assert.equal(off.items[0].cheered, false);
  // Nunca abaixo de 0.
  assert.equal(g.toggleItemCheer({ total: 1, items: [it('z', 'comida', { cheers: 0, cheered: true })] }, 'z').items[0].cheers, 0);
  const fixed = g.applyItemCheer(on, { itemId: 'a', cheered: true, cheers: 7 });
  assert.equal(fixed.items[0].cheers, 7);
  assert.equal(g.applyItemCheer(on, { itemId: 'a', cheered: false, cheers: -1 }).items[0].cheers, 0);
});

test('textos: gostos, leitor de ecrã e o motivo para não partilhar', () => {
  assert.equal(g.tastesCount(1), '1 gosto');
  assert.equal(g.tastesCount(12), '12 gostos');
  assert.equal(g.tastesCount(undefined), '0 gostos');
  assert.equal(g.itemA11yLabel({ name: 'Matapa', cheers: 0 }, false), 'Brindar a Matapa');
  assert.equal(g.itemA11yLabel({ name: 'Matapa', cheers: 3, cheered: true, favorite: true }, false), 'Matapa, favorito, 3 brindes. Tirar o brinde');
  assert.equal(g.itemA11yLabel({ name: 'Matapa', cheers: 1 }, true), 'Matapa, 1 brinde');
  assert.match(g.shareBlockReason([]), /vazia/);
  assert.match(g.shareBlockReason([{ kind: 'vibe' }, { kind: 'bebida', pending: true }]), /vazia/);
  assert.equal(g.shareBlockReason([{ kind: 'comida' }]), null);
  assert.equal(g.visibilityNote('everyone', false), null);
  assert.match(g.visibilityNote('everyone', true), /privada/);
  assert.match(g.visibilityNote('followers', false), /só para quem te segue/);
  assert.match(g.visibilityNote('me', false), /só para ti/);
});

test('ownerCheersText: "🥂 12 brindes à tua geleira"; sem brindes, nada', () => {
  assert.equal(c.ownerCheersText(12), '🥂 12 brindes à tua geleira');
  assert.equal(c.ownerCheersText(1), '🥂 1 brinde à tua geleira');
  assert.equal(c.ownerCheersText(0), '');
  assert.equal(c.ownerCheersText(-2), '');
});

test('duplo toque no meio do post da geleira brinda o post (como nas fotos)', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../src/components/PostCard.tsx', import.meta.url), 'utf8');
  assert.match(src, /<DoubleTapArea onDouble=\{\(\) => void brindar\(\)\}[^>]*>\s*<GeleiraPostCard/);
  assert.match(src, /function DoubleTapArea[\s\S]*useTap\(onDouble\)[\s\S]*dblclick/);
});
