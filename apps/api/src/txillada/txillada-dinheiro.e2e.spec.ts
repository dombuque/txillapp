import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Pool } from 'pg';
import { loadConfig } from '../config';
import { migrate } from '../db/migrate';
import { createApp } from '../main';
import { staffLogin } from '../staff/staff-test';
import { WalletService } from '../wallet/wallet.service';
import type { LiveKitRooms } from './livekit';
import { TxilladaService } from './txillada.service';

const DB = process.env.TEST_DATABASE_URL ?? 'postgres://txill:txill_dev@localhost:5433/txillapp_test';
const PASSWORD = 'password-bem-longa-1';
const LK = { LIVEKIT_URL: 'ws://localhost:7880', LIVEKIT_API_KEY: 'devkey', LIVEKIT_API_SECRET: 'secret' };

interface U { token: string; id: string; username: string; ip: string }

/**
 * Txillada paga e ofertas (0167): o dinheiro sob corridas e nos casos de fronteira — a mesma oferta ao mesmo tempo, devoluções
 * em paralelo, pagar enquanto a moderação corta, saldos que nunca ficam negativos, bloqueios e expulsões depois de pagar,
 * e-mail por verificar (com o envio de e-mail ligado, MAIL_CAPTURE) e contas apagadas. Complementa txillada-tipos.e2e.spec.ts.
 */
