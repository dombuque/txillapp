// Compras pela loja (App Store e Google Play): só o selo azul (subscrição) e o Bombar (pacotes). A loja e a API são
// simuladas: src/lib/iap/core.ts não depende do React Native nem do expo-iap.
// Correr em apps/mobile:  node --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { INTENTS_KEY, classifyIapError, createIap, doneMessage, iapMessage, iapPlatformFor, outcomeMessage, restoreBody, verifyBody, verifyFailedMessage } from '../src/lib/iap/core.ts';
import { PRIVACY_URL, TERMS_URL, activeText, approvedForBlue, blueScreenState, blueSealEntry, boostPackLabel, boostPackageFor, periodLabel, storeName, subscriptionTerms } from '../src/lib/iap/view.ts';
import { IAP_READY, askStoreCatalog, helpFaqFor, purchaseRulesFor, storePurchasesOn } from '../src/lib/storeRules.ts';
import { nativeStore as webStore } from '../src/lib/iap/store.web.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p) => readFileSync(path.join(ROOT, 'src', ...p), 'utf8').replace(/\r\n/g, '\n');
const USER = '6f1c2a4e-7b8d-4c3e-9a10-1234567890ab';
const tick = () => new Promise((r) => setTimeout(r, 0));

const CATALOG = {
  enabled: true,
  verification: { products: [{ id: 'txill.selo.mensal', period: 'month' }, { id: 'txill.selo.anual', period: 'year' }], eligible: true, active: null },
  boost: { products: [{ id: 'txill.bombar.3d', days: 3, radiusKm: 5 }, { id: 'txill.bombar.7d', days: 7, radiusKm: 10 }] },
};

/** Uma loja de mentira: regista tudo o que a app lhe pede e entrega compras quando o teste mandar. */
function fakeStore({ available = true, unfinished = [], owned = [], buyError = null } = {}) {
  const log = [];
  let onBuy = null;
  let onErr = null;
  const s = {
    available,
    log,
    unfinishedList: unfinished,
    async connect() { log.push(['connect']); },
    async products(ids, kind) { log.push(['products', ids, kind]); return ids.map((id) => ({ id, kind, title: id, price: id.includes('anual') ? '2 500,00 MT' : '250,00 MT' })); },
    async buy(req) { log.push(['buy', req]); if (buyError) throw buyError; },
    listen(cb) { onBuy = cb; return () => { onBuy = null; }; },
    listenErrors(cb) { onErr = cb; return () => { onErr = null; }; },
    async unfinished() { log.push(['unfinished']); return s.unfinishedList; },
    async owned() { log.push(['owned']); return owned; },
    async finish(p, consumable) { log.push(['finish', p.token, consumable]); s.unfinishedList = s.unfinishedList.filter((x) => x.token !== p.token); },
    async manage(id) { log.push(['manage', id]); },
    deliver(p) { onBuy?.(p); },
    fail(e) { onErr?.(e); },
  };
  return s;
}

function fakeApi({ verify = async () => ({ ok: true, entitlement: { tier: 'paid' } }) } = {}) {
  const log = [];
  return {
    log,
    async catalog(platform) { log.push(['catalog', platform]); return CATALOG; },
    async appleVerify(b) { log.push(['appleVerify', b]); return verify(b); },
    async googleVerify(b) { log.push(['googleVerify', b]); return verify(b); },
    async restore(b) { log.push(['restore', b]); return { ok: true }; },
  };
}

function memStorage() {
  const m = new Map();
  return { m, async get(k) { return m.get(k) ?? null; }, async set(k, v) { m.set(k, v); } };
}

const purchase = (productId, token, extra = {}) => ({ productId, token, id: `t-${token}`, state: 'purchased', profileId: null, raw: { token }, ...extra });
const networkError = () => new TypeError('Sem ligação à internet. Verifica a rede e tenta outra vez.');

// ---------------------------------------------------------------------------------------------------------------------
// Canais e interruptores
// ---------------------------------------------------------------------------------------------------------------------

