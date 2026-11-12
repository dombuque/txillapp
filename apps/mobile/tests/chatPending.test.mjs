// Testes do envio otimista do chat (src/lib/chatPending.ts): a bolha aparece logo, não pisca quando o servidor
// confirma (sem "A enviar…" no primeiro instante, a mesma chave na lista antes e depois), e quando falha fica lá com
// "Tentar de novo" (o texto não se perde).
// Correr em apps/mobile:  node --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const p = await import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'chatPending.ts')).href);

const C = 'u:sara';
/** Uma promessa que se resolve (ou falha) quando o teste quiser. */
function later() {
  let ok, ko;
  const promise = new Promise((a, b) => { ok = a; ko = b; });
  return { promise, ok, ko };
}
const server = (...ids) => ids.map((id) => ({ id, fromMe: false, body: id, kind: 'text', at: '2026-11-12T10:00:00Z' }));

test('a bolha aparece logo, em cima das do servidor, sem "A enviar…" no primeiro instante', async () => {
  p.resetPending();
  const d = later();
  const sent = p.sendPending(C, { kind: 'text', body: 'olá' }, () => d.promise);
  const list = p.mergePending(server('m2', 'm1'), p.pendingOf(C));
  assert.equal(list.length, 3);
  assert.equal(list[0].body, 'olá');
  assert.equal(list[0].fromMe, true);
  assert.match(list[0].id, /^tmp-/);
  assert.equal(list[0].state, undefined, 'sem "A enviar…" (nem esbatida) logo ao tocar em Enviar');
  d.ok({ id: 'm3' });
  assert.equal(await sent, true);
});

test('quando o servidor confirma: o id verdadeiro e a MESMA chave na lista (não remonta, não pisca)', async () => {
  p.resetPending();
  const d = later();
  let refetched = 0;
  const sent = p.sendPending(C, { kind: 'text', body: 'olá' }, () => d.promise, { onSent: () => refetched++ });
  const tmp = p.pendingOf(C)[0].id;
  d.ok({ id: 'm3' });
  await sent;
  assert.equal(refetched, 1, 'pede as mensagens outra vez');
  // Confirmada mas o refetch ainda não chegou: continua lá, já com o id do servidor.
  let list = p.mergePending(server('m2', 'm1'), p.pendingOf(C));
  assert.equal(list[0].id, 'm3');
  assert.equal(list[0].state, undefined);
  assert.equal(p.listKey(list[0].id), tmp);
  // O refetch traz a mensagem: não aparece duas vezes e a chave é a mesma de quando estava a caminho.
  list = p.mergePending(server('m3', 'm2', 'm1'), p.pendingOf(C));
  assert.deepEqual(list.map((m) => m.id), ['m3', 'm2', 'm1']);
  assert.equal(p.listKey('m3'), tmp);
  p.prunePending(C, new Set(['m3', 'm2', 'm1']));
  assert.equal(p.pendingOf(C).length, 0);
  assert.equal(p.listKey('m3'), tmp, 'a chave fica depois de sair das pendentes');
  assert.equal(p.listKey('m2'), 'm2');
});

test('um refetch que já ia a caminho (sem a mensagem) não a faz desaparecer', async () => {
  p.resetPending();
  const d = later();
  const sent = p.sendPending(C, { kind: 'text', body: 'olá' }, () => d.promise);
  d.ok({ id: 'm9' });
  await sent;
  const list = p.mergePending(server('m2', 'm1'), p.pendingOf(C));
  assert.deepEqual(list.map((m) => m.id), ['m9', 'm2', 'm1']);
});

test('demora: passa a mostrar "A enviar…" (depois de SLOW_MS)', async (t) => {
  p.resetPending();
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const d = later();
  const sent = p.sendPending(C, { kind: 'text', body: 'devagar' }, () => d.promise);
  assert.equal(p.mergePending([], p.pendingOf(C))[0].state, undefined);
  t.mock.timers.tick(p.SLOW_MS + 1);
  assert.equal(p.mergePending([], p.pendingOf(C))[0].state, 'sending');
  d.ok({ id: 'x1' });
  await sent;
  assert.equal(p.mergePending([], p.pendingOf(C))[0].state, undefined);
  t.mock.timers.reset();
});

