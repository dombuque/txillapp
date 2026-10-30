import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Pool } from 'pg';
import { loadConfig } from '../config';
import { migrate } from '../db/migrate';
import { createApp } from '../main';
import { MailService } from './mail.service';

const DB = process.env.TEST_DATABASE_URL ?? 'postgres://txill:txill_dev@localhost:5433/txillapp_test';
const PASSWORD = 'password-bem-longa-1';

describe('e-mail: confirmar conta e recuperar senha (integração)', () => {
  let app: INestApplication;
  let pool: Pool;
  let mail: MailService;
  const run = Date.now().toString(36);
  const api = () => request(app.getHttpServer());
  const tokenIn = (text: string) => decodeURIComponent(/token=([^\s"&]+)/.exec(text)![1]);

  async function signup(name: string) {
    const username = `${name}${run}`.slice(0, 28);
    const email = `${username}@example.com`;
    const r = await api()
      .post('/api/v1/auth/register')
      .send({ email, username, displayName: `Pessoa ${username}`, password: PASSWORD, birthDate: '1990-06-15', gender: 'unspecified', acceptTerms: true })
      .expect(201);
    return { token: r.body.accessToken as string, id: r.body.user.id as string, username, email, auth: { Authorization: `Bearer ${r.body.accessToken}` } };
  }
  /** O envio do registo é feito em segundo plano: espera até aparecer na caixa de saída. */
  const mailTo = async (email: string, n = 1) => {
    for (let i = 0; i < 50; i++) {
      const found = mail.outbox.filter((m) => m.to === email);
      if (found.length >= n) return found[n - 1];
      await new Promise((r) => setTimeout(r, 40));
    }
    throw new Error(`sem e-mail para ${email}`);
  };

  beforeAll(async () => {
    await migrate(DB);
    pool = new Pool({ connectionString: DB });
    app = await createApp(loadConfig({ DATABASE_URL: DB, JWT_ACCESS_SECRET: 'm'.repeat(40), NODE_ENV: 'test', MEDIA_DIR: './uploads-test', MAIL_CAPTURE: 'true', PUBLIC_URL: 'https://txillapp.com' }));
    await app.init();
    mail = app.get(MailService);
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  it('conta nova recebe o e-mail de confirmação e só publica depois de o confirmar', async () => {
    const u = await signup('conf');
    const m = await mailTo(u.email);
    expect(m.subject).toBe('Confirma o teu e-mail');
    expect(m.text).toContain('https://txillapp.com/verify-email?token=');
    expect(m.html).toContain('icon-192.png');

    expect((await api().get('/api/v1/auth/email/status').set(u.auth).expect(200)).body).toEqual({ required: true, verified: false });
    // Ver a app continua a funcionar; publicar e comentar não.
    await api().get('/api/v1/feed').set(u.auth).expect(200);
    const blocked = await api().post('/api/v1/posts').set(u.auth).send({ body: 'Olá' }).expect(403);
    expect(blocked.body.code).toBe('email_not_verified');

    const token = tokenIn(m.text);
    await api().post('/api/v1/auth/email/verify').send({ token }).expect(200);
    await api().post('/api/v1/posts').set(u.auth).send({ body: 'Já confirmei' }).expect(201);
    expect((await api().get('/api/v1/auth/email/status').set(u.auth).expect(200)).body.verified).toBe(true);
    // O link só funciona uma vez.
    await api().post('/api/v1/auth/email/verify').send({ token }).expect(400);
  });

  it('reenviar cria um link novo e o anterior deixa de valer', async () => {
    const u = await signup('resend');
    const first = tokenIn((await mailTo(u.email, 1)).text);
    await api().post('/api/v1/auth/email/resend').set(u.auth).expect(200);
    const second = tokenIn((await mailTo(u.email, 2)).text);
    expect(second).not.toBe(first);
    await api().post('/api/v1/auth/email/verify').send({ token: first }).expect(400);
    await api().post('/api/v1/auth/email/verify').send({ token: second }).expect(200);
    // Já confirmada: não reenvia.
    expect((await api().post('/api/v1/auth/email/resend').set(u.auth).expect(200)).body).toEqual({ sent: false });
  });

  it('um código inventado ou expirado não confirma nada', async () => {
    await api().post('/api/v1/auth/email/verify').send({ token: 'x'.repeat(43) }).expect(400);
    const u = await signup('exp');
    const token = tokenIn((await mailTo(u.email)).text);
    await pool.query("UPDATE identity.email_tokens SET expires_at = now() - interval '1 minute' WHERE user_id = $1", [u.id]);
    await api().post('/api/v1/auth/email/verify').send({ token }).expect(400);
  });

  it('recuperar a senha: não revela quem existe, o link serve uma vez e termina as sessões', async () => {
    const u = await signup('reset');
    await mailTo(u.email); // e-mail de confirmação do registo
    const before = mail.outbox.length;
    // E-mail que não existe: mesma resposta e nada enviado.
    expect((await api().post('/api/v1/auth/password/forgot').send({ email: `ninguem${run}@example.com` }).expect(200)).body).toEqual({ ok: true });
    expect(mail.outbox.length).toBe(before);

    await api().post('/api/v1/auth/password/forgot').send({ email: u.email.toUpperCase() }).expect(200);
    const m = await mailTo(u.email, 2);
    expect(m.subject).toBe('Define uma senha nova');
    const token = tokenIn(m.text);

    await api().post('/api/v1/auth/password/reset').send({ token, newPassword: 'curta' }).expect(400); // senha fraca: o link continua válido
    await api().post('/api/v1/auth/password/reset').send({ token, newPassword: 'outra-senha-bem-longa-9' }).expect(200);
    await api().post('/api/v1/auth/password/reset').send({ token, newPassword: 'mais-uma-senha-bem-longa-9' }).expect(400);

    await api().post('/api/v1/auth/login').send({ identifier: u.username, password: PASSWORD }).expect(401);
    await api().post('/api/v1/auth/login').send({ identifier: u.username, password: 'outra-senha-bem-longa-9' }).expect(200);
    // O access token antigo ainda vale até expirar (10 min), mas a sessão de renovação foi revogada.
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM identity.sessions WHERE user_id = $1 AND revoked_at IS NULL', [u.id]);
    expect(rows[0].n).toBe(1); // só a do login novo
  });
});
