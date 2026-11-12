import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Pool } from 'pg';
import { loadConfig } from '../config';
import { migrate } from '../db/migrate';
import { createApp } from '../main';
import { MailService } from '../mail/mail.service';

const DB = process.env.TEST_DATABASE_URL ?? 'postgres://txill:txill_dev@localhost:5433/txillapp_test';
const PASSWORD = 'password-bem-longa-1';

/** Página pública txillapp.com/apagar-conta (exigida pela Google Play): pedir o apagamento sem sessão, com confirmação por email. */
describe('apagar a conta sem sessão, pela ligação do email (integração)', () => {
  let app: INestApplication;
  let pool: Pool;
  let mail: MailService;
  const run = Date.now().toString(36);
  const api = () => request(app.getHttpServer());
  const tokenIn = (text: string) => decodeURIComponent(/apagar-conta\?token=([^\s"&]+)/.exec(text)![1]);

  async function signup(name: string) {
    const username = `${name}${run}`.slice(0, 28);
    const email = `${username}@example.com`;
    const r = await api()
      .post('/api/v1/auth/register')
      .send({ email, username, displayName: `Pessoa ${username}`, password: PASSWORD, birthDate: '1990-06-15', gender: 'unspecified', acceptTerms: true })
      .expect(201);
    return { id: r.body.user.id as string, username, email, auth: { Authorization: `Bearer ${r.body.accessToken}` } };
  }
  const deletionMail = async (email: string) => {
    for (let i = 0; i < 50; i++) {
      const found = mail.outbox.filter((m) => m.to === email && m.subject.includes('apagar a conta'));
      if (found.length) return found[found.length - 1];
      await new Promise((r) => setTimeout(r, 40));
    }
    throw new Error(`sem e-mail de apagar para ${email}`);
  };

  beforeAll(async () => {
    await migrate(DB);
    pool = new Pool({ connectionString: DB });
    app = await createApp(loadConfig({ DATABASE_URL: DB, JWT_ACCESS_SECRET: 'z'.repeat(40), NODE_ENV: 'test', MEDIA_DIR: './uploads-test', MAIL_CAPTURE: 'true', PUBLIC_URL: 'https://txillapp.com' }));
    await app.init();
    mail = app.get(MailService);
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  it('o pedido só manda uma ligação; a conta só é apagada quando se confirma na página', async () => {
    const u = await signup('apw');
    await api().post('/api/v1/posts').set(u.auth).send({ body: 'O meu post #segredo' }).expect((r) => expect([201, 403]).toContain(r.status));

    const r = await api().post('/api/v1/auth/delete-account/request').send({ email: u.email.toUpperCase() }).expect(200);
    expect(r.body).toEqual({ ok: true, mail: true });
    const m = await deletionMail(u.email);
    expect(m.text).toContain('https://txillapp.com/apagar-conta?token=');
    // Pedir não apaga nada.
    expect((await pool.query('SELECT status FROM identity.users WHERE id = $1', [u.id])).rows[0].status).toBe('active');

    const token = tokenIn(m.text);
    // A ligação não serve de sessão.
    await api().get('/api/v1/auth/me').set({ Authorization: `Bearer ${token}` }).expect(401);
    expect((await api().post('/api/v1/auth/delete-account/preview').send({ token }).expect(200)).body).toEqual({ username: u.username, displayName: `Pessoa ${u.username}` });
    expect((await pool.query('SELECT status FROM identity.users WHERE id = $1', [u.id])).rows[0].status).toBe('active');

    await api().post('/api/v1/auth/delete-account/confirm').send({ token }).expect(204);
    const row = (await pool.query('SELECT status, email, username, city, country FROM identity.users WHERE id = $1', [u.id])).rows[0];
    expect(row.status).toBe('deleted');
    expect(row.email).not.toBe(u.email);
    expect(row.username).not.toBe(u.username);
    expect((await pool.query('SELECT count(*)::int AS n FROM identity.sessions WHERE user_id = $1', [u.id])).rows[0].n).toBe(0);
    expect((await pool.query("SELECT count(*)::int AS n FROM content.posts WHERE author_id = $1 AND body <> ''", [u.id])).rows[0].n).toBe(0);
    expect((await pool.query('SELECT action FROM audit.audit_log WHERE actor_id = $1 ORDER BY id DESC LIMIT 1', [u.id])).rows[0].action).toBe('account.deleted_by_email_link');
    // A sessão que havia deixa de valer, e a ligação só serve uma vez.
    await api().get('/api/v1/auth/me').set(u.auth).expect(401);
    await api().post('/api/v1/auth/delete-account/confirm').send({ token }).expect(400);
    await api().post('/api/v1/auth/delete-account/preview').send({ token }).expect(400);
  });

  it('responde igual para um email sem conta, e recusa ligações falsas ou de outro tipo', async () => {
    const before = mail.outbox.length;
    expect((await api().post('/api/v1/auth/delete-account/request').send({ email: `ninguem${run}@example.com` }).expect(200)).body).toEqual({ ok: true, mail: true });
    expect((await api().post('/api/v1/auth/delete-account/request').send({ email: 'isto-nao-e-email' }).expect(200)).body).toEqual({ ok: true, mail: true });
    expect(mail.outbox.length).toBe(before);

    const u = await signup('apx');
    await api().post('/api/v1/auth/delete-account/confirm').send({ token: 'x'.repeat(40) }).expect(400);
    // Um token de sessão (outro "audience") não apaga a conta.
    const access = u.auth.Authorization.slice(7);
    await api().post('/api/v1/auth/delete-account/confirm').send({ token: access }).expect(400);
    expect((await pool.query('SELECT status FROM identity.users WHERE id = $1', [u.id])).rows[0].status).toBe('active');
  });

  it('a ligação deixa de valer se a conta já foi apagada na app', async () => {
    const u = await signup('apy');
    await api().post('/api/v1/auth/delete-account/request').send({ email: u.email }).expect(200);
    const token = tokenIn((await deletionMail(u.email)).text);
    await api().post('/api/v1/auth/delete-account').set(u.auth).send({ confirmUsername: u.username, password: PASSWORD }).expect(204);
    await api().post('/api/v1/auth/delete-account/confirm').send({ token }).expect(400);
  });
});