test('falhou: fica com "Não enviada"; tentar de novo envia o mesmo; apagar tira-a', async () => {
  p.resetPending();
  let calls = 0;
  let fail = true;
  const send = () => { calls++; return fail ? Promise.reject(new Error('sem rede')) : Promise.resolve({ id: 'm5' }); };
  assert.equal(await p.sendPending(C, { kind: 'text', body: 'não te perco' }, send), false);
  let [b] = p.mergePending([], p.pendingOf(C));
  assert.equal(b.state, 'failed');
  assert.equal(b.body, 'não te perco');
  fail = false;
  assert.equal(await p.retryPending(C, b.id), true);
  assert.equal(calls, 2);
  [b] = p.mergePending([], p.pendingOf(C));
  assert.equal(b.id, 'm5');
  // Apagar uma que falhou
  fail = true;
  await p.sendPending(C, { kind: 'text', body: 'outra' }, send);
  const failed = p.pendingOf(C).find((x) => x.state === 'failed');
  p.dropPending(C, failed.id);
  assert.equal(p.pendingOf(C).some((x) => x.id === failed.id), false);
  // Só se tenta de novo uma que falhou.
  assert.equal(await p.retryPending(C, 'nada'), false);
});

test('cada conversa tem as suas; a lista do servidor passa tal e qual quando não há nada a caminho', async () => {
  p.resetPending();
  const s = server('a');
  assert.equal(p.mergePending(s, p.pendingOf(C)), s);
  await p.sendPending('g:42', { kind: 'sticker', body: 'brinde' }, () => Promise.reject(new Error('x')));
  assert.equal(p.pendingOf(C).length, 0);
  assert.equal(p.pendingOf('g:42').length, 1);
  assert.equal(p.pendingOf(C), p.pendingOf(C), 'a mesma referência (useSyncExternalStore)');
});

test('pendingFrom: texto, sticker e GIF (com a citação da resposta); fotos e voz não', () => {
  assert.deepEqual(p.pendingFrom({ body: 'olá' }), { kind: 'text', body: 'olá', replyTo: null });
  assert.equal(p.pendingFrom({ body: '   ' }), null);
  assert.equal(p.pendingFrom({ kind: 'image', body: 'legenda' }), null);
  assert.equal(p.pendingFrom({ kind: 'voice' }), null);
  assert.equal(p.pendingFrom({ kind: 'gif' }), null);
  const gif = { id: 'g', w: 200, h: 100, url: 'https://x/y.gif' };
  assert.deepEqual(p.pendingFrom({ kind: 'gif', gif }), { kind: 'gif', body: '', gif, replyTo: null });
  assert.deepEqual(p.pendingFrom({ kind: 'sticker', body: 'brinde' }, { id: 'm1', text: 'bora?', who: 'Sara' }).replyTo, { id: 'm1', gone: false, fromMe: false, name: 'Sara', kind: 'text', body: 'bora?' });
  assert.equal(p.pendingFrom({ body: 'sim' }, { id: 'm1', text: 'eu', who: 'ti' }).replyTo.fromMe, true);
});

test('as barras de escrever e a lista usam as mensagens a caminho', () => {
  const read = (f) => readFileSync(path.join(ROOT, f), 'utf8');
  for (const f of ['src/components/ChatComposer.tsx', 'src/components/GroupComposer.tsx']) {
    assert.match(read(f), /pendingFrom\(msg, replyTo\)/, f);
    assert.match(read(f), /sendPending\(/, f);
  }
  const list = read('src/components/ChatList.tsx');
  assert.match(list, /keyExtractor=\{\(m\) => listKey\(m\.id\)\}/);
  assert.match(list, /mergePending\(serverItems, pending\)/);
  assert.match(read('src/app/messages/[username].tsx'), /pendingKey=\{`u:\$\{username\}`\}/);
  assert.match(read('src/app/messages/g/[id].tsx'), /<ChatList[\s\S]*pendingKey=\{`g:\$\{id\}`\}/);
  assert.match(read('src/app/messages/g/[id].tsx'), /<GroupComposer pendingKey=\{`g:\$\{id\}`\}/);
});
