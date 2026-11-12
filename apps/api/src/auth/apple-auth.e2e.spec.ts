import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from 'jose';
import { Pool } from 'pg';
import request from 'supertest';
import { loadConfig } from '../config';
import { migrate } from '../db/migrate';
import { createApp } from '../main';

const DB = process.env.TEST_DATABASE_URL ?? 'postgres://txill:txill_dev@localhost:5433/txillapp_test';
const BUNDLE = 'com.txillapp.app';
const base = { DATABASE_URL: DB, JWT_ACCESS_SECRET: 'g'.repeat(40), NODE_ENV: 'test' as const };

describe('Iniciar sessão com a Apple (integração)', () => {
  let app: INestApplication;
  let off: INestApplication;
  let pool: Pool;
  let sign: (claims: Record<string, unknown>, opts?: { aud?: string; iss?: string; wrongKey?: boolean }) => Promise<string>;
  const run = Date.now().toString(36);
  const api = () => request(app.getHttpServer());

  beforeAll(async () => {
    await migrate(DB);
    pool = new Pool({ connectionString: DB });
    // Chaves locais a fingir ser a Apple (nunca se chama a Apple nos testes).
    const good = await generateKeyPair('RS256');
    const other = await generateKeyPair('RS256');
    const jwk = { ...(await exportJWK(good.publicKey)), kid: 'ak1', alg: 'RS256', use: 'sig' };
    sign = (claims, o = {}) =>
      new SignJWT({ email_verified: 'true', ...claims })
        .setProtectedHeader({ alg: 'RS256', kid: 'ak1' })
        .setIssuer(o.iss ?? 'https://appleid.apple.com')
        .setAudience(o.aud ?? BUNDLE)
        .setIssuedAt()
        .setExpirationTime('1h')
        .sign(o.wrongKey ? other.privateKey : good.privateKey);
    app = await createApp(loadConfig({ ...base, APPLE_CLIENT_ID: BUNDLE }), { appleJwks: createLocalJWKSet({ keys: [jwk] }) });
    await app.init();
    off = await createApp(loadConfig(base));
    await off.init();
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await off.close();
    await pool.end();
  });

  it('fica desligado sem configuração e ligado com ela', async () => {
    expect((await api().get('/api/v1/auth/config').expect(200)).body.appleEnabled).toBe(true);
    expect((await request(off.getHttpServer()).get('/api/v1/auth/config').expect(200)).body.appleEnabled).toBe(false);
    await request(off.getHttpServer()).post('/api/v1/auth/apple').send({ identityToken: 'x'.repeat(40) }).expect(503);
  });

  it('conta nova: escolhe o @, entra; da segunda vez entra direto; pede o nome só na primeira', async () => {
    const sub = `apple-${run}-1`;
    const email = `apple${run}@example.com`;
    const token = await sign({ sub, email });
    const first = (await api().post('/api/v1/auth/apple').send({ identityToken: token, fullName: 'Maria Apple' }).expect(200)).body;
    expect(first).toMatchObject({ needsUsername: true, displayName: 'Maria Apple' });
    expect(first.signupToken).toBeTruthy();

    const username = `ap${run}`.slice(0, 24);
    const done = (await api().post('/api/v1/auth/apple/complete').send({ signupToken: first.signupToken, username, gender: 'unspecified', birthDate: '1990-06-15', acceptTerms: true }).expect(200)).body;
    expect(done.user).toMatchObject({ username, displayName: 'Maria Apple' });
    expect(done.accessToken).toBeTruthy();
    const row = (await pool.query('SELECT apple_sub, email_verified_at FROM identity.users WHERE username = $1', [username])).rows[0];
    expect(row.apple_sub).toBe(sub);
    expect(row.email_verified_at).not.toBeNull(); // email verificado pela Apple

    const again = (await api().post('/api/v1/auth/apple').send({ identityToken: await sign({ sub, email }) }).expect(200)).body;
    expect(again.user.username).toBe(username);
    expect(again.accessToken).toBeTruthy();
  });

  it('email escondido (reencaminhamento privado): a conta nasce por confirmar', async () => {
    const sub = `apple-${run}-2`;
    const first = (await api().post('/api/v1/auth/apple').send({ identityToken: await sign({ sub, email: `x${run}@privaterelay.appleid.com`, is_private_email: 'true' }) }).expect(200)).body;
    const username = `pr${run}`.slice(0, 24);
    await api().post('/api/v1/auth/apple/complete').send({ signupToken: first.signupToken, username, birthDate: '1990-06-15', acceptTerms: true }).expect(200);
    expect((await pool.query('SELECT email_verified_at FROM identity.users WHERE username = $1', [username])).rows[0].email_verified_at).toBeNull();
  });

  it('recusa: destinatário errado, emissor errado, assinatura falsa, nonce que não bate, email que já tem conta', async () => {
    const sub = `apple-${run}-3`;
    for (const bad of [await sign({ sub }, { aud: 'com.outra.app' }), await sign({ sub }, { iss: 'https://evil.example.com' }), await sign({ sub }, { wrongKey: true })]) {
      await api().post('/api/v1/auth/apple').send({ identityToken: bad }).expect(401);
    }
    // Nonce: aceita o próprio ou o SHA-256 dele; recusa outro.
    const nonce = `nonce-${run}`;
    await api().post('/api/v1/auth/apple').send({ identityToken: await sign({ sub, nonce: createHash('sha256').update(nonce).digest('hex') }), nonce }).expect(200);
    await api().post('/api/v1/auth/apple').send({ identityToken: await sign({ sub, nonce: 'outro' }), nonce }).expect(401);

    // Já existe uma conta com este email: não se liga sozinha.
    const name = `ex${run}`.slice(0, 20);
    await api().post('/api/v1/auth/register').send({ email: `${name}@example.com`, username: name, displayName: 'Existente', password: 'password-bem-longa-1', birthDate: '1990-06-15', acceptTerms: true }).expect(201);
    await api().post('/api/v1/auth/apple').send({ identityToken: await sign({ sub: `apple-${run}-4`, email: `${name}@example.com` }) }).expect(409);
  });
});
