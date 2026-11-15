// Pedidos para seguir no topo das Notificações (como no Instagram): a linha abre a folha de aceitar ou recusar.
// Correr em apps/mobile:  node --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(path.join(ROOT, 'src', 'app', 'notifications.tsx'), 'utf8').replace(/\r\n/g, '\n');

test('a linha dos pedidos aparece no topo (Todas e Seguidores) só quando há pedidos e abre a folha', () => {
  assert.match(src, /const showReq = reqList\.length > 0 && \(filter === 'all' \|\| filter === 'follows'\);/);
  assert.match(src, /\.\.\.\(showReq \? \[\{ kind: 'req' as const, id: 'req' \}\] : \[\]\),\n\s+\.\.\.\(fresh\.length > 0/);
  assert.match(src, /onPress=\{\(\) => setReqOpen\(true\)\}/);
  assert.match(src, /<RequestsSheet username=\{user\.username\} onClose=\{\(\) => setReqOpen\(false\)\} \/>/);
  assert.match(src, /queryKey: \['requests'\], queryFn: api\.followRequests/);
});

test('o texto por baixo diz quem pediu', () => {
  const m = src.match(/export function requestsLine\(names: string\[\]\): string \{([\s\S]*?)\n\}/);
  assert.ok(m, 'requestsLine');
  const fn = new Function('names', m[1]);
  assert.equal(fn([]), 'Aprovar ou recusar pedidos');
  assert.equal(fn(['ana']), 'Aprovar ou recusar · @ana');
  assert.equal(fn(['ana', 'rui', 'zé']), 'Aprovar ou recusar · @ana e mais 2');
});
