import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Pool } from 'pg';
import { createApp } from './main';
import { migrate } from './db/migrate';
import { loadConfig } from './config';

const DB = process.env.TEST_DATABASE_URL ?? 'postgres://txill:txill_dev@localhost:5433/txillapp_test';
const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');

describe('MVP: carteira, ledger, feed, media (integração)', () => {
  let app: INestApplication;
  let pool: Pool;
  const run = Date.now();
  const api = () => request(app.getHttpServer());
  let ana: { token: string; id: string; username: string };
  let bruno: { token: string; id: string; username: string };

  async function signup(name: string) {
    const username = `${name}${run}`.slice(0, 30);
    const r = await api()
      .post('/api/v1/auth/register')
      .send({ email: `${username}@example.com`, username, displayName: name, password: 'password-bem-longa-1' })
      .expect(201);
    return { token: r.body.accessToken as string, id: r.body.user.id as string, username };
  }
  const auth = (u: { token: string }) => ({ Authorization: `Bearer ${u.token}` });

  beforeAll(async () => {
    await migrate(DB);
    pool = new Pool({ connectionString: DB });
    app = await createApp(
      loadConfig({ DATABASE_URL: DB, JWT_ACCESS_SECRET: 'y'.repeat(40), NODE_ENV: 'test', MEDIA_DIR: './uploads-test' }),
    );
    await app.init();
    ana = await signup('ana');
    bruno = await signup('bruno');
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  it('carteira abre com bónus de demonstração e rotula Txills como fictícios', async () => {
    const w = await api().get('/api/v1/wallet').set(auth(ana)).expect(200);
    expect(w.body).toMatchObject({ balance: 1000, currency: 'TXL', demo: true });
  });

  it('exige autenticação e Idempotency-Key', async () => {
    await api().get('/api/v1/wallet').expect(401);
    await api().post('/api/v1/wallet/transfers').set(auth(ana)).send({ toUsername: bruno.username, amount: 5 }).expect(400);
  });

  it('transferência é idempotente: repetir a chave não debita duas vezes', async () => {
    await api().get('/api/v1/wallet').set(auth(bruno)); // abre carteira do destinatário
    const send = () =>
      api().post('/api/v1/wallet/transfers').set(auth(ana)).set('Idempotency-Key', `idem-${run}-1`).send({ toUsername: bruno.username, amount: 100 });
    const a = await send().expect(201);
    const b = await send().expect(201);
    expect(b.body.transactionId).toBe(a.body.transactionId);
    expect(b.body.replayed).toBe(true);
    expect((await api().get('/api/v1/wallet').set(auth(ana))).body.balance).toBe(900);
  });

  it('gasto duplo concorrente: 20 pedidos de 100 com saldo de 900 → exactamente 9 sucessos, saldo 0', async () => {
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        api()
          .post('/api/v1/wallet/transfers')
          .set(auth(ana))
          .set('Idempotency-Key', `race-${run}-${i}`)
          .send({ toUsername: bruno.username, amount: 100 }),
      ),
    );
    const ok = results.filter((r) => r.status === 201).length;
    const rejected = results.filter((r) => r.status === 422).length;
    expect(ok).toBe(9);
    expect(rejected).toBe(11);
    expect((await api().get('/api/v1/wallet').set(auth(ana))).body.balance).toBe(0);
    expect((await api().get('/api/v1/wallet').set(auth(bruno))).body.balance).toBe(1000 + 100 + 900);
  });

  it('invariantes do ledger: cada transacção soma zero e saldo = soma dos lançamentos', async () => {
    const unbalanced = await pool.query(
      'SELECT transaction_id FROM ledger.entries GROUP BY transaction_id HAVING SUM(amount) <> 0',
    );
    expect(unbalanced.rowCount).toBe(0);
    const drift = await pool.query(
      `SELECT a.id FROM ledger.accounts a
         LEFT JOIN (SELECT account_id, SUM(amount) s FROM ledger.entries GROUP BY account_id) e ON e.account_id = a.id
        WHERE a.balance <> COALESCE(e.s, 0)`,
    );
    expect(drift.rowCount).toBe(0);
    await expect(pool.query('UPDATE ledger.entries SET amount = 1')).rejects.toThrow(/imutável/);
  });

  it('upload de imagem: valida bytes reais, publica no feed, brinda, comenta e presenteia', async () => {
    // Tipo declarado PNG mas conteúdo falso → rejeitado.
    const bad = await api().post('/api/v1/media/uploads').set(auth(bruno)).send({ mime: 'image/png', size: 40 }).expect(201);
    await api().put(bad.body.uploadUrl).set('Content-Type', 'image/png').send(Buffer.from('isto não é uma imagem!')).expect(415);

    // Assinatura adulterada → 403.
    const up = await api().post('/api/v1/media/uploads').set(auth(bruno)).send({ mime: 'image/png', size: PNG.length }).expect(201);
    await api().put(up.body.uploadUrl.replace(/sig=./, 'sig=X')).send(PNG).expect(403);
    await api().put(up.body.uploadUrl).set('Content-Type', 'image/png').send(PNG).expect(200);
    await api().post('/api/v1/media/uploads').set(auth(bruno)).send({ mime: 'application/pdf', size: 10 }).expect(415);

    const post = await api()
      .post('/api/v1/posts')
      .set(auth(bruno))
      .send({ body: 'Sejam bem vindos à Praia da Barra', locationLabel: 'Bairro do Fomento', mediaId: up.body.assetId })
      .expect(201);
    expect(post.body.mediaUrl).toContain(up.body.assetId);
    await api().get(post.body.mediaUrl).expect(200).expect('Content-Type', /image\/png/);

    // Não se pode usar media de outro utilizador.
    await api().post('/api/v1/posts').set(auth(ana)).send({ body: 'x', mediaId: up.body.assetId }).expect(400);

    const c1 = await api().post(`/api/v1/posts/${post.body.id}/cheers`).set(auth(ana)).expect(200);
    expect(c1.body).toEqual({ cheered: true, cheers: 1 });
    const c2 = await api().post(`/api/v1/posts/${post.body.id}/cheers`).set(auth(ana)).expect(200);
    expect(c2.body).toEqual({ cheered: false, cheers: 0 });

    await api().post(`/api/v1/posts/${post.body.id}/comments`).set(auth(ana)).send({ body: 'Que lugar lindo!' }).expect(201);

    // Ana está sem saldo → presente rejeitado; Bruno não pode presentear o próprio post.
    await api().post(`/api/v1/posts/${post.body.id}/gifts`).set(auth(ana)).set('Idempotency-Key', `gift-${run}-0`).send({ amount: 10 }).expect(422);
    await api().post(`/api/v1/posts/${post.body.id}/gifts`).set(auth(bruno)).set('Idempotency-Key', `gift-${run}-1`).send({ amount: 10 }).expect(422);
    // Bruno devolve 50 a Ana, que presenteia 20.
    await api().post('/api/v1/wallet/transfers').set(auth(bruno)).set('Idempotency-Key', `back-${run}`).send({ toUsername: ana.username, amount: 50 }).expect(201);
    const g = await api().post(`/api/v1/posts/${post.body.id}/gifts`).set(auth(ana)).set('Idempotency-Key', `gift-${run}-2`).send({ amount: 20 }).expect(201);
    expect(g.body.post.gifts).toBe(1);
    const g2 = await api().post(`/api/v1/posts/${post.body.id}/gifts`).set(auth(ana)).set('Idempotency-Key', `gift-${run}-2`).send({ amount: 20 }).expect(201);
    expect(g2.body.replayed).toBe(true);
    expect(g2.body.post.gifts).toBe(1);

    const feed = await api().get('/api/v1/posts?limit=5').set(auth(ana)).expect(200);
    expect(feed.body.items[0]).toMatchObject({ id: post.body.id, comments: 1, gifts: 1, cheers: 0, cheered: false });
  });

  it('feed pagina por cursor sem repetir itens', async () => {
    for (let i = 0; i < 5; i++) {
      await api().post('/api/v1/posts').set(auth(ana)).send({ body: `post ${i}` }).expect(201);
    }
    const p1 = await api().get('/api/v1/posts?limit=3').set(auth(ana)).expect(200);
    expect(p1.body.items).toHaveLength(3);
    expect(p1.body.nextCursor).toBeTruthy();
    const p2 = await api().get(`/api/v1/posts?limit=3&cursor=${p1.body.nextCursor}`).set(auth(ana)).expect(200);
    const ids = [...p1.body.items, ...p2.body.items].map((x: { id: string }) => x.id);
    expect(new Set(ids).size).toBe(ids.length);
    await api().get('/api/v1/posts?cursor=nao-e-uuid').set(auth(ana)).expect(400);
  });
});