test('as compras pela loja estão desligadas nesta versão (IAP_READY): nada aparece nem se liga à loja, diga o servidor o que disser', () => {
  assert.equal(IAP_READY, false);
  for (const c of ['play', 'appstore', 'beta', 'web']) {
    assert.equal(askStoreCatalog(c), false, c);
    assert.equal(storePurchasesOn(c, true), false, c);
    const r = purchaseRulesFor(c, { iap: true });
    assert.equal(r.storeBoosts, false, c);
    assert.equal(r.storeVerification, false, c);
  }
  // Nas lojas o Bombar fica escondido como até aqui.
  assert.equal(purchaseRulesFor('play', { iap: true }).buyBoosts, false);
  assert.equal(purchaseRulesFor('appstore', { iap: true }).buyBoosts, false);
  // A app só pergunta pelo catálogo (e só depois liga à loja) com o interruptor ligado.
  const p = read('lib', 'purchases.ts');
  assert.match(p, /export const ASK_IAP = askStoreCatalog\(CHANNEL\) && !!IAP_PLATFORM;/);
  assert.match(p, /enabled: ASK_IAP/);
  const idx = read('lib', 'iap', 'index.ts');
  assert.match(idx, /platform: ASK_IAP \? IAP_PLATFORM : null/);
  assert.match(idx, /const on = iap\.supported && /);
});

test('com a versão pronta, só nas lojas e com o catálogo ligado; no site e no APK beta nada muda', () => {
  for (const c of ['play', 'appstore']) {
    assert.equal(askStoreCatalog(c, true), true, c);
    assert.equal(storePurchasesOn(c, true, true), true, c);
    assert.equal(storePurchasesOn(c, false, true), false, c);
    assert.equal(storePurchasesOn(c, undefined, true), false, c);
    assert.deepEqual(purchaseRulesFor(c, { iap: true }, false, true), { buyTxills: false, buyBoosts: false, storeBoosts: true, storeVerification: true }, c);
    assert.deepEqual(purchaseRulesFor(c, null, false, true), { buyTxills: false, buyBoosts: false, storeBoosts: false, storeVerification: false }, c);
  }
  for (const c of ['web', 'beta']) {
    assert.equal(askStoreCatalog(c, true), false, c);
    assert.deepEqual(purchaseRulesFor(c, { iap: true }, true, true), { buyTxills: true, buyBoosts: true, storeBoosts: false, storeVerification: false }, c);
  }
  assert.equal(iapPlatformFor('appstore'), 'ios');
  assert.equal(iapPlatformFor('play'), 'android');
  assert.equal(iapPlatformFor('beta'), null);
  assert.equal(iapPlatformFor('web'), null);
});

test('sem loja (APK beta, web ou interruptor desligado) nunca se abre a ligação ao StoreKit / Play Billing', async () => {
  const store = fakeStore();
  const api = fakeApi();
  const iap = createIap({ platform: null, store, api, storage: memStorage(), userId: () => USER });
  assert.equal(iap.supported, false);
  await assert.rejects(iap.ensure());
  assert.equal((await iap.subscribe('txill.selo.mensal')).status, 'error');
  let drafted = false;
  assert.equal((await iap.buyBoost('txill.bombar.3d', async () => { drafted = true; return { id: 'c1' }; })).status, 'error');
  assert.equal(drafted, false);
  assert.deepEqual(store.log, []);
  // Na web a camada da loja não faz nada e não carrega a biblioteca.
  assert.equal(webStore.available, false);
  assert.deepEqual(await webStore.unfinished(), []);
  const web = createIap({ platform: 'android', store: webStore, api, storage: memStorage(), userId: () => USER });
  assert.equal(web.supported, false);
  // A camada nativa só carrega o expo-iap quando liga (import dinâmico), e o APK beta nunca chega lá.
  const native = read('lib', 'iap', 'store.ts');
  assert.doesNotMatch(native, /^import .* from 'expo-iap'/m);
  assert.match(native, /import\('expo-iap'\)/);
});

// ---------------------------------------------------------------------------------------------------------------------
// A subscrição (o selo azul)
// ---------------------------------------------------------------------------------------------------------------------

