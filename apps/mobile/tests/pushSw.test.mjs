// Testes do service worker das notificações (public/push-sw.js): chamadas a tocar, reenvios, fim da chamada e Recusar.
// O ficheiro corre num contexto à parte com um `self` de mentira (registo, janelas, fetch).
// Correr em apps/mobile:  node --experimental-strip-types --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CODE = readFileSync(path.join(ROOT, 'public', 'push-sw.js'), 'utf8');
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1';

/** Um service worker novo, com janelas abertas (`windows`) e um fetch de mentira. */
/** Cópia simples (os objetos do contexto à parte têm outros protótipos). */
const plain = (x) => (x === undefined ? x : JSON.parse(JSON.stringify(x)));

function load({ ua = ANDROID, windows = [], fetchImpl } = {}) {
  const listeners = {};
  const shown = [];
  const fetched = [];
  const opened = [];
  const messages = [];
  const registration = {
    showNotification: async (title, options) => {
      for (let i = shown.length - 1; i >= 0; i--) if (shown[i].options.tag && shown[i].options.tag === options.tag) shown[i].closed = true;
      shown.push({ title, options: plain(options), closed: false });
    },
    getNotifications: async (filter = {}) =>
      shown.filter((n) => !n.closed && (!filter.tag || n.options.tag === filter.tag)).map((n) => ({ tag: n.options.tag, data: n.options.data, close: () => { n.closed = true; } })),
  };
  const clients = windows.map((w) => ({ url: typeof w === 'object' ? w.url : 'https://txillapp.com/', visibilityState: typeof w === 'object' ? w.state : w, postMessage: (m) => messages.push(plain(m)), focus: async () => undefined, navigate: async () => undefined }));
  const self = {
    navigator: { userAgent: ua },
    location: { origin: 'https://txillapp.com' },
    registration,
    clients: { matchAll: async () => clients, openWindow: async (u) => { opened.push(String(u)); } },
    addEventListener: (type, fn) => { listeners[type] = fn; },
  };
  const fetch = async (url, init) => {
    fetched.push({ url, init: plain(init) });
    return fetchImpl ? fetchImpl(url, init) : { ok: true, status: 200 };
  };
  vm.runInNewContext(CODE, { self, URL, setTimeout: () => 0, fetch, console });
  async function fire(type, event) {
    const waits = [];
    listeners[type]({ ...event, waitUntil: (p) => waits.push(p) });
    await Promise.all(waits);
  }
  const push = (payload) => fire('push', { data: { json: () => payload, text: () => JSON.stringify(payload) } });
  const click = (n, action = '') => fire('notificationclick', { action, notification: { data: n.options.data, close: () => { n.closed = true; } } });
  return { api: self.__txCall, push, click, fire, shown, fetched, opened, messages, open: () => shown.filter((n) => !n.closed) };
}

const ring = (extra = {}) => ({ kind: 'call', callId: 'c1', from: 'ana', video: '0', declineToken: 'tok-123', title: 'Ana', body: 'Está a ligar-te', url: '/call/c1?from=ana&video=0', tag: 'call-c1', ...extra });

test('notificação a tocar no Android: fica até responder, vibra, Atender/Recusar e "Chamada de voz de Ana"', async () => {
  const sw = load();
  await sw.push(ring());
  assert.equal(sw.open().length, 1);
  const { title, options } = sw.open()[0];
  assert.equal(title, 'Ana');
  assert.equal(options.body, 'Chamada de voz de Ana');
  assert.equal(options.tag, 'call-c1');
  assert.equal(options.requireInteraction, true);
  assert.equal(options.renotify, true);
  assert.equal(options.silent, false);
  assert.ok(options.vibrate.length >= 7 && options.vibrate.reduce((a, b) => a + b, 0) >= 7000);
  assert.deepEqual(options.actions.map((a) => [a.action, a.title]), [['answer', 'Atender'], ['decline', 'Recusar']]);
  assert.equal(options.icon, '/icon-192.png');
  assert.equal(options.badge, '/badge-96.png');
  assert.equal(options.data.url, '/call/c1?from=ana&video=0&accept=1');
  assert.equal(options.data.declineToken, 'tok-123');
});

