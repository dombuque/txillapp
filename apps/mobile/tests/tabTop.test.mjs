// Tocar outra vez no separador em que já estás volta ao topo: Início (já existia), Mensagens e Perfil; e o mesmo na
// barra lateral do computador (src/lib/tabPress.ts, sameTabPress).
// Correr em apps/mobile:  node --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tp = await import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'tabPress.ts')).href);
const src = (p) => readFileSync(path.join(ROOT, 'src', p), 'utf8');

test('sameTabPress: só no próprio ecrã; com uma conversa aberta, «Mensagens» volta à lista em vez de rolar', () => {
  assert.equal(tp.sameTabPress('home', '/'), 'index');
  assert.equal(tp.sameTabPress('messages', '/messages'), 'messages');
  assert.equal(tp.sameTabPress('messages', '/messages/ana'), null);
  assert.equal(tp.sameTabPress('profile', '/profile'), 'profile');
  assert.equal(tp.sameTabPress('profile', '/u/ana'), null);
  assert.equal(tp.sameTabPress('search', '/search'), null);
});

test('Mensagens e Perfil voltam ao topo ao tocar outra vez; a barra lateral usa sameTabPress', () => {
  const m = src('app/(tabs)/messages.tsx');
  assert.match(m, /useTabPress\('messages', \(\) => listRef\.current\?\.scrollToOffset\(\{ offset: 0, animated: true \}\)\)/);
  assert.match(m, /<FlatList\s+ref=\{listRef\}/);
  const p = src('components/ProfileView.tsx');
  assert.match(p, /useTabPress\('profile', \(\) => listRef\.current\?\.scrollToOffset\(\{ offset: 0, animated: true \}\)\)/);
  assert.match(p, /<FlatList ref=\{listRef\} data=\{\[\] as never\[\]\}/);
  const d = src('components/DesktopShell.tsx');
  assert.match(d, /const tab = sameTabPress\(it\.key, path\);\s+if \(tab\) return emitTabPress\(tab\);/);
});
