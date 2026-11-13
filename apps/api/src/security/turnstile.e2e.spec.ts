import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { getStorageToken } from '@nestjs/throttler';
import request from 'supertest';
import { Pool } from 'pg';
import { loadConfig } from '../config';
import { migrate } from '../db/migrate';
import { createApp } from '../main';
import { LOGIN } from './rules';

const DB = process.env.TEST_DATABASE_URL ?? 'postgres://txill:txill_dev@localhost:5433/txillapp_test';
const PASSWORD = 'password-bem-longa-1';
const WEB = { 'X-Client': 'txillapp-web', 'X-Requested-With': 'txillapp' };
const MOBILE = { 'X-Client': 'txillapp-mobile', 'X-Requested-With': 'txillapp', 'X-App-Version': '1.46.0', 'X-App-Platform': 'android' };

/**
 * As chaves de teste oficiais da Cloudflare (developers.cloudflare.com/turnstile/troubleshooting/testing):
 *   secreta 1x0000000000000000000000000000000AA → passa sempre;
 *   secreta 2x0000000000000000000000000000000AA → falha sempre;
 *   o widget de teste (chave do site 1x00000000000000000000AA) dá o código «XXXX.DUMMY.TOKEN.XXXX».
 * Estes testes falam com a Cloudflare a sério. Sem internet (ou com SKIP_NETWORK_TESTS) ficam por correr.
 */
const PASS = '1x0000000000000000000000000000000AA';
const FAIL = '2x0000000000000000000000000000000AA';
const DUMMY = 'XXXX.DUMMY.TOKEN.XXXX';

async function cloudflareUp(): Promise<boolean> {
  if (process.env.SKIP_NETWORK_TESTS) return false;
  try {
    const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: new URLSearchParams({ secret: PASS, response: DUMMY }), signal: AbortSignal.timeout(5000) });
    return ((await r.json()) as { success?: boolean }).success === true;
  } catch {
    return false;
  }
}

