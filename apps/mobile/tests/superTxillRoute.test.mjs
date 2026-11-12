import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');

test('o SuperTxill é um ecrã da pilha: arrastar para trás volta às Mensagens (ou à Pesquisa), não ao início', () => {
  const route = read('app/supertxill.tsx');
  assert.match(route, /router\.canGoBack\(\) \? router\.back\(\) : router\.replace\('\/messages'/);
  const panel = read('components/SuperTxillPanel.tsx');
  assert.doesNotMatch(panel, /<Modal/);
  for (const f of ['app/(tabs)/messages.tsx', 'app/search.tsx']) {
    const src = read(f);
    assert.match(src, /router\.push\('\/supertxill' as never\)/, f);
    assert.doesNotMatch(src, /SuperTxillPanel onClose/, f);
  }
});

test('a Malta para ti tem pesquisa de pessoas (nome ou @), com os resultados da mesma pesquisa da lupa', () => {
  const panel = readFileSync(new URL('../src/components/SuperTxillPanel.tsx', import.meta.url), 'utf8');
  assert.match(panel, /placeholder="Procurar malta pelo nome ou @"/);
  assert.match(panel, /queryFn: \(\) => api\.search\(term\), enabled: finding/);
  assert.match(panel, /setTerm\(text\.trim\(\)\.replace\(\/\^@\/, ''\)\)/);
});
