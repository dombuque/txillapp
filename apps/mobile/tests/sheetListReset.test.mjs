// Folhas na web (src/components/Sheet.tsx e ListReset): uma FlatList dentro de uma folha aberta a partir do feed (os
// comentários) tem de ter scroll. O React passa o contexto da lista do feed pelo portal do Modal e o react-native-web
// desenhava a lista de dentro como uma View simples, sem scroll (nem a roda, nem o dedo).
// Correr em apps/mobile:  node --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL('../src/' + p, import.meta.url), 'utf8');

test('a folha recomeça o contexto das listas (os comentários voltam a rolar na web)', () => {
  const sheet = read('components/Sheet.tsx');
  assert.match(sheet, /import \{ ListReset \} from '\.\/ListReset';/);
  assert.match(sheet, /<ListReset>/);
  const web = read('components/ListReset.web.tsx');
  assert.match(web, /from 'react-native-web\/dist\/vendor\/react-native\/VirtualizedList\/VirtualizedListContext'/);
  assert.match(web, /<VirtualizedListContextResetter>\{children\}<\/VirtualizedListContextResetter>/);
  // Na app nativa o Modal já o faz: o ListReset nativo só devolve os filhos.
  assert.match(read('components/ListReset.tsx'), /return <>\{children\}<\/>;/);
});
