import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import request from 'supertest';
import { Pool } from 'pg';
import { loadConfig } from '../config';
import { migrate } from '../db/migrate';
import { createApp } from '../main';

const DB = process.env.TEST_DATABASE_URL ?? 'postgres://txill:txill_dev@localhost:5433/txillapp_test';
const PASSWORD = 'password-bem-longa-1';
const SECRET = 'segredo-de-teste-dos-pagamentos';

interface U { token: string; id: string; username: string }

describe('recarregar Txills: pacotes, pedidos, idempotência, crédito e avisos assinados (integração)', () => {
  let app: INestApplication;
  let pool: Pool;
  const run = Date.now().toString(36);
  const api = () => request(app.getHttpServer());
  const auth = (x: U) => ({ Authorization: `Bearer ${x.token}` });
  const u: Record<string, U> = {};

  async function signup(name: string): Promise<U> {
    const username = `${name}${run}`.slice(0, 28);
    const r = await api().post('/api/v1/auth/register').send({ email: `${username}@example.com`, username, displayName: `${name} Teste`, password: PASSWORD, birthDate: '1990-06-15', acceptTerms: true }).expect(201);
    return { token: r.body.accessToken, id: r.body.user.id, username };
  }
  const balance = async (x: U) => (await api().get('/api/v1/wallet').set(auth(x)).expect(200)).body.balance as number;
  const order = (x: U, body: object, key: string) => api().post('/api/v1/payments/orders').set({ ...auth(x), 'Idempotency-Key': key }).send(body);

  beforeAll(async () => {
    await migrate(DB);
    pool = new Pool({ connectionString: DB });
    app = await createApp(loadConfig({ DATABASE_URL: DB, JWT_ACCESS_SECRET: 'd'.repeat(40), NODE_ENV: 'test', MEDIA_DIR: './uploads-test', PAYMENTS_SANDBOX: 'true', PAYMENTS_WEBHOOK_SECRET: SECRET }));
    await app.init();
    for (const n of ['pya', 'pyb']) u[n] = await signup(n);
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  it('config: pacotes e fornecedores ligados (só o de teste, neste ambiente)', async () => {
    const c = (await api().get('/api/v1/payments/config').set(auth(u.pya)).expect(200)).body;
    expect(c.providers.map((p: { id: string }) => p.id)).toEqual(['sandbox']);
    expect(c.packages.map((p: { id: string }) => p.id)).toEqual(['pequeno', 'medio', 'grande', 'mega']);
    expect(c.packages[0]).toMatchObject({ txills: 500, priceMinor: 5000, currency: 'MZN' });
    await api().get('/api/v1/payments/config').expect(401);
  });

  it('comprar: o pedido fica à espera, confirmar credita uma única vez e a idempotência repete o mesmo pedido', async () => {
    const { pya } = u;
    const before = await balance(pya);
    await api().post('/api/v1/payments/orders').set(auth(pya)).send({ packageId: 'pequeno', provider: 'sandbox' }).expect(400); // sem Idempotency-Key
    await order(pya, { packageId: 'pequeno', provider: 'mpesa', phone: '841234567' }, 'chave-pya-0001').expect(400); // M-Pesa ainda não está ligado
    await order(pya, { packageId: 'nao-existe', provider: 'sandbox' }, 'chave-pya-0002').expect(404);

    const o = (await order(pya, { packageId: 'medio', provider: 'sandbox' }, 'chave-pya-0003').expect(201)).body;
    expect(o).toMatchObject({ status: 'pending', txills: 1200, amountMinor: 10000, currency: 'MZN', provider: 'sandbox' });
    const again = (await order(pya, { packageId: 'medio', provider: 'sandbox' }, 'chave-pya-0003').expect(201)).body;
    expect(again.id).toBe(o.id); // mesma chave, mesmo pedido
    expect(await balance(pya)).toBe(before); // ainda não pagou

    const paid = (await api().post(`/api/v1/payments/orders/${o.id}/sandbox-pay`).set(auth(pya)).expect(200)).body;
    expect(paid.status).toBe('paid');
    expect(await balance(pya)).toBe(before + 1200);
    await api().post(`/api/v1/payments/orders/${o.id}/sandbox-pay`).set(auth(pya)).expect(200); // repetir não credita outra vez
    expect(await balance(pya)).toBe(before + 1200);
    expect((await api().get('/api/v1/wallet').set(auth(pya)).expect(200)).body.history[0]).toMatchObject({ type: 'topup', amount: 1200 });

    const list = (await api().get('/api/v1/payments/orders').set(auth(pya)).expect(200)).body as { id: string; status: string }[];
    expect(list.find((x) => x.id === o.id)?.status).toBe('paid');
  });

  it('privacidade: ninguém vê, paga ou cancela pedidos de outra pessoa; cancelar só vale à espera; máximo de 3 à espera', async () => {
    const { pya, pyb } = u;
    const o = (await order(pyb, { packageId: 'pequeno', provider: 'sandbox' }, 'chave-pyb-0001').expect(201)).body;
    await api().get(`/api/v1/payments/orders/${o.id}`).set(auth(pya)).expect(404);
    await api().post(`/api/v1/payments/orders/${o.id}/sandbox-pay`).set(auth(pya)).expect(404);
    await api().post(`/api/v1/payments/orders/${o.id}/cancel`).set(auth(pya)).expect(404);
    await api().post(`/api/v1/payments/orders/${o.id}/cancel`).set(auth(pyb)).expect(204);
    await api().post(`/api/v1/payments/orders/${o.id}/cancel`).set(auth(pyb)).expect(404); // já não está à espera

    for (let i = 0; i < 3; i++) await order(pyb, { packageId: 'pequeno', provider: 'sandbox' }, `chave-pyb-1${i}00`).expect(201);
    await order(pyb, { packageId: 'pequeno', provider: 'sandbox' }, 'chave-pyb-2000').expect(409);
  });

  it('aviso assinado: só com a assinatura certa; credita uma vez; "falhou" não credita; pedido expirado pago a tempo ainda credita', async () => {
    const { pya } = u;
    const sign = (orderId: string, status: string, ref: string) => createHmac('sha256', SECRET).update(`${orderId}.${status}.${ref}`).digest('hex');
    const before = await balance(pya);
    const o = (await order(pya, { packageId: 'pequeno', provider: 'sandbox' }, 'chave-pya-0100').expect(201)).body;

    await api().post('/api/v1/payments/webhook').send({ orderId: o.id, status: 'paid', ref: `ref1-${run}` }).expect(403); // sem assinatura
    await api().post('/api/v1/payments/webhook').set('X-Signature', sign(o.id, 'failed', `ref1-${run}`)).send({ orderId: o.id, status: 'paid', ref: `ref1-${run}` }).expect(403); // assinatura de outra coisa
    expect(await balance(pya)).toBe(before);

    // O pedido expira, mas o dinheiro chegou: os Txills são entregues.
    await pool.query(`UPDATE payments.orders SET created_at = now() - interval '2 hours' WHERE id = $1`, [o.id]);
    expect((await api().get(`/api/v1/payments/orders/${o.id}`).set(auth(pya)).expect(200)).body.status).toBe('expired');
    await api().post('/api/v1/payments/webhook').set('X-Signature', sign(o.id, 'paid', `ref1-${run}`)).send({ orderId: o.id, status: 'paid', ref: `ref1-${run}` }).expect(200);
    expect(await balance(pya)).toBe(before + 500);
    await api().post('/api/v1/payments/webhook').set('X-Signature', sign(o.id, 'paid', `ref1-${run}`)).send({ orderId: o.id, status: 'paid', ref: `ref1-${run}` }).expect(200);
    expect(await balance(pya)).toBe(before + 500); // aviso repetido não credita outra vez

    const f = (await order(pya, { packageId: 'pequeno', provider: 'sandbox' }, 'chave-pya-0200').expect(201)).body;
    await api().post('/api/v1/payments/webhook').set('X-Signature', sign(f.id, 'failed', `ref2-${run}`)).send({ orderId: f.id, status: 'failed', ref: `ref2-${run}` }).expect(200);
    expect((await api().get(`/api/v1/payments/orders/${f.id}`).set(auth(pya)).expect(200)).body.status).toBe('failed');
    expect(await balance(pya)).toBe(before + 500);
  });

  it('produção: o fornecedor de teste não pode estar ligado', () => {
    expect(() => loadConfig({ DATABASE_URL: DB, JWT_ACCESS_SECRET: 'd'.repeat(40), NODE_ENV: 'production', PAYMENTS_SANDBOX: 'true' })).toThrow(/PAYMENTS_SANDBOX/);
  });
});
