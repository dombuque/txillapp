// Testes do envio otimista do chat e da fila sem rede (src/lib/chatPending.ts): a bolha aparece logo, não pisca quando o
// servidor confirma (sem "A enviar…" no primeiro instante, a mesma chave na lista antes e depois); sem rede fica à espera
// (reloginho) e vai sozinha, pela ordem, quando a rede volta; só uma recusa do servidor (4xx) fica "Não enviada"; as que
// estão à espera ficam guardadas por conta e voltam ao abrir a app.
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
/** Deixa correr as promessas (o setImmediate não é dos temporizadores falsos). */
const flush = async (n = 5) => { for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r)); };
const httpError = (status) => Object.assign(new Error(`HTTP ${status}`), { status });

/**
 * Um servidor de faz de conta: `mode` 'ok' aceita (ids srv-1, srv-2…), 'down' é sem rede (TypeError do fetch), um número é
 * a resposta HTTP de erro, 'hang' nunca responde. `calls` guarda os pedidos (para ver a ordem e o clientId).
 */
function fakeServer() {
  const s = { mode: 'ok', calls: [], n: 0, online: true };
  s.transport = (req) => {
    s.calls.push(req);
    if (s.mode === 'down') return Promise.reject(new TypeError('Sem ligação à internet.'));
    if (s.mode === 'hang') return new Promise(() => {});
    if (typeof s.mode === 'number') return Promise.reject(httpError(s.mode));
    return Promise.resolve({ id: `srv-${++s.n}` });
  };
  p.configurePending({ transport: s.transport, online: () => s.online });
  return s;
}
/** Um armazenamento de faz de conta (o ficheiro ou o localStorage), por conta. */
function fakeStore() {
  const data = new Map();
  return { data, load: (u) => data.get(u) ?? null, save: (u, v) => (v === null ? data.delete(u) : data.set(u, v)) };
}

test('a bolha aparece logo, em cima das do servidor, sem "A enviar…" no primeiro instante', async () => {
  p.resetPending();
  const d = later();
  p.configurePending({ transport: () => d.promise });
  const sent = p.sendPending(C, { kind: 'text', body: 'olá' });
  const list = p.mergePending(server('m2', 'm1'), p.pendingOf(C));
  assert.equal(list.length, 3);
  assert.equal(list[0].body, 'olá');
  assert.equal(list[0].fromMe, true);
  assert.match(list[0].id, /^tmp-/);
  assert.equal(list[0].state, undefined, 'sem "A enviar…" (nem esbatida) logo ao tocar em Enviar');
  d.ok({ id: 'm3' });
  assert.equal(await sent, true);
});

