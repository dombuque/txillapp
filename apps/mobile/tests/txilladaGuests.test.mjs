// A Txillada com convidados (0165, docs/txillada-contrato.md): o ecrã com 1, 2, 3 e 4 pessoas, a camada de vídeo de cada
// quadrado, os eventos do canal, o estado (pedir, convite, aceitar, sair, tirar) e o que cada um vê; e o cliente da API.
// Correr em apps/mobile:  node --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';

const src = (p) => new URL(`../src/${p}`, import.meta.url).href;
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r/g, '');

const stubs = {
  '@/lib/api': `
    export class ApiError extends Error { constructor(status, message) { super(message); this.status = status; } }
    export const post = (b) => ({ method: 'POST', body: JSON.stringify(b) });
    export async function raw(path, init = {}) {
      globalThis.__calls.push({ path, method: init.method ?? 'GET', body: init.body ? JSON.parse(init.body) : undefined });
      return globalThis.__reply(path, init);
    }`,
  '@tanstack/react-query': 'export const useQuery = () => ({ data: undefined });',
};
registerHooks({
  resolve(spec, ctx, next) {
    if (stubs[spec]) return { url: `data:text/javascript,${encodeURIComponent(stubs[spec])}`, shortCircuit: true };
    if (spec.startsWith('@/')) return { url: src(`${spec.slice(2)}.ts`), shortCircuit: true };
    return next(spec, ctx);
  },
});

const G = await import(src('lib/txilladaGuests.ts'));
const { txilladaApi } = await import(src('lib/api.txillada.ts'));

const P = (u, id = `id-${u}`) => ({ id, username: u, displayName: u.toUpperCase(), avatarUrl: null, verified: u === 'ana', verifiedTier: u === 'ana' ? 'verified' : null });
const guest = (u, min) => ({ user: P(u), since: `2026-11-15T10:${String(min).padStart(2, '0')}:00.000Z` });
const pend = (u) => ({ user: P(u), at: '2026-11-15T10:00:00.000Z' });
const area = (r) => r.w * r.h;
const overlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

test('ecrã: 1 pessoa = ecrã inteiro; 2 = uma em cima da outra ao alto, lado a lado deitado', () => {
  assert.deepEqual(G.stageLayout(1, 390, 844), [{ x: 0, y: 0, w: 390, h: 844 }]);
  assert.deepEqual(G.stageLayout(0, 390, 844), [{ x: 0, y: 0, w: 390, h: 844 }]);
  const tall = G.stageLayout(2, 390, 844);
  assert.deepEqual(tall, [{ x: 0, y: 0, w: 390, h: 421 }, { x: 0, y: 423, w: 390, h: 421 }]);
  const wide = G.stageLayout(2, 1440, 900);
  assert.deepEqual(wide, [{ x: 0, y: 0, w: 719, h: 900 }, { x: 721, y: 0, w: 719, h: 900 }]);
});

test('ecrã: 3 = uma grande em cima e duas em baixo; 4 = grelha 2×2; sem sobreposições e até à borda', () => {
  for (const [w, h] of [[390, 844], [1440, 900], [360, 640], [391, 845]]) {
    const three = G.stageLayout(3, w, h);
    assert.equal(three.length, 3);
    assert.equal(three[0].w, w, 'a grande em cima, a largura toda');
    assert.equal(three[0].y, 0);
    assert.equal(three[1].y, three[2].y);
    assert.ok(three[1].y > three[0].h - 1);
    assert.equal(three[2].x + three[2].w, w);
    assert.equal(three[1].y + three[1].h, h);
    const four = G.stageLayout(4, w, h);
    assert.equal(four.length, 4);
    assert.equal(four[0].y, four[1].y);
    assert.equal(four[2].y, four[3].y);
    assert.equal(four[3].x + four[3].w, w);
    assert.equal(four[3].y + four[3].h, h);
    for (const list of [three, four, G.stageLayout(2, w, h)]) {
      for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) assert.ok(!overlap(list[i], list[j]), `${w}x${h}: ${i} e ${j}`);
      // Só as frestas de 2 px ficam por cobrir.
      assert.ok(list.reduce((s, r) => s + area(r), 0) > w * h * 0.98);
    }
  }
  assert.equal(G.stageLayout(9, 390, 844).length, 4, 'nunca mais de 4');
});