test('videochamada: "Videochamada de Ana" e o endereço com video=1', () => {
  const { api } = load();
  const n = api.txCallNotification(api.txCallInfo({ callId: 'c2', from: 'ana', video: '1', title: 'Ana' }), { now: 5 });
  assert.equal(n.options.body, 'Videochamada de Ana');
  assert.equal(n.options.data.url, '/call/c2?from=ana&video=1&accept=1');
  assert.equal(n.options.timestamp, 5);
  // Campos dentro de "data" também servem; sem nome fica o @.
  const m = api.txCallNotification(api.txCallInfo({}, { callId: 'c3', from: 'rui', video: 1 }));
  assert.equal(m.title, 'rui');
  assert.equal(m.options.body, 'Videochamada de rui');
});

test('iPhone: sem botões; com a app à vista mostra-se na mesma, sem som (o Safari não deixa avisos sem notificação)', async () => {
  const hidden = load({ ua: IPHONE });
  await hidden.push(ring());
  assert.equal(hidden.open()[0].options.actions, undefined);
  assert.equal(hidden.open()[0].options.silent, false);

  const visible = load({ ua: IPHONE, windows: ['visible'] });
  await visible.push(ring());
  assert.equal(visible.open().length, 1);
  assert.equal(visible.open()[0].options.silent, true);
  assert.equal(visible.open()[0].options.vibrate, undefined);
  assert.deepEqual(visible.messages[0], { type: 'tx-call-ring', call: { callId: 'c1', from: 'ana', name: 'Ana', video: false } });
});

test('Android com a app à vista: não aparece notificação (a app já toca), mas a página é avisada', async () => {
  const sw = load({ windows: ['visible'] });
  await sw.push(ring());
  assert.equal(sw.open().length, 0);
  assert.equal(sw.messages[0].type, 'tx-call-ring');
  // Com a app escondida em segundo plano: aparece a notificação e a página também é avisada.
  const bg = load({ windows: ['hidden'] });
  await bg.push(ring());
  assert.equal(bg.open().length, 1);
  assert.equal(bg.messages[0].type, 'tx-call-ring');
});

test('reenvio: volta a tocar; se a pessoa afastou a notificação, volta sem som', async () => {
  const sw = load();
  await sw.push(ring());
  await sw.push(ring({ repeat: '1' }));
  assert.equal(sw.open().length, 1);
  assert.equal(sw.open()[0].options.renotify, true);
  await sw.fire('notificationclose', { notification: { data: sw.open()[0].options.data } });
  sw.open()[0].closed = true;
  await sw.push(ring({ repeat: '1' }));
  assert.equal(sw.open().length, 1);
  assert.equal(sw.open()[0].options.silent, true);
  assert.equal(sw.open()[0].options.renotify, false);
});

test('regras puras: quando mostrar a tocar, sem som ou nada; e o que fazer quando a chamada acaba', () => {
  const { api } = load();
  const c = { callId: 'x', repeat: false };
  assert.equal(api.txRingMode({ callId: '' }, {}), 'skip');
  assert.equal(api.txRingMode(c, {}), 'ring');
  assert.equal(api.txRingMode(c, { visible: true }), 'skip');
  assert.equal(api.txRingMode(c, { visible: true, apple: true }), 'quiet');
  assert.equal(api.txRingMode(c, { handled: true }), 'skip');
  assert.equal(api.txRingMode(c, { handled: true, apple: true }), 'quiet');
  assert.equal(api.txRingMode(c, { dismissed: true }), 'ring');
  assert.equal(api.txRingMode({ ...c, repeat: true }, { dismissed: true }), 'quiet');
  assert.equal(api.txEndMode({ had: true, visible: false }), 'replace');
  assert.equal(api.txEndMode({ had: true, visible: true }), 'close');
  assert.equal(api.txEndMode({ had: false, visible: false }), 'close');
  assert.equal(api.txEndMode({ apple: true, had: false, visible: true }), 'replace');
  assert.equal(api.txCallUrl({ callId: 'a b', from: 'ana', video: true }, 'decline'), '/call/a%20b?from=ana&video=1&decline=1');
});

test('atendida noutro aparelho: a notificação que tocava fecha e fica uma discreta', async () => {
  const sw = load();
  await sw.push(ring());
  await sw.push({ kind: 'call_end', callId: 'c1', reason: 'accepted', title: 'Txillapp', body: 'Chamada atendida', url: '/calls', tag: 'call-c1' });
  const open = sw.open();
  assert.equal(open.length, 1);
  assert.equal(open[0].options.data.kind, 'call_end');
  assert.equal(open[0].options.body, 'Chamada atendida noutro aparelho');
  assert.equal(open[0].options.silent, true);
  assert.equal(open[0].options.requireInteraction, undefined);
  // Já não havia notificação a tocar (Android): só fecha, não mostra nada.
  const sw2 = load();
  await sw2.push({ kind: 'call_end', callId: 'c9', reason: 'declined', tag: 'call-c9' });
  assert.equal(sw2.open().length, 0);
});

