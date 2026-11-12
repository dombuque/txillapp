// A página de entrada no computador (src/components/Landing.tsx): duas colunas, até 1200 px, rodapé legal; telemóvel igual.
// Correr em apps/mobile:  node --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL('../src/' + p, import.meta.url), 'utf8');

test('landing no computador: duas colunas a partir de 1024, até 1200 px, rodapé legal; telemóvel igual', () => {
  const l = read('components/Landing.tsx');
  assert.match(l, /const wide = width >= 1024/);
  assert.match(l, /if \(Platform\.OS === 'web' && wide\) return <DesktopLanding/);
  assert.match(l, /maxWidth: 1200/);
  for (const to of ['/terms', '/privacy', '/apagar-conta', '/suporte']) assert.ok(l.includes(`'${to}'`), to);
  assert.match(l, /BETA_URL = '\/app\/beta\/'/);
  // A raiz deixa a landing e as páginas de entrar ocupar a janela no computador (antes ficavam presas na coluna de 576).
  const layout = read('app/_layout.tsx');
  assert.match(layout, /const wideOut = desktop && !user && \(pathname === '\/'/);
  assert.match(layout, /shell \|\| wideOut \|\| site \? styles\.desk : styles\.column/);
});