test('camada de vídeo: 720p nos quadrados grandes, 360p nos pequenos', () => {
  const q = (n, w = 390, h = 844) => G.stageLayout(n, w, h).map((r) => G.tileQuality(r, w, h));
  assert.deepEqual(q(1), ['high']);
  assert.deepEqual(q(2), ['high', 'high']);
  assert.deepEqual(q(3), ['high', 'low', 'low']);
  assert.deepEqual(q(4), ['low', 'low', 'low', 'low']);
  assert.deepEqual(q(4, 1440, 900), ['low', 'low', 'low', 'low']);
});

test('quem aparece: o anfitrião primeiro, depois os convidados (sem repetidos, no máximo 3); a etiqueta abaixo do cabeçalho', () => {
  const host = P('zeca');
  const ppl = G.stagePeople(host, [guest('ana', 1), guest('rui', 2), guest('ana', 3), { user: host, since: '' }, guest('eva', 4), guest('ze', 5)]);
  assert.deepEqual(ppl.map((p) => p.username), ['zeca', 'ana', 'rui', 'eva']);
  assert.deepEqual(G.stageIds(host, [guest('ana', 1)]), ['id-zeca', 'id-ana']);
  const [top, bottom] = G.stageLayout(2, 390, 844);
  assert.equal(G.labelOffset(top, 140), 140);
  assert.equal(G.labelOffset(bottom, 140), 8);
});

test('eventos do canal: só os bem formados e desta Txillada', () => {
  assert.equal(G.parseGuestEvent({ type: 'txillada.guest_joined', txilladaId: 'outra', guest: guest('ana', 1) }, 't1'), null);
  assert.equal(G.parseGuestEvent({ type: 'txillada.guest_joined', txilladaId: 't1', guest: { user: { username: 'x' } } }, 't1'), null, 'sem id (identity)');
  assert.equal(G.parseGuestEvent({ type: 'txillada.comment', txilladaId: 't1' }, 't1'), null);
  assert.equal(G.parseGuestEvent(null), null);
  assert.deepEqual(G.parseGuestEvent({ type: 'txillada.guest_left', txilladaId: 't1', user: P('ana'), reason: '??' }, 't1'), { type: 'txillada.guest_left', txilladaId: 't1', user: P('ana'), reason: 'left' });
  assert.deepEqual(G.parseGuestEvent({ type: 'txillada.request', txilladaId: 't1', user: P('rui'), requests: [pend('rui'), { user: null }], invites: 'x' }, 't1'), { type: 'txillada.request', txilladaId: 't1', user: P('rui'), requests: [pend('rui')], invites: [] });
  assert.deepEqual(G.parseGuestEvent({ type: 'txillada.invite', txilladaId: 't1', host: { username: 'zeca', displayName: 'Zeca', avatarUrl: null } }, 't1').host.username, 'zeca');
  assert.deepEqual(G.parseGuestEvent({ type: 'txillada.request_declined', txilladaId: 't1' }), { type: 'txillada.request_declined', txilladaId: 't1' });
});

