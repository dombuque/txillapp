// Testes do tempo real do chat (src/lib/streamEvents.ts): o que fazer com cada evento, sobretudo com o eco `self` (o que
// eu fiz noutro aparelho, ou neste), e o vigia que volta a ligar quando o stream fica calado.
// Correr em apps/mobile:  node --experimental-strip-types --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const s = await import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'streamEvents.ts')).href);
const LIST = [['chat-list'], ['chat-unread'], ['chat-groups']];

test('mensagem de outra pessoa: passa ao "a escrever…"/onEvent e põe em dia a lista e essa conversa', () => {
  assert.deepEqual(s.planChatEvent({ type: 'message', from: 'ana' }), { notify: true, keys: [...LIST, ['chat-thread', 'ana']] });
  assert.deepEqual(s.planChatEvent({ type: 'deleted', group: 'g1' }), { notify: true, keys: [...LIST, ['chat-group', 'g1']] });
  assert.deepEqual(s.planChatEvent({ type: 'read', from: 'ana' }), { notify: true, keys: [...LIST, ['chat-thread', 'ana']] });
});

test('"a escrever" de outra pessoa: avisa, sem pedir dados; ping: nada', () => {
  assert.deepEqual(s.planChatEvent({ type: 'typing', from: 'ana' }), { notify: true, keys: [] });
  assert.deepEqual(s.planChatEvent({ type: 'ping' }), { notify: false, keys: [] });
});

test('eco self: só põe os dados em dia (sem som, aviso, "a escrever…" nem onEvent)', () => {
  for (const type of ['message', 'edited', 'deleted']) {
    assert.deepEqual(s.planChatEvent({ type, from: 'ana', self: true }), { notify: false, keys: [...LIST, ['chat-thread', 'ana']] }, type);
    assert.deepEqual(s.planChatEvent({ type, group: 'g1', self: true }), { notify: false, keys: [...LIST, ['chat-group', 'g1']] }, type);
  }
});

test('eco self de "li eu": só a lista (a conversa não muda; voltar a pedi-la marcaria como lido)', () => {
  assert.deepEqual(s.planChatEvent({ type: 'read', from: 'ana', self: true }), { notify: false, keys: LIST });
  assert.deepEqual(s.planChatEvent({ type: 'read', group: 'g1', self: true }), { notify: false, keys: LIST });
});

test('o meu próprio "a escrever" (não devia chegar) é ignorado', () => {
  assert.deepEqual(s.planChatEvent({ type: 'typing', from: 'ana', self: true }), { notify: false, keys: [] });
});

test('sem evento (voltar a ligar, voltar à app): tudo, também a faixa dos Zás', () => {
  assert.deepEqual(s.refreshKeys(), [...LIST, ['chat-group'], ['chat-thread'], ['instants'], ['instants-feed']]);
});

test('Zás novo ou apagado (e o eco de um meu): só a faixa e a lista do visor, sem som nem aviso nem conversas', () => {
  const zas = { notify: false, keys: [['instants'], ['instants-feed']] };
  assert.deepEqual(s.planChatEvent({ type: 'zas', what: 'new' }), zas);
  assert.deepEqual(s.planChatEvent({ type: 'zas', what: 'gone' }), zas);
  assert.deepEqual(s.planChatEvent({ type: 'zas', what: 'new', self: true }), zas);
  // As mensagens continuam a não mexer nos Zás.
  assert.ok(!s.planChatEvent({ type: 'message', from: 'ana' }).keys.some((k) => k[0] === 'instants'));
});

/** Relógio e intervalo falsos para o vigia. */
function fakeClock() {
  let t = 0;
  const timers = new Map();
  let next = 1;
  return {
    now: () => t,
    setInterval: (f, ms) => { const h = next++; timers.set(h, { f, ms, at: t + ms }); return h; },
    clearInterval: (h) => timers.delete(h),
    advance(ms) {
      const end = t + ms;
      for (;;) {
        const due = [...timers.entries()].filter(([, x]) => x.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        const [h, x] = due;
        t = x.at;
        x.at += x.ms;
        x.f();
        if (!timers.has(h)) continue;
      }
      t = end;
    },
    get active() { return timers.size; },
  };
}

test('vigia: com dados (o ping de 25 s) nunca dispara', () => {
  const c = fakeClock();
  let stalls = 0;
  const dog = s.startWatchdog(() => stalls++, c);
  for (let i = 0; i < 20; i++) { c.advance(25_000); dog.feed(); }
  assert.equal(stalls, 0);
  dog.stop();
  assert.equal(c.active, 0);
});

test('vigia: sem dados há mais de 60 s dispara uma vez (e pára)', () => {
  const c = fakeClock();
  let stalls = 0;
  const dog = s.startWatchdog(() => stalls++, c);
  c.advance(30_000);
  dog.feed();
  c.advance(59_000);
  assert.equal(stalls, 0, 'ainda dentro do prazo');
  c.advance(10_000);
  assert.equal(stalls, 1);
  c.advance(300_000);
  assert.equal(stalls, 1, 'só uma vez');
  assert.equal(c.active, 0, 'o intervalo foi limpo');
  dog.stop(); // não faz mal
});

test('vigia: um pedido que nunca responde também conta (começa a contar logo)', () => {
  const c = fakeClock();
  let stalls = 0;
  s.startWatchdog(() => stalls++, c);
  c.advance(s.STALL_MS + s.WATCH_EVERY_MS);
  assert.equal(stalls, 1);
});

test('vigia: parado antes do prazo não dispara', () => {
  const c = fakeClock();
  let stalls = 0;
  const dog = s.startWatchdog(() => stalls++, c);
  c.advance(20_000);
  dog.stop();
  c.advance(200_000);
  assert.equal(stalls, 0);
});

test('o prazo do vigia folga o ping do servidor (25 s)', () => {
  assert.ok(s.STALL_MS >= 2 * 25_000);
  assert.ok(s.STALL_MS <= 90_000);
});

test('realtime.ts usa o plano: o eco self não chega ao "a escrever…" nem ao onEvent; há vigia e corte ao ir para segundo plano', () => {
  const src = readFileSync(path.join(ROOT, 'src', 'lib', 'realtime.ts'), 'utf8');
  assert.match(src, /const plan = planChatEvent\(e\);\s*if \(plan\.notify\) \{\s*typingSubs\.forEach\(\(f\) => f\(e\)\);\s*cb\.current\?\.\(e\);\s*\}/);
  assert.match(src, /startWatchdog\(/);
  assert.match(src, /if \(!active\) kill\?\.\(\);/);
  // Ao voltar a ficar ativa (AppState; na web é o visibilitychange): atualiza logo e acorda o ciclo.
  assert.match(src, /else if \(!was\) \{ refresh\(\); wake\?\.\(\); \}/);
});
