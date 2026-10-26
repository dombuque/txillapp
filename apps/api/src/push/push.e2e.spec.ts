import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Pool } from 'pg';
import webpush from 'web-push';
import { loadConfig } from '../config';
import { migrate } from '../db/migrate';
import { createApp } from '../main';

const DB = process.env.TEST_DATABASE_URL ?? 'postgres://txill:txill_dev@localhost:5433/txillapp_test';
const PASSWORD = 'password-bem-longa-1';

interface U { token: string; id: string; username: string }

describe('notificações no telemóvel (Web Push)', () => {
  let app: INestApplication;
  let pool: Pool;
  const run = Date.now().toString(36);
  const api = () => request(app.getHttpServer());
  const auth = (x: U) => ({ Authorization: `Bearer ${x.token}` });
  const u: Record<string, U> = {};
  const sent: { endpoint: string; payload: { body: string; url: string } }[] = [];
  const keys = webpush.generateVAPIDKeys();

  async function signup(name: string): Promise<U> {
    const username = `${name}${run}`.slice(0, 28);
    const r = await api().post('/api/v1/auth/register').send({ email: `${username}@example.com`, username, displayName: `${name} Teste`, password: PASSWORD, birthDate: '1990-06-15', acceptTerms: true }).expect(201);
    return { token: r.body.accessToken, id: r.body.user.id, username };
  }
  const sub = (n: string) => ({ endpoint: `https://push.example.com/${run}/${n}`, keys: { p256dh: 'p'.repeat(20), auth: 'a'.repeat(16) } });
  const wait = () => new Promise((r) => setTimeout(r, 400));

  beforeAll(async () => {
    await migrate(DB);
    pool = new Pool({ connectionString: DB });
    jest.spyOn(webpush, 'sendNotification').mockImplementation(async (s, payload) => {
      sent.push({ endpoint: (s as { endpoint: string }).endpoint, payload: JSON.parse(String(payload)) });
      return { statusCode: 201, body: '', headers: {} };
    });
    app = await createApp(
      loadConfig({ DATABASE_URL: DB, JWT_ACCESS_SECRET: 'p'.repeat(40), NODE_ENV: 'test', MEDIA_DIR: './uploads-test', VAPID_PUBLIC_KEY: keys.publicKey, VAPID_PRIVATE_KEY: keys.privateKey }),
    );
    await app.init();
    for (const n of ['qa', 'qb']) u[n] = await signup(n);
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await pool.end();
    jest.restoreAllMocks();
  });

  it('regista o aparelho, avisa de mensagens e seguidores sem mostrar o conteúdo, e remove subscrições mortas', async () => {
    const { qa, qb } = u;
    expect((await api().get('/api/v1/push/key').set(auth(qa)).expect(200)).body.publicKey).toBe(keys.publicKey);
    await api().post('/api/v1/push/subscribe').send(sub('a')).expect(401);
    await api().post('/api/v1/push/subscribe').set(auth(qa)).send({ endpoint: 'nao-e-url', keys: {} }).expect(400);
    await api().post('/api/v1/push/subscribe').set(auth(qa)).send(sub('a')).expect(204);
    await api().post('/api/v1/push/subscribe').set(auth(qa)).send(sub('a')).expect(204); // repetir não duplica
    expect((await pool.query('SELECT count(*)::int AS n FROM social.push_subscriptions WHERE user_id = $1', [qa.id])).rows[0].n).toBe(1);

    await api().post(`/api/v1/chat/with/${qa.username}`).set(auth(qb)).send({ body: 'segredo: a minha senha é 1234' }).expect(201);
    await wait();
    const msg = sent.find((s) => s.payload.url === `/messages/${qb.username}`)!;
    expect(msg.endpoint).toBe(sub('a').endpoint);
    expect(msg.payload.body).toBe('qb Teste enviou-te uma mensagem');
    expect(JSON.stringify(sent)).not.toMatch(/segredo|1234/); // nunca o conteúdo

    await api().post(`/api/v1/users/${qa.username}/follow`).set(auth(qb)).expect(200);
    await wait();
    expect(sent.some((s) => /começou a seguir-te/.test(s.payload.body))).toBe(true);

    // o endpoint expirou (410): a subscrição é removida
    (webpush.sendNotification as jest.Mock).mockRejectedValueOnce(Object.assign(new Error('gone'), { statusCode: 410 }));
    await api().post(`/api/v1/chat/with/${qa.username}`).set(auth(qb)).send({ body: 'outra' }).expect(201);
    await wait();
    expect((await pool.query('SELECT count(*)::int AS n FROM social.push_subscriptions WHERE user_id = $1', [qa.id])).rows[0].n).toBe(0);

    await api().post('/api/v1/push/subscribe').set(auth(qa)).send(sub('b')).expect(204);
    const before = sent.length;
    await api().post('/api/v1/push/test').set(auth(qa)).expect(204);
    expect(sent.slice(before).some((x) => x.endpoint === sub('b').endpoint && /Funciona/.test(x.payload.body))).toBe(true);
    await api().delete('/api/v1/push/subscribe').set(auth(qa)).send({ endpoint: sub('b').endpoint }).expect(204);
    expect((await pool.query('SELECT count(*)::int AS n FROM social.push_subscriptions WHERE user_id = $1', [qa.id])).rows[0].n).toBe(0);
  });
});