test('subscrever no iPhone: a loja recebe o uuid da conta (appAccountToken), o verify leva a transação assinada e só depois se acaba', async () => {
  const store = fakeStore();
  const api = fakeApi();
  const iap = createIap({ platform: 'ios', store, api, storage: memStorage(), userId: () => USER });
  assert.equal(iap.supported, true);
  const pending = iap.subscribe('txill.selo.mensal');
  await tick();
  assert.equal(store.log.filter((l) => l[0] === 'connect').length, 1);
  assert.deepEqual(store.log.find((l) => l[0] === 'buy')[1], { productId: 'txill.selo.mensal', kind: 'subs', accountId: USER, profileId: undefined });
  store.deliver(purchase('txill.selo.mensal', 'jws.ios.1'));
  const o = await pending;
  assert.equal(o.status, 'done');
  assert.equal(o.kind, 'verification');
  assert.deepEqual(o.entitlement, { tier: 'paid' });
  assert.deepEqual(api.log.find((l) => l[0] === 'appleVerify')[1], { signedTransaction: 'jws.ios.1' });
  // finishTransaction depois do servidor, e a subscrição não se consome.
  const order = [...api.log.map((l) => l[0]), ...store.log.map((l) => l[0])];
  assert.ok(order.includes('appleVerify') && order.includes('finish'));
  assert.deepEqual(store.log.find((l) => l[0] === 'finish'), ['finish', 'jws.ios.1', false]);
  // A ligação abre-se uma vez só.
  await iap.ensure();
  assert.equal(store.log.filter((l) => l[0] === 'connect').length, 1);
});

test('subscrever no Android: obfuscatedAccountId com o uuid da conta e o verify com productId e purchaseToken', async () => {
  const store = fakeStore();
  const api = fakeApi();
  const iap = createIap({ platform: 'android', store, api, storage: memStorage(), userId: () => USER });
  const pending = iap.subscribe('txill.selo.anual');
  await tick();
  assert.equal(store.log.find((l) => l[0] === 'buy')[1].accountId, USER);
  store.deliver(purchase('txill.selo.anual', 'gp-token-1'));
  assert.equal((await pending).status, 'done');
  assert.deepEqual(api.log.find((l) => l[0] === 'googleVerify')[1], { productId: 'txill.selo.anual', purchaseToken: 'gp-token-1' });
  assert.deepEqual(verifyBody('android', { productId: 'a', token: 't' }, 'c9'), { productId: 'a', purchaseToken: 't', campaignId: 'c9' });
  assert.deepEqual(verifyBody('ios', { productId: 'a', token: 'jws' }), { signedTransaction: 'jws' });
});

test('sem sessão não se compra', async () => {
  const store = fakeStore();
  const iap = createIap({ platform: 'ios', store, api: fakeApi(), storage: memStorage(), userId: () => null });
  assert.equal((await iap.subscribe('txill.selo.mensal')).status, 'error');
  assert.equal(store.log.some((l) => l[0] === 'buy'), false);
});

test('cancelado pela pessoa: sem alarme; pendente («Pedir para comprar»): avisa e não vai ao servidor', async () => {
  const cancelStore = fakeStore({ buyError: Object.assign(new Error('cancelled'), { code: 'user-cancelled' }) });
  const a = createIap({ platform: 'ios', store: cancelStore, api: fakeApi(), storage: memStorage(), userId: () => USER });
  const o = await a.subscribe('txill.selo.mensal');
  assert.equal(o.status, 'cancelled');
  assert.equal(iapMessage('cancelled'), null);

  const store = fakeStore();
  const api = fakeApi();
  const b = createIap({ platform: 'ios', store, api, storage: memStorage(), userId: () => USER });
  const p = b.subscribe('txill.selo.mensal');
  await tick();
  store.deliver(purchase('txill.selo.mensal', 'jws.ask', { state: 'pending' }));
  assert.equal((await p).status, 'pending');
  assert.equal(api.log.some((l) => l[0] === 'appleVerify'), false);
  assert.equal(store.log.some((l) => l[0] === 'finish'), false);
  assert.match(iapMessage('pending'), /aprovação/);
  // O «Ask to Buy» também pode vir como erro da loja.
  assert.equal(classifyIapError({ code: 'deferred-payment' }), 'pending');
  assert.equal(classifyIapError({ code: 'network-error' }), 'network');
  assert.equal(classifyIapError(networkError()), 'network');
  assert.equal(classifyIapError({ code: 'billing-unavailable' }), 'unavailable');
  assert.equal(classifyIapError(new Error('x')), 'failed');
});

