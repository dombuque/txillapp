// Só os @ de contas que existem são ligação (src/lib/mentionExists.ts e src/components/RichText.tsx).
// Correr em apps/mobile:  node --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const m = await import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'mentionExists.ts')).href);

test('junta os nomes de vários textos num pedido e guarda a resposta', async () => {
  const calls = [];
  const check = m.createMentionChecker(async (names) => { calls.push(names); return names.filter((n) => n !== 'kulenaha'); });
  const [a, b] = await Promise.all([check(['Ana', 'kulenaha']), check(['rui', 'ana'])]);
  assert.deepEqual(a, { ana: true, kulenaha: false });
  assert.deepEqual(b, { rui: true, ana: true });
  assert.equal(calls.length, 1, 'um só pedido');
  assert.deepEqual(calls[0].sort(), ['ana', 'kulenaha', 'rui']);
  assert.deepEqual(await check(['kulenaha']), { kulenaha: false });
  assert.equal(calls.length, 1, 'da segunda vez já se sabe');
});

test('mais de 20 nomes vão em vários pedidos; sem rede conta como «existe» e não se guarda', async () => {
  const calls = [];
  let fail = true;
  const check = m.createMentionChecker(async (names) => { calls.push(names.length); if (fail) throw new Error('rede'); return names; });
  const many = Array.from({ length: 25 }, (_, i) => `nome${i}`);
  const r = await check(many);
  assert.deepEqual(calls, [20, 5]);
  assert.ok(Object.values(r).every((v) => v === true));
  fail = false;
  await check(['nome1']);
  assert.equal(calls.length, 3, 'tenta outra vez depois da falha');
});

test('o RichText só faz ligação dos @ que existem', () => {
  const src = readFileSync(path.join(ROOT, 'src', 'components', 'RichText.tsx'), 'utf8');
  assert.match(src, /queryKey: \['mention-exists', names\.join\(','\)\]/);
  assert.match(src, /if \(known === false\) \{\s*out\.push\(`\$\{mark\}\$\{name\}`\);/);
  assert.match(src, /onPress=\{known \? \(\) => router\.push/);
});