test('o pedido leva a conversa, o corpo, a resposta e um clientId (uuid)', async () => {
  p.resetPending();
  const s = fakeServer();
  const gif = { id: 'g', w: 200, h: 100, url: 'https://media.giphy.com/x.gif' };
  await p.sendPending('g:42', { kind: 'gif', gif, replyTo: { id: 'm1', gone: false, fromMe: false, name: 'Sara', kind: 'text', body: 'bora?' } });
  assert.equal(s.calls.length, 1);
  const [r] = s.calls;
  assert.equal(r.conv, 'g:42');
  assert.equal(r.kind, 'gif');
  assert.deepEqual(r.gif, gif);
  assert.equal(r.replyTo, 'm1');
  assert.match(r.clientId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test('mensagens temporárias: a confirmada leva o expiresAt e sai quando expira, mesmo sem o servidor a trazer', async () => {
  p.resetPending();
  const at = Date.parse('2026-11-12T10:00:00Z');
  const exp = new Date(at + 86_400_000).toISOString();
  p.configurePending({ transport: async () => ({ id: 'm9', expiresAt: exp }) });
  await p.sendPending(C, { kind: 'text', body: 'temporária' });
  let list = p.mergePending(server('m2'), p.pendingOf(C), at);
  assert.equal(list[0].id, 'm9');
  assert.equal(list[0].expiresAt, exp);
  // Passada a hora: já não aparece (nem duplica com a do servidor) e sai das pendentes.
  list = p.mergePending(server('m2'), p.pendingOf(C), at + 86_400_001);
  assert.deepEqual(list.map((m) => m.id), ['m2']);
  p.prunePending(C, new Set(['m2']), at + 86_400_001);
  assert.equal(p.pendingOf(C).length, 0);
});

test('Limpar conversa esquece as mensagens a caminho dessa conversa (e só dessa)', async () => {
  p.resetPending();
  const d = later();
  p.configurePending({ transport: (r) => (r.conv === C ? d.promise : new Promise(() => {})) });
  void p.sendPending(C, { kind: 'text', body: 'a caminho' });
  void p.sendPending('g:1', { kind: 'text', body: 'no grupo' });
  p.clearPending(C);
  assert.equal(p.pendingOf(C).length, 0);
  assert.equal(p.pendingOf('g:1').length, 1);
  d.ok({ id: 'm5' });
  await flush();
  assert.equal(p.pendingOf(C).length, 0, 'a confirmação que chega depois não a faz voltar');
});

test('quando o servidor confirma: o id verdadeiro e a MESMA chave na lista (não remonta, não pisca)', async () => {
  p.resetPending();
  const d = later();
  p.configurePending({ transport: () => d.promise });
  let refetched = 0;
  const sent = p.sendPending(C, { kind: 'text', body: 'olá' }, { onSent: () => refetched++ });
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
  p.configurePending({ transport: async () => ({ id: 'm9' }) });
  await p.sendPending(C, { kind: 'text', body: 'olá' });
  const list = p.mergePending(server('m2', 'm1'), p.pendingOf(C));
  assert.deepEqual(list.map((m) => m.id), ['m9', 'm2', 'm1']);
});

test('demora: passa a mostrar "A enviar…" (depois de SLOW_MS)', async (t) => {
  p.resetPending();
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const d = later();
  p.configurePending({ transport: () => d.promise });
  const sent = p.sendPending(C, { kind: 'text', body: 'devagar' });
  assert.equal(p.mergePending([], p.pendingOf(C))[0].state, undefined);
  t.mock.timers.tick(p.SLOW_MS + 1);
  assert.equal(p.mergePending([], p.pendingOf(C))[0].state, 'sending');
  d.ok({ id: 'x1' });
  await sent;
  assert.equal(p.mergePending([], p.pendingOf(C))[0].state, undefined);
  t.mock.timers.reset();
});

test('sem rede (navigator.onLine false): fica à espera com o reloginho, nem tenta, e vai quando a rede volta', async (t) => {
  p.resetPending();
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const s = fakeServer();
  s.online = false;
  assert.equal(await p.sendPending(C, { kind: 'text', body: 'sem rede' }), false);
  const [b] = p.mergePending([], p.pendingOf(C));
  assert.equal(b.state, 'waiting', 'à espera (reloginho), não "Não enviada"');
  assert.equal(b.body, 'sem rede');
  assert.equal(s.calls.length, 0, 'sem rede não se tenta');
  // O recuo passa e continua sem rede: continua à espera, sem pedidos.
  t.mock.timers.tick(60_000);
  await flush();
  assert.equal(s.calls.length, 0);
  assert.equal(p.pendingOf(C)[0].state, 'waiting');
  // A rede volta (evento 'online'): envia-se sozinha.
  s.online = true;
  p.wakePending();
  await flush();
  assert.equal(s.calls.length, 1);
  assert.equal(p.pendingOf(C)[0].state, 'sent');
  assert.equal(p.mergePending([], p.pendingOf(C))[0].id, 'srv-1');
  t.mock.timers.reset();
});

test('a rede cai a meio (erro do fetch): à espera, e as seguintes da conversa ficam atrás dela, pela ordem', async (t) => {
  p.resetPending();
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const s = fakeServer();
  s.mode = 'down';
  assert.equal(await p.sendPending(C, { kind: 'text', body: 'um' }), false);
  assert.equal(p.pendingOf(C)[0].state, 'waiting');
  // Mais duas enquanto a primeira espera: não passam à frente (ficam à espera também).
  await p.sendPending(C, { kind: 'text', body: 'dois' });
  await p.sendPending(C, { kind: 'sticker', body: 'brinde' });
  await flush();
  assert.deepEqual(p.mergePending([], p.pendingOf(C)).map((m) => [m.body, m.state]), [['brinde', 'waiting'], ['dois', 'waiting'], ['um', 'waiting']]);
  assert.ok(s.calls.every((r) => r.body === 'um'), 'só a mais antiga é tentada enquanto não passa');
  // Volta a rede: vão as três, pela ordem.
  s.mode = 'ok';
  s.calls.length = 0;
  p.wakePending();
  await flush(10);
  assert.deepEqual(s.calls.map((r) => r.body), ['um', 'dois', 'brinde']);
  assert.ok(p.pendingOf(C).every((x) => x.state === 'sent'));
  t.mock.timers.reset();
});

test('tenta sozinha para sempre, com recuo (2 s, 5 s, 10 s, 30 s, 60 s, 60 s…), e repete o MESMO clientId', async (t) => {
  p.resetPending();
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const s = fakeServer();
  s.mode = 'down';
  await p.sendPending(C, { kind: 'text', body: 'insiste' });
  await flush();
  assert.equal(s.calls.length, 1);
  const steps = [2_000, 5_000, 10_000, 30_000, 60_000, 60_000, 60_000];
  for (let i = 0; i < steps.length; i++) {
    t.mock.timers.tick(steps[i] - 1);
    await flush();
    assert.equal(s.calls.length, i + 1, `ainda não (antes de ${steps[i]} ms)`);
    t.mock.timers.tick(1);
    await flush();
    assert.equal(s.calls.length, i + 2, `tentou outra vez ao fim de ${steps[i]} ms`);
    assert.equal(p.pendingOf(C)[0].state, 'waiting', 'nunca desiste sozinha');
  }
  assert.equal(new Set(s.calls.map((r) => r.clientId)).size, 1, 'o mesmo clientId: o servidor não duplica');
  s.mode = 'ok';
  t.mock.timers.tick(60_000);
  await flush();
  assert.equal(p.pendingOf(C)[0].state, 'sent');
  t.mock.timers.reset();
});

test('à espera e a tentar: a bolha diz que está a tentar (trying)', async (t) => {
  p.resetPending();
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const s = fakeServer();
  s.mode = 'down';
  await p.sendPending(C, { kind: 'text', body: 'x' });
  await flush();
  s.mode = 'hang';
  t.mock.timers.tick(2_000);
  await flush();
  let [b] = p.mergePending([], p.pendingOf(C));
  assert.equal(b.state, 'waiting');
  assert.equal(b.trying, true);
  // Sem resposta em SEND_TIMEOUT_MS: volta a "à espera" e tenta mais tarde.
  t.mock.timers.tick(p.SEND_TIMEOUT_MS);
  await flush();
  [b] = p.mergePending([], p.pendingOf(C));
  assert.equal(b.state, 'waiting');
  assert.equal(b.trying, undefined);
  t.mock.timers.reset();
});

test('5xx, 408, 429 e 401: à espera (tenta mais tarde); 4xx: "Não enviada"', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  for (const status of [500, 502, 503, 504, 408, 429, 401]) {
    p.resetPending();
    const s = fakeServer();
    s.mode = status;
    await p.sendPending(C, { kind: 'text', body: 'x' });
    await flush();
    assert.equal(p.pendingOf(C)[0].state, 'waiting', `HTTP ${status} fica à espera`);
  }
  for (const status of [400, 403, 404, 409, 422]) {
    p.resetPending();
    const s = fakeServer();
    s.mode = status;
    assert.equal(await p.sendPending(C, { kind: 'text', body: 'x' }), false);
    assert.equal(p.pendingOf(C)[0].state, 'failed', `HTTP ${status} é recusa`);
    // Recusada não volta a tentar sozinha.
    t.mock.timers.tick(120_000);
    await flush();
    assert.equal(s.calls.length, 1);
  }
  assert.equal(p.shouldRetry(new TypeError('Load failed')), true);
  assert.equal(p.shouldRetry(httpError(403)), false);
  t.mock.timers.reset();
});

test('uma recusada não segura a fila: as seguintes vão; "Tentar outra vez" envia a mesma; "Apagar" tira-a', async () => {
  p.resetPending();
  const s = fakeServer();
  let first = true;
  p.configurePending({ transport: (r) => (first ? ((first = false), Promise.reject(httpError(403))) : s.transport(r)) });
  assert.equal(await p.sendPending(C, { kind: 'text', body: 'não te perco' }), false);
  assert.equal(await p.sendPending(C, { kind: 'text', body: 'a seguir' }), true);
  let [, b] = p.mergePending([], p.pendingOf(C));
  assert.equal(b.state, 'failed');
  assert.equal(b.body, 'não te perco');
  const clientId = p.pendingOf(C).find((x) => x.id === b.id).clientId;
  assert.equal(await p.retryPending(C, b.id), true);
  assert.equal(s.calls.at(-1).clientId, clientId, 'o mesmo clientId');
  assert.equal(p.mergePending([], p.pendingOf(C))[1].id, 'srv-2');
  // Apagar uma que falhou
  first = true;
  await p.sendPending(C, { kind: 'text', body: 'outra' });
  const failed = p.pendingOf(C).find((x) => x.state === 'failed');
  p.dropPending(C, failed.id);
  assert.equal(p.pendingOf(C).some((x) => x.id === failed.id), false);
  // Só se tenta de novo uma que falhou.
  assert.equal(await p.retryPending(C, 'nada'), false);
});

test('Apagar uma à espera cancela o envio (não vai quando a rede voltar)', async (t) => {
  p.resetPending();
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const s = fakeServer();
  s.online = false;
  await p.sendPending(C, { kind: 'text', body: 'afinal não' });
  await p.sendPending(C, { kind: 'text', body: 'esta sim' });
  const gone = p.pendingOf(C).find((x) => x.body === 'afinal não');
  p.dropPending(C, gone.id);
  s.online = true;
  p.wakePending();
  await flush();
  assert.deepEqual(s.calls.map((r) => r.body), ['esta sim']);
  t.mock.timers.reset();
});

test('cada conversa tem a sua fila: uma à espera não segura as outras', async (t) => {
  p.resetPending();
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const s = fakeServer();
  p.configurePending({ transport: (r) => (r.conv === C ? Promise.reject(new TypeError('x')) : s.transport(r)) });
  const sv = server('a');
  assert.equal(p.mergePending(sv, p.pendingOf(C)), sv, 'a lista do servidor passa tal e qual sem nada a caminho');
  await p.sendPending(C, { kind: 'text', body: 'presa' });
  assert.equal(await p.sendPending('g:42', { kind: 'sticker', body: 'brinde' }), true);
  assert.equal(p.pendingOf(C)[0].state, 'waiting');
  assert.equal(p.pendingOf('g:42')[0].state, 'sent');
  assert.equal(p.pendingOf(C), p.pendingOf(C), 'a mesma referência (useSyncExternalStore)');
  t.mock.timers.reset();
});

test('guardadas por conta: sobrevivem a fechar e abrir a app e enviam-se sozinhas ao arrancar', async (t) => {
  p.resetPending();
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const store = fakeStore();
  let s = fakeServer();
  p.configurePending({ store });
  await p.setPendingUser('ana');
  s.online = false;
  await p.sendPending(C, { kind: 'text', body: 'primeira' });
  await p.sendPending(C, { kind: 'text', body: 'segunda', replyTo: { id: 'm1', gone: false, fromMe: true, name: '', kind: 'text', body: 'eu' } });
  await p.sendPending('g:7', { kind: 'gif', gif: { id: 'g', w: 1, h: 1, url: 'https://media.giphy.com/a.gif' } });
  const saved = JSON.parse(store.data.get('ana'));
  assert.equal(saved.convs[C].length, 2);
  assert.equal(saved.convs['g:7'][0].kind, 'gif');
  const ids = p.pendingOf(C).map((x) => x.clientId);

  // Fechar a app (tudo esquecido da memória) e abrir outra vez, já com rede.
  p.resetPending();
  s = fakeServer();
  p.configurePending({ store });
  await p.setPendingUser('ana');
  const back = p.mergePending([], p.pendingOf(C));
  assert.deepEqual(back.map((m) => m.body), ['segunda', 'primeira']);
  assert.equal(back[0].replyTo.body, 'eu', 'a citação da resposta volta também');
  await flush(10);
  assert.deepEqual(s.calls.filter((r) => r.conv === C).map((r) => r.body), ['primeira', 'segunda'], 'pela ordem');
  assert.deepEqual(s.calls.filter((r) => r.conv === C).map((r) => r.clientId), [...ids].reverse(), 'com os mesmos clientId');
  assert.equal(s.calls.filter((r) => r.conv === 'g:7').length, 1);
  assert.equal(store.data.has('ana'), false, 'já enviadas: nada fica guardado');
  t.mock.timers.reset();
});

test('as contas não se misturam; terminar sessão apaga as guardadas dessa conta', async (t) => {
  p.resetPending();
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const store = fakeStore();
  const s = fakeServer();
  p.configurePending({ store });
  s.online = false;
  await p.setPendingUser('ana');
  await p.sendPending(C, { kind: 'text', body: 'da ana' });
  // Trocar de conta: as da Ana saem da memória (ficam guardadas na dela); o Rui não as vê nem as envia.
  await p.setPendingUser('rui');
  assert.equal(p.pendingOf(C).length, 0);
  assert.ok(store.data.has('ana'));
  s.online = true;
  p.wakePending();
  await flush();
  assert.equal(s.calls.length, 0, 'a mensagem da Ana não vai com a sessão do Rui');
  // A Ana termina sessão: as dela são apagadas do aparelho.
  p.forgetPendingUser('ana');
  assert.equal(store.data.has('ana'), false);
  // Uma estragada no armazenamento não parte nada.
  store.data.set('rui', '{isto não é json');
  await p.setPendingUser(null);
  await p.setPendingUser('rui');
  assert.equal(p.pendingOf(C).length, 0);
  t.mock.timers.reset();
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

test('as barras de escrever, a lista, a bolha e a sessão usam as mensagens a caminho', () => {
  const read = (f) => readFileSync(path.join(ROOT, f), 'utf8');
  for (const f of ['src/components/ChatComposer.tsx', 'src/components/GroupComposer.tsx']) {
    assert.match(read(f), /pendingFrom\(msg, replyTo\)/, f);
    assert.match(read(f), /sendPending\([^,]+, shown, \{ onSent \}\)/, f);
  }
  const list = read('src/components/ChatList.tsx');
  assert.match(list, /keyExtractor=\{\(m\) => listKey\(m\.id\)\}/);
  assert.match(list, /mergePending\(serverItems, pending\)/);
  assert.match(read('src/app/messages/[username].tsx'), /pendingKey=\{`u:\$\{username\}`\}/);
  assert.match(read('src/app/messages/g/[id].tsx'), /<ChatList[\s\S]*pendingKey=\{`g:\$\{id\}`\}/);
  assert.match(read('src/app/messages/g/[id].tsx'), /<GroupComposer groupId=\{id\} pendingKey=\{`g:\$\{id\}`\}/);
  // A bolha à espera: o reloginho no lugar dos vistos, «À espera de rede», e segurar deixa apagar.
  const bubbles = read('src/components/ChatBubbles.tsx');
  assert.match(bubbles, /<Icon name="clock"/);
  assert.match(bubbles, /À espera de rede/);
  assert.match(bubbles, /onLongPress: cancelWaiting/);
  // A fila liga-se à conta (e esquece-se ao sair) e ao pedido com o clientId.
  const auth = read('src/lib/auth.tsx');
  assert.match(auth, /setOutboxUser\(userId\)/);
  assert.match(auth, /forgetOutboxUser\(/);
  const outbox = read('src/lib/chatOutbox.ts');
  assert.match(outbox, /clientId: r\.clientId/);
  assert.match(outbox, /addEventListener\('online'/);
  assert.match(outbox, /s === 'active'/);
});
