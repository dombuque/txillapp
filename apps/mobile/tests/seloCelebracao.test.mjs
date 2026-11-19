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