test('o meu lugar: pedir → à espera → aceite (o evento) → a transmitir → tirado → só a ver', () => {
  let s = G.guestsInit();
  const ev = (e) => G.guestsReduce(s, { t: 'event', ev: { txilladaId: 't1', ...e }, me: 'rui' });
  s = G.guestsReduce(s, { t: 'mine', mine: 'requested', now: 1000 });
  assert.equal(s.mine, 'requested');
  // Um DTO pedido antes do pedido (ainda 'none') não o desfaz logo; depois do tempo de graça vale o servidor.
  s = G.guestsReduce(s, { t: 'dto', dto: { guests: [], guestState: 'none' }, now: 2000 });
  assert.equal(s.mine, 'requested');
  s = G.guestsReduce(s, { t: 'dto', dto: { guests: [], guestState: 'requested' }, now: 1000 + G.LOCAL_GRACE_MS + 1 });
  assert.equal(s.mine, 'requested');
  s = ev({ type: 'txillada.guest_joined', guest: guest('ana', 1) });
  assert.equal(s.mine, 'requested', 'outra pessoa');
  s = ev({ type: 'txillada.guest_joined', guest: guest('rui', 2) });
  assert.equal(s.mine, 'guest');
  assert.deepEqual(s.guests.map((x) => x.user.username), ['ana', 'rui']);
  s = ev({ type: 'txillada.guest_joined', guest: guest('rui', 2) });
  assert.equal(s.guests.length, 2, 'sem repetidos');
  assert.equal(G.guestNotice({ type: 'txillada.guest_joined', txilladaId: 't1', guest: guest('rui', 2) }, 'rui', false), 'Estás a transmitir 🎥');
  s = ev({ type: 'txillada.guest_left', user: P('rui'), reason: 'removed' });
  assert.equal(s.mine, 'none');
  assert.deepEqual(s.guests.map((x) => x.user.username), ['ana']);
  assert.equal(G.guestNotice({ type: 'txillada.guest_left', txilladaId: 't1', user: P('rui'), reason: 'removed' }, 'rui', false), 'O anfitrião tirou-te de transmitir');
  assert.equal(G.guestNotice({ type: 'txillada.guest_left', txilladaId: 't1', user: P('rui'), reason: 'left' }, 'rui', false), null);
});

test('o meu lugar: convite (com quem convidou), retirado; pedido recusado; um servidor antigo não muda nada', () => {
  let s = G.guestsInit();
  const ev = (e) => G.guestsReduce(s, { t: 'event', ev: { txilladaId: 't1', ...e }, me: 'eva' });
  s = ev({ type: 'txillada.invite', host: { username: 'zeca', displayName: 'Zeca', avatarUrl: null } });
  assert.equal(s.mine, 'invited');
  assert.equal(s.inviter.username, 'zeca');
  assert.equal(G.guestUi({ status: 'live', isHost: false }, s).invited, true);
  s = ev({ type: 'txillada.invite_cancelled' });
  assert.equal(s.mine, 'none');
  assert.equal(s.inviter, null);
  s = G.guestsReduce(s, { t: 'mine', mine: 'requested', now: 0 });
  s = ev({ type: 'txillada.request_declined' });
  assert.equal(s.mine, 'none');
  assert.equal(G.guestNotice({ type: 'txillada.request_declined', txilladaId: 't1' }, 'eva', false), 'O anfitrião recusou o teu pedido');
  const before = s;
  assert.equal(G.guestsReduce(s, { t: 'dto', dto: { viewers: 3 }, now: 99_999 }), before, 'sem os campos novos');
  // O DTO diz que já transmito (aceitaram enquanto o canal estava em baixo).
  s = G.guestsReduce(s, { t: 'dto', dto: { guests: [guest('eva', 3)], guestState: 'guest' }, now: 99_999 });
  assert.equal(s.mine, 'guest');
});