test('Recusar: chama a API com o código do aviso, sem sessão e sem abrir a app', async () => {
  const sw = load({ windows: ['hidden'] });
  await sw.push(ring());
  await sw.click(sw.open()[0], 'decline');
  assert.equal(sw.fetched.length, 1);
  assert.equal(sw.fetched[0].url, '/api/v1/calls/c1/decline-push');
  assert.equal(sw.fetched[0].init.method, 'POST');
  assert.equal(sw.fetched[0].init.credentials, 'omit');
  assert.deepEqual(JSON.parse(sw.fetched[0].init.body), { token: 'tok-123' });
  assert.equal(sw.opened.length, 0);
  assert.deepEqual(sw.messages.at(-1), { type: 'tx-call-end', callId: 'c1', reason: 'declined' });
  // Um reenvio que chegue logo a seguir já não toca neste aparelho.
  await sw.push(ring({ repeat: '1' }));
  assert.equal(sw.open().length, 0);
});

test('Recusar sem rede: pede à janela aberta; sem janela e sem código, abre a app com decline=1', async () => {
  const offline = load({ windows: ['hidden'], fetchImpl: () => { throw new TypeError('offline'); } });
  await offline.push(ring());
  await offline.click(offline.open()[0], 'decline');
  assert.deepEqual(offline.messages.at(-1), { type: 'tx-call-decline', callId: 'c1' });

  const none = load();
  await none.push(ring({ declineToken: undefined }));
  await none.click(none.open()[0], 'decline');
  assert.equal(none.fetched.length, 0);
  assert.deepEqual(none.opened, ['/call/c1?from=ana&video=0&decline=1']);
});

test('Atender ou tocar na notificação abre a chamada com accept=1; uma notificação antiga leva à lista de chamadas', async () => {
  const sw = load();
  await sw.push(ring());
  await sw.click(sw.open()[0], 'answer');
  assert.deepEqual(sw.opened, ['https://txillapp.com/call/c1?from=ana&video=0&accept=1']);

  const old = load();
  await old.push(ring());
  const n = old.open()[0];
  n.options.data.at = Date.now() - 5 * 60_000;
  await old.click(n);
  assert.deepEqual(old.opened, ['https://txillapp.com/calls']);
});

test('chamada perdida: substitui a que tocava (mesma etiqueta) e abre /calls', async () => {
  const sw = load();
  await sw.push(ring());
  await sw.push({ kind: 'missed_call', callId: 'c1', from: 'ana', video: '0', title: 'Ana', body: 'Chamada perdida', url: '/calls', tag: 'call-c1' });
  const open = sw.open();
  assert.equal(open.length, 1);
  assert.equal(open[0].options.body, 'Chamada perdida');
  assert.equal(open[0].options.data.url, '/calls');
});

test('mensagem com o chat à vista: o Android não mostra; o iPhone mostra sem som e fecha (senão o Safari cancela a subscrição)', async () => {
  const msg = { title: 'Ana', body: 'enviou-te uma mensagem', url: '/messages/ana', tag: 'chat:1' };
  const chat = { state: 'visible', url: 'https://txillapp.com/messages/ana' };
  const android = load({ windows: [chat] });
  await android.push(msg);
  assert.equal(android.shown.length, 0);
  const iphone = load({ ua: IPHONE, windows: [chat] });
  await iphone.push(msg);
  assert.equal(iphone.shown.length, 1);
  assert.equal(iphone.shown[0].options.silent, true);
  assert.equal(iphone.shown[0].options.renotify, false);
  const away = load({ ua: IPHONE, windows: ['hidden'] });
  await away.push(msg);
  assert.equal(away.shown[0].options.silent, false);
  assert.equal(away.shown[0].options.renotify, true);
  const { api } = load();
  assert.equal(api.txMessageMode({ inChat: false }), 'show');
  assert.equal(api.txMessageMode({ inChat: true }), 'skip');
  assert.equal(api.txMessageMode({ inChat: true, apple: true }), 'quiet');
});
