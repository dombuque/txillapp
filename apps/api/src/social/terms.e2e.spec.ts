import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Pool } from 'pg';
import { TERMS_VERSION } from '@txillapp/shared';
import { loadConfig } from '../config';
import { migrate } from '../db/migrate';
import { createApp } from '../main';

const DB = process.env.TEST_DATABASE_URL ?? 'postgres://txill:txill_dev@localhost:5433/txillapp_test';

describe('aceitar os Termos em vigor depois de uma atualização (PUT /users/me/terms)', () => {
  let app: INestApplication;
  let pool: Pool;
  let token = '';
  let id = '';
  const api = () => request(app.getHttpServer());
  const auth = () => ({ Authorization: `Bearer ${token}` });

  beforeAll(async () => {
    await migrate(DB);
    pool = new Pool({ connectionString: DB });
    app = await createApp(loadConfig({ DATABASE_URL: DB, JWT_ACCESS_SECRET: 't'.repeat(40), NODE_ENV: 'test', MEDIA_DIR: './uploads-test' }));
    await app.init();
    const username = `trm${Date.now().toString(36)}`.slice(0, 28);
    const r = await api().post('/api/v1/auth/register').send({ email: `${username}@example.com`, username, displayName: 'Termos', password: 'password-bem-longa-1', birthDate: '1990-06-15', acceptTerms: true }).expect(201);
    token = r.body.accessToken;
    id = r.body.user.id;
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  it('com uma versão antiga, termsAccepted é false; depois de aceitar passa a true e grava a versão em vigor', async () => {
    expect((await api().get('/api/v1/settings/privacy').set(auth()).expect(200)).body.termsAccepted).toBe(true);
    await pool.query("UPDATE identity.users SET terms_version = '2000-01-01', terms_accepted_at = now() - interval '1 year' WHERE id = $1", [id]);
    expect((await api().get('/api/v1/settings/privacy').set(auth()).expect(200)).body.termsAccepted).toBe(false);

    await api().put('/api/v1/users/me/terms').set(auth()).send({}).expect(400);
    await api().put('/api/v1/users/me/terms').set(auth()).send({ acceptTerms: false }).expect(400);
    await api().put('/api/v1/users/me/terms').send({ acceptTerms: true }).expect(401);
    expect((await api().get('/api/v1/settings/privacy').set(auth()).expect(200)).body.termsAccepted).toBe(false);

    const ok = await api().put('/api/v1/users/me/terms').set(auth()).send({ acceptTerms: true });
    expect([200, 204]).toContain(ok.status);
    expect((await api().get('/api/v1/settings/privacy').set(auth()).expect(200)).body.termsAccepted).toBe(true);
    const row = (await pool.query("SELECT terms_version, terms_accepted_at > now() - interval '1 minute' AS fresh FROM identity.users WHERE id = $1", [id])).rows[0];
    expect(row.terms_version).toBe(TERMS_VERSION);
    expect(row.fresh).toBe(true);
  });
});
