// No PWA do iPhone a FlatList nem sempre recebe o scroll e ficava nas primeiras 10 linhas: nas Notificações o «Ver mais»
// trazia mais, mas nada aparecia. Na web, as listas das Notificações e das Mensagens desenham logo tudo o que já veio.
// Correr em apps/mobile:  node --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const src = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');
const read = (...p) => readFileSync(path.join(src, ...p), 'utf8');

for (const [name, file] of [['Notificações', ['app', 'notifications.tsx']], ['Mensagens', ['app', '(tabs)', 'messages.tsx']]]) {
  test(`${name}: na web a lista não virtualiza (o PWA do iPhone ficava nas primeiras linhas)`, () => {
    const s = read(...file);
    assert.match(s, /disableVirtualization=\{Platform\.OS === 'web'\}/);
    assert.match(s, /initialNumToRender=\{Platform\.OS === 'web' \? 200 : 12\}/);
    assert.match(s, /windowSize=\{Platform\.OS === 'web' \? 201 : 11\}/);
  });
}
