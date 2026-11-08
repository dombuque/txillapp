import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Pool } from 'pg';
import { createApp } from '../main';
import { migrate } from '../db/migrate';
import { loadConfig } from '../config';

const TEST_DB_URL = process.env.TEST_DATABASE_URL ?? 'postgres://txill:txill_dev@localhost:5433/txillapp_test';
const describeDb = process.env.SKIP_DB_TESTS ? describe.skip : describe;

describeDb('auth no browser: cookie HttpOnly por conta (integração)', () => {
  let app: INestApplication;
  let pool: Pool;
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

  it('app no browser: o token de renovação nunca vai para a página; fica num cookie HttpOnly por conta', async () => {
    const web = { ...csrf, 'X-Client': 'txillapp-web' };
    const n = `web${Date.now()}`.slice(0, 28);
    const reg = await request(app.getHttpServer()).post('/api/v1/auth/register').set(web)
      .send({ email: `${n}@example.com`, username: n, displayName: 'Web', password, birthDate: '1990-06-15', acceptTerms: true }).expect(201);
    expect(reg.body.refreshToken).toBeUndefined();
    const id = reg.body.user.id as string;
    const cookies = reg.headers['set-cookie'] as unknown as string[];
    const mine = cookies.find((c) => c.startsWith(`txill_rt_${id}=`))!;
    expect(mine).toMatch(/HttpOnly/);
    expect(mine).toMatch(/SameSite=Strict/);
    expect(mine).toMatch(/Path=\/api\/v1\/auth/);
    const jar = mine.split(';')[0];

    // Renovar: precisa do cookie da conta e de dizer qual é a conta.
    const ok = await request(app.getHttpServer()).post('/api/v1/auth/refresh').set(web).set('X-Account', id).set('Cookie', jar).expect(200);
    expect(ok.body.refreshToken).toBeUndefined();
    expect(ok.body.user.id).toBe(id);
    const rotated = (ok.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith(`txill_rt_${id}=`))!.split(';')[0];
    expect(rotated).not.toBe(jar); // o token roda a cada renovação
    await request(app.getHttpServer()).post('/api/v1/auth/refresh').set(web).set('Cookie', rotated).expect(401); // sem dizer a conta
    await request(app.getHttpServer()).post('/api/v1/auth/refresh').set({ 'X-Client': 'txillapp-web' }).set('X-Account', id).set('Cookie', rotated).expect(401); // sem o cabeçalho anti-CSRF

    // Migração: um token antigo guardado na página passa para o cookie (e depois a página apaga-o).
    const m = `mob${Date.now()}`.slice(0, 28);
    const mob = await request(app.getHttpServer()).post('/api/v1/auth/register').set({ ...csrf, 'X-Client': 'txillapp-mobile' })
      .send({ email: `${m}@example.com`, username: m, displayName: 'Mob', password, birthDate: '1990-06-15', acceptTerms: true }).expect(201);
    expect(mob.body.refreshToken).toEqual(expect.any(String)); // a app nativa continua a receber o token
    const mig = await request(app.getHttpServer()).post('/api/v1/auth/refresh').set(web).set('X-Account', mob.body.user.id).set('X-Refresh-Token', mob.body.refreshToken).expect(200);
    expect(mig.body.refreshToken).toBeUndefined();
    expect((mig.headers['set-cookie'] as unknown as string[]).some((c) => c.startsWith(`txill_rt_${mob.body.user.id}=`))).toBe(true);

    // Sair apaga o cookie da conta e termina a sessão.
    const out = await request(app.getHttpServer()).post('/api/v1/auth/logout').set(web).set('X-Account', id).set('Cookie', rotated);
    expect((out.headers['set-cookie'] as unknown as string[]).some((c) => c.startsWith(`txill_rt_${id}=;`))).toBe(true);
    await request(app.getHttpServer()).post('/api/v1/auth/refresh').set(web).set('X-Account', id).set('Cookie', rotated).expect(401);
  });
});
