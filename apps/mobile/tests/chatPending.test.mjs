// Testes do envio otimista do chat e da fila sem rede (src/lib/chatPending.ts): a bolha aparece logo, não pisca quando o
// servidor confirma (sem "A enviar…" no primeiro instante, a mesma chave na lista antes e depois); sem rede fica à espera
// (reloginho) e vai sozinha, pela ordem, quando a rede volta; só uma recusa do servidor (4xx) fica "Não enviada"; as que
// estão à espera ficam guardadas por conta e voltam ao abrir a app.
// Correr em apps/mobile:  node --test tests/*.test.mjs
import { afterEach, test } from 'node:test';
import './fixtures/alias.mjs'; // o alias @/ (os módulos usam t() de @/lib/i18n)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const p = await import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'chatPending.ts')).href);

const C = 'u:sara';
// Cada teste acaba sem temporizadores nem filas (uma fila sem rede tenta para sempre: não deixaria o processo acabar).
afterEach(() => p.resetPending());
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
  await p.forgetPendingUser('ana');
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

// ---------- Voz, fotos e vídeos sem rede ----------

/** Os ficheiros guardados de faz de conta (lib/chatMediaStore): o que existe e o que se apagou. */
function fakeMedia() {
  const files = new Map([['voz-1.m4a', 'file:///docs/tx-chat-media/voz-1.m4a'], ['foto-1.jpg', 'file:///docs/tx-chat-media/foto-1.jpg']]);
  const dropped = [];
  return { files, dropped, resolve: async (ref) => files.get(ref) ?? null, drop: (ref) => { dropped.push(ref); files.delete(ref); } };
}

test('voz sem rede: fica na conversa à espera com o ficheiro guardado; volta a rede: sobe uma vez e envia', async (t) => {
  p.resetPending();
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const media = fakeMedia();
  const calls = [];
  let mode = 'down';
  let uploads = 0;
  p.configurePending({
    media,
    online: () => true,
    transport: async (req, ctx) => {
      calls.push(req);
      if (req.media && !req.mediaId) { uploads++; ctx.uploaded('asset-1'); }
      if (mode === 'down') throw new TypeError('Load failed');
      return { id: 'srv-voz' };
    },
  });
  await p.sendPending(C, { kind: 'voice', media: { ref: 'voz-1.m4a', mime: 'audio/mp4', durationMs: 4000 }, localUri: 'file:///docs/tx-chat-media/voz-1.m4a' });
  await flush();
  let [b] = p.mergePending([], p.pendingOf(C));
  assert.equal(b.kind, 'voice');
  assert.equal(b.state, 'waiting');
  assert.equal(b.mediaUrl, 'file:///docs/tx-chat-media/voz-1.m4a', 'a bolha toca a cópia guardada');
  assert.equal(b.durationMs, 4000);
  assert.equal(p.pendingOf(C)[0].mediaId, 'asset-1', 'o ficheiro que já subiu fica guardado');
  // A rede volta: não sobe outra vez (vai com o mediaId), com o mesmo clientId.
  mode = 'ok';
  p.wakePending();
  await flush();
  assert.equal(uploads, 1);
  assert.equal(calls.at(-1).mediaId, 'asset-1');
  assert.equal(calls.at(-1).clientId, calls[0].clientId);
  [b] = p.mergePending([], p.pendingOf(C));
  assert.equal(b.id, 'srv-voz');
  assert.equal(b.mediaUrl, 'file:///docs/tx-chat-media/voz-1.m4a', 'até o servidor a trazer, ainda se ouve a cópia');
  assert.deepEqual(media.dropped, []);
  // O servidor traz a mensagem: o ficheiro local apaga-se.
  p.prunePending(C, new Set(['srv-voz']));
  assert.deepEqual(media.dropped, ['voz-1.m4a']);
  t.mock.timers.reset();
});

test('o ficheiro de uma enviada apaga-se sozinho passado MEDIA_KEEP_AFTER_SENT_MS (mesmo sem abrir a conversa)', async (t) => {
  p.resetPending();
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const media = fakeMedia();
  p.configurePending({ media, transport: async () => ({ id: 'srv-f' }) });
  await p.sendPending(C, { kind: 'image', body: 'praia', media: { ref: 'foto-1.jpg', mime: 'image/jpeg' } });
  assert.deepEqual(media.dropped, []);
  t.mock.timers.tick(p.MEDIA_KEEP_AFTER_SENT_MS);
  assert.deepEqual(media.dropped, ['foto-1.jpg']);
  t.mock.timers.reset();
});

