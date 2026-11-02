import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Pool } from 'pg';
import { loadConfig } from '../config';
import { migrate } from '../db/migrate';
import { createApp } from '../main';

const DB = process.env.TEST_DATABASE_URL ?? 'postgres://txill:txill_dev@localhost:5433/txillapp_test';
const PASSWORD = 'password-bem-longa-1';

interface U { token: string; id: string; username: string }

describe('presentes dentro do chat (integração)', () => {
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
  const thread = async (x: U, other: U) => (await api().get(`/api/v1/chat/with/${other.username}`).set(auth(x)).expect(200)).body;
  const list = async (x: U) => (await api().get('/api/v1/chat/conversations').set(auth(x)).expect(200)).body as { username: string; lastMessage: { kind: string } }[];

  beforeAll(async () => {
    await migrate(DB);
    pool = new Pool({ connectionString: DB });
    app = await createApp(loadConfig({ DATABASE_URL: DB, JWT_ACCESS_SECRET: 'g'.repeat(40), NODE_ENV: 'test', MEDIA_DIR: './uploads-test' }));
    await app.init();
    for (const n of ['pa', 'pb', 'pc']) u[n] = await signup(n);
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  it('presente na conversa: só entra um presente verdadeiro, meu e para esta pessoa, uma única vez', async () => {
    const { pa: from, pb: to, pc: other } = u;
    await pool.query('INSERT INTO social.follows (follower_id, followee_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [from.id, to.id]);
    await pool.query('INSERT INTO social.follows (follower_id, followee_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [to.id, from.id]);
    const gift = async (a: U, b: U, key: string, note = 'Uma bebida por minha conta') =>
      (await api().post('/api/v1/gifts').set(auth(a)).set('Idempotency-Key', `${key}-${run}`).send({ toUsername: b.username, amount: 10, note, visibility: 'private' }).expect(201)).body.transactionId as string;
    const post = (a: U, b: U, body: object) => api().post(`/api/v1/chat/with/${b.username}`).set(auth(a)).send(body);

    const tx = await gift(from, to, 'chat-gift-1');
    await post(from, to, { kind: 'gift', body: 'nao-e-um-id' }).expect(400);
    await post(from, to, { kind: 'gift', body: '00000000-0000-0000-0000-000000000000' }).expect(400);
    await post(to, from, { kind: 'gift', body: tx }).expect(400); // quem recebeu não pode apresentar o presente de outra pessoa
    await pool.query('INSERT INTO social.follows (follower_id, followee_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [from.id, other.id]);
    await post(from, other, { kind: 'gift', body: tx }).expect(400); // foi para outra pessoa

    await post(from, to, { kind: 'gift', body: tx }).expect(201);
    await post(from, to, { kind: 'gift', body: tx }).expect(400); // já está na conversa
    const m = ((await thread(to, from)).items as { kind: string; body: string; giftAmount: number | null }[]).find((x) => x.kind === 'gift')!;
    expect(m).toMatchObject({ giftAmount: 10, body: 'Uma bebida por minha conta' });
    expect(((await list(to)).find((c) => c.username === from.username)!).lastMessage.kind).toBe('gift');
  });
});
