// «Pedir revisão» de uma foto recusada pela verificação automática (src/lib/photoAppeal.ts, publishQueue e PublishBanner).
// Correr em apps/mobile:  node --experimental-strip-types --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const m = await import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'photoAppeal.ts')).href);
const read = (...p) => readFileSync(path.join(ROOT, 'src', ...p), 'utf8');

test('reconhece a foto recusada pela resposta 422 do servidor (code + assetId)', () => {
  assert.equal(m.rejectedPhotoId({ status: 422, code: 'nudity_rejected', extra: { assetId: 'abc' } }), 'abc');
  assert.equal(m.rejectedPhotoId({ status: 422, code: 'nudity_rejected', extra: {} }), null);
  assert.equal(m.rejectedPhotoId({ status: 422, message: 'outro erro' }), null);
  assert.equal(m.rejectedPhotoId({ status: 503, code: 'nudity_rejected', extra: { assetId: 'abc' } }), null);
  assert.equal(m.rejectedPhotoId(new Error('x')), null);
  assert.equal(m.rejectedPhotoId(null), null);
});

test('estados do pedido: quando se pode tocar em «Pedir revisão» e o que a faixa diz', () => {
  assert.equal(m.canAppeal('available'), true);
  assert.equal(m.canAppeal('failed'), true);
  assert.equal(m.canAppeal('pending'), false);
  assert.equal(m.canAppeal('refused'), false);
  assert.equal(m.appealText('available'), null); // fica a mensagem do servidor, com «Pedir revisão»
  assert.match(m.appealText('pending'), /segue sozinha/);
  assert.match(m.appealText('refused'), /manteve a recusa/);
  assert.equal(m.appealOutcome('ready'), 'approved');
  assert.equal(m.appealOutcome('deleted'), 'refused');
  assert.equal(m.appealOutcome('rejected'), 'waiting');
});

test('a faixa e a fila: «Pedir revisão» chama POST /media/:id/appeal, e a publicação segue quando a foto é aprovada', () => {
  const q = read('lib', 'publishQueue.ts');
  assert.match(q, /\/media\/\$\{t\.appeal\.assetId\}\/appeal`, \{ method: 'POST' \}/);
  assert.match(q, /if \(rid\) sent\[i\] = rid;/, 'a foto recusada fica guardada na tarefa (não se envia de novo)');
  assert.match(q, /void run\(id, qc\);/);
  const b = read('components', 'PublishBanner.tsx');
  assert.match(b, /Pedir revisão/);
  assert.match(b, /Descartar/);
  // O ApiError leva o resto da resposta (assetId) no envio (XHR) e nos pedidos normais.
  const api = read('lib', 'api.ts');
  assert.match(api, /public extra\?: Record<string, unknown>/);
  assert.match(api, /reject\(new ApiError\(x\.status, msg, typeof body\?\.code === 'string' \? body\.code : undefined, body\)\)/);
});
