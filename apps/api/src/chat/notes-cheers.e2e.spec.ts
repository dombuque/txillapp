import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Pool } from 'pg';
import { loadConfig } from '../config';
import { migrate } from '../db/migrate';
import { createApp } from '../main';

const DB = process.env.TEST_DATABASE_URL ?? 'postgres://txill:txill_dev@localhost:5433/txillapp_test';

interface U { token: string; id: string; username: string }

describe('Notas: brindar (integração)', () => {
  let app: INestApplication;
  let pool: Pool;
  const run = Date.now().toString(36);
  const api = () => request(app.getHttpServer());
  const auth = (x: U) => ({ Authorization: `Bearer ${x.token}` });

  async function signup(name: string): Promise<U> {
    const username = `${name}${run}`.slice(0, 28);
    const r = await api().post('/api/v1/auth/register').send({ email: `${username}@example.com`, username, displayName: `${name} Teste`, password: 'password-bem-longa-1', birthDate: '1990-06-15', acceptTerms: true }).expect(201);
    await pool.query('UPDATE identity.users SET email_verified_at = now() WHERE id = $1', [r.body.user.id]);
    return { token: r.body.accessToken, id: r.body.user.id, username };
  }

  beforeAll(async () => {
    await migrate(DB);
    pool = new Pool({ connectionString: DB });
    app = await createApp(loadConfig({ DATABASE_URL: DB, JWT_ACCESS_SECRET: 'e'.repeat(40), NODE_ENV: 'test', MEDIA_DIR: './uploads-test' }));
    await app.init();
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  it('só quem vê a nota a pode brindar; brindar põe e tira; o dono vê a contagem; apagar a nota apaga os brindes', async () => {
    const a = await signup('nca');
    const b = await signup('ncb');
    const c = await signup('ncc');
    await api().put('/api/v1/notes/me').set(auth(a)).send({ body: 'Bora txilar' }).expect(204);
    // b ainda não segue a: não vê a nota, não a pode brindar.
    await api().post(`/api/v1/notes/${a.username}/cheer`).set(auth(b)).expect(404);
    await pool.query('INSERT INTO social.follows (follower_id, followee_id) VALUES ($1, $2), ($3, $2)', [b.id, a.id, c.id]);
    expect((await api().post(`/api/v1/notes/${a.username}/cheer`).set(auth(b)).expect(200)).body).toEqual({ cheered: true, cheers: 1 });
    expect((await api().post(`/api/v1/notes/${a.username}/cheer`).set(auth(c)).expect(200)).body).toEqual({ cheered: true, cheers: 2 });
    const seenByB = (await api().get('/api/v1/notes').set(auth(b)).expect(200)).body.items.find((n: { username: string }) => n.username === a.username);
    expect(seenByB).toMatchObject({ cheered: true, cheers: 2 });
    expect((await api().get('/api/v1/notes').set(auth(a)).expect(200)).body.mine).toMatchObject({ cheers: 2 });
    // Brindar outra vez tira o brinde.
    expect((await api().post(`/api/v1/notes/${a.username}/cheer`).set(auth(b)).expect(200)).body).toEqual({ cheered: false, cheers: 1 });
    // Apagar a nota apaga os brindes: uma nota nova começa a zero.
    await api().delete('/api/v1/notes/me').set(auth(a)).expect(204);
    await api().put('/api/v1/notes/me').set(auth(a)).send({ body: 'Outra' }).expect(204);
    expect((await api().get('/api/v1/notes').set(auth(a)).expect(200)).body.mine).toMatchObject({ cheers: 0 });
  });
});
