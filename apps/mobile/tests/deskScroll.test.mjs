// A roda do rato no computador (src/lib/deskScroll.ts): fora da coluna também rola, a barra vê-se, e no telemóvel nada muda.
// Correr em apps/mobile:  node --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const d = await import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'deskScroll.ts')).href);
const read = (p) => readFileSync(path.join(ROOT, 'src', p), 'utf8');

/** Um elemento falso: { overflowY, scrollTop, scrollHeight, clientHeight } e o pai. */
const node = (o, parentElement = null) => ({ parentElement, scrollTop: 0, scrollHeight: 100, clientHeight: 100, overflowY: 'visible', ...o });
const style = (el) => ({ overflowY: el.overflowY });

test('wheelPixels: píxeis, linhas (×16) e páginas', () => {
  assert.equal(d.wheelPixels({ deltaY: 120 }), 120);
  assert.equal(d.wheelPixels({ deltaY: 3, deltaMode: 1 }), 48);
  assert.equal(d.wheelPixels({ deltaY: 1, deltaMode: 2 }, 700), 700);
});

test('nativeHandles: dentro da lista que rola é o browser; numa margem (nada que role) somos nós', () => {
  const body = node({ overflowY: 'hidden' });
  const list = node({ overflowY: 'auto', scrollHeight: 3000, clientHeight: 900 }, body);
  const card = node({}, list);
  const gutter = node({}, body);
  assert.equal(d.nativeHandles(card, 100, style), true);
  assert.equal(d.nativeHandles(gutter, 100, style), false);
  // No topo, para cima, a lista não anda: não é do browser.
  assert.equal(d.nativeHandles(card, -100, style), false);
  // Uma coluna com scroll mas sem conteúdo a mais (a da direita, curta) não conta.
  const rail = node({ overflowY: 'auto', scrollHeight: 400, clientHeight: 900 }, body);
  assert.equal(d.nativeHandles(node({}, rail), 100, style), false);
});

test('scrollerOf e canMove: a lista certa e só enquanto ainda anda', () => {
  const list = node({ overflowY: 'scroll', scrollHeight: 2000, clientHeight: 800 });
  const inner = node({ overflowY: 'hidden' }, list);
  assert.equal(d.scrollerOf(inner, style), list);
  assert.equal(d.canMove(list, 50), true);
  list.scrollTop = 1200;
  assert.equal(d.canMove(list, 50), false);
  assert.equal(d.canMove(list, -50), true);
});

test('ecrãs com roda própria (tchekas, mimos, mapa) e as Mensagens (outra equipa) ficam de fora', () => {
  for (const p of ['/messages', '/messages/ana', '/reels', '/r/abc', '/stories/ana', '/m/ana', '/perto']) assert.equal(d.deskScrollSkips(p), true, p);
  for (const p of ['/', '/profile', '/u/ana', '/notifications', '/search', '/settings', '/locais', '/help', '/terms']) assert.equal(d.deskScrollSkips(p), false, p);
});

test('só se instala com rato (hover + pointer fine): no telemóvel não faz nada', () => {
  const src = read('lib/deskScroll.ts');
  assert.match(src, /\(hover: hover\) and \(pointer: fine\)/);
  assert.match(src, /!finePointer\(\)\) return \(\) => undefined/);
  // Com uma folha ou visor aberto a roda é deles.
  assert.match(src, /\[aria-modal="true"\]/);
  // A barra de deslocamento volta a ver-se na lista principal.
  assert.match(src, /\[data-tx-scroll\]\{scrollbar-width:thin!important/);
  const layout = read('app/_layout.tsx');
  assert.match(layout, /installDeskScroll\(\)/);
  assert.match(read('components/DesktopShell.tsx'), /nativeID="tx-main"/);
});