test('apagar uma foto à espera, limpar a conversa e terminar sessão apagam os ficheiros guardados', async (t) => {
  p.resetPending();
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const media = fakeMedia();
  const store = fakeStore();
  const s = fakeServer();
  p.configurePending({ media, store });
  s.online = false;
  await p.setPendingUser('ana');
  await p.sendPending(C, { kind: 'image', media: { ref: 'foto-1.jpg', mime: 'image/jpeg' } });
  p.dropPending(C, p.pendingOf(C)[0].id);
  assert.deepEqual(media.dropped, ['foto-1.jpg']);
  await p.sendPending('g:3', { kind: 'voice', media: { ref: 'voz-1.m4a', mime: 'audio/mp4', durationMs: 2000 } });
  p.clearPending('g:3');
  assert.deepEqual(media.dropped, ['foto-1.jpg', 'voz-1.m4a']);
  // Terminar sessão: também os ficheiros das que estão guardadas (mesmo de uma conta que já não é a ativa).
  await p.sendPending(C, { kind: 'video', media: { ref: 'video-1.mp4', mime: 'video/mp4' } });
  await p.setPendingUser('rui');
  await p.forgetPendingUser('ana');
  assert.ok(media.dropped.includes('video-1.mp4'));
  assert.equal(store.data.has('ana'), false);
  t.mock.timers.reset();
});

test('voz e fotos guardadas sobrevivem a fechar a app: voltam com o ficheiro (onde se vê agora) e o mediaId', async (t) => {
  p.resetPending();
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const store = fakeStore();
  let media = fakeMedia();
  let s = fakeServer();
  p.configurePending({ store, media });
  s.online = false;
  await p.setPendingUser('ana');
  await p.sendPending(C, { kind: 'voice', media: { ref: 'voz-1.m4a', mime: 'audio/mp4', durationMs: 3000, once: true }, localUri: 'blob:velho' }, { mediaId: 'asset-9', clientId: '11111111-1111-4111-8111-111111111111' });
  const saved = JSON.parse(store.data.get('ana')).convs[C][0];
  assert.equal(saved.media.ref, 'voz-1.m4a');
  assert.equal(saved.mediaId, 'asset-9');
  assert.equal(saved.localUri, undefined, 'o endereço do momento não se guarda (no browser muda)');
  // Abrir outra vez, ainda sem rede: a bolha volta com o ficheiro guardado.
  p.resetPending();
  media = fakeMedia();
  s = fakeServer();
  s.online = false;
  p.configurePending({ store, media });
  await p.setPendingUser('ana');
  await flush();
  const [b] = p.mergePending([], p.pendingOf(C));
  assert.equal(b.kind, 'voice');
  assert.equal(b.mediaUrl, 'file:///docs/tx-chat-media/voz-1.m4a');
  assert.equal(b.viewOnce, true);
  s.online = true;
  p.wakePending();
  await flush();
  assert.equal(s.calls[0].mediaId, 'asset-9');
  assert.equal(s.calls[0].clientId, '11111111-1111-4111-8111-111111111111');
  assert.equal(s.calls[0].media.durationMs, 3000);
  t.mock.timers.reset();
});

test('o ficheiro já não está no aparelho (o transporte diz 410): fica «Não enviada», não tenta para sempre', async () => {
  p.resetPending();
  p.configurePending({ transport: async () => { throw httpError(410); } });
  await p.sendPending(C, { kind: 'image', media: { ref: 'sumiu.jpg', mime: 'image/jpeg' } });
  assert.equal(p.pendingOf(C)[0].state, 'failed');
});

test('uma guardada de voz sem ficheiro (estragada) não volta; as outras voltam pela ordem', async () => {
  p.resetPending();
  const store = fakeStore();
  store.data.set('ana', JSON.stringify({ v: 1, convs: { [C]: [
    { id: 'tmp-b', clientId: 'b', kind: 'image', body: '', media: { ref: 'f.jpg', mime: 'image/jpeg' }, at: '2026-11-17T10:01:00Z', state: 'waiting' },
    { id: 'tmp-x', clientId: 'x', kind: 'voice', body: '', at: '2026-11-17T10:00:30Z', state: 'waiting' },
    { id: 'tmp-a', clientId: 'a', kind: 'text', body: 'olá', at: '2026-11-17T10:00:00Z', state: 'waiting' },
  ] } }));
  p.configurePending({ store, online: () => false });
  await p.setPendingUser('ana');
  assert.deepEqual(p.pendingOf(C).map((x) => x.id), ['tmp-b', 'tmp-a']);
});

// ---------- Segundo plano, recuo no telemóvel ----------

test('em segundo plano não tenta nem agenda; ao voltar ao primeiro plano tenta logo', async (t) => {
  p.resetPending();
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const s = fakeServer();
  let active = false;
  p.configurePending({ active: () => active });
  await p.sendPending(C, { kind: 'text', body: 'no bolso' });
  t.mock.timers.tick(10 * 60_000);
  await flush();
  assert.equal(s.calls.length, 0, 'em segundo plano não gasta');
  assert.equal(p.pendingOf(C)[0].state, 'waiting');
  active = true;
  p.wakePending();
  await flush();
  assert.equal(s.calls.length, 1);
  assert.equal(p.pendingOf(C)[0].state, 'sent');
  t.mock.timers.reset();
});