describe('prova de humano (Cloudflare Turnstile) no registo, no login e no «Esqueci-me da senha»', () => {
  let pool: Pool;
  const apps: INestApplication[] = [];
  const run = Date.now().toString(36);
  const base = Math.floor(Math.random() * 0xe000) + 0x1000;
  let seq = 0;
  const freshIp = () => `2001:db8:${((base + ++seq) % 0xffff).toString(16)}::1`;
  let online = false;

  async function mkApp(env: Record<string, string>) {
    const app = await createApp(loadConfig({ DATABASE_URL: DB, JWT_ACCESS_SECRET: 't'.repeat(40), NODE_ENV: 'test', MEDIA_DIR: './uploads-test', ...env }));
    await app.init();
    apps.push(app);
    return app;
  }
  const reg = (app: INestApplication, headers: Record<string, string>, token?: string) => {
    const username = `ts${run}${++seq}`;
    const r = request(app.getHttpServer()).post('/api/v1/auth/register').set(headers).set('X-Forwarded-For', freshIp());
    if (token) r.set('X-Turnstile-Token', token);
    return r.send({ email: `${username}@example.com`, username, displayName: 'Ts Teste', password: PASSWORD, birthDate: '1990-06-15', acceptTerms: true });
  };
  const resetThrottle = (app: INestApplication) => {
    const s = app.get(getStorageToken()) as { storage: Map<string, unknown>; hitExpirations?: Map<string, unknown> };
    s.storage.clear();
    s.hitExpirations?.clear();
  };

  beforeAll(async () => {
    await migrate(DB);
    pool = new Pool({ connectionString: DB });
    online = await cloudflareUp();
    if (!online) console.warn('Cloudflare inacessível: os testes com as chaves de teste reais ficam por correr.');
  }, 60_000);

  afterAll(async () => {
    for (const a of apps) await a.close();
    await pool.end();
  });

  it('sem chave: desligada (o /auth/config diz humanCheck: false e o registo no browser passa sem código)', async () => {
    const app = await mkApp({});
    expect((await request(app.getHttpServer()).get('/api/v1/auth/config').expect(200)).body).toMatchObject({ humanCheck: false, turnstileSiteKey: null });
    await reg(app, WEB).expect(201);
    await request(app.getHttpServer()).post('/api/v1/auth/password/forgot').set(WEB).send({ email: 'a@b.co' }).expect(200);
  });

  it('a Cloudflare não responde: deixa passar (um problema do lado deles não tranca ninguém) e fica registado', async () => {
    const app = await mkApp({ TURNSTILE_SECRET: PASS, TURNSTILE_VERIFY_URL: 'http://127.0.0.1:9/siteverify' });
    const r = await reg(app, WEB, DUMMY).expect(201);
    await new Promise((res) => setTimeout(res, 150));
    expect((await pool.query("SELECT 1 FROM security.events WHERE kind = 'human_unavailable' AND created_at > now() - interval '1 minute'")).rowCount).toBeGreaterThanOrEqual(1);
    // Sem código no browser, recusa na mesma (não chega a perguntar à Cloudflare).
    expect((await reg(app, WEB).expect(403)).body.code).toBe('human_check');
    expect(r.body.user.id).toEqual(expect.any(String));
  });

  it('chave de teste que passa: o browser tem de mandar o código; a app nativa antiga entra sem ele, com mais pontos de risco', async () => {
    if (!online) return;
    const app = await mkApp({ TURNSTILE_SECRET: PASS, TURNSTILE_SITEKEY: '1x00000000000000000000AA' });
    const api = () => request(app.getHttpServer());
    // A app que não trouxe a chave do site da compilação recebe-a aqui (é pública).
    expect((await api().get('/api/v1/auth/config').expect(200)).body).toMatchObject({ humanCheck: true, turnstileSiteKey: '1x00000000000000000000AA' });
    // Registo: browser sem código → 403; com o código do widget de teste → 201 (e a conta leva o bónus de «humano»).
    expect((await reg(app, WEB).expect(403)).body).toMatchObject({ code: 'human_check' });
    const ok = await reg(app, WEB, DUMMY).expect(201);
    expect((await pool.query('SELECT human FROM security.account_risk WHERE user_id = $1', [ok.body.user.id])).rows[0].human).toBe(true);
    // App nativa sem código (versões antigas): entra, mas com o sinal «sem prova».
    const old = await reg(app, MOBILE).expect(201);
    const r = (await pool.query('SELECT human, signals FROM security.account_risk WHERE user_id = $1', [old.body.user.id])).rows[0];
    expect(r.human).toBe(false);
    expect(r.signals.sem_prova).toBe(10);
    // «Esqueci-me da senha» no browser: sem código → 403; com código → a resposta de sempre.
    await api().post('/api/v1/auth/password/forgot').set(WEB).send({ email: 'a@b.co' }).expect(403);
    expect((await api().post('/api/v1/auth/password/forgot').set(WEB).set('X-Turnstile-Token', DUMMY).send({ email: 'a@b.co' }).expect(200)).body).toEqual({ ok: true });
    // Login: as primeiras tentativas não pedem nada; depois de N falhas, o browser tem de provar que é uma pessoa.
    const user = ok.body.user.username as string;
    const ip = freshIp();
    const login = (password: string, token?: string) => {
      const q = api().post('/api/v1/auth/login').set(WEB).set('X-Forwarded-For', ip);
      if (token) q.set('X-Turnstile-Token', token);
      return q.send({ identifier: user, password });
    };
    for (let i = 0; i < LOGIN.ACCOUNT_HUMAN_AFTER; i++) await login('errada-errada-1').expect(401);
    expect((await login(PASSWORD).expect(403)).body.code).toBe('human_check');
    resetThrottle(app);
    await login(PASSWORD, DUMMY).expect(200);
  });

  it('chave de teste que falha: com código ou sem ele, o browser fica de fora, e cada falha fica nos eventos', async () => {
    if (!online) return;
    const app = await mkApp({ TURNSTILE_SECRET: FAIL });
    const r = await reg(app, WEB, DUMMY).expect(403);
    expect(r.body).toMatchObject({ code: 'human_check', message: 'Não conseguimos confirmar que és uma pessoa. Tenta outra vez.' });
    await new Promise((res) => setTimeout(res, 150));
    expect((await pool.query("SELECT 1 FROM security.events WHERE kind = 'human_failed' AND created_at > now() - interval '1 minute'")).rowCount).toBeGreaterThanOrEqual(1);
    // A app nativa que manda um código errado também fica de fora (só a falta do código é tolerada).
    await reg(app, MOBILE, DUMMY).expect(403);
  });
});
