import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Pool } from 'pg';
import { createApp } from '../main';
import { migrate } from '../db/migrate';
import { loadConfig } from '../config';

const TEST_DB_URL = process.env.TEST_DATABASE_URL ?? 'postgres://txill:txill_dev@localhost:5433/txillapp_test';
const describeDb = process.env.SKIP_DB_TESTS ? describe.skip : describe;

describeDb('auth (integração, PostgreSQL real)', () => {
  let app: INestApplication;
  let pool: Pool;
  const email = `u${Date.now()}@example.com`;
  const password = 'uma-password-bem-longa-123';
  const csrf = { 'X-Requested-With': 'txillapp' };

  beforeAll(async () => {
    const admin = new Pool({ connectionString: TEST_DB_URL.replace(/\/[^/]+$/, '/postgres') });
    const name = TEST_DB_URL.split('/').pop()!;
    const exists = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
    if (!exists.rowCount) await admin.query(`CREATE DATABASE ${name}`);
    await admin.end();
    await migrate(TEST_DB_URL);
    pool = new Pool({ connectionString: TEST_DB_URL });
    app = await createApp(
      loadConfig({ DATABASE_URL: TEST_DB_URL, JWT_ACCESS_SECRET: 'x'.repeat(40), NODE_ENV: 'test' }),
    );
    await app.init();
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  const register = () =>
    request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email, username: `user${Date.now()}`, displayName: 'Teste', password });

  it('regista, devolve access token e cookie de refresh HttpOnly', async () => {
    const res = await register().expect(201);
    expect(res.body.accessToken).toEqual(expect.any(String));
    const cookie = (res.headers['set-cookie'] as unknown as string[])[0];
    expect(cookie).toMatch(/txill_rt=.*HttpOnly.*SameSite=Strict/);
    expect(JSON.stringify(res.body)).not.toContain(password);
  });

  it('rejeita email duplicado com 409', async () => {
    await register().expect(409);
  });

  it('guarda a password como argon2id', async () => {
    const { rows } = await pool.query(
      'SELECT password_hash FROM identity.credentials c JOIN identity.users u ON u.id = c.user_id WHERE u.email = $1',
      [email],
    );
    expect(rows[0].password_hash).toMatch(/^\$argon2id\$/);
  });

  it('valida input (password curta)', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email: 'a@b.co', username: 'abc', displayName: 'A', password: 'curta' })
      .expect(400);
  });

  it('login falha com password errada e funciona com a certa; /me exige token', async () => {
    const api = request(app.getHttpServer());
    await api.post('/api/v1/auth/login').send({ identifier: email, password: 'errada-errada-1' }).expect(401);
    const ok = await api.post('/api/v1/auth/login').send({ identifier: email, password }).expect(200);
    await api.get('/api/v1/auth/me').expect(401);
    const me = await api.get('/api/v1/auth/me').set('Authorization', `Bearer ${ok.body.accessToken}`).expect(200);
    expect(me.body.displayName).toBe('Teste');
  });

  it('rotação do refresh token e deteção de reutilização', async () => {
    const api = request(app.getHttpServer());
    const login = await api.post('/api/v1/auth/login').send({ identifier: email, password }).expect(200);
    const c1 = (login.headers['set-cookie'] as unknown as string[])[0].split(';')[0];

    await api.post('/api/v1/auth/refresh').set(csrf).expect(401); // sem cookie
    await api.post('/api/v1/auth/refresh').set('Cookie', c1).expect(401); // sem cabeçalho CSRF

    const r1 = await api.post('/api/v1/auth/refresh').set(csrf).set('Cookie', c1).expect(200);
    const c2 = (r1.headers['set-cookie'] as unknown as string[])[0].split(';')[0];
    expect(c2).not.toBe(c1);

    // Dentro da margem de 10 s (vários separadores) o token antigo ainda é aceite.
    await api.post('/api/v1/auth/refresh').set(csrf).set('Cookie', c1).expect(200);

    // Fora da margem, reutilizar o token antigo revoga a família inteira.
    await pool.query(
      `UPDATE identity.sessions SET used_at = used_at - interval '1 minute'
        WHERE used_at IS NOT NULL AND user_id = (SELECT id FROM identity.users WHERE email = $1)`,
      [email],
    );
    await api.post('/api/v1/auth/refresh').set(csrf).set('Cookie', c1).expect(401);
    await api.post('/api/v1/auth/refresh').set(csrf).set('Cookie', c2).expect(401);
  });

  it('refresh simultâneo com o mesmo cookie (vários separadores) não termina a sessão', async () => {
    const api = request(app.getHttpServer());
    const login = await api.post('/api/v1/auth/login').send({ identifier: email, password }).expect(200);
    const c = (login.headers['set-cookie'] as unknown as string[])[0].split(';')[0];
    const rs = await Promise.all([1, 2, 3].map(() => api.post('/api/v1/auth/refresh').set(csrf).set('Cookie', c)));
    expect(rs.map((r) => r.status)).toEqual([200, 200, 200]);
  });

  it('o limite do login não bloqueia a renovação de sessão, mas o login continua limitado', async () => {
    const api = request(app.getHttpServer());
    const login = await api.post('/api/v1/auth/login').send({ identifier: email, password }).expect(200);
    const c = (login.headers['set-cookie'] as unknown as string[])[0].split(';')[0];
    for (let i = 0; i < 15; i++) await api.post('/api/v1/auth/refresh').set(csrf).set('Cookie', c).expect(200);
    const attempts = await Promise.all(
      Array.from({ length: 12 }, () => api.post('/api/v1/auth/login').send({ identifier: email, password: 'errada-errada-1' })),
    );
    expect(attempts.some((r) => r.status === 429)).toBe(true);
  });

  it('audit_log é append-only', async () => {
    await expect(pool.query('DELETE FROM audit.audit_log')).rejects.toThrow(/append-only/);
  });

  it('health e readiness', async () => {
    await request(app.getHttpServer()).get('/api/v1/health').expect(200);
    await request(app.getHttpServer()).get('/api/v1/health/ready').expect(200);
  });
});
