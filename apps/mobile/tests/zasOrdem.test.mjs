// «Os meus Zás»: os mais recentes em cima (a API manda-os do mais antigo para o mais novo).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('a grelha dos meus Zás põe os mais recentes primeiro', () => {
  const src = readFileSync(new URL('../src/components/Instants.tsx', import.meta.url), 'utf8');
  assert.match(src, /export const newestFirst = <T extends \{ at: string \}>\(l: readonly T\[\]\): T\[\] => \[\.\.\.l\]\.sort\(\(x, y\) => Date\.parse\(y\.at\) - Date\.parse\(x\.at\)\);/);
  assert.match(src, /instantsApi\.archive\(username\)\.then\(\(l\) => setItems\(newestFirst\(l\)\)\)/);
});
