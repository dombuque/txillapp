// A publicação volta a tentar sozinha quando a falha é passageira (sem rede, o servidor a reiniciar), em vez de «Erro inesperado».
// Correr em apps/mobile:  node --test tests/*.test.mjs
import { test } from 'node:test';
import './fixtures/alias.mjs';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const e = await import(new URL('../src/lib/apiErrors.ts', import.meta.url).href);

test('isTransient: rede, 0, 408, 502/503/504 sim; recusas 4xx e 500 não', () => {
  for (const x of [new TypeError('Load failed'), { status: 0 }, { status: 502 }, { status: 503 }, { status: 504 }, { status: 408 }, new Error('Network request failed')]) assert.equal(e.isTransient(x), true);
  for (const x of [{ status: 400 }, { status: 403 }, { status: 422 }, { status: 500 }, null, new Error('Esta foto não pode')]) assert.equal(e.isTransient(x), false);
  assert.equal(e.AUTO_RETRY_MS.length, 6);
});

test('a fila de publicação agenda a nova tentativa e a faixa avisa', () => {
  const q = readFileSync(new URL('../src/lib/publishQueue.ts', import.meta.url), 'utf8');
  assert.match(q, /if \(!rid\) \{ patch\(id, \{ sent: \[\.\.\.sent\] \}\); if \(scheduleRetry\(id, qc, e\)\) return; \}/);
  assert.match(q, /if \(!rid && scheduleRetry\(id, qc, e\)\) return;/);
  const b = readFileSync(new URL('../src/components/PublishBanner.tsx', import.meta.url), 'utf8');
  assert.match(b, /publishTask\.retrying && publishTask\.status === 'uploading' \? t\('Sem ligação ao servidor\. A tentar outra vez…'\)/);
});
