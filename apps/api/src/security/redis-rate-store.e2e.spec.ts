import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import Redis from 'ioredis';
import { Pool } from 'pg';
import request from 'supertest';
import { loadConfig } from '../config';
import { migrate } from '../db/migrate';
import { createApp } from '../main';
import { REDIS } from '../realtime/redis';
import { PgRateStore, RATE_STORE } from './rate-store';
import { RedisRateStore } from './redis-rate-store';
import { LOGIN } from './rules';
import { SecurityService } from './security.service';

const DB = process.env.TEST_DATABASE_URL ?? 'postgres://txill:txill_dev@localhost:5433/txillapp_test';
const URL = process.env.TEST_REDIS_URL;
const PASSWORD = 'password-bem-longa-1';
const MOBILE = { 'X-Client': 'txillapp-mobile', 'X-Requested-With': 'txillapp', 'X-App-Version': '1.46.0', 'X-App-Platform': 'android', 'User-Agent': 'okhttp/4.12.0' };

/**
 * Os travões da segurança com REDIS_URL (docs/escala.md): os contadores e os bloqueios vivem no Redis, iguais nas duas
 * instâncias, sem escrever em security.counters; e sem Redis (ou com ele em baixo) tudo continua no PostgreSQL.
 * Só corre com TEST_REDIS_URL (ex.: redis://localhost:6380 com `docker run -d --rm --name t-redis2 -p 6380:6379 redis:7-alpine`).
 */
(URL ? describe : describe.skip)('segurança das contas com o Redis (integração)', () => {
  let A: INestApplication;
  let B: INestApplication;
  let pool: Pool;
  let redis: Redis;
  const run = Date.now().toString(36);
  const base = Math.floor(Math.random() * 0xe000) + 0x1000;
  let seq = 0;
  const freshIp = () => `2001:db8:${((base + ++seq) % 0xffff).toString(16)}::1`;
  const env = () => loadConfig({ DATABASE_URL: DB, JWT_ACCESS_SECRET: 'q'.repeat(40), NODE_ENV: 'test', MEDIA_DIR: './uploads-test', MAIL_CAPTURE: 'true', REDIS_URL: URL!, ROLE: 'web' });
  const login = (app: INestApplication, identifier: string, password: string, ip: string) =>
    request(app.getHttpServer()).post('/api/v1/auth/login').set(MOBILE).set('X-Forwarded-For', ip).send({ identifier, password });

  beforeAll(async () => {
    await migrate(DB);
    pool = new Pool({ connectionString: DB });
    redis = new Redis(URL!, { maxRetriesPerRequest: 1 });
    A = await createApp(env());
    await A.init();
    B = await createApp(env());
    await B.init();
  }, 60_000);

  afterAll(async () => {
    await A.close();
    await B.close();
    await redis.quit();
    await pool.end();
  });

  it('com REDIS_URL o store é o do Redis e usa a ligação da escala (sem abrir outra)', () => {
    const store = A.get(RATE_STORE);
    expect(store).toBeInstanceOf(RedisRateStore);
    expect((store as unknown as { redis: Redis }).redis).toBe(A.get(REDIS));
  });

  it('força bruta repartida pelas duas instâncias: o bloqueio é o mesmo nas duas, fica no Redis e não na base de dados', async () => {
    const username = `rr${run}`.slice(0, 28);
    const reg = await request(A.getHttpServer()).post('/api/v1/auth/register').set(MOBILE).set('X-Forwarded-For', freshIp())
      .send({ email: `${username}@example.com`, username, displayName: 'Rr Teste', password: PASSWORD, birthDate: '1990-06-15', acceptTerms: true })
      .expect(201);
    const id = reg.body.user.id as string;
    const ip = freshIp();
    // As falhas alternam entre as instâncias, como atrás do nginx.
    for (let i = 1; i <= LOGIN.ACCOUNT_LOCK_AFTER; i++) await login(i % 2 ? A : B, username, `errada-errada-${i}`, ip).expect(401);
    const a = await login(A, username, PASSWORD, ip).expect(429);
    const b = await login(B, username, PASSWORD, freshIp()).expect(429);
    expect(a.body.code).toBe('login_locked');
    expect(b.body.code).toBe('login_locked');

    const sec = A.get(SecurityService);
    const keys = [`login:acct:${id}`, `login:id:${sec.print('login', username)}`];
    expect(Number(await redis.get(`sec:l:${keys[0]}`))).toBeGreaterThan(Date.now());
    expect(await redis.get(`sec:s:${keys[1]}`)).toBe('1');
    expect((await pool.query('SELECT 1 FROM security.counters WHERE key = ANY($1)', [keys])).rowCount).toBe(0);
    expect((await pool.query('SELECT 1 FROM security.locks WHERE key = ANY($1)', [keys])).rowCount).toBe(0);

    // Recuperar a senha desbloqueia (apaga no Redis e na reserva).
    await sec.unlockAccount(id, [username]);
    expect(await redis.exists(`sec:l:${keys[0]}`, `sec:l:${keys[1]}`, `sec:s:${keys[1]}`)).toBe(0);
    await login(B, username, PASSWORD, ip).expect(200);
  });

  it('com o Redis em baixo: os bloqueios ficam no PostgreSQL e o login responde na mesma', async () => {
    const dead = new Redis('redis://127.0.0.1:1', { lazyConnect: true, maxRetriesPerRequest: 0, enableOfflineQueue: false, retryStrategy: () => null });
    dead.on('error', () => undefined);
    const pg = new PgRateStore(pool);
    const s = new RedisRateStore(dead, pg);
    const k = `test:redis-down:${run}`;
    expect(await s.hit(k, 60_000)).toBe(1);
    const l = await s.lock(k, 60_000, 60_000);
    expect((await pool.query('SELECT strikes FROM security.locks WHERE key = $1', [k])).rows[0].strikes).toBe(1);
    expect((await s.lockedUntil(k))?.getTime()).toBe(l.until.getTime());
    // E o store a sério (com o Redis de pé) também respeita esse bloqueio, até ao reset.
    const live = A.get(RATE_STORE) as RedisRateStore;
    expect((await live.lockedUntil(k))?.getTime()).toBe(l.until.getTime());
    await live.reset(k);
    expect(await live.lockedUntil(k)).toBeNull();
    dead.disconnect();
  });
});