test('a compra nunca se perde: sem rede ou com falha na confirmação fica por acabar e volta ao servidor no arranque', async () => {
  let mode = 'offline';
  const api = fakeApi({ verify: async () => { if (mode === 'offline') throw networkError(); if (mode === 'reject') throw Object.assign(new Error('Erro'), { status: 502 }); return { ok: true, entitlement: {} }; } });
  const store = fakeStore();
  const iap = createIap({ platform: 'android', store, api, storage: memStorage(), userId: () => USER });
  const p = iap.subscribe('txill.selo.mensal');
  await tick();
  const bought = purchase('txill.selo.mensal', 'gp-offline');
  store.unfinishedList = [bought];
  store.deliver(bought);
  assert.equal((await p).status, 'retry');
  assert.match(iapMessage('retry'), /ficou guardada/);
  assert.equal(store.log.some((l) => l[0] === 'finish'), false);

  // Ao abrir outra vez: o servidor falha → continua por acabar, com a mensagem de não voltar a comprar.
  mode = 'reject';
  const r1 = await iap.recover();
  assert.deepEqual(r1.map((o) => o.status), ['verify-failed']);
  assert.match(iapMessage('verify-failed'), /Não voltes a comprar/);
  assert.equal(store.log.some((l) => l[0] === 'finish'), false);

  // E depois confirma: só agora se acaba.
  mode = 'ok';
  const seen = [];
  iap.onOutcome((o) => seen.push(o.status));
  const r2 = await iap.recover();
  assert.deepEqual(r2.map((o) => o.status), ['done']);
  assert.deepEqual(seen, ['done']);
  assert.deepEqual(store.log.filter((l) => l[0] === 'finish'), [['finish', 'gp-offline', false]]);
  assert.deepEqual(await iap.recover(), []);
  // O servidor a dizer ok: false também não acaba.
  const s2 = fakeStore({ unfinished: [purchase('txill.selo.mensal', 'gp-bad')] });
  const i2 = createIap({ platform: 'android', store: s2, api: fakeApi({ verify: async () => ({ ok: false }) }), storage: memStorage(), userId: () => USER });
  assert.deepEqual((await i2.recover()).map((o) => o.status), ['verify-failed']);
  assert.equal(s2.log.some((l) => l[0] === 'finish'), false);
});

test('a mesma compra entregue duas vezes ao mesmo tempo (ouvinte e arranque) vai uma só vez ao servidor', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const api = fakeApi({ verify: async () => { await gate; return { ok: true, entitlement: {} }; } });
  const p = purchase('txill.selo.mensal', 'jws.dup');
  const store = fakeStore({ unfinished: [p] });
  const iap = createIap({ platform: 'ios', store, api, storage: memStorage(), userId: () => USER });
  await iap.ensure();
  store.deliver(p);
  const rec = iap.recover();
  await tick();
  release();
  await rec;
  assert.equal(api.log.filter((l) => l[0] === 'appleVerify').length, 1);
});

test('restaurar compras: iOS manda as transações assinadas, Android os tokens, e reenvia as por acabar', async () => {
  const ownedIos = [purchase('txill.selo.anual', 'jws.a'), purchase('txill.selo.mensal', 'jws.b', { state: 'pending' })];
  const store = fakeStore({ owned: ownedIos, unfinished: [purchase('txill.selo.anual', 'jws.c')] });
  const api = fakeApi();
  const iap = createIap({ platform: 'ios', store, api, storage: memStorage(), userId: () => USER });
  assert.deepEqual(await iap.restore(), { ok: true });
  assert.deepEqual(api.log.find((l) => l[0] === 'restore')[1], { platform: 'ios', signedTransactions: ['jws.a'] });
  assert.deepEqual(store.log.filter((l) => l[0] === 'finish'), [['finish', 'jws.c', false]]);

  assert.deepEqual(restoreBody('android', [{ productId: 'txill.selo.anual', token: 'gp1' }]), { platform: 'android', purchases: [{ productId: 'txill.selo.anual', purchaseToken: 'gp1' }] });
  const offline = createIap({ platform: 'android', store: fakeStore({ owned: [purchase('x', 'y')] }), api: { ...fakeApi(), restore: async () => { throw networkError(); } }, storage: memStorage(), userId: () => USER });
  assert.deepEqual(await offline.restore(), { ok: false, kind: 'network' });
});

// ---------------------------------------------------------------------------------------------------------------------
// O Bombar pela loja
// ---------------------------------------------------------------------------------------------------------------------

