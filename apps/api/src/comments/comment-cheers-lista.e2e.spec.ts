import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Pool } from 'pg';
import { loadConfig } from '../config';
import { migrate } from '../db/migrate';
import { createApp } from '../main';

const DB = process.env.TEST_DATABASE_URL ?? 'postgres://txill:txill_dev@localhost:5433/txillapp_test';
const PASSWORD = 'password-bem-longa-1';
const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');

interface U { token: string; id: string; username: string }

/** «Quem brindou» um comentário: GET /comments/:id/cheers (publicações) e GET /stories/comments/:id/cheers (mimos). */
describe('quem brindou um comentário (integração)', () => {
  let app: INestApplication;
  let pool: Pool;
  const run = Date.now().toString(36);
  const api = () => request(app.getHttpServer());
  const auth = (x: U) => ({ Authorization: `Bearer ${x.token}` });
  const u: Record<string, U> = {};

  async function signup(name: string): Promise<U> {
    const username = `${name}${run}`.slice(0, 28);
    const r = await api().post('/api/v1/auth/register').send({ email: `${username}@example.com`, username, displayName: `${name} Teste`, password: PASSWORD, birthDate: '1990-06-15', acceptTerms: true }).expect(201);
    await pool.query('UPDATE identity.users SET email_verified_at = now() WHERE id = $1', [r.body.user.id]);
    return { token: r.body.accessToken, id: r.body.user.id, username };
  }
  const block = (a: U, b: U) => api().put(`/api/v1/blocks/${b.username}`).set(auth(a)).expect(200);
  const names = (body: { username: string }[]) => body.map((p) => p.username);

  beforeAll(async () => {
    await migrate(DB);
    pool = new Pool({ connectionString: DB });
    app = await createApp(loadConfig({ DATABASE_URL: DB, JWT_ACCESS_SECRET: 's'.repeat(40), NODE_ENV: 'test', MEDIA_DIR: './uploads-test' }));
    await app.init();
    for (const n of ['qba', 'qbb', 'qbc', 'qbd', 'qbe']) u[n] = await signup(n);
  }, 90_000);

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  it('publicações: lista quem brindou, os mais recentes primeiro, sem as contas com bloqueio; comentário escondido dá 404', async () => {
    const { qba, qbb, qbc, qbd, qbe } = u;
    const post = (await api().post('/api/v1/posts').set(auth(qba)).send({ body: `brindes ${run}` }).expect(201)).body;
    const c = (await api().post(`/api/v1/posts/${post.id}/comments`).set(auth(qbb)).send({ body: 'Boa!' }).expect(201)).body.id as string;
    await api().post(`/api/v1/comments/${c}/cheers`).set(auth(qbc)).expect(200);
    await api().post(`/api/v1/comments/${c}/cheers`).set(auth(qbd)).expect(200);

    const r = await api().get(`/api/v1/comments/${c}/cheers`).set(auth(qba)).expect(200);
    expect(names(r.body)).toEqual([qbd.username, qbc.username]);
    expect(r.body[0]).toMatchObject({ displayName: 'qbd Teste', hasAvatar: false, verified: false });
    expect(r.body[0].at).toBeTruthy();

    // Quem bloqueou alguém não o vê na lista.
    await block(qbe, qbc);
    expect(names((await api().get(`/api/v1/comments/${c}/cheers`).set(auth(qbe)).expect(200)).body)).toEqual([qbd.username]);
    // Com bloqueio para quem escreveu o comentário, o comentário não se vê: 404.
    await block(qbb, qbe);
    await api().get(`/api/v1/comments/${c}/cheers`).set(auth(qbe)).expect(404);
    await api().get('/api/v1/comments/not-a-uuid/cheers').set(auth(qba)).expect(400);
  });

  it('mimos: lista quem brindou o comentário; sem bloqueados; quem não vê o comentário recebe 404', async () => {
    const { qba, qbb, qbc, qbd } = u;
    const up = await api().post('/api/v1/media/uploads').set(auth(qbd)).send({ mime: 'image/png', size: PNG.length }).expect(201);
    await api().put(up.body.uploadUrl).set('Content-Type', 'image/png').send(PNG).expect(200);
    const s = (await api().post('/api/v1/stories').set(auth(qbd)).send({ mediaId: up.body.assetId, caption: 'mimo' }).expect(201)).body;
    const c = (await api().post(`/api/v1/stories/${s.id}/comments`).set(auth(qba)).send({ body: 'Que mimo!' }).expect(201)).body.id as string;
    await api().post(`/api/v1/stories/comments/${c}/cheer`).set(auth(qbc)).expect(200);
    await api().post(`/api/v1/stories/comments/${c}/cheer`).set(auth(qbd)).expect(200);

    expect(names((await api().get(`/api/v1/stories/comments/${c}/cheers`).set(auth(qbd)).expect(200)).body)).toEqual([qbd.username, qbc.username]);
    // qbe bloqueou qbc no teste anterior: não o vê.
    expect(names((await api().get(`/api/v1/stories/comments/${c}/cheers`).set(auth(u.qbe)).expect(200)).body)).toEqual([qbd.username]);
    // Bloqueio entre quem escreveu o comentário e quem pede: o comentário não existe para ele.
    await block(qba, qbb);
    await api().get(`/api/v1/stories/comments/${c}/cheers`).set(auth(qbb)).expect(404);
  });
});
