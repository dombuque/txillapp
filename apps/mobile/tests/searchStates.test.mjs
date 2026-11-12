// Testes dos estados da pesquisa (src/app/search.tsx):
// - a cada letra os resultados desapareciam e voltavam (vazio, roda, resultados): agora os anteriores ficam até chegarem os novos;
// - o erro da pesquisa não tinha "Tentar outra vez" e o Explorar, sem rede, ficava em branco.
// Correr em apps/mobile:  node --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(path.join(ROOT, 'src', 'app', 'search.tsx'), 'utf8');

test('pesquisa e menções mantêm os resultados anteriores enquanto carregam', () => {
  assert.match(src, /queryKey: \['search', term\][^\n]*placeholderData: keepPreviousData/);
  assert.match(src, /queryKey: \['search-mentions', handle\][^\n]*placeholderData: keepPreviousData/);
});

test('erro da pesquisa e do Explorar com Tentar outra vez', () => {
  assert.match(src, /onPress=\{\(\) => void q\.refetch\(\)\}/);
  assert.match(src, /explore\.isError && grid\.length === 0/);
  assert.match(src, /onPress=\{\(\) => void explore\.refetch\(\)\}/);
});