test('Bombar no Android: rascunho primeiro, compra com o id da campanha, verify com o campaignId, consome-se no fim', async () => {
  const store = fakeStore();
  const api = fakeApi({ verify: async () => ({ ok: true, entitlement: { campaignId: 'camp-1', state: 'active' } }) });
  const storage = memStorage();
  const iap = createIap({ platform: 'android', store, api, storage, userId: () => USER });
  const steps = [];
  const p = iap.buyBoost('txill.bombar.3d', async () => { steps.push('draft'); return { id: 'camp-1' }; });
  await tick();
  await tick();
  assert.deepEqual(steps, ['draft']);
  const buy = store.log.find((l) => l[0] === 'buy');
  assert.deepEqual(buy[1], { productId: 'txill.bombar.3d', kind: 'in-app', accountId: USER, profileId: 'camp-1' });
  assert.deepEqual(JSON.parse(storage.m.get(INTENTS_KEY)), { 'txill.bombar.3d': 'camp-1' });
  store.deliver(purchase('txill.bombar.3d', 'gp-boost', { profileId: 'camp-1' }));
  const o = await p;
  assert.equal(o.status, 'done');
  assert.equal(o.kind, 'boost');
  assert.equal(o.campaignId, 'camp-1');
  assert.deepEqual(api.log.find((l) => l[0] === 'googleVerify')[1], { productId: 'txill.bombar.3d', purchaseToken: 'gp-boost', campaignId: 'camp-1' });
  assert.deepEqual(store.log.find((l) => l[0] === 'finish'), ['finish', 'gp-boost', true]);
  assert.deepEqual(JSON.parse(storage.m.get(INTENTS_KEY)), {});
});

test('Bombar no iPhone: o campaignId vem do que ficou guardado, também quando a compra só chega no arranque seguinte', async () => {
  const storage = memStorage();
  const store = fakeStore();
  let offline = true;
  const api = fakeApi({ verify: async () => { if (offline) throw networkError(); return { ok: true, entitlement: {} }; } });
  const iap = createIap({ platform: 'ios', store, api, storage, userId: () => USER });
  const p = iap.buyBoost('txill.bombar.7d', async () => ({ id: 'camp-7' }));
  await tick();
  await tick();
  assert.equal(store.log.find((l) => l[0] === 'buy')[1].profileId, undefined);
  const bought = purchase('txill.bombar.7d', 'jws.boost');
  store.unfinishedList = [bought];
  store.deliver(bought);
  assert.equal((await p).status, 'retry');
  iap.dispose();

  // A app voltou a abrir (outra instância, o mesmo aparelho): o rascunho continua guardado.
  offline = false;
  const again = createIap({ platform: 'ios', store, api, storage, userId: () => USER });
  const [o] = await again.recover();
  assert.equal(o.status, 'done');
  assert.equal(o.campaignId, 'camp-7');
  assert.deepEqual(api.log.filter((l) => l[0] === 'appleVerify').at(-1)[1], { signedTransaction: 'jws.boost', campaignId: 'camp-7' });
  assert.deepEqual(store.log.filter((l) => l[0] === 'finish'), [['finish', 'jws.boost', true]]);
});

test('Bombar: sem loja não se cria rascunho; rascunho que falha não abre a compra', async () => {
  const unavailable = fakeStore();
  unavailable.connect = async () => { throw Object.assign(new Error('x'), { code: 'billing-unavailable' }); };
  const a = createIap({ platform: 'android', store: unavailable, api: fakeApi(), storage: memStorage(), userId: () => USER });
  let drafted = false;
  const o = await a.buyBoost('txill.bombar.3d', async () => { drafted = true; return { id: 'c' }; });
  assert.deepEqual([o.status, o.kind, drafted], ['error', 'unavailable', false]);

  const store = fakeStore();
  const b = createIap({ platform: 'android', store, api: fakeApi(), storage: memStorage(), userId: () => USER });
  const r = await b.buyBoost('txill.bombar.3d', async () => { throw networkError(); });
  assert.deepEqual([r.status, r.kind], ['error', 'network']);
  assert.equal(store.log.some((l) => l[0] === 'buy'), false);
});