test('o anfitrião: os pedidos e os convites chegam pelo canal; aceitar tira da lista; o que cada um vê', () => {
  let s = G.guestsInit();
  const ev = (e) => G.guestsReduce(s, { t: 'event', ev: { txilladaId: 't1', ...e }, me: 'zeca' });
  s = ev({ type: 'txillada.request', user: P('rui'), requests: [pend('rui'), pend('ana')], invites: [pend('eva')] });
  assert.deepEqual(s.requests.map((x) => x.user.username), ['rui', 'ana']);
  assert.equal(G.guestNotice({ type: 'txillada.request', txilladaId: 't1', user: P('rui'), requests: [], invites: [] }, 'zeca', true), '@rui pediu para entrar');
  assert.equal(G.guestNotice({ type: 'txillada.request', txilladaId: 't1', user: P('rui'), requests: [], invites: [] }, 'ana', false), null);
  const host = { status: 'live', isHost: true };
  assert.deepEqual(G.guestUi(host, s), { canRequest: false, waiting: false, invited: false, onStage: false, hostPanel: true, full: false, pending: 2 });
  assert.equal(G.viewerGuestAction(s, 'rui'), 'requested');
  assert.equal(G.viewerGuestAction(s, 'eva'), 'invited');
  assert.equal(G.viewerGuestAction(s, 'lia'), 'invite');
  s = ev({ type: 'txillada.guest_joined', guest: guest('rui', 1) });
  assert.deepEqual(s.requests.map((x) => x.user.username), ['ana']);
  assert.equal(G.viewerGuestAction(s, 'rui'), 'guest');
  s = ev({ type: 'txillada.invite_declined', user: P('eva') });
  assert.deepEqual(s.invites, []);
  s = G.guestsReduce(s, { t: 'lists', guests: [guest('ze', 3), guest('rui', 1), guest('ana', 2)], requests: [], invites: [] });
  assert.deepEqual(s.guests.map((x) => x.user.username), ['rui', 'ana', 'ze'], 'por ordem de entrada');
  assert.equal(G.guestUi(host, s).full, true);
  assert.equal(G.viewerGuestAction(s, 'lia'), 'full');
  // Quem vê: pedir; acabada: nada.
  assert.equal(G.guestUi({ status: 'live', isHost: false }, G.guestsInit()).canRequest, true);
  assert.equal(G.guestUi({ status: 'ended', isHost: false }, G.guestsInit()).canRequest, false);
  assert.equal(G.guestUi(null, G.guestsInit()).canRequest, false);
});

test('cliente da API: as rotas dos convidados', async () => {
  globalThis.__calls = [];
  globalThis.__reply = () => ({ state: 'requested' });
  await txilladaApi.guestRequest('t 1');
  await txilladaApi.guestAccept('t1');
  await txilladaApi.guestDecline('t1');
  await txilladaApi.guestLeave('t1');
  await txilladaApi.guestInvite('t1', 'ana');
  await txilladaApi.guestAcceptRequest('t1', 'rui.x');
  await txilladaApi.guestDeclineRequest('t1', 'rui');
  await txilladaApi.guestRemove('t1', 'eva');
  assert.deepEqual(globalThis.__calls.map((c) => `${c.method} ${c.path}${c.body && Object.keys(c.body).length ? ` ${JSON.stringify(c.body)}` : ''}`), [
    'POST /txilladas/t%201/guests/request',
    'POST /txilladas/t1/guests/accept',
    'POST /txilladas/t1/guests/decline',
    'POST /txilladas/t1/guests/leave',
    'POST /txilladas/t1/guests/invite {"username":"ana"}',
    'POST /txilladas/t1/guests/rui.x/accept',
    'POST /txilladas/t1/guests/rui/decline',
    'POST /txilladas/t1/guests/eva/remove',
  ]);
});

test('o ecrã liga tudo: os quadrados, quem fala, o pedido, o convite, a lista do anfitrião e as faixas de quem não aparece', () => {
  const room = read('src/lib/txilladaRoom.ts');
  assert.match(room, /ActiveSpeakersChanged/);
  assert.match(room, /setVideoQuality\(tileQuality/);
  assert.match(room, /setSubscribed\(false\)/, 'as faixas de quem não aparece no meu ecrã não se recebem');
  assert.match(room, /waitCanPublish/);
  assert.match(room, /autoSubscribe: true/, 'o anfitrião também recebe (as dos convidados)');
  const screen = read('src/app/txillada/[id].tsx');
  for (const s of ['TxilladaStage', 'InviteCard', 'GuestsPanel', 'Pedir para entrar', 'Sair do ecrã', 'Convidar para transmitir']) assert.ok(screen.includes(s), s);
  const comp = read('src/components/txillada/TxilladaGuests.tsx');
  assert.match(comp, /NameWithBadge name=\{`@\$\{t\.person\.username\}`\} who=\{t\.person\}/, 'o @ com o selo em cada quadrado');
  assert.match(comp, /mic-off/);
  assert.match(comp, /speaking/);
});
