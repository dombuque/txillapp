// «Ganhaste o selo!»: a celebração quando a equipa dá um selo (pedido aceite ou à mão no backoffice).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = (f) => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8');

test('a celebração pergunta ao servidor, mostra uma vez e marca como vista', () => {
  const s = read('components/BadgeCelebration.tsx');
  assert.match(s, /queryKey: \['badge-news', user\?\.id\], queryFn: api\.badgeNews/);
  assert.match(s, /void api\.badgeNewsSeen\(news\.id\)/);
  assert.match(s, /<VerifiedBadge size=\{104\}/);
  assert.match(s, /export const CONFETTI_COUNT = 28;/);
  // Reduzir movimento: sem papelinhos nem molas.
  assert.match(s, /\{!reduce \? Array\.from\(\{ length: CONFETTI_COUNT \}/);
  assert.match(read('app/_layout.tsx'), /<BadgeCelebration \/>/);
  assert.match(read('lib/api.ts'), /badgeNews: \(\): Promise<\{ news: \{ id: string; tier: string \} \| null \}> => raw\('\/verification\/news'\)/);
});

test('os avisos do selo da própria conta: do Txillapp, com o motivo; tirar o selo não celebra', () => {
  const n = read('app/notifications.tsx');
  assert.match(n, /if \(n\.data\.removed\) return \{ text: t\('A equipa do Txillapp retirou o selo da tua conta\.'\)/);
  assert.match(n, /t\('Motivo: \{note\}', \{ note: n\.data\.reason \}\)/);
  assert.match(n, /const badgeNotice = n\.kind === 'verified' && !!n\.data\.self;/);
  const c = read('components/BadgeCelebration.tsx');
  assert.match(c, /quem te encontra sabe que és tu de verdade/);
});