test('o ecrã do Bombar nas lojas: pacotes da loja (dias, raio e preço), rascunho com source iap e o pacote', () => {
  assert.equal(boostPackageFor(1), '1d');
  assert.equal(boostPackageFor(3), '3d');
  assert.equal(boostPackageFor(7), '7d');
  assert.equal(boostPackLabel({ days: 3, radiusKm: 5 }), '3 dias · 5 km');
  assert.equal(boostPackLabel({ days: 1, radiusKm: 2 }), '1 dia · 2 km');
  const vb = read('components', 'boost', 'VenueBoost.tsx');
  assert.match(vb, /const rules = usePurchases\(\);/);
  assert.match(vb, /if \(rules\.storeBoosts\) \{/);
  assert.match(vb, /iap\.buyBoost\(pack\.id, \(\) =>/);
  assert.match(vb, /source: 'iap', pack: pack\.id/);
  assert.match(vb, /package: boostPackageFor\(pack\.days\), radiusKm: pack\.radiusKm/);
  assert.match(vb, /iap\.products\(ids\.split\(','\), 'in-app'\)/);
  assert.match(read('lib', 'api.boosts.ts'), /source\?: 'iap'; .*pack\?: string;/);
});

// ---------------------------------------------------------------------------------------------------------------------
// O ecrã do selo azul
// ---------------------------------------------------------------------------------------------------------------------

test('o ecrã do selo azul: só nas lojas com o catálogo ligado; quem não é elegível pede primeiro a verificação', () => {
  assert.equal(blueScreenState('web', CATALOG), 'hidden');
  assert.equal(blueScreenState('beta', CATALOG), 'hidden');
  assert.equal(blueScreenState('play', null, true), 'loading');
  assert.equal(blueScreenState('play', null), 'hidden');
  assert.equal(blueScreenState('appstore', { ...CATALOG, enabled: false }), 'hidden');
  assert.equal(blueScreenState('appstore', CATALOG), 'offer');
  const notYet = { ...CATALOG, verification: { ...CATALOG.verification, eligible: false } };
  assert.equal(blueScreenState('play', notYet), 'not-eligible');
  const active = { ...CATALOG, verification: { ...CATALOG.verification, active: { productId: 'txill.selo.anual', expiresAt: '2027-03-05T10:00:00Z', autoRenew: true } } };
  assert.equal(blueScreenState('play', active), 'active');
  assert.equal(blueScreenState('play', { ...active, enabled: false }), 'active');
  assert.match(activeText(active.verification.active), /ativo e renova a 05\/03\/2027/);
  assert.match(activeText({ expiresAt: '2027-03-05T10:00:00Z', autoRenew: false }), /até 05\/03\/2027\. Não vai renovar/);
});

test('o ecrã do selo azul mostra o preço e o período da loja, as condições e as ligações (Apple 3.1.2)', () => {
  assert.equal(periodLabel('month'), 'por mês');
  assert.equal(periodLabel('year'), 'por ano');
  assert.equal(TERMS_URL, 'https://txillapp.com/termos');
  assert.equal(PRIVACY_URL, 'https://txillapp.com/privacidade');
  for (const pl of ['ios', 'android']) {
    const t = subscriptionTerms(pl).join(' ');
    assert.match(t, new RegExp(storeName(pl)));
    assert.match(t, /renova-se automaticamente/);
    assert.match(t, /24 horas/);
    assert.match(t, /Cancelas quando quiseres/);
  }
  assert.match(subscriptionTerms('ios').join(' '), /Definições do iPhone/);
  assert.match(subscriptionTerms('android').join(' '), /Pagamentos e subscrições/);

  const s = read('app', 'selo-azul.tsx');
  assert.match(s, /const state = ASK_IAP \? blueScreenState\(CHANNEL, c, catalog\.isLoading\) : 'hidden';/);
  assert.match(s, /if \(state === 'hidden'\) return <Redirect/);
  assert.match(s, /iap\.products\(ids\.split\(','\), 'subs'\)/);
  assert.match(s, /\{p\.price\} <Text style=\{st\.small\}>\{periodLabel\(per\)\}<\/Text>/);
  assert.match(s, /Renova automaticamente/);
  assert.match(s, /subscriptionTerms\(platform\)/);
  assert.match(s, /Linking\.openURL\(TERMS_URL\)/);
  assert.match(s, /Linking\.openURL\(PRIVACY_URL\)/);
  for (const b of ['>Subscrever<', "'Restaurar compras'", '>Gerir subscrição<', '>Pedir a verificação<']) assert.ok(s.includes(b), b);
  assert.match(s, /router\.push\('\/verification' as never\)/);
  assert.match(s, /activeText\(c\.verification\.active\)/);
  assert.match(s, /void iap\.recover\(\)/);
  assert.match(s, /<VerifiedBadge size=\{56\} tier="paid" \/>/);
  // As condições ficam no ecrã antes de se subscrever (não atrás de uma ligação).
  assert.ok(s.indexOf('>Subscrever<') < s.indexOf('subscriptionTerms(platform)'));
  // A entrada: Definições → Conta e o ecrã da verificação, só com as compras pela loja ligadas.
  const conta = read('app', 'settings', 'conta.tsx');
  assert.match(conta, /const blue = purchases\.storeVerification && ver\.data \? blueSealEntry\(ver\.data\) : null;/);
  assert.match(conta, /\{blue \? <SettingRow [^\n]*to="\/selo-azul"/);
  const ver = read('app', 'verification.tsx');
  assert.match(ver, /const entry = s && purchases\.storeVerification \? blueSealEntry\(s\) : null;/);
  assert.match(ver, /\{entry \? <BlueSealEntry/);
  // Aprovado para o selo azul (paid_eligible): diz-se, e o formulário do pedido já não aparece (o servidor dava 409).
  assert.ok(ver.includes('>Aprovado para o selo azul<'));
  assert.match(ver, /s\.eligible && !blueOk && s\.request\?\.status !== 'pending'/);
  // A camada nativa identifica sempre quem compra e leva o plano base no Android.
  const n = read('lib', 'iap', 'store.ts');
  assert.match(n, /appAccountToken: accountId/);
  assert.match(n, /obfuscatedAccountId: accountId/);
  assert.match(n, /subscriptionOffers: offerToken/);
  assert.match(n, /finishTransaction\(\{ purchase: p\.raw as Purchase, isConsumable: consumable \}\)/);
});

test('a Ajuda explica como cancelar a subscrição só quando o selo azul está à venda', () => {
  const faq = [
    { q: 'Como cancelo a subscrição do selo azul?', a: 'Nas definições da loja.' },
    { q: 'Como bombo o meu local?', a: 'Em Gerir, Bombar. Escolhe o pacote, e paga com os Txills da carteira do local. Se parares, voltam à carteira os dias inteiros que faltam, ou tudo se ainda não começou. Fim.' },
  ];
  assert.deepEqual(helpFaqFor(purchaseRulesFor('appstore', { iap: true }), faq).map((f) => f.q), []);
  const on = helpFaqFor(purchaseRulesFor('play', { iap: true }, false, true), faq);
  assert.deepEqual(on.map((f) => f.q), faq.map((f) => f.q));
  assert.equal(on[1].a, 'Em Gerir, Bombar. Escolhe o pacote. Pagas pela loja (App Store ou Google Play), com o preço que a loja mostra. Fim.');
  assert.deepEqual(helpFaqFor(purchaseRulesFor('web'), faq).map((f) => f.q), ['Como bombo o meu local?']);
  const help = read('app', 'help.tsx');
  assert.match(help, /q: 'Como cancelo a subscrição do selo azul\?'/);
  assert.match(help, /e paga com os Txills da carteira do local\. Se parares, voltam à carteira/);
});

// ---------------------------------------------------------------------------------------------------------------------
// Integração com a API (o que o servidor devolve em /iap e /verification/me)
// ---------------------------------------------------------------------------------------------------------------------

test('a confirmação recusada pelo servidor diz o porquê (403, 409, 422, 502, 503) e a compra fica por acabar', async () => {
  const cases = [
    [403, 'A tua identidade ainda não foi aprovada para a verificação paga. A compra ficou guardada e o selo é aplicado quando for aprovada.', /ainda não foi aprovada/],
    [409, 'Esta compra já pagou outra campanha', /já pagou outra campanha/],
    [422, 'Esta compra foi feita para outra campanha', /outra campanha/],
    [502, 'A loja não respondeu. Tenta outra vez daqui a pouco.', /loja não respondeu.*Não voltes a comprar/],
    [503, 'As compras no Google Play não estão disponíveis', /em pausa.*ficou guardada/],
  ];
  for (const [status, message, re] of cases) {
    const store = fakeStore({ unfinished: [purchase('txill.selo.mensal', `gp-${status}`)] });
    const i = createIap({ platform: 'android', store, api: fakeApi({ verify: async () => { throw Object.assign(new Error(message), { status }); } }), storage: memStorage(), userId: () => USER });
    const [o] = await i.recover();
    assert.equal(o.status, 'verify-failed', String(status));
    assert.equal(o.code, status);
    assert.match(outcomeMessage(o), re, String(status));
    assert.equal(store.log.some((l) => l[0] === 'finish'), false, String(status));
  }
  // Sem código (ok: false ou erro desconhecido): o texto de sempre.
  assert.equal(verifyFailedMessage(undefined), iapMessage('verify-failed'));
  // 409 «pagamento pendente» da Google: é pendente, não uma falha.
  const sp = fakeStore({ unfinished: [purchase('txill.selo.mensal', 'gp-pend')] });
  const ip = createIap({ platform: 'android', store: sp, api: fakeApi({ verify: async () => { throw Object.assign(new Error('O pagamento ainda está pendente na Google'), { status: 409 }); } }), storage: memStorage(), userId: () => USER });
  assert.deepEqual((await ip.recover()).map((o) => o.status), ['pending']);
  // O rascunho do Bombar recusado: 503 em pausa; 422 com a razão do servidor.
  assert.match(outcomeMessage({ status: 'error', kind: 'failed', code: 503, message: 'x' }), /em pausa/);
  assert.equal(outcomeMessage({ status: 'error', kind: 'failed', code: 422, message: 'Este local está suspenso' }), 'Este local está suspenso');
  assert.equal(outcomeMessage({ status: 'cancelled' }), null);
});

test('o entitlement do verify: subscrição terminada ou Bombar sem campanha dizem-se, o resto é sucesso', () => {
  const ok = 'Feito!';
  assert.deepEqual(doneMessage({ kind: 'verification', productId: 'a', status: 'active', active: true, expiresAt: '2027-01-01T00:00:00Z', autoRenew: true, verified: true, tier: 'paid' }, ok), { ok: true, text: ok });
  assert.equal(doneMessage({ kind: 'verification', productId: 'a', status: 'expired', active: false, expiresAt: null, autoRenew: false, verified: false, tier: null }, ok).ok, false);
  assert.match(doneMessage({ kind: 'verification', productId: 'a', status: 'refunded', active: false, expiresAt: null, autoRenew: false, verified: false, tier: null }, ok).text, /reembolsada/);
  assert.equal(doneMessage({ kind: 'boost', productId: 'b', status: 'consumed', campaignId: null, campaignState: null }, ok).ok, false);
  assert.match(doneMessage({ kind: 'boost', productId: 'b', status: 'consumed', campaignId: 'c', campaignState: 'scheduled' }, ok).text, /data marcada/);
  assert.deepEqual(doneMessage({ kind: 'boost', productId: 'b', status: 'consumed', campaignId: 'c', campaignState: 'active' }, ok), { ok: true, text: ok });
  // Servidores antigos ou respostas sem entitlement: sucesso.
  assert.deepEqual(doneMessage(null, ok), { ok: true, text: ok });
});

test('selo azul: paidEligible (verification/me) e o pedido paid_eligible abrem a mesma entrada', () => {
  assert.equal(approvedForBlue({ paidEligible: true, request: null }), true);
  assert.equal(approvedForBlue({ request: { status: 'paid_eligible' } }), true);
  assert.equal(approvedForBlue({ paidEligible: false, request: { status: 'approved' } }), false);
  assert.equal(blueSealEntry({ verified: true, tier: 'official', paidEligible: true }), null);
  assert.equal(blueSealEntry({ verified: true, tier: 'paid', paidEligible: true }).title, 'Selo azul');
  assert.equal(blueSealEntry({ verified: false, tier: null, paidEligible: true }).title, 'Ativar o selo azul');
  // Selo vermelho sem aprovação para o selo azul: não se mostra (o ecrã mandaria pedir a verificação que já tem).
  assert.equal(blueSealEntry({ verified: true, tier: 'verified', paidEligible: false }), null);
  assert.match(blueSealEntry({ verified: false, tier: null, paidEligible: false, request: null }).description, /Depois de a verificação ser aprovada/);
});
