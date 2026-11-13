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
  assert.equal(m.appealOutcome({ status: 'ready' }), 'approved');
  assert.equal(m.appealOutcome({ status: 'deleted' }), 'refused');
  assert.equal(m.appealOutcome({ status: 'rejected' }), 'waiting');
});

test('com o rascunho guardado no servidor: a faixa diz que se pode fechar a app e mostra o resultado', () => {
  assert.equal(m.appealText('held'), 'Pedido enviado. Publicamos sozinhos quando a equipa aprovar; podes fechar a app.');
  assert.match(m.appealText('published'), /já está publicado/);
  assert.equal(m.canAppeal('held'), false);
  assert.equal(m.appealOutcome({ status: 'rejected', held: { status: 'held' } }), 'waiting');
  assert.equal(m.appealOutcome({ status: 'ready', held: { status: 'held' } }), 'waiting'); // aprovada: o servidor está a publicar
  assert.equal(m.appealOutcome({ status: 'ready', held: { status: 'published' } }), 'published');
  assert.equal(m.appealOutcome({ status: 'ready', held: { status: 'failed', error: 'x' } }), 'held_failed');
  assert.equal(m.appealOutcome({ status: 'ready', held: { status: 'expired' } }), 'held_failed');
  assert.equal(m.appealOutcome({ status: 'deleted', held: { status: 'discarded' } }), 'refused');
});

test('a faixa e a fila: «Pedir revisão» manda o rascunho (publicação, mimo e Zás) para POST /media/:id/appeal', () => {
  const q = read('lib', 'publishQueue.ts');
  assert.ok(q.includes("raw(`/media/${assetId}/appeal`, { method: 'POST', body: JSON.stringify(draft ? { draft } : {}) })"));
  assert.ok(q.includes('sent[i] = rid;'), 'a foto recusada fica guardada na tarefa (não se envia de novo)');
  assert.ok(q.includes('rejected ??= e;'), 'os outros ficheiros sobem na mesma (o rascunho leva-os todos)');
  assert.ok(q.includes("return { kind: 'post', payload: { ...b, music: b.remixOf && b.music === null ? null : musicPayload(b.music), mediaIds: t.sent as string[] } };"));
  assert.ok(read('app', 'stories', 'new.tsx').includes("kind: 'story', payload: { mediaId, caption: text, audience: who, music: musicPayload(track), stickers: placed }"));
  assert.ok(read('components', 'Instants.tsx').includes("kind: 'instant', payload: { mediaId, caption: text, audience: who }"));
  const b = read('components', 'PublishBanner.tsx');
  assert.match(b, /Pedir revisão/);
  assert.ok(b.includes("? 'Fechar' : 'Descartar'"));
  // O ApiError leva o resto da resposta (assetId) no envio (XHR) e nos pedidos normais.
  const api = read('lib', 'api.ts');
  assert.match(api, /public extra\?: Record<string, unknown>/);
  assert.match(api, /reject\(new ApiError\(x\.status, msg, typeof body\?\.code === 'string' \? body\.code : undefined, body\)\)/);
});
