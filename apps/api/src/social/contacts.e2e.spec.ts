import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { createHash } from 'node:crypto';
import request from 'supertest';
import { Pool } from 'pg';
import { loadConfig } from '../config';
import { migrate } from '../db/migrate';
import { createApp } from '../main';

const DB = process.env.TEST_DATABASE_URL ?? 'postgres://txill:txill_dev@localhost:5433/txillapp_test';
const PASSWORD = 'password-bem-longa-1';
const sha = (e: string) => createHash('sha256').update(e.trim().toLowerCase()).digest('hex');

interface U { token: string; id: string; username: string; email: string }

describe('amigos nos contactos: só resumos de emails, com privacidade (integração)', () => {
  let app: INestApplication;
  let pool: Pool;
  const run = Date.now().toString(36);
  const api = () => request(app.getHttpServer());
  const auth = (x: U) => ({ Authorization: `Bearer ${x.token}` });
  const u: Record<string, U> = {};

  async function signup(name: string): Promise<U> {
    const username = `${name}${run}`.slice(0, 28);
    const email = `${username}@example.com`;
    const r = await api().post('/api/v1/auth/register').send({ email, username, displayName: `${name} Teste`, password: PASSWORD, birthDate: '1990-06-15', acceptTerms: true }).expect(201);
    return { token: r.body.accessToken, id: r.body.user.id, username, email };
  }
  const match = (x: U, emails: string[]) => api().post('/api/v1/contacts/match').set(auth(x)).send({ hashes: emails.map(sha) });

  beforeAll(async () => {
    await migrate(DB);
    pool = new Pool({ connectionString: DB });
    app = await createApp(loadConfig({ DATABASE_URL: DB, JWT_ACCESS_SECRET: 'd'.repeat(40), NODE_ENV: 'test', MEDIA_DIR: './uploads-test' }));
    await app.init();
    for (const n of ['cta', 'ctb', 'ctc', 'ctd']) u[n] = await signup(n);
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  it('encontra quem tem conta com esse email (maiúsculas e espaços não contam), e mais ninguém', async () => {
    const { cta, ctb, ctc } = u;
    const r = (await match(cta, [`  ${ctb.email.toUpperCase()} `, 'ninguem-com-isto@example.com']).expect(200)).body as { username: string; reason: string }[];
    expect(r.map((x) => x.username)).toEqual([ctb.username]);
    expect(r[0].reason).toBe('Está nos teus contactos');
    expect(JSON.stringify(r)).not.toContain(ctb.email); // nunca devolve o email
    expect((await match(cta, [cta.email]).expect(200)).body).toEqual([]); // nem a própria pessoa
    expect((await match(cta, [ctb.email, ctc.email]).expect(200)).body).toHaveLength(2);
  });

  it('respeita a privacidade: quem desliga não é encontrado; quem já sigo ou bloqueei não vem; entradas inválidas são recusadas', async () => {
    const { cta, ctb, ctc, ctd } = u;
    await api().patch('/api/v1/settings/privacy').set(auth(ctb)).send({ findByContacts: false }).expect(200);
    expect((await match(cta, [ctb.email]).expect(200)).body).toEqual([]);
    await api().patch('/api/v1/settings/privacy').set(auth(ctb)).send({ findByContacts: true }).expect(200);
    expect(((await match(cta, [ctb.email]).expect(200)).body as unknown[]).length).toBe(1);

    await api().post(`/api/v1/users/${ctc.username}/follow`).set(auth(cta)).expect(200);
    expect((await match(cta, [ctc.email]).expect(200)).body).toEqual([]); // já segue
    await api().put(`/api/v1/blocks/${ctd.username}`).set(auth(cta)).expect(200);
    expect((await match(cta, [ctd.email]).expect(200)).body).toEqual([]); // bloqueado
    expect((await match(ctd, [cta.email]).expect(200)).body).toEqual([]); // e o inverso

    await api().post('/api/v1/contacts/match').set(auth(cta)).send({ hashes: ['isto-nao-e-um-hash'] }).expect(400);
    await api().post('/api/v1/contacts/match').send({ hashes: [] }).expect(401);
    expect((await api().get('/api/v1/settings/privacy').set(auth(ctb)).expect(200)).body.findByContacts).toBe(true);
  });
});
