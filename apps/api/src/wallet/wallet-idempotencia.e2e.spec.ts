import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Pool } from 'pg';
import { loadConfig } from '../config';
import { migrate } from '../db/migrate';
import { createApp } from '../main';
import { uuidv7 } from '../common/uuid7';
import { WalletService } from './wallet.service';

const DB = process.env.TEST_DATABASE_URL ?? 'postgres://txill:txill_dev@localhost:5433/txillapp_test';
const PASSWORD = 'password-bem-longa-1';

interface U { token: string; id: string; username: string }

/**
 * A chave de idempotência das transferências vem do cliente. Não pode coincidir com as chaves internas de outros movimentos
 * (a entrada paga de uma Txillada usa «txillada_ticket:<id>», a devolução «txillada_refund:<id>», a recarga «topup:<id>»…):
 * senão uma transferência de 1 vib com essa chave fazia o pagamento a sério passar por «repetido», sem cobrar.
 */
describe('carteira: chaves de idempotência por tipo de movimento (integração)', () => {
  let app: INestApplication;
  let pool: Pool;
  let wallet: WalletService;
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
  const send = (from: U, to: U, amount: number, key: string) =>
    api().post('/api/v1/wallet/transfers').set({ ...auth(from), 'Idempotency-Key': key }).send({ toUsername: to.username, amount });

  /** Uma transferência gravada como antes desta versão (a chave do cliente tal e qual, sem o tipo à frente). */
  async function legacyTransfer(from: U, to: U, amount: number, key: string) {
    const acc = async (x: U) => (await pool.query('SELECT id FROM ledger.accounts WHERE user_id = $1', [x.id])).rows[0].id as string;
    const [a, b] = [await acc(from), await acc(to)];
    return wallet.move({ type: 'transfer', actorId: from.id, idempotencyKey: key, lock: [a, b].sort(), legs: [[a, -amount], [b, amount]], metadata: {} });
  }

  beforeAll(async () => {
    await migrate(DB);
    pool = new Pool({ connectionString: DB });
    app = await createApp(loadConfig({ DATABASE_URL: DB, JWT_ACCESS_SECRET: 'w'.repeat(40), NODE_ENV: 'test', MEDIA_DIR: './uploads-test' }));
    await app.init();
    wallet = app.get(WalletService);
    for (const n of ['wia', 'wib']) u[n] = await signup(n);
    for (const n of ['wia', 'wib']) await balance(u[n]); // abre as carteiras (bónus de boas-vindas)
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  it('a mesma chave na transferência repete o mesmo movimento (cobra uma vez só)', async () => {
    const { wia, wib } = u;
    const before = await balance(wia);
    const first = (await send(wia, wib, 7, `repete-${run}`).expect(201)).body;
    const again = (await send(wia, wib, 7, `repete-${run}`).expect(201)).body;
    expect(again).toEqual({ transactionId: first.transactionId, replayed: true });
    expect(await balance(wia)).toBe(before - 7);
  });

  it('uma transferência com a chave da entrada paga de uma Txillada não deixa a entrada passar sem pagar', async () => {
    const { wia, wib } = u;
    const txillada = uuidv7();
    const key = `txillada_ticket:${txillada}`;
    const before = await balance(wia);
    // O truque: 1 vib a alguém com a chave que a entrada vai usar.
    await send(wia, wib, 1, key).expect(201);
    // A entrada (300) é cobrada a sério: não é tomada por repetição da transferência de 1 vib.
    const ticket = await wallet.transfer({ actorId: wia.id, fromUserId: wia.id, toUserId: wib.id, amount: 300, type: 'txillada_ticket', idempotencyKey: key, metadata: { txilladaId: txillada } });
    expect(ticket.replayed).toBe(false);
    expect(await balance(wia)).toBe(before - 1 - 300);
    const t = (await pool.query('SELECT type FROM ledger.transactions WHERE id = $1', [ticket.transactionId])).rows[0];
    expect(t.type).toBe('txillada_ticket');
    // E a entrada repetida (o mesmo pedido outra vez) continua a não cobrar duas vezes.
    const twice = await wallet.transfer({ actorId: wia.id, fromUserId: wia.id, toUserId: wib.id, amount: 300, type: 'txillada_ticket', idempotencyKey: key, metadata: { txilladaId: txillada } });
    expect(twice).toEqual({ transactionId: ticket.transactionId, replayed: true });
    expect(await balance(wia)).toBe(before - 1 - 300);
  });

  it('a chave já usada noutro tipo de movimento é recusada (409), nunca dada por feita', async () => {
    const { wia, wib } = u;
    const key = `txillada_ticket:${uuidv7()}`;
    // Como uma chave antiga (de antes do espaço por tipo) que ficou na base de dados com o tipo errado.
    await legacyTransfer(wia, wib, 2, key);
    const before = await balance(wia);
    await expect(wallet.transfer({ actorId: wia.id, fromUserId: wia.id, toUserId: wib.id, amount: 300, type: 'txillada_ticket', idempotencyKey: key, metadata: {} }))
      .rejects.toMatchObject({ response: { code: 'idempotency_key_reused' } });
    expect(await balance(wia)).toBe(before);
    // O mesmo nas recargas: a chave de outro tipo não credita nem passa por repetição.
    await wallet.credit(wia.id, 10, `topup:${run}-k`, {});
    await expect(wallet.credit(wia.id, 10, `topup:${run}-k`, {}, undefined, 'invite')).rejects.toMatchObject({ response: { code: 'idempotency_key_reused' } });
  });

  it('as transferências antigas (chave guardada sem o tipo) continuam a ser reconhecidas quando o pedido se repete', async () => {
    const { wia, wib } = u;
    const raw = `legado-${run}`;
    // Como estava guardada antes desta versão: a chave do cliente sem o «transfer:».
    const first = await legacyTransfer(wia, wib, 3, raw);
    const before = await balance(wia);
    expect((await send(wia, wib, 3, raw).expect(201)).body).toEqual({ transactionId: first.transactionId, replayed: true });
    expect(await balance(wia)).toBe(before);
  });
});
