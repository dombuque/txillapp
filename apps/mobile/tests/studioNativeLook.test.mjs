// Estúdio nativo: a aproximação dos filtros nos vídeos da pré-visualização (as fotos usam a matriz verdadeira).
// Correr em apps/mobile:  node --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mod = (x) => import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'studio', x)).href);
const L = await mod('nativeLook.ts');
const fx = await mod('effects.ts');
const look = (id, amount = 1) => { const p = fx.resolveFx({ filter: { id, amount } }); return L.videoLook(p.matrix, p.vignette); };

test('sem filtro não há nada por cima', () => {
  assert.equal(L.videoLook(fx.IDENTITY).none, true);
  assert.equal(look('normal').none, true);
});

test('P&B tira a cor toda; a meio, metade', () => {
  assert.equal(look('pb').desaturate, 1);
  assert.ok(Math.abs(look('pb', 0.5).desaturate - 0.5) < 0.05);
});

test('Limpopo puxa para o laranja, Noite de Maputo para o frio, e as vinhetas passam', () => {
  const l = look('limpopo');
  assert.ok(l.tint);
  const [r, , b] = [1, 3, 5].map((i) => parseInt(l.tint.color.slice(i, i + 2), 16));
  assert.ok(r > b, 'quente');
  const n = look('noite-de-maputo');
  assert.ok(parseInt(n.tint.color.slice(5, 7), 16) > parseInt(n.tint.color.slice(1, 3), 16), 'frio');
  assert.equal(n.vignette, 0.45);
  assert.equal(look('xima').light?.color, '#ffffff');
});

test('todos os filtros dão valores dentro dos limites', () => {
  for (const f of fx.FILTERS) {
    const l = look(f.id);
    assert.ok(l.desaturate >= 0 && l.desaturate <= 1, f.id);
    if (l.tint) assert.ok(l.tint.alpha > 0 && l.tint.alpha <= 0.55 && /^#[0-9a-f]{6}$/.test(l.tint.color), f.id);
    if (l.light) assert.ok(l.light.alpha <= 0.35, f.id);
  }
});
