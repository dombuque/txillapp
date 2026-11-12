// Erros de rede em português (src/lib/netError.ts e lib/api.ts): sem rede, o fetch lança textos em inglês diferentes em
// cada browser ("Failed to fetch", "Load failed"…) que iam parar ao ecrã de entrar, ao registo e a muitas folhas.
// Correr em apps/mobile:  node --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { friendlyFetchError, OFFLINE_TEXT } = await import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'netError.ts')).href);

test('os erros de rede de cada sítio passam a uma frase em português (e continuam TypeError)', () => {
  for (const m of ['Failed to fetch', 'Load failed', 'NetworkError when attempting to fetch resource.', 'Network request failed']) {
    const e = friendlyFetchError(new TypeError(m));
    assert.ok(e instanceof TypeError, m);
    assert.equal(e.message, OFFLINE_TEXT, m);
  }
  assert.match(OFFLINE_TEXT, /^Sem ligação à internet/);
});

test('o resto passa como está: outros TypeError, cancelamentos e erros do servidor', () => {
  const t = new TypeError('x is not a function');
  assert.equal(friendlyFetchError(t), t);
  const abort = Object.assign(new Error('The operation was aborted'), { name: 'AbortError' });
  assert.equal(friendlyFetchError(abort), abort);
  const other = new Error('Hmm');
  assert.equal(friendlyFetchError(other), other);
});

test('lib/api.ts passa todos os pedidos por friendlyFetchError', () => {
  const src = readFileSync(path.join(ROOT, 'src', 'lib', 'api.ts'), 'utf8');
  const call = src.slice(src.indexOf('async function call('), src.indexOf('async function parse('));
  assert.match(call, /throw friendlyFetchError\(e\)/);
});
