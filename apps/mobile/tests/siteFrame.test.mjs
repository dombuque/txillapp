import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');

test('no computador, termos, privacidade, ajuda e apagar a conta abrem como página do site', () => {
  const layout = read('app/_layout.tsx');
  assert.match(layout, /const site = desktop && !shell && isSitePage\(segments\[0\]\);/);
  assert.match(layout, /site \? <SiteFrame segment=\{segments\[0\]\}>\{stack\}<\/SiteFrame>/);
  const frame = read('components/SiteFrame.tsx');
  for (const seg of ['terms', 'termos', 'privacy', 'privacidade', 'help', 'suporte', 'apagar-conta']) assert.ok(frame.includes(`'${seg}'`), seg);
  assert.match(frame, /maxWidth: 860/);
});

test('no computador as barras de deslocamento são finas e sem setas em todo o lado', () => {
  const css = readFileSync(new URL('../src/lib/deskScroll.ts', import.meta.url), 'utf8');
  assert.match(css, /\*\{scrollbar-width:thin;/);
  assert.match(css, /\*::-webkit-scrollbar-button\{display:none/);
});
