import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from 'jose';
import { Pool } from 'pg';
import request from 'supertest';
import { loadConfig } from '../config';
import { migrate } from '../db/migrate';
import { createApp } from '../main';

const DB = process.env.TEST_DATABASE_URL ?? 'postgres://txill:txill_dev@localhost:5433/txillapp_test';
const CLIENT_ID = 'teste-1234567890.apps.googleusercontent.com';
const base = { DATABASE_URL: DB, JWT_ACCESS_SECRET: 'g'.repeat(40), NODE_ENV: 'test' as const };

describe('login com Google e validação do @/email em tempo real (integração)', () => {
  let app: INestApplication;
  let off: INestApplication;
  let pool: Pool;
  let signGoogle: (claims: Record<string, unknown>, opts?: { aud?: string; iss?: string; exp?: string; wrongKey?: boolean }) => Promise<string>;
  const run = Date.now().toString(36);
  const api = () => request(app.getHttpServer());

  beforeAll(async () => {
    await migrate(DB);
    pool = new Pool({ connectionString: DB });
    // Par de chaves local a fingir ser a Google (nunca se chama a Google nos testes).
    const good = await generateKeyPair('RS256');
    const other = await generateKeyPair('RS256');
    const jwk = { ...(await exportJWK(good.publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
    signGoogle = (claims, o = {}) =>
      new SignJWT({ email_verified: true, ...claims })
        .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
        .setIssuer(o.iss ?? 'https://accounts.google.com')
        .setAudience(o.aud ?? CLIENT_ID)
        .setIssuedAt()
        .setExpirationTime(o.exp ?? '1h')
        .sign(o.wrongKey ? other.privateKey : good.privateKey);
    app = await createApp(loadConfig({ ...base, GOOGLE_CLIENT_ID: CLIENT_ID }), { googleJwks: createLocalJWKSet({ keys: [jwk] }) });
    await app.init();
    off = await createApp(loadConfig(base));
    await off.init();
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await off.close();
    await pool.end();
  });

  it('expõe o ID de cliente da Google (público) e fica desligado sem ele', async () => {
    expect((await api().get('/api/v1/auth/config').expect(200)).body.googleClientId).toBe(CLIENT_ID);
    expect((await request(off.getHttpServer()).get('/api/v1/auth/config').expect(200)).body.googleClientId).toBeNull();
    await request(off.getHttpServer()).post('/api/v1/auth/google').send({ idToken: 'x'.repeat(40) }).expect(503);
  });

  it('valida o @ na hora: inválido, reservado, ocupado (com sugestões livres) e livre', async () => {
    const name = `ocupado${run}`.slice(0, 20);
    await api()
      .post('/api/v1/auth/register')
      .send({ email: `${name}@example.com`, username: name, displayName: 'Ocupado', password: 'password-bem-longa-1' })
      .expect(201);
    const check = (u: string) => api().get(`/api/v1/auth/username-available?username=${encodeURIComponent(u)}`).expect(200);

    expect((await check('ab')).body).toEqual({ available: false, reason: 'invalid' });
    expect((await check('com espaço')).body.reason).toBe('invalid');
    expect((await check('Admin')).body.reason).toBe('reserved');
    expect((await check('tx.illapp')).body.reason).toBe('reserved'); // pontos/underscores não contornam a reserva

    const taken = (await check(name.toUpperCase())).body; // insensível a maiúsculas
    expect(taken).toMatchObject({ available: false, reason: 'taken' });
    expect(taken.suggestions.length).toBeGreaterThan(0);
    for (const s of taken.suggestions) expect((await check(s)).body.available).toBe(true); // sugestões realmente livres

    expect((await check(`@livre_${run}`.slice(0, 20))).body).toEqual({ available: true });
  });

  it('valida o email na hora e o registo recusa nomes reservados', async () => {
    const check = (e: string) => api().get(`/api/v1/auth/email-available?email=${encodeURIComponent(e)}`).expect(200);
    expect((await check('isto-nao-e-email')).body).toEqual({ available: false, reason: 'invalid' });
    expect((await check(`livre${run}@example.com`)).body).toEqual({ available: true });
    const name = `ocupado${run}`.slice(0, 20);
    expect((await check(`${name}@example.com`.toUpperCase())).body).toEqual({ available: false, reason: 'taken' });
    await api()
      .post('/api/v1/auth/register')
      .send({ email: `res${run}@example.com`, username: `administrador${run}`.slice(0, 30), displayName: 'X', password: 'password-bem-longa-1' })
      .expect(201); // "administrador" não é reservado…
    await api()
      .post('/api/v1/auth/register')
      .send({ email: `res2${run}@example.com`, username: 'admin', displayName: 'X', password: 'password-bem-longa-1' })
      .expect(409); // …mas "admin" é
  });

  it('Google: conta nova escolhe o @, depois entra directamente; o token de registo nunca serve de sessão', async () => {
    const sub = `g-${run}-1`;
    const email = `google${run}@example.com`;
    const idToken = await signGoogle({ sub, email, name: 'Maria Google' });

    const first = (await api().post('/api/v1/auth/google').send({ idToken }).expect(200)).body;
    expect(first.needsUsername).toBe(true);
    expect(first.displayName).toBe('Maria Google');
    expect((await api().get(`/api/v1/auth/username-available?username=${first.suggestedUsername}`)).body.available).toBe(true);

    // O token de registo não é um access token.
    await api().get('/api/v1/auth/me').set('Authorization', `Bearer ${first.signupToken}`).expect(401);

    const done = (u: string) => api().post('/api/v1/auth/google/complete').send({ signupToken: first.signupToken, username: u });
    await done('admin').expect(409);
    await done('x').expect(409);
    const taken = `ocupado${run}`.slice(0, 20);
    await done(taken).expect(409);
    const username = `maria_${run}`.slice(0, 20);
    const created = await done(`@${username}`).expect(200);
    expect(created.body.user).toMatchObject({ username, displayName: 'Maria Google' });
    expect((created.headers['set-cookie'] as unknown as string[])[0]).toMatch(/txill_rt=.*HttpOnly/);
    await api().get('/api/v1/auth/me').set('Authorization', `Bearer ${created.body.accessToken}`).expect(200);

    // Segunda vez: entra directamente na mesma conta.
    const again = await api().post('/api/v1/auth/google').send({ idToken: await signGoogle({ sub, email, name: 'Maria G.' }) }).expect(200);
    expect(again.body.user.id).toBe(created.body.user.id);
    expect(again.body.accessToken).toEqual(expect.any(String));

    // Conta só-Google não entra com senha.
    await api().post('/api/v1/auth/login').send({ identifier: email, password: 'qualquer-coisa-123' }).expect(401);
    const row = await pool.query('SELECT google_sub FROM identity.users WHERE username = $1', [username]);
    expect(row.rows[0].google_sub).toBe(sub);
  });

  it('Google: não se liga a uma conta existente com o mesmo email (evita tomada de conta)', async () => {
    const name = `ocupado${run}`.slice(0, 20);
    const idToken = await signGoogle({ sub: `g-${run}-2`, email: `${name}@example.com`, name: 'Intruso' });
    await api().post('/api/v1/auth/google').send({ idToken }).expect(409);
  });

  it('Google: rejeita tokens inválidos (audiência, emissor, expirado, chave errada, email por verificar, lixo)', async () => {
    const ok = { sub: `g-${run}-3`, email: `x${run}@example.com`, name: 'X' };
    const bad = [
      await signGoogle(ok, { aud: 'outra-app.apps.googleusercontent.com' }),
      await signGoogle(ok, { iss: 'https://evil.example.com' }),
      await signGoogle(ok, { exp: '-1m' }),
      await signGoogle(ok, { wrongKey: true }),
      await signGoogle({ ...ok, email_verified: false }),
      'x'.repeat(50),
    ];
    for (const idToken of bad) await api().post('/api/v1/auth/google').send({ idToken }).expect(401);
  });
});
