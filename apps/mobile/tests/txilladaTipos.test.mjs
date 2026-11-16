// Txillada: os três tipos (Pública, Para amigos, Privada paga) e a Angariação (0167, docs/txillada-contrato.md): o que se
// escolhe ao preparar, os limites, a barra, as ofertas no estado do live, o cadeado e o cliente da API (com um servidor a fingir).
// Correr em apps/mobile:  node --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';

const src = (p) => new URL(`../src/${p}`, import.meta.url).href;
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r/g, '');

const stubs = {
  '@/lib/api': `
    export class ApiError extends Error { constructor(status, message, code, extra) { super(message); this.status = status; this.code = code; this.extra = extra; } }
    export const post = (b) => ({ method: 'POST', body: JSON.stringify(b) });
    export async function raw(path, init = {}) {
      globalThis.__calls.push({ path, method: init.method ?? 'GET', body: init.body ? JSON.parse(init.body) : undefined });
      const r = globalThis.__reply(path, init);
      if (r instanceof Error) throw r;
      return r;
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

const t = await import(src('lib/txillada.ts'));
const { txilladaApi } = await import(src('lib/api.txillada.ts'));

const host = { id: 'h1', username: 'zeca', displayName: 'Zeca', avatarUrl: null, verified: true, verifiedTier: 'verified' };
const dto = (o = {}) => ({ id: 't1', host, title: 'Bom dia', audience: 'everyone', status: 'live', startedAt: '2026-11-16T10:00:00.000Z', endedAt: null, viewers: 3, peakViewers: 5, cheers: 0, comments: 0, isHost: false, canComment: true, ...o });
const giver = (u, total) => ({ username: u, displayName: u.toUpperCase(), avatarUrl: null, verified: u === 'ana', verifiedTier: u === 'ana' ? 'verified' : null, total });
const gift = (id, u, amount, at = '2026-11-16T10:05:00.000Z') => ({ id, from: { username: u, displayName: u.toUpperCase(), avatarUrl: null, verified: u === 'ana', verifiedTier: u === 'ana' ? 'verified' : null }, amount, createdAt: at });
const giftEv = (g, raised, goal = 100, top = []) => ({ type: 'txillada.gift', txilladaId: 't1', gift: g, raised, goal, topGivers: top });

test('preparar: Pública, Para amigos (com «Só amigos próximos») e Privada dão os públicos do contrato', () => {
  assert.deepEqual(t.KINDS.map((k) => [k.id, k.label]), [['public', 'Pública'], ['friends', 'Para amigos'], ['paid', 'Privada']]);
  assert.equal(t.prepAudience('public', false), 'everyone');
  assert.equal(t.prepAudience('public', true), 'everyone', '«Só amigos próximos» só conta em Para amigos');
  assert.equal(t.prepAudience('friends', false), 'friends');
  assert.equal(t.prepAudience('friends', true), 'close');
  assert.equal(t.prepAudience('paid', true), 'paid');
  assert.match(t.kindHint('friends', false), /segues e te segue/);
  assert.match(t.kindHint('friends', true), /amigos próximos/);
  assert.match(t.kindHint('paid', false), /entrada em vibes/);
});

test('o tipo de uma Txillada: o do servidor, ou do público (servidores antigos)', () => {
  assert.equal(t.dtoKind(dto({ kind: 'paid' })), 'paid');
  assert.equal(t.dtoKind(dto({ audience: 'paid' })), 'paid');
  assert.equal(t.dtoKind(dto({ audience: 'close' })), 'friends');
  assert.equal(t.dtoKind(dto({ audience: 'friends' })), 'friends');
  assert.equal(t.dtoKind(dto({ audience: 'followers' })), 'public');
  assert.equal(t.dtoKind(dto()), 'public');
  assert.equal(t.dtoKind(null), 'public');
});

test('valores: só inteiros; o preço de 5 a 5000, a meta de 10 a 1 000 000, a oferta de 1 a 5000 e não mais do que o saldo', () => {
  assert.equal(t.parseAmount('50'), 50);
  assert.equal(t.parseAmount(' 1 000 '), 1000);
  assert.equal(t.parseAmount('1.000'), 1000);
  for (const bad of ['', 'abc', '12,5', '-5', '5x']) assert.equal(t.parseAmount(bad), null, bad);
  assert.match(t.priceError(null), /preço da entrada/);
  assert.match(t.priceError(4), /de 5 a 5000/);
  assert.match(t.priceError(5001), /de 5 a 5000/);
  assert.equal(t.priceError(5), null);
  assert.equal(t.priceError(5000), null);
  assert.match(t.goalError(9), /10 a 1 000 000/);
  assert.equal(t.goalError(10), null);
  assert.match(t.goalError(null), /meta/);
  assert.match(t.giftError(0), /Escolhe/);
  assert.match(t.giftError(5001), /até 5000/);
  assert.match(t.giftError(60, 50), /Não tens vibes suficientes \(tens 50\)/);
  assert.equal(t.giftError(50, 50), null);
  assert.equal(t.giftError(50), null, 'sem saber o saldo, o servidor decide');
  assert.deepEqual([...t.GIFT_PRESETS], [5, 10, 50, 100]);
});

test('números: «50 vibes», «1 vibe», «12 500»; a barra «X de Y vibes» (cheia quando passa da meta)', () => {
  assert.equal(t.txillsLabel(50), '50 vibes');
  assert.equal(t.txillsLabel(1), '1 vibe');
  assert.equal(t.fmtTxills(1000), '1000');
  assert.equal(t.fmtTxills(12500), '12 500');
  assert.equal(t.goalProgress(10, null), null);
  assert.deepEqual(t.goalProgress(25, 100), { pct: 0.25, label: '25 de 100 vibes', done: false });
  assert.deepEqual(t.goalProgress(150, 100), { pct: 1, label: '150 de 100 vibes', done: true });
  assert.equal(t.goalProgress(-3, 100).pct, 0);
});

test('a chave de cada oferta: só letras e números (8 a 64), uma nova de cada vez', () => {
  const a = t.giftKey(1_700_000_000_000, () => 0.5);
  assert.match(a, /^[A-Za-z0-9_-]{8,64}$/);
  assert.notEqual(t.giftKey(), t.giftKey());
});

test('eventos: txillada.gift bem formado passa (com o top 3); mal formado ou de outra Txillada, não', () => {
  const g = gift('g1', 'ana', 50);
  const ev = t.parseTxilladaEvent(giftEv(g, 50, 100, [giver('ana', 50), giver('rui', 10), giver('eva', 5), giver('ivo', 1)]), 't1');
  assert.equal(ev.type, 'txillada.gift');
  assert.equal(ev.gift.amount, 50);
  assert.equal(ev.topGivers.length, 3);
  assert.equal(ev.goal, 100);
  assert.equal(t.parseTxilladaEvent(giftEv(g, 50), 'outra'), null);
  assert.equal(t.parseTxilladaEvent({ ...giftEv(g, 50), gift: { id: 'x' } }, 't1'), null);
  assert.equal(t.parseTxilladaEvent({ ...giftEv(g, 50), goal: null }, 't1').goal, null);
});

test('estado: uma oferta põe a linha destacada na conversa, sobe a barra e o top; repetida não conta duas vezes', () => {
  let s = t.initialLive(dto({ goal: 100, goalPurpose: 'Festa', raised: 0, topGivers: [] }));
  assert.equal(s.goal, 100);
  s = t.applyEvent(s, giftEv(gift('g1', 'ana', 50), 50, 100, [giver('ana', 50)]));
  assert.equal(s.raised, 50);
  assert.equal(s.giftBurst, 1);
  assert.deepEqual(s.topGivers.map((x) => x.username), ['ana']);
  const line = s.comments.at(-1);
  assert.equal(line.id, 'gift:g1');
  assert.equal(line.body, 'ofereceu 50 vibes');
  assert.deepEqual(line.gift, { amount: 50 });
  assert.equal(line.author.username, 'ana');
  assert.equal(line.author.verified, true, 'o selo vai com o nome');
  assert.equal(t.isGiftLine(line), true);
  // O mesmo evento outra vez (a minha resposta e o evento da sala): igual.
  assert.equal(t.applyEvent(s, giftEv(gift('g1', 'ana', 50), 50, 100, [giver('ana', 50)])), s);
  assert.equal(t.withMyGift(s, { gift: gift('g1', 'ana', 50), raised: 50, goal: 100, topGivers: [giver('ana', 50)] }), s);
  // Uma resposta atrasada (raised mais baixo) não faz a barra andar para trás.
  s = t.applyEvent(s, giftEv(gift('g2', 'rui', 100), 150, 100, [giver('rui', 100), giver('ana', 50)]));
  s = t.withDto(s, dto({ goal: 100, raised: 60, topGivers: [giver('ana', 50)] }));
  assert.equal(s.raised, 150);
  assert.deepEqual(s.topGivers.map((x) => x.username), ['rui', 'ana']);
  // As linhas das ofertas não vão no ?after= (não são comentários) nem têm menu.
  const withComment = t.withComments(s, [{ id: 'c1', author: { id: 'a', username: 'eva', displayName: 'Eva', avatarUrl: null }, body: 'oi', createdAt: '2026-11-16T10:01:00.000Z' }]);
  assert.equal(t.lastCommentId(withComment), 'c1');
  assert.equal(t.lastCommentId(t.applyEvent(t.initialLive(), giftEv(gift('g9', 'ana', 5), 5))), null);
  assert.deepEqual(t.commentMenu(dto(), line, 'rui'), []);
  assert.deepEqual(t.commentActions(dto({ isHost: true }), line, 'zeca'), []);
});

test('privada sem entrada: o cartão com o cadeado (não liga à sala); com a entrada, ao vivo, sem a lista de quem vê', () => {
  const locked = dto({ kind: 'paid', audience: 'paid', price: 50, hasTicket: false, locked: true, viewersHidden: true, viewers: 0 });
  assert.equal(t.viewKind(locked, t.initialLive(locked), false), 'locked');
  const ui = t.liveUi(locked);
  assert.deepEqual([ui.canComment, ui.canCheer, ui.canGift, ui.canShare, ui.canSeeViewers], [false, false, false, false, false]);
  assert.equal(ui.canReport, true, 'o cartão também se denuncia');
  const inside = { ...locked, hasTicket: true, locked: false };
  assert.equal(t.viewKind(inside, t.initialLive(inside), false), 'live');
  assert.deepEqual([t.liveUi(inside).canGift, t.liveUi(inside).canSeeViewers], [true, false]);
  const asHost = { ...inside, isHost: true, viewersHidden: false };
  assert.deepEqual([t.liveUi(asHost).canGift, t.liveUi(asHost).canSeeViewers], [false, true]);
  // Acabada: acabou, mesmo sem entrada.
  assert.equal(t.viewKind({ ...locked, status: 'cut' }, t.initialLive(), false), 'ended');
  assert.equal(t.errorText(402), 'Esta Txillada é privada: paga a entrada para entrar.');
  assert.equal(t.isInsufficient({ status: 422, code: 'insufficient_funds' }), true);
  assert.equal(t.isInsufficient({ status: 422, extra: { code: 'insufficient_funds' } }), true);
  assert.equal(t.isInsufficient({ status: 422 }), false);
  assert.equal(t.isInsufficient({ status: 402, code: 'insufficient_funds' }), false);
});

test('a roda «AO VIVO»: numa privada que ainda não paguei, o preço; nas outras, nada', () => {
  assert.equal(t.livePrice({ live: { id: 't1', price: 50 } }), 50);
  assert.equal(t.livePrice({ live: { id: 't1' } }), null);
  assert.equal(t.livePrice({ live: null }), null);
  assert.equal(t.livePrice(undefined), null);
  assert.match(read('src/components/txillada/TxilladaParts.tsx'), /<Icon name=\{price \? 'lock' : 'txillada'\}/);
  assert.match(read('src/components/StoriesTray.tsx'), /<LiveRing price=\{livePrice\(u\)\}>/);
  assert.match(read('src/components/ProfileView.tsx'), /livePrice=\{livePrice\(p\)\}/);
});

test('resumo do anfitrião: as entradas pagas (numa privada) e as vibes oferecidas', () => {
  const s = t.applyEvent(t.initialLive(), giftEv(gift('g1', 'ana', 30), 30));
  const sum = t.liveSummary(dto({ kind: 'paid', status: 'ended', endedAt: '2026-11-16T10:30:00.000Z', tickets: 4, raised: 10, isHost: true }), s, Date.now());
  assert.equal(sum.raised, 30);
  assert.equal(sum.tickets, 4);
  assert.equal(t.liveSummary(dto({ status: 'ended' }), t.initialLive(), Date.now()).tickets, null);
});

test('API: abrir com o tipo, o preço e a Angariação; pagar a entrada; oferecer com a chave', async () => {
  globalThis.__calls = [];
  globalThis.__reply = (path) => (path === '/wallet' ? { balance: 420 } : { ok: true });
  await txilladaApi.start('Olá', 'paid', { price: 50, goal: 1000, purpose: 'Som novo' });
  await txilladaApi.start('Olá', 'friends', { price: 50 });
  await txilladaApi.start('', 'close');
  await txilladaApi.pay('t 1');
  await txilladaApi.gift('t1', 50, 'gabc12345');
  assert.equal(await txilladaApi.balance(), 420);
  assert.deepEqual(globalThis.__calls, [
    { path: '/txilladas', method: 'POST', body: { title: 'Olá', audience: 'paid', price: 50, goal: 1000, purpose: 'Som novo' } },
    { path: '/txilladas', method: 'POST', body: { title: 'Olá', audience: 'friends' } },
    { path: '/txilladas', method: 'POST', body: { title: '', audience: 'close' } },
    { path: '/txilladas/t%201/ticket', method: 'POST', body: {} },
    { path: '/txilladas/t1/gifts', method: 'POST', body: { amount: 50, key: 'gabc12345' } },
    { path: '/wallet', method: 'GET', body: undefined },
  ]);
  globalThis.__reply = () => new Error('rede');
  assert.equal(await txilladaApi.balance(), null);
});

test('o ecrã: preparar com os três tipos e a Angariação; o cadeado antes de pagar; oferecer, a barra e o top', () => {
  const prep = read('src/components/txillada/TxilladaPrep.tsx');
  assert.match(prep, /KINDS\.map/);
  assert.match(prep, /Só amigos próximos/);
  assert.match(prep, /prepAudience\(txKind, closeOnly\)/);
  assert.match(prep, /label="Angariação"/);
  const screen = read('src/app/txillada/[id].tsx');
  assert.match(screen, /if \(kind === 'locked'\)/);
  assert.match(screen, /<LockedView dto=\{dto\} onPay=\{tx\.pay\}/);
  assert.match(screen, /<GoalBar raised=\{live\.raised\} goal=\{live\.goal\}/);
  assert.match(screen, /<TopGivers items=\{live\.topGivers\} \/>/);
  assert.match(screen, /onSend=\{tx\.gift\}/);
  assert.match(screen, /noViewers: !!dto\?\.viewersHidden && !host/);
  assert.match(screen, /router\.push\('\/wallet' as never\)/);
  const money = read('src/components/txillada/TxilladaMoney.tsx');
  assert.match(money, /Entrar por \{formatVibes\(price, \{ short: true \}\)\}/);
  assert.match(money, /Ver a carteira/);
  // Sem compras: os Txills vêm da carteira (nada de IAP aqui).
  assert.doesNotMatch(money + prep, /comprar|purchase|iap/i);
  // O vidro da linha da oferta na cor da marca.
  assert.match(read('src/components/StoryFloatComments.tsx'), /gift && st\.giftGlass/);
});

test('texto à vista: sem travessões nem emojis nos ecrãs novos', () => {
  const emoji = /\p{Extended_Pictographic}/u;
  for (const f of ['src/components/txillada/TxilladaMoney.tsx', 'src/components/txillada/TxilladaPrep.tsx']) {
    const s = read(f);
    assert.doesNotMatch(s, /—/, `${f}: travessão`);
    assert.doesNotMatch(s, emoji, `${f}: emoji`);
  }
  // Os textos novos de lib/txillada (os rótulos e os erros), sem travessões.
  const lib = read('src/lib/txillada.ts');
  const kinds = lib.slice(lib.indexOf('export const KINDS'), lib.indexOf('export function livePrice'));
  assert.doesNotMatch(kinds, /—/);
  assert.doesNotMatch(kinds, emoji);
});