test('telemóvel (NATIVE_RETRY_DELAYS): com a app à frente, nunca mais de 15 s entre tentativas', async (t) => {
  p.resetPending();
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const s = fakeServer();
  s.mode = 'down';
  p.configurePending({ retryDelays: p.NATIVE_RETRY_DELAYS });
  assert.equal(Math.max(...p.NATIVE_RETRY_DELAYS), 15_000);
  await p.sendPending(C, { kind: 'text', body: 'x' });
  await flush();
  for (const step of [2_000, 5_000, 10_000, 15_000, 15_000, 15_000]) {
    const n = s.calls.length;
    t.mock.timers.tick(step);
    await flush();
    assert.equal(s.calls.length, n + 1, `tentou ao fim de ${step} ms`);
  }
  t.mock.timers.reset();
});

// ---------- O nome da conversa e a lista sem rede ----------

test('o nome da conversa fica guardado com as que estão à espera e volta ao abrir (cabeçalho sem rede)', async () => {
  p.resetPending();
  const store = fakeStore();
  p.configurePending({ store, online: () => false });
  await p.setPendingUser('ana');
  p.notePendingTitle(C, { name: 'Sara Machel', username: 'sara', hasAvatar: true });
  p.notePendingTitle('g:9', { name: 'Malta do Tofo' });
  assert.equal(store.data.has('ana'), false, 'sem mensagens à espera não se guarda nada');
  await p.sendPending(C, { kind: 'text', body: 'já chego' });
  await p.sendPending('g:9', { kind: 'sticker', body: 'brinde' });
  assert.deepEqual(JSON.parse(store.data.get('ana')).titles, { [C]: { name: 'Sara Machel', username: 'sara', hasAvatar: true }, 'g:9': { name: 'Malta do Tofo' } });
  p.resetPending();
  p.configurePending({ store, online: () => false });
  await p.setPendingUser('ana');
  assert.equal(p.pendingTitle(C).name, 'Sara Machel');
  const convs = p.pendingConvs();
  assert.deepEqual(convs.map((c) => [c.conv, c.title?.name, c.count]).sort(), [['g:9', 'Malta do Tofo', 1], [C, 'Sara Machel', 1]]);
  assert.equal(p.pendingConvs(), convs, 'a mesma referência enquanto nada muda (useSyncExternalStore)');
});

test('pendingPreview: o texto curto de cada tipo', () => {
  assert.equal(p.pendingPreview({ kind: 'text', body: 'olá' }), 'olá');
  assert.equal(p.pendingPreview({ kind: 'sticker', body: 'brinde' }), 'Sticker');
  assert.equal(p.pendingPreview({ kind: 'gif', body: '' }), 'GIF');
  assert.equal(p.pendingPreview({ kind: 'voice', body: '' }), 'Mensagem de voz');
  assert.equal(p.pendingPreview({ kind: 'image', body: '' }), 'Foto');
  assert.equal(p.pendingPreview({ kind: 'video', body: 'golo' }), 'Vídeo: golo');
});

test('voz, fotos e vídeos sem rede passam pela fila (lib/chatMediaSend), nas conversas e nos grupos', () => {
  const read = (f) => readFileSync(path.join(ROOT, f), 'utf8');
  for (const f of ['src/components/ChatComposer.tsx', 'src/components/GroupComposer.tsx']) {
    const s = read(f);
    assert.match(s, /sendChatMedia\(/, f);
    assert.match(s, /kind: 'voice', uri,/, f);
    assert.doesNotMatch(s, /heldVoice|HeldVoiceRow/, f);
  }
  const send = read('src/lib/chatMediaSend.ts');
  assert.match(send, /keepChatMedia\(/);
  assert.match(send, /pendingWaiting\(conv\)/, 'com mensagens à espera, a nova vai atrás delas');
  assert.match(send, /Tentar quando houver rede/);
  assert.match(read('src/lib/chatOutbox.ts'), /retryDelays: NATIVE_RETRY_DELAYS/);
  assert.match(read('src/lib/chatOutbox.ts'), /media: \{ resolve: chatMediaUri, drop: dropChatMedia \}/);
  assert.match(read('src/lib/chatMediaStore.ts'), /Paths\.document, 'tx-chat-media'/);
  assert.match(read('src/lib/chatMediaStore.web.ts'), /indexedDB/);
  // Sem rede ao abrir: a conversa com mensagens à espera abre (com o nome guardado) e a lista mostra-as.
  for (const f of ['src/app/messages/[username].tsx', 'src/app/messages/g/[id].tsx']) {
    assert.match(read(f), /offlineWithPending\(q\.error, waitingHere\.length\)/, f);
    assert.match(read(f), /notePendingTitle\(/, f);
  }
  assert.match(read('src/app/(tabs)/messages.tsx'), /<PendingConvs \/>/);
  for (const f of ['src/lib/chatMediaSend.ts', 'src/components/PendingConvs.tsx', 'src/lib/chatMediaStore.ts', 'src/lib/chatMediaStore.web.ts']) assert.doesNotMatch(read(f), /[—–]/, `${f}: sem travessões`);
});
