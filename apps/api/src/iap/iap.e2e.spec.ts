import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { getStorageToken } from '@nestjs/throttler';
import request from 'supertest';
import { Pool } from 'pg';
import { loadConfig } from '../config';
import { migrate } from '../db/migrate';
import { createApp } from '../main';
import { staffLogin } from '../staff/staff-test';
import { uuidv7 } from '../common/uuid7';
import { IapService } from './iap.service';
import { BoostsService } from '../boosts/boosts.service';
import { FakeStores, appleChain } from './iap-test-kit';

const DB = process.env.TEST_DATABASE_URL ?? 'postgres://txill:txill_dev@localhost:5433/txillapp_test';
const PASSWORD = 'password-bem-longa-1';
const RTDN = 'segredo-do-pubsub-de-teste-1234567890';
const P = { monthly: 'txillapp.verificado.mensal', yearly: 'txillapp.verificado.anual', b1: 'txillapp.bombar.1d', b3: 'txillapp.bombar.3d', b7: 'txillapp.bombar.7d' };

interface U { token: string; id: string; username: string }

describe('compras pela loja: verificação paga e Bombar, com a Apple e a Google simuladas (integração)', () => {
  let app: INestApplication; // ligado, com as duas lojas
  let off: INestApplication; // com credenciais, mas IAP_ENABLED por ligar
  let bare: INestApplication; // ligado, mas sem credenciais
  let pool: Pool;
  const stores = new FakeStores();
  const chain = appleChain('e2e');
  const run = Date.now().toString(36);
  let n = 0;
  let seq = Date.now();
  const api = (a: INestApplication = app) => request(a.getHttpServer());
  const auth = (x: U) => ({ Authorization: `Bearer ${x.token}` });
  let staff: string;
  let ana: U, beto: U, caio: U, dora: U, eva: U, dono: U, intruso: U;
  let venue: { slug: string; id: string };
  let postId: string;

  const env = (extra: Record<string, string> = {}) => ({
    DATABASE_URL: DB, JWT_ACCESS_SECRET: 'i'.repeat(40), NODE_ENV: 'test', MEDIA_DIR: './uploads-test',
    IAP_APPLE_ISSUER_ID: 'issuer-teste', IAP_APPLE_KEY_ID: 'KEY123', IAP_APPLE_KEY_P8: stores.appleP8, IAP_APPLE_BUNDLE_ID: stores.bundleId,
    IAP_APPLE_ENV: 'Sandbox', IAP_APPLE_API_ORIGIN: stores.origin, IAP_APPLE_ROOT_CA: Buffer.from(chain.rootPem).toString('base64'),
    IAP_GOOGLE_SERVICE_ACCOUNT_JSON: Buffer.from(stores.serviceAccountJson).toString('base64'), IAP_GOOGLE_PACKAGE: stores.packageName, IAP_GOOGLE_RTDN_TOKEN: RTDN,
    IAP_GOOGLE_API_ORIGIN: stores.origin, IAP_GOOGLE_OAUTH_URL: `${stores.origin}/token`,
    ...extra,
  });

  async function signup(name: string): Promise<U> {
    const username = `${name}${run}${n++}`.slice(0, 28);
    const r = await api().post('/api/v1/auth/register').set('X-Forwarded-For', `10.77.0.${(n % 250) + 1}`)
      .send({ email: `${username}@example.com`, username, displayName: `${name} Teste`, password: PASSWORD, birthDate: '1990-06-15', acceptTerms: true }).expect(201);
    return { token: r.body.accessToken, id: r.body.user.id, username };
  }
  const resetThrottle = () => {
    for (const a of [app, off, bare]) {
      const s = a.get(getStorageToken()) as { storage: Map<string, unknown>; hitExpirations?: Map<string, unknown> };
      s.storage.clear();
      s.hitExpirations?.clear();
    }
  };
  const user = async (x: U) => (await pool.query('SELECT verified, verified_tier FROM identity.users WHERE id = $1', [x.id])).rows[0] as { verified: boolean; verified_tier: string | null };
  /** O pedido de selo (como se a pessoa o tivesse feito) e a aprovação pela equipa como «elegível para verificação paga». */
  async function approvePaid(x: U) {
    const id = uuidv7();
    await pool.query(`INSERT INTO identity.verification_requests (id, user_id, kind, full_name, proof) VALUES ($1, $2, 'person', 'Pessoa Teste', 'Sou eu, a pessoa do teste.')`, [id, x.id]);
    await api().post(`/api/v1/admin/verifications/${id}/decide`).set({ Authorization: `Bearer ${staff}` }).send({ action: 'approve_paid' }).expect(204);
  }

  /* ---- Apple ---- */
  const tx = (o: Record<string, unknown>) => {
    const id = String(seq++);
    return {
      transactionId: id, originalTransactionId: id, bundleId: stores.bundleId, purchaseDate: Date.now(), signedDate: Date.now(), environment: 'Sandbox',
      transactionReason: 'PURCHASE', price: 299000, currency: 'MZN', quantity: 1, inAppOwnershipType: 'PURCHASED', ...o,
    } as Record<string, any>;
  };
  /** Uma subscrição na «Apple»: a app manda a JWS; a API diz o estado (1 ativa, 2 expirada…). */
  function appleSub(owner: U, productId = P.monthly, status = 1, autoRenew = 1) {
    const t = tx({ productId, type: 'Auto-Renewable Subscription', expiresDate: Date.now() + 30 * 86_400_000, appAccountToken: owner.id });
    const jws = chain.sign(t);
    const renewal = chain.sign({ originalTransactionId: t.originalTransactionId, productId, autoRenewStatus: autoRenew, autoRenewProductId: productId });
    stores.appleSubs.set(t.originalTransactionId, [{ status, signedTransactionInfo: jws, signedRenewalInfo: renewal, originalTransactionId: t.originalTransactionId }]);
    return { t, jws, renewal };
  }
  function appleConsumable(owner: U | { id: string }, productId: string) {
    const t = tx({ productId, type: 'Consumable', appAccountToken: owner.id, price: 400000 });
    const jws = chain.sign(t);
    stores.appleTx.set(t.transactionId, jws);
    return { t, jws };
  }
  const notify = (type: string, t: Record<string, unknown>, extra: { subtype?: string; renewal?: string; uuid?: string } = {}) => {
    const uuid = extra.uuid ?? uuidv7();
    const payload = chain.sign({
      notificationType: type, subtype: extra.subtype, notificationUUID: uuid, version: '2.0', signedDate: Date.now(),
      data: { bundleId: stores.bundleId, environment: 'Sandbox', signedTransactionInfo: chain.sign(t), signedRenewalInfo: extra.renewal },
    });
    return { uuid, payload };
  };

  /* ---- Google ---- */
  let tok = 0;
  function googleSub(owner: U | { id: string }, productId = P.monthly, state = 'SUBSCRIPTION_STATE_ACTIVE') {
    const token = `tok-sub-${run}-${tok++}-${'x'.repeat(20)}`;
    const order = `GPA.${run}-${tok}`;
    stores.googleSubs.set(token, {
      kind: 'androidpublisher#subscriptionPurchaseV2', subscriptionState: state, latestOrderId: order, acknowledgementState: 'ACKNOWLEDGEMENT_STATE_PENDING',
      startTime: new Date().toISOString(), externalAccountIdentifiers: { obfuscatedExternalAccountId: owner.id },
      lineItems: [{ productId, expiryTime: new Date(Date.now() + 30 * 86_400_000).toISOString(), autoRenewingPlan: { autoRenewEnabled: true } }],
    });
    return { token, order };
  }
  function googleProduct(owner: U | { id: string }, productId: string, extra: Record<string, unknown> = {}) {
    const token = `tok-prod-${run}-${tok++}-${'y'.repeat(20)}`;
    const order = `GPA.${run}-p${tok}`;
    stores.googleProducts.set(token, { productId, orderId: order, purchaseState: 0, consumptionState: 0, acknowledgementState: 0, obfuscatedExternalAccountId: owner.id, purchaseTimeMillis: String(Date.now()), ...extra });
    return { token, order };
  }
  const rtdn = (data: Record<string, unknown>, messageId = uuidv7(), token = RTDN) =>
    api().post(`/api/v1/iap/google/rtdn?token=${token}`).send({ message: { data: Buffer.from(JSON.stringify({ version: '1.0', packageName: stores.packageName, eventTimeMillis: String(Date.now()), ...data })).toString('base64'), messageId }, subscription: 'projects/x/subscriptions/y' });

  const draft = async (pkg: '1d' | '3d' | '7d', key?: string) => {
    const r = await api().post(`/api/v1/boosts/venue/${venue.slug}`).set(auth(dono)).send({ target: { kind: 'post', id: postId }, package: pkg, source: 'iap', pack: `txillapp.bombar.${pkg}`, radiusKm: 5, ...(key ? { idempotencyKey: key } : {}) }).expect(201);
    return r.body.campaign as { id: string; state: string; radiusKm: number; price: number; payment: string; package: string };
  };
  const campaign = async (id: string) => (await pool.query('SELECT status, payment, price, starts_at, ends_at FROM content.boost_campaigns WHERE id = $1', [id])).rows[0];

  beforeAll(async () => {
    await stores.start();
    await migrate(DB);
    pool = new Pool({ connectionString: DB });
    app = await createApp(loadConfig(env({ IAP_ENABLED: 'true' })));
    await app.init();
    off = await createApp(loadConfig(env()));
    await off.init();
    bare = await createApp(loadConfig({ DATABASE_URL: DB, JWT_ACCESS_SECRET: 'i'.repeat(40), NODE_ENV: 'test', MEDIA_DIR: './uploads-test', IAP_ENABLED: 'true' }));
    await bare.init();
    [ana, beto, caio, dora, eva, dono, intruso] = await Promise.all(['iana', 'ibeto', 'icaio', 'idora', 'ieva', 'idono', 'iintr'].map(signup));
    staff = (await staffLogin(app, 'iap')).token;
    venue = (await api().post('/api/v1/venues').set(auth(dono)).send({ name: `Bar da Loja ${run}`, kind: 'bar', lat: -40.5, lng: -120.25, city: 'Maputo' }).expect(201)).body;
    await pool.query("UPDATE content.venues SET review_status = 'approved' WHERE id = $1", [venue.id]);
    postId = (await api().post('/api/v1/posts').set(auth(dono)).send({ body: `Promoção da loja ${run}`, venueId: venue.id }).expect(201)).body.id;
  }, 120_000);

  beforeEach(() => resetThrottle());

  afterAll(async () => {
    await app.close();
    await off.close();
    await bare.close();
    await pool.end();
    await stores.stop();
  });

  it('catálogo: produtos, elegibilidade e subscrição ativa; precisa de sessão', async () => {
    const c = (await api().get('/api/v1/iap/catalog?platform=ios').set(auth(ana)).expect(200)).body;
    expect(c).toEqual({
      enabled: true,
      verification: { products: [{ id: P.monthly, period: 'month' }, { id: P.yearly, period: 'year' }], eligible: false, active: null },
      boost: { products: [{ id: P.b1, days: 1, radiusKm: 3 }, { id: P.b3, days: 3, radiusKm: 3 }, { id: P.b7, days: 7, radiusKm: 3 }] },
    });
    expect((await api().get('/api/v1/iap/catalog?platform=android').set(auth(ana)).expect(200)).body.enabled).toBe(true);
    await api().get('/api/v1/iap/catalog?platform=web').set(auth(ana)).expect(400);
    await api().get('/api/v1/iap/catalog?platform=ios').expect(401);
  });

  it('desligado (IAP_ENABLED por ligar, mesmo com credenciais): catálogo off, verify e restore 503, avisos só registados', async () => {
    for (const p of ['ios', 'android']) expect((await api(off).get(`/api/v1/iap/catalog?platform=${p}`).set(auth(ana)).expect(200)).body.enabled).toBe(false);
    const { jws, t } = appleSub(ana);
    await api(off).post('/api/v1/iap/apple/verify').set(auth(ana)).send({ signedTransaction: jws }).expect(503);
    const g = googleSub(ana);
    await api(off).post('/api/v1/iap/google/verify').set(auth(ana)).send({ productId: P.monthly, purchaseToken: g.token }).expect(503);
    await api(off).post('/api/v1/iap/restore').set(auth(ana)).send({ platform: 'ios', signedTransactions: [jws] }).expect(503);
    await api(off).post('/api/v1/iap/restore').set(auth(ana)).send({ platform: 'android', purchases: [{ productId: P.monthly, purchaseToken: g.token }] }).expect(503);
    // Os avisos das lojas entram (para registo) mas não aplicam nada.
    const nt = notify('SUBSCRIBED', t, { renewal: chain.sign({ autoRenewStatus: 1 }) });
    expect((await api(off).post('/api/v1/iap/apple/notifications').send({ signedPayload: nt.payload }).expect(200)).body).toMatchObject({ ok: true, applied: false });
    const r = await api(off).post(`/api/v1/iap/google/rtdn?token=${RTDN}`).send({ message: { data: Buffer.from(JSON.stringify({ packageName: stores.packageName, subscriptionNotification: { notificationType: 4, purchaseToken: g.token, subscriptionId: P.monthly } })).toString('base64'), messageId: uuidv7() } }).expect(200);
    expect(r.body).toMatchObject({ ok: true, applied: false });
    expect((await pool.query('SELECT count(*)::int AS n FROM payments.iap_purchases WHERE user_id = $1', [ana.id])).rows[0].n).toBe(0);
    expect((await pool.query(`SELECT data FROM payments.iap_events WHERE store = 'apple' AND notification_id = $1`, [nt.uuid])).rows[0].data).toMatchObject({ applied: false, enabled: false });
    expect(await user(ana)).toEqual({ verified: false, verified_tier: null });
  });

  it('sem credenciais (mesmo ligado): catálogo off e 503', async () => {
    expect((await api(bare).get('/api/v1/iap/catalog?platform=ios').set(auth(ana)).expect(200)).body.enabled).toBe(false);
    expect((await api(bare).get('/api/v1/iap/catalog?platform=android').set(auth(ana)).expect(200)).body.enabled).toBe(false);
    await api(bare).post('/api/v1/iap/apple/verify').set(auth(ana)).send({ signedTransaction: appleSub(ana).jws }).expect(503);
    await api(bare).post('/api/v1/iap/google/verify').set(auth(ana)).send({ productId: P.monthly, purchaseToken: googleSub(ana).token }).expect(503);
    await api(bare).post('/api/v1/iap/apple/notifications').send({ signedPayload: appleSub(ana).jws }).expect(503);
    await rtdnOn(bare).expect(503);
    function rtdnOn(a: INestApplication) {
      return api(a).post(`/api/v1/iap/google/rtdn?token=${RTDN}`).send({ message: { data: Buffer.from('{}').toString('base64'), messageId: 'x' } });
    }
  });

  it('elegibilidade: sem aprovação a subscrição é recusada (fica guardada, sem selo, sem confirmar na Google); ao aprovar, o selo aplica-se', async () => {
    const g = googleSub(beto);
    const r = await api().post('/api/v1/iap/google/verify').set(auth(beto)).send({ productId: P.monthly, purchaseToken: g.token }).expect(403);
    expect(r.body.message).toMatch(/ainda não foi aprovada/);
    expect(await user(beto)).toEqual({ verified: false, verified_tier: null });
    expect(stores.acked).not.toContain(g.token); // sem confirmar: a Google devolve sozinha se ninguém aprovar
    expect((await pool.query('SELECT status FROM payments.iap_purchases WHERE purchase_token = $1', [g.token])).rows[0].status).toBe('active');

    await approvePaid(beto);
    expect(await user(beto)).toEqual({ verified: true, verified_tier: 'paid' });
    const me = (await api().get('/api/v1/verification/me').set(auth(beto)).expect(200)).body;
    expect(me).toMatchObject({ paidEligible: true, request: { status: 'paid_eligible' } });
    // Agora o verify passa e confirma na Google.
    const ok = (await api().post('/api/v1/iap/google/verify').set(auth(beto)).send({ productId: P.monthly, purchaseToken: g.token }).expect(200)).body;
    expect(ok).toMatchObject({ ok: true, entitlement: { kind: 'verification', productId: P.monthly, status: 'active', active: true, autoRenew: true, verified: true, tier: 'paid' } });
    expect(stores.acked).toContain(g.token);
    const c = (await api().get('/api/v1/iap/catalog?platform=android').set(auth(beto)).expect(200)).body;
    expect(c.verification).toMatchObject({ eligible: true, active: { productId: P.monthly, autoRenew: true } });

    // Google: expira (RTDN SUBSCRIPTION_EXPIRED, estado lido na Google) -> antes não era verificado, deixa de ser.
    stores.googleSubs.get(g.token)!.subscriptionState = 'SUBSCRIPTION_STATE_EXPIRED';
    (stores.googleSubs.get(g.token)!.lineItems as { expiryTime: string }[])[0].expiryTime = new Date(Date.now() - 1000).toISOString();
    const msg = uuidv7();
    expect((await rtdn({ subscriptionNotification: { version: '1.0', notificationType: 13, purchaseToken: g.token, subscriptionId: P.monthly } }, msg).expect(200)).body).toMatchObject({ applied: true });
    expect(await user(beto)).toEqual({ verified: false, verified_tier: null });
    expect((await rtdn({ subscriptionNotification: { notificationType: 13, purchaseToken: g.token, subscriptionId: P.monthly } }, msg).expect(200)).body).toMatchObject({ duplicate: true });
    await rtdn({ testNotification: { version: '1.0' } }, uuidv7(), 'token-errado-token-errado-token-errad').expect(401);
  });

  it('Apple: subscrição -> selo pago -> expira -> volta ao selo de antes; a mesma transação não conta duas vezes', async () => {
    await pool.query(`UPDATE identity.users SET verified = true, verified_tier = 'verified' WHERE id = $1`, [ana.id]);
    await approvePaid(ana);
    expect(await user(ana)).toEqual({ verified: true, verified_tier: 'verified' }); // ainda sem subscrição
    const { t, jws, renewal } = appleSub(ana);
    const r = (await api().post('/api/v1/iap/apple/verify').set(auth(ana)).send({ signedTransaction: jws }).expect(200)).body;
    expect(r).toMatchObject({ ok: true, entitlement: { kind: 'verification', status: 'active', active: true, autoRenew: true, tier: 'paid' } });
    expect(await user(ana)).toEqual({ verified: true, verified_tier: 'paid' });
    // Repetir (ou restaurar) não credita outra vez.
    await api().post('/api/v1/iap/apple/verify').set(auth(ana)).send({ signedTransaction: jws }).expect(200);
    const rest = (await api().post('/api/v1/iap/restore').set(auth(ana)).send({ platform: 'ios', signedTransactions: [jws] }).expect(200)).body;
    expect(rest).toMatchObject({ ok: true, restored: 1, failed: 0 });
    const ev = (await pool.query(`SELECT type, count(*)::int AS n FROM payments.iap_events WHERE store = 'apple' AND transaction_ref = $1 GROUP BY type`, [t.transactionId])).rows;
    expect(ev).toEqual([{ type: 'purchase', n: 1 }]);
    expect((await pool.query(`SELECT count(*)::int AS n FROM payments.iap_purchases WHERE store = 'apple' AND original_transaction_id = $1`, [t.originalTransactionId])).rows[0].n).toBe(1);
    expect((await pool.query(`SELECT count(*)::int AS n FROM audit.audit_log WHERE action = 'iap.purchase' AND metadata->>'transaction' = $1`, [t.transactionId])).rows[0].n).toBe(1);

    // Renovação (DID_RENEW com uma transação nova) conta uma vez; o aviso repetido não faz nada.
    const renewed = { ...t, transactionId: String(seq++), transactionReason: 'RENEWAL', expiresDate: Date.now() + 60 * 86_400_000 };
    const nr = notify('DID_RENEW', renewed, { renewal });
    await api().post('/api/v1/iap/apple/notifications').send({ signedPayload: nr.payload }).expect(200);
    expect((await api().post('/api/v1/iap/apple/notifications').send({ signedPayload: nr.payload }).expect(200)).body).toMatchObject({ duplicate: true });
    expect((await pool.query(`SELECT count(*)::int AS n FROM payments.iap_events WHERE type = 'renewal' AND transaction_ref = $1`, [renewed.transactionId])).rows[0].n).toBe(1);

    // Expira: volta ao 'verified' que tinha antes.
    const ne = notify('EXPIRED', { ...renewed, expiresDate: Date.now() - 1000 }, { subtype: 'VOLUNTARY', renewal });
    await api().post('/api/v1/iap/apple/notifications').send({ signedPayload: ne.payload }).expect(200);
    expect(await user(ana)).toEqual({ verified: true, verified_tier: 'verified' });
    expect((await api().get('/api/v1/iap/catalog?platform=ios').set(auth(ana)).expect(200)).body.verification.active).toBeNull();
    // Volta a subscrever (SUBSCRIBED) -> 'paid' outra vez; reembolso (REFUND) -> volta ao de antes.
    const back = { ...renewed, transactionId: String(seq++), expiresDate: Date.now() + 30 * 86_400_000 };
    await api().post('/api/v1/iap/apple/notifications').send({ signedPayload: notify('SUBSCRIBED', back, { subtype: 'RESUBSCRIBE', renewal }).payload }).expect(200);
    expect(await user(ana)).toEqual({ verified: true, verified_tier: 'paid' });
    await api().post('/api/v1/iap/apple/notifications').send({ signedPayload: notify('REFUND', { ...back, revocationDate: Date.now(), revocationReason: 0 }).payload }).expect(200);
    expect(await user(ana)).toEqual({ verified: true, verified_tier: 'verified' });
    expect((await pool.query(`SELECT status FROM payments.iap_purchases WHERE original_transaction_id = $1`, [t.originalTransactionId])).rows[0].status).toBe('refunded');
    expect((await pool.query(`SELECT count(*)::int AS n FROM payments.iap_events WHERE type = 'refund' AND purchase_id = (SELECT id FROM payments.iap_purchases WHERE original_transaction_id = $1)`, [t.originalTransactionId])).rows[0].n).toBe(1);
    // CONSUMPTION_REQUEST: só fica registado.
    const cr = notify('CONSUMPTION_REQUEST', back);
    expect((await api().post('/api/v1/iap/apple/notifications').send({ signedPayload: cr.payload }).expect(200)).body).toMatchObject({ applied: false });
    expect((await pool.query(`SELECT type FROM payments.iap_events WHERE notification_id = $1`, [cr.uuid])).rows[0].type).toBe('notification:CONSUMPTION_REQUEST');
  });

  it('Google: reembolso de uma subscrição (voidedPurchaseNotification) tira o selo pago', async () => {
    await approvePaid(caio);
    const g = googleSub(caio, P.yearly);
    await api().post('/api/v1/iap/google/verify').set(auth(caio)).send({ productId: P.yearly, purchaseToken: g.token }).expect(200);
    expect(await user(caio)).toEqual({ verified: true, verified_tier: 'paid' });
    await rtdn({ voidedPurchaseNotification: { purchaseToken: g.token, orderId: g.order, productType: 1, refundType: 1 } }).expect(200);
    expect(await user(caio)).toEqual({ verified: false, verified_tier: null });
    expect((await pool.query('SELECT status FROM payments.iap_purchases WHERE purchase_token = $1', [g.token])).rows[0].status).toBe('refunded');
  });

  it('utilizador errado: a compra de outra conta é recusada (Apple e Google) e não se consome', async () => {
    await approvePaid(intruso);
    const a = appleSub(dora);
    await api().post('/api/v1/iap/apple/verify').set(auth(intruso)).send({ signedTransaction: a.jws }).expect(403);
    const noToken = tx({ productId: P.monthly, type: 'Auto-Renewable Subscription', expiresDate: Date.now() + 86_400_000 });
    stores.appleSubs.set(noToken.originalTransactionId, [{ status: 1, signedTransactionInfo: chain.sign(noToken), originalTransactionId: noToken.originalTransactionId }]);
    expect((await api().post('/api/v1/iap/apple/verify').set(auth(intruso)).send({ signedTransaction: chain.sign(noToken) }).expect(403)).body.message).toMatch(/appAccountToken/);
    const g = googleProduct(dora, P.b1);
    await api().post('/api/v1/iap/google/verify').set(auth(intruso)).send({ productId: P.b1, purchaseToken: g.token }).expect(403);
    expect(stores.consumed).not.toContain(g.token);
    expect(await user(intruso)).toEqual({ verified: false, verified_tier: null });
    expect((await pool.query(`SELECT count(*)::int AS n FROM audit.audit_log WHERE action = 'iap.wrong_user' AND actor_id = $1`, [intruso.id])).rows[0].n).toBe(3);
    // Uma JWS que não vem da Apple (outra cadeia), de outra app, ou um token que a Google não conhece: 400.
    const fake = appleChain('falsa');
    await api().post('/api/v1/iap/apple/verify').set(auth(dora)).send({ signedTransaction: fake.sign(a.t) }).expect(400);
    await api().post('/api/v1/iap/apple/verify').set(auth(dora)).send({ signedTransaction: chain.sign({ ...a.t, bundleId: 'com.outra.app' }) }).expect(400);
    await api().post('/api/v1/iap/google/verify').set(auth(dora)).send({ productId: P.b1, purchaseToken: 'token-inventado-que-nao-existe' }).expect(400);
    await api().post('/api/v1/iap/google/verify').set(auth(dora)).send({ productId: 'txillapp.txills.100', purchaseToken: g.token }).expect(400);
    // A mesma compra já registada noutra conta também é recusada.
    await approvePaid(dora);
    await api().post('/api/v1/iap/apple/verify').set(auth(dora)).send({ signedTransaction: a.jws }).expect(200);
    expect(await user(dora)).toEqual({ verified: true, verified_tier: 'paid' });
  });

  it('Bombar: rascunho -> compra (Google) -> campanha ativa -> reembolso -> suspensa; uma compra paga uma só campanha', async () => {
    const d = await draft('3d', `rasc-${run}-1`);
    expect(d).toMatchObject({ state: 'draft', radiusKm: 3, price: 0, payment: 'iap', package: '3d' });
    expect((await draft('3d', `rasc-${run}-1`)).id).toBe(d.id); // mesma chave, mesmo rascunho
    const list = (await api().get(`/api/v1/boosts/venue/${venue.slug}`).set(auth(dono)).expect(200)).body;
    expect([...list.active, ...list.past].some((c: { id: string }) => c.id === d.id)).toBe(false); // o rascunho não aparece
    // Sem raio, só com Txills é que falta.
    await api().post(`/api/v1/boosts/venue/${venue.slug}`).set(auth(dono)).set('Idempotency-Key', `k-${run}-x`).send({ target: { kind: 'post', id: postId }, package: '1d' }).expect(400);

    const g = googleProduct(dono, P.b3);
    const r = (await api().post('/api/v1/iap/google/verify').set(auth(dono)).send({ productId: P.b3, purchaseToken: g.token, campaignId: d.id }).expect(200)).body;
    expect(r).toEqual({ ok: true, entitlement: { kind: 'boost', productId: P.b3, status: 'consumed', campaignId: d.id, campaignState: 'active' } });
    expect(stores.consumed).toContain(g.token);
    const c = await campaign(d.id);
    expect(c.status).toBe('active');
    expect(new Date(c.ends_at).getTime() - new Date(c.starts_at).getTime()).toBe(3 * 86_400_000);
    // Repetir não muda nada; a mesma compra noutra campanha: 409.
    expect((await api().post('/api/v1/iap/google/verify').set(auth(dono)).send({ productId: P.b3, purchaseToken: g.token, campaignId: d.id }).expect(200)).body.entitlement.campaignId).toBe(d.id);
    const d2 = await draft('3d');
    await api().post('/api/v1/iap/google/verify').set(auth(dono)).send({ productId: P.b3, purchaseToken: g.token, campaignId: d2.id }).expect(409);
    expect((await campaign(d2.id)).status).toBe('draft');
    expect((await pool.query(`SELECT count(*)::int AS n FROM payments.iap_events WHERE transaction_ref = $1`, [g.order])).rows[0].n).toBe(1);
    // Parar uma campanha paga na loja não devolve Txills.
    // Reembolso na Google -> suspensa (e a equipa não a pode repor).
    await rtdn({ voidedPurchaseNotification: { purchaseToken: g.token, orderId: g.order, productType: 2, refundType: 1 } }).expect(200);
    expect((await campaign(d.id)).status).toBe('suspended');
    await api().put(`/api/v1/venues/admin/boosts/${d.id}/reinstate`).set({ Authorization: `Bearer ${staff}` }).expect(409);
    expect((await pool.query(`SELECT count(*)::int AS n FROM audit.audit_log WHERE action = 'boost.iap_suspended' AND target = $1`, [`boost:${d.id}`])).rows[0].n).toBe(1);
  });

  it('Bombar na Apple: pacote errado é recusado (a compra fica guardada) e liga-se depois; REFUND suspende; parar não devolve Txills', async () => {
    const d1 = await draft('1d');
    const d3 = await draft('3d');
    const { t, jws } = appleConsumable(dono, P.b1);
    await api().post('/api/v1/iap/apple/verify').set(auth(dono)).send({ signedTransaction: jws, campaignId: d3.id }).expect(422);
    expect((await pool.query(`SELECT status, campaign_id FROM payments.iap_purchases WHERE transaction_id = $1`, [t.transactionId])).rows[0]).toEqual({ status: 'active', campaign_id: null });
    // Outra pessoa não liga a campanha do local, mesmo com uma compra sua.
    const other = appleConsumable(eva, P.b1);
    await api().post('/api/v1/iap/apple/verify').set(auth(eva)).send({ signedTransaction: other.jws, campaignId: d1.id }).expect(403);
    const ok = (await api().post('/api/v1/iap/apple/verify').set(auth(dono)).send({ signedTransaction: jws, campaignId: d1.id }).expect(200)).body;
    expect(ok.entitlement).toMatchObject({ kind: 'boost', status: 'consumed', campaignId: d1.id, campaignState: 'active' });

    const stop = (await api().post(`/api/v1/boosts/${d1.id}/stop`).set(auth(dono)).expect(200)).body;
    expect(stop.refunded).toBe(0);

    const { t: t7, jws: j7 } = appleConsumable(dono, P.b7);
    const d7 = await draft('7d');
    await api().post('/api/v1/iap/apple/verify').set(auth(dono)).send({ signedTransaction: j7, campaignId: d7.id }).expect(200);
    await api().post('/api/v1/iap/apple/notifications').send({ signedPayload: notify('REFUND', { ...t7, revocationDate: Date.now(), revocationReason: 1 }).payload }).expect(200);
    expect((await campaign(d7.id)).status).toBe('suspended');
    // Um reembolso que chega depois também não deixa a compra voltar a ser usada.
    const d7b = await draft('7d');
    await api().post('/api/v1/iap/apple/verify').set(auth(dono)).send({ signedTransaction: j7, campaignId: d7b.id }).expect(409);
  });

  it('rascunho: só com o IAP ligado e com o produto do pacote; Android liga pela campanha da compra; rascunhos por pagar expiram', async () => {
    const body = { target: { kind: 'post', id: postId }, package: '1d', source: 'iap', pack: P.b1, radiusKm: 5, idempotencyKey: `r-${run}-off` };
    await api(off).post(`/api/v1/boosts/venue/${venue.slug}`).set(auth(dono)).send(body).expect(503);
    await api().post(`/api/v1/boosts/venue/${venue.slug}`).set(auth(dono)).send({ ...body, pack: P.b7, idempotencyKey: `r-${run}-pk` }).expect(422);
    const d = (await api().post(`/api/v1/boosts/venue/${venue.slug}`).set(auth(dono)).send({ ...body, idempotencyKey: `r-${run}-ok` }).expect(201)).body.campaign;
    expect(d).toMatchObject({ state: 'draft', radiusKm: 3 }); // o raio é o fixo do pacote, não o pedido

    // Android: o campaignId vem na compra (obfuscatedProfileIdAndroid); sem ele no corpo, liga-se na mesma.
    const g = googleProduct(dono, P.b1, { obfuscatedExternalProfileId: d.id });
    const r = (await api().post('/api/v1/iap/google/verify').set(auth(dono)).send({ productId: P.b1, purchaseToken: g.token }).expect(200)).body;
    expect(r.entitlement).toMatchObject({ campaignId: d.id, campaignState: 'active' });
    // Reenvios no arranque: ok outra vez, sem creditar duas vezes.
    for (let i = 0; i < 3; i++) await api().post('/api/v1/iap/google/verify').set(auth(dono)).send({ productId: P.b1, purchaseToken: g.token, campaignId: d.id }).expect(200);
    expect((await pool.query(`SELECT count(*)::int AS n FROM payments.iap_events WHERE transaction_ref = $1`, [g.order])).rows[0].n).toBe(1);
    // Corpo e compra com campanhas diferentes (e a da compra ainda existe): 422, e a compra fica guardada sem campanha.
    const other = (await api().post(`/api/v1/boosts/venue/${venue.slug}`).set(auth(dono)).send({ ...body, idempotencyKey: `r-${run}-o1` }).expect(201)).body.campaign;
    const wrong = (await api().post(`/api/v1/boosts/venue/${venue.slug}`).set(auth(dono)).send({ ...body, idempotencyKey: `r-${run}-o2` }).expect(201)).body.campaign;
    const g2 = googleProduct(dono, P.b1, { obfuscatedExternalProfileId: other.id });
    await api().post('/api/v1/iap/google/verify').set(auth(dono)).send({ productId: P.b1, purchaseToken: g2.token, campaignId: wrong.id }).expect(422);
    expect((await pool.query(`SELECT campaign_id FROM payments.iap_purchases WHERE purchase_token = $1`, [g2.token])).rows[0].campaign_id).toBeNull();
    expect((await campaign(wrong.id)).status).toBe('draft');

    // Por pagar há mais de 24 h: apaga-se. A que foi paga fica.
    await pool.query(`UPDATE content.boost_campaigns SET created_at = now() - interval '25 hours' WHERE id = ANY($1)`, [[wrong.id, d.id]]);
    expect(await app.get(BoostsService).expireIapDrafts()).toBeGreaterThanOrEqual(1);
    expect(await campaign(wrong.id)).toBeUndefined();
    expect((await campaign(d.id)).status).toBe('active');
    // A compra cujo rascunho expirou liga-se a um rascunho novo (o da compra já não existe).
    await pool.query(`UPDATE content.boost_campaigns SET created_at = now() - interval '25 hours' WHERE id = $1`, [other.id]);
    await app.get(BoostsService).expireIapDrafts();
    const fresh = (await api().post(`/api/v1/boosts/venue/${venue.slug}`).set(auth(dono)).send({ ...body, idempotencyKey: `r-${run}-o3` }).expect(201)).body.campaign;
    expect((await api().post('/api/v1/iap/google/verify').set(auth(dono)).send({ productId: P.b1, purchaseToken: g2.token, campaignId: fresh.id }).expect(200)).body.entitlement).toMatchObject({ campaignId: fresh.id });
  });

  it('varredura: subscrição que passou da data é confirmada na loja e expira', async () => {
    await approvePaid(eva);
    const g = googleSub(eva);
    await api().post('/api/v1/iap/google/verify').set(auth(eva)).send({ productId: P.monthly, purchaseToken: g.token }).expect(200);
    expect(await user(eva)).toEqual({ verified: true, verified_tier: 'paid' });
    await pool.query(`UPDATE payments.iap_purchases SET expires_at = now() - interval '1 minute' WHERE purchase_token = $1`, [g.token]);
    const s = stores.googleSubs.get(g.token)!;
    s.subscriptionState = 'SUBSCRIPTION_STATE_EXPIRED';
    (s.lineItems as { expiryTime: string }[])[0].expiryTime = new Date(Date.now() - 60_000).toISOString();
    expect(await app.get(IapService).sweep()).toBeGreaterThanOrEqual(1);
    expect(await user(eva)).toEqual({ verified: false, verified_tier: null });
  });

  it('backoffice: lista com filtros, estados e totais por produto e por mês (wallet.view); exportação de dados', async () => {
    const H = { Authorization: `Bearer ${staff}` };
    const all = (await api().get('/api/v1/admin/fin/store-purchases').set(H).expect(200)).body;
    expect(all.config).toMatchObject({ enabled: true, apple: true, google: true, currency: 'MZN' });
    expect(all.counts.refunded).toBeGreaterThanOrEqual(3);
    const g = (await api().get('/api/v1/admin/fin/store-purchases?store=google&status=refunded').set(H).expect(200)).body;
    expect(g.items.length).toBeGreaterThanOrEqual(2);
    expect(g.items.every((i: { store: string; status: string }) => i.store === 'google' && i.status === 'refunded')).toBe(true);
    const mine = (await api().get(`/api/v1/admin/fin/store-purchases?store=google&user=${caio.username}`).set(H).expect(200)).body;
    const yearly = mine.totals.byProduct.find((x: { productId: string }) => x.productId === P.yearly);
    expect(yearly).toMatchObject({ store: 'google', purchases: 1, refunds: 1, grossMinor: 299000, refundedMinor: 299000, netMinor: 0 });
    expect(g.totals.byMonth[0].month).toBe(new Date().toISOString().slice(0, 7));
    // As da Apple (sandbox) ficam fora das receitas.
    const apple = (await api().get('/api/v1/admin/fin/store-purchases?store=apple').set(H).expect(200)).body;
    expect(apple.totals.byProduct).toEqual([]);
    expect(apple.totals.sandbox.purchases).toBeGreaterThanOrEqual(1);
    const byUser = (await api().get(`/api/v1/admin/fin/store-purchases?user=${dono.username}`).set(H).expect(200)).body;
    expect(byUser.items.find((i: { campaign: unknown }) => i.campaign)).toMatchObject({ campaign: { venue: { slug: venue.slug } } });
    const suporte = (await staffLogin(app, 'iap-sup', ['suporte'])).token;
    await api().get('/api/v1/admin/fin/store-purchases').set({ Authorization: `Bearer ${suporte}` }).expect(403);
    await api().get('/api/v1/admin/fin/store-purchases').set(auth(dono)).expect(401);

    const ex = JSON.parse((await api().get('/api/v1/me/export').set(auth(ana)).expect(200)).text);
    const data = ex.data ?? ex;
    expect(data.storePurchases.length).toBeGreaterThanOrEqual(1);
    expect(data.storePurchases[0]).not.toHaveProperty('raw');
    expect(data.paidVerification).toMatchObject({ applied: false, previousTier: 'verified' });
  });
});