describe('Txillada: dinheiro (entradas e ofertas sob corrida)', () => {
  let app: INestApplication;
  let pool: Pool;
  let svc: TxilladaService;
  let wallet: WalletService;
  const run = Date.now().toString(36);
  const api = () => request(app.getHttpServer());
  const auth = (x: U) => ({ Authorization: `Bearer ${x.token}`, 'X-Forwarded-For': x.ip });
  const u: Record<string, U> = {};
  const rooms: LiveKitRooms = {
    removeParticipant: async () => undefined,
    deleteRoom: async () => undefined,
    participants: async () => [],
    setCanPublish: async () => undefined,
  };
  let n = 0;

  async function signup(name: string, verified = true): Promise<U> {
    const username = `${name}${run}`.slice(0, 28);
    n++;
    const ip = `10.168.${n >> 8}.${n & 255}`;
    const r = await api().post('/api/v1/auth/register').set('X-Forwarded-For', ip)
      .send({ email: `${username}@example.com`, username, displayName: `${name[0].toUpperCase()}${name.slice(1)} Teste`, password: PASSWORD, birthDate: '1990-06-15', acceptTerms: true }).expect(201);
    if (verified) await pool.query('UPDATE identity.users SET email_verified_at = now() WHERE id = $1', [r.body.user.id]);
    return { token: r.body.accessToken, id: r.body.user.id, username, ip };
  }
  const open = (x: U, body: Record<string, unknown>) => api().post('/api/v1/txilladas').set(auth(x)).send({ title: 'Dinheiro', ...body });
  const get = (x: U, id: string) => api().get(`/api/v1/txilladas/${id}`).set(auth(x));
  const join = (x: U, id: string) => api().post(`/api/v1/txilladas/${id}/join`).set(auth(x));
  const pay = (x: U, id: string) => api().post(`/api/v1/txilladas/${id}/ticket`).set(auth(x));
  const gift = (x: U, id: string, amount: unknown, key: unknown) => api().post(`/api/v1/txilladas/${id}/gifts`).set(auth(x)).send({ amount, key });
  const balance = async (x: U) => (await api().get('/api/v1/wallet').set(auth(x)).expect(200)).body.balance as number;
  const endAll = (x: U) => pool.query(`UPDATE content.txilladas SET status = 'ended', ended_at = now() WHERE host_id = $1 AND status = 'live'`, [x.id]);
  const ledger = async (type: string, actor: U) => (await pool.query('SELECT count(*)::int AS n FROM ledger.transactions WHERE type = $1 AND actor_id = $2', [type, actor.id])).rows[0].n as number;
  const negatives = async () => (await pool.query('SELECT count(*)::int AS n FROM ledger.accounts WHERE kind = \'user_wallet\' AND balance < 0')).rows[0].n as number;
  /** Deixa `x` com exatamente `left` Txills (o resto vai para o banco). */
  async function drainTo(x: U, left: number) {
    const b = await balance(x);
    if (b > left) await wallet.transfer({ actorId: x.id, fromUserId: x.id, toUserId: u.bank.id, amount: b - left, type: 'transfer', idempotencyKey: `drain-${x.id}-${b}-${left}` });
    expect(await balance(x)).toBe(left);
  }

  beforeAll(async () => {
    await migrate(DB);
    pool = new Pool({ connectionString: DB });
    app = await createApp(
      loadConfig({ DATABASE_URL: DB, JWT_ACCESS_SECRET: 't'.repeat(40), NODE_ENV: 'test', MEDIA_DIR: './uploads-test', MAIL_CAPTURE: 'true', PUBLIC_URL: 'https://txillapp.com', ...LK }),
      { livekitRooms: rooms },
    );
    await app.init();
    svc = app.get(TxilladaService);
    wallet = app.get(WalletService);
    for (const name of ['host', 'ana', 'rui', 'eva', 'bank', 'blk', 'ban', 'gone']) u[name] = await signup(name);
    u.unv = await signup('unv', false);
    for (const x of Object.values(u)) await wallet.ensureWallet(x.id);
  }, 180_000);

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  it('validação: preço e ofertas com valores zero, negativos, decimais ou em texto dão 400 e não cobram nada', async () => {
    const { host, ana } = u;
    for (const price of [0, -10, '50', null]) await open(host, { audience: 'paid', price }).expect(400);
    const id = (await open(host, {}).expect(201)).body.txillada.id as string;
    await join(ana, id).expect(200);
    const a0 = await balance(ana);
    await gift(ana, id, -5, `neg-${run}`).expect(400);
    await gift(ana, id, '10', `str-${run}`).expect(400);
    await gift(ana, id, 1e12, `huge-${run}`).expect(400);
    await gift(ana, id, 10, undefined).expect(400);
    await gift(ana, id, 10, 'com espaço inválida').expect(400);
    await gift(ana, id, 10, 'x'.repeat(65)).expect(400);
    expect(await balance(ana)).toBe(a0);
    expect(await ledger('txillada_gift', ana)).toBe(0);
    await endAll(host);
  });

  it('a mesma oferta (a mesma chave) três vezes ao mesmo tempo cobra uma vez; a mesma chave noutra Txillada é outra oferta', async () => {
    const { host, ana } = u;
    const id = (await open(host, { goal: 100 }).expect(201)).body.txillada.id as string;
    await join(ana, id).expect(200);
    const a0 = await balance(ana);
    const h0 = await balance(host);
    const key = `corrida-${run}`;
    const all = await Promise.all([gift(ana, id, 20, key), gift(ana, id, 20, key), gift(ana, id, 20, key)]);
    expect(all.map((r) => r.status)).toEqual([200, 200, 200]);
    expect(all.filter((r) => r.body.replayed === false).length).toBe(1);
    expect(new Set(all.map((r) => r.body.gift.id)).size).toBe(1);
    expect(await balance(ana)).toBe(a0 - 20);
    expect(await balance(host)).toBe(h0 + 20);
    expect((await pool.query('SELECT count(*)::int AS n FROM content.txillada_gifts WHERE txillada_id = $1', [id])).rows[0].n).toBe(1);
    expect((await get(ana, id).expect(200)).body.raised).toBe(20);
    // A mesma chave com outro valor: devolve a primeira oferta, sem cobrar.
    expect((await gift(ana, id, 999, key).expect(200)).body).toMatchObject({ replayed: true, gift: { amount: 20 } });
    expect(await balance(ana)).toBe(a0 - 20);
    await endAll(host);
    // Noutra Txillada, a mesma chave é uma oferta nova (a chave é por Txillada).
    const id2 = (await open(host, {}).expect(201)).body.txillada.id as string;
    await join(ana, id2).expect(200);
    expect((await gift(ana, id2, 20, key).expect(200)).body.replayed).toBe(false);
    expect(await balance(ana)).toBe(a0 - 40);
    await endAll(host);
  });

  it('o saldo nunca fica negativo: oferecer e pagar com o saldo exato passa; mais um Txill dá 422 sem gravar nada', async () => {
    const { host, rui } = u;
    const id = (await open(host, { audience: 'paid', price: 30 }).expect(201)).body.txillada.id as string;
    await drainTo(rui, 35);
    expect((await pay(rui, id).expect(200)).body).toMatchObject({ charged: true, balance: 5 });
    await join(rui, id).expect(200);
    expect((await gift(rui, id, 5, `exato-${run}`).expect(200)).body).toMatchObject({ replayed: false, balance: 0 });
    expect((await gift(rui, id, 1, `mais-um-${run}`).expect(422)).body).toMatchObject({ code: 'insufficient_funds', amount: 1, balance: 0 });
    // Várias ofertas ao mesmo tempo com chaves diferentes e saldo para uma só.
    await wallet.transfer({ actorId: u.bank.id, fromUserId: u.bank.id, toUserId: rui.id, amount: 10, type: 'transfer', idempotencyKey: `back-${run}` });
    const all = await Promise.all([0, 1, 2].map((i) => gift(rui, id, 10, `par-${i}-${run}`)));
    expect(all.map((r) => r.status).sort()).toEqual([200, 422, 422]);
    expect(await balance(rui)).toBe(0);
    expect((await pool.query('SELECT count(*)::int AS n FROM content.txillada_gifts WHERE giver_id = $1', [rui.id])).rows[0].n).toBe(2);
    expect(await negatives()).toBe(0);
    await endAll(host);
  });

  it('devoluções em paralelo (corte, tarefa e gancho ao mesmo tempo): cada entrada volta uma vez só', async () => {
    const { host, ana, eva } = u;
    const id = (await open(host, { audience: 'paid', price: 40 }).expect(201)).body.txillada.id as string;
    const a0 = await balance(ana);
    const e0 = await balance(eva);
    await pay(ana, id).expect(200);
    await pay(eva, id).expect(200);
    const h0 = await balance(host);
    const refundsBefore = await ledger('txillada_refund', host);
    await pool.query(`UPDATE content.txilladas SET status = 'cut', ended_at = now() WHERE id = $1`, [id]);
    const res = await Promise.all([svc.refundTickets(id), svc.refundTickets(id), svc.refundTickets(id), svc.afterCut(id), svc.sweep()]);
    expect((res.slice(0, 3) as number[]).reduce((s, x) => s + x, 0)).toBeLessThanOrEqual(2);
    expect(await svc.refundTickets(id)).toBe(0);
    expect(await balance(ana)).toBe(a0);
    expect(await balance(eva)).toBe(e0);
    expect(await balance(host)).toBe(h0 - 80);
    expect(await ledger('txillada_refund', host)).toBe(refundsBefore + 2);
    const tk = (await pool.query('SELECT refunded_at IS NOT NULL AS done FROM content.txillada_tickets WHERE txillada_id = $1', [id])).rows;
    expect(tk).toEqual([{ done: true }, { done: true }]);
    // Depois do corte já não se paga nem se oferece.
    await pay(u.rui, id).expect(409);
    await gift(ana, id, 5, `depois-corte-${run}`).expect(409);
  });

  it('pagar ao mesmo tempo que a moderação corta: ou não cobra, ou cobra e devolve; nunca perde dinheiro', async () => {
    const { host, rui } = u;
    const staff = await staffLogin(app, `txdin${run}`.slice(0, 20), ['moderacao']);
    for (let i = 0; i < 3; i++) {
      await wallet.transfer({ actorId: u.bank.id, fromUserId: u.bank.id, toUserId: rui.id, amount: 20, type: 'transfer', idempotencyKey: `race-top-${i}-${run}` });
      const id = (await open(host, { audience: 'paid', price: 20 }).expect(201)).body.txillada.id as string;
      const r0 = await balance(rui);
      const [p] = await Promise.all([
        pay(rui, id),
        api().post(`/api/v1/admin/txilladas/${id}/cut`).set({ Authorization: `Bearer ${staff.token}` }).send({ reason: 'Corte de teste' }),
      ]);
      expect([200, 409]).toContain(p.status);
      await svc.sweep();
      expect(await balance(rui)).toBe(r0);
      const tk = (await pool.query('SELECT refunded_at IS NOT NULL AS done FROM content.txillada_tickets WHERE txillada_id = $1 AND user_id = $2', [id, rui.id])).rows;
      expect(tk.every((x) => x.done)).toBe(true);
    }
  });

  it('bloqueios e expulsões: quem tem bloqueio não vê, não paga nem oferece (404); o expulso recebe 403; nada se cobra', async () => {
    const { host, blk, ban } = u;
    const id = (await open(host, { audience: 'paid', price: 10 }).expect(201)).body.txillada.id as string;
    // Pagou e depois o anfitrião bloqueou-o.
    const b0 = await balance(blk);
    await pay(blk, id).expect(200);
    await api().put(`/api/v1/blocks/${blk.username}`).set(auth(host)).expect((r) => expect([200, 204]).toContain(r.status));
    await get(blk, id).expect(404);
    await join(blk, id).expect(404);
    await pay(blk, id).expect(404);
    await gift(blk, id, 5, `blk-${run}`).expect(404);
    expect(await balance(blk)).toBe(b0 - 10);
    // Quem vê não oferece ao anfitrião que o bloqueou, nem numa pública.
    await endAll(host);
    const pub = (await open(host, {}).expect(201)).body.txillada.id as string;
    await gift(blk, pub, 5, `blk-pub-${run}`).expect(404);
    expect(await balance(blk)).toBe(b0 - 10);
    await endAll(host);

    // Pagou e foi expulso: 403 em tudo, sem cobrar outra vez.
    const id2 = (await open(host, { audience: 'paid', price: 10 }).expect(201)).body.txillada.id as string;
    const x0 = await balance(ban);
    await pay(ban, id2).expect(200);
    await api().post(`/api/v1/txilladas/${id2}/ban/${ban.username}`).set(auth(host)).expect((r) => expect(r.status).toBeLessThan(300));
    await join(ban, id2).expect(403);
    await pay(ban, id2).expect(403);
    await gift(ban, id2, 5, `ban-${run}`).expect(403);
    await api().get(`/api/v1/txilladas/${id2}/comments`).set(auth(ban)).expect(403);
    expect(await balance(ban)).toBe(x0 - 10);
    expect(await ledger('txillada_ticket', ban)).toBe(1);
    await endAll(host);
  });

  it('e-mail por verificar não paga nem oferece; conta apagada não entra e a Txillada do anfitrião apagado desaparece', async () => {
    const { host, unv, gone, ana } = u;
    const id = (await open(host, { audience: 'paid', price: 10 }).expect(201)).body.txillada.id as string;
    const v0 = await balance(unv);
    await pay(unv, id).expect(403);
    await gift(unv, id, 5, `unv-${run}`).expect(403);
    expect(await balance(unv)).toBe(v0);
    await endAll(host);

    // O anfitrião apaga a conta a meio de uma paga: a Txillada sai e quem tinha pago fica com o registo.
    const gid = (await open(gone, { audience: 'paid', price: 10 }).expect(201)).body.txillada.id as string;
    await pay(ana, gid).expect(200);
    const a1 = await balance(ana);
    await api().post('/api/v1/auth/delete-account').set(auth(gone)).send({ confirmUsername: gone.username, password: PASSWORD }).expect(204);
    await get(ana, gid).expect(404);
    await pay(ana, gid).expect(404);
    await gift(ana, gid, 5, `gone-${run}`).expect(404);
    expect(await balance(ana)).toBe(a1);
    expect((await pool.query('SELECT count(*)::int AS n FROM content.txillada_tickets WHERE host_id = $1 AND user_id = $2', [gone.id, ana.id])).rows[0].n).toBe(1);
    expect(await negatives()).toBe(0);
  });

  it('a conta apagada já não paga nem oferece, nem com o token de acesso que ainda não expirou (até 10 min)', async () => {
    const { gone } = u; // apagada no teste anterior
    expect((await pool.query('SELECT status FROM identity.users WHERE id = $1', [gone.id])).rows[0].status).toBe('deleted');
    const live = (await open(u.eva, { audience: 'paid', price: 10 }).expect(201)).body.txillada.id as string;
    const goneBalance = async () => (await pool.query('SELECT balance FROM ledger.accounts WHERE user_id = $1', [gone.id])).rows[0]?.balance ?? null;
    const g0 = await goneBalance();
    const pg = await pay(gone, live);
    await join(gone, live);
    const gg = await gift(gone, live, 5, `gone-gift-${run}`);
    expect({ pay: pg.status >= 400, gift: gg.status >= 400, balance: await goneBalance() }).toEqual({ pay: true, gift: true, balance: g0 });
    await endAll(u.eva);
    expect(await negatives()).toBe(0);
  });
});
