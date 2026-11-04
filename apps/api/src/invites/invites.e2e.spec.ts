import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Pool } from 'pg';
import { loadConfig } from '../config';
import { migrate } from '../db/migrate';
import { createApp } from '../main';
import { InvitesService } from './invites.service';
import { INVITE } from './rules';

const DB = process.env.TEST_DATABASE_URL ?? 'postgres://txill:txill_dev@localhost:5433/txillapp_test';

interface U { token: string; id: string; username: string; email: string }

describe('Convites: código, limites, espera e abuso (integração)', () => {
  let app: INestApplication;
  let pool: Pool;
  let svc: InvitesService;
  const run = Date.now().toString(36);
  let n = 0;
  const api = () => request(app.getHttpServer());
  const auth = (x: U) => ({ Authorization: `Bearer ${x.token}` });

  async function signup(name: string, opts: { code?: string; email?: string; old?: boolean; verified?: boolean; ip?: string } = {}): Promise<U> {
    const username = `${name}${run}${n++}`.slice(0, 28);
    const email = opts.email ?? `${username}@example.com`;
    // Cada pessoa vem de um «IP» diferente (senão o limite de registos por minuto trava o teste), menos quando o teste quer a mesma rede.
    const ip = opts.ip ?? `10.7.${Math.floor(n / 250)}.${(n % 250) + 1}`;
    const r = await api().post('/api/v1/auth/register').set('X-Forwarded-For', ip).send({ email, username, displayName: `${name} Teste`, password: 'password-bem-longa-1', birthDate: '1990-06-15', acceptTerms: true, inviteCode: opts.code }).expect(201);
    const id = r.body.user.id as string;
    if (opts.verified !== false) await pool.query('UPDATE identity.users SET email_verified_at = now() WHERE id = $1', [id]);
    if (opts.old) await pool.query("UPDATE identity.users SET created_at = now() - interval '5 days' WHERE id = $1", [id]);
    return { token: r.body.accessToken, id, username, email };
  }
  const balance = async (x: U) => Number((await api().get('/api/v1/wallet').set(auth(x)).expect(200)).body.balance);
  const post = (x: U) => api().post('/api/v1/posts').set(auth(x)).send({ body: 'olá malta', mediaIds: [] }).expect(201);
  const status = async (x: U) => (await pool.query('SELECT status, reason FROM social.referrals WHERE invitee_id = $1', [x.id])).rows[0] as { status: string; reason: string | null } | undefined;
  const settle = () => pool.query("UPDATE social.referrals SET release_at = now() - interval '1 minute' WHERE status = 'qualified'");

  beforeAll(async () => {
    await migrate(DB);
    pool = new Pool({ connectionString: DB });
    app = await createApp(loadConfig({ DATABASE_URL: DB, JWT_ACCESS_SECRET: 'e'.repeat(40), NODE_ENV: 'test', MEDIA_DIR: './uploads-test' }));
    await app.init();
    svc = app.get(InvitesService);
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  it('o convidado só ganha quando fica ativo; quem convida só depois da espera; tudo uma só vez', async () => {
    const a = await signup('cva', { old: true });
    const me = (await api().get('/api/v1/invites/me').set(auth(a)).expect(200)).body;
    expect(me.code).toMatch(/^[A-Z2-9]{8}$/);
    expect(me.link).toContain(`/register?convite=${me.code}`);
    expect(me.rules).toMatchObject({ reward: INVITE.REWARD, perDay: 5, maxPaid: 50, holdDays: 7 });
    // O mesmo código outra vez.
    expect((await api().get('/api/v1/invites/me').set(auth(a)).expect(200)).body.code).toBe(me.code);
    // Pré-visualização pública.
    expect((await api().get(`/api/v1/invites/preview/${me.code}`).expect(200)).body.username).toBe(a.username);
    await api().get('/api/v1/invites/preview/NAOEXISTE').expect(404);

    const before = await balance(a);
    const b = await signup('cvb', { code: me.code });
    await new Promise((r) => setTimeout(r, 150));
    expect((await status(b))?.status).toBe('registered');
    // Ainda não fez nada: nada acontece.
    await svc.sweep();
    expect((await status(b))?.status).toBe('registered');
    const welcome = await balance(b);
    // Publica: fica ativa. Ganha na hora; o convite fica em espera.
    await post(b);
    await svc.sweep();
    expect(await balance(b)).toBe(welcome + INVITE.REWARD);
    expect((await status(b))?.status).toBe('qualified');
    expect(await balance(a)).toBe(before);
    // Depois da espera: quem convidou recebe, e só uma vez.
    await settle();
    await svc.sweep();
    expect(await balance(a)).toBe(before + INVITE.REWARD);
    expect((await status(b))?.status).toBe('paid');
    await svc.sweep(); // outra vez: nada muda
    expect(await balance(a)).toBe(before + INVITE.REWARD);
    const after = (await api().get('/api/v1/invites/me').set(auth(a)).expect(200)).body;
    expect(after.stats).toMatchObject({ invited: 1, paid: 1, earned: INVITE.REWARD });
  });

  it('sem email confirmado, ou com email temporário, ou com o código de si próprio: sem prémio', async () => {
    const a = await signup('cvc', { old: true });
    const code = (await api().get('/api/v1/invites/me').set(auth(a)).expect(200)).body.code as string;
    const nv = await signup('cvd', { code, verified: false });
    await post(nv).catch(() => undefined); // sem email confirmado nem sequer publica
    await new Promise((r) => setTimeout(r, 150));
    await svc.sweep();
    expect((await status(nv))?.status).toBe('registered'); // continua à espera
    const tmp = await signup('cve', { code, email: `x${run}${n}@mailinator.com` });
    await new Promise((r) => setTimeout(r, 150));
    expect(await status(tmp)).toMatchObject({ status: 'blocked', reason: 'email temporário' });
    // Código desconhecido: ignorado, o registo não falha.
    const x = await signup('cvf', { code: 'ZZZZZZZZ' });
    expect(await status(x)).toBeUndefined();
  });

  it('quem convida precisa de email confirmado e de mais de 3 dias; a mesma rede repetida deixa de ser premiada', async () => {
    const young = await signup('cvg');
    const code = (await api().get('/api/v1/invites/me').set(auth(young)).expect(200)).body;
    expect(code.eligible).toBe(false);
    expect(code.note).toContain('dias');
    const c = await signup('cvh', { code: code.code });
    await post(c);
    await new Promise((r) => setTimeout(r, 150));
    await svc.sweep();
    expect((await status(c))?.status).toBe('registered'); // quem convidou ainda é recente
    // Mesma rede: o 4.º registo em 24 h é marcado.
    const old = await signup('cvi', { old: true });
    const oc = (await api().get('/api/v1/invites/me').set(auth(old)).expect(200)).body.code as string;
    const rows: U[] = [];
    for (let i = 0; i < INVITE.SAME_NET_MAX + 1; i++) rows.push(await signup(`cvn${i}`, { code: oc, ip: `203.0.113.${run.length}` }));
    await new Promise((r) => setTimeout(r, 300));
    const statuses = await Promise.all(rows.map(status));
    expect(statuses.filter((s) => s?.reason === 'mesma rede').length).toBe(1);
  });

  it('limite por dia (5) e limite total (50): o convite funciona mas já sem prémio', async () => {
    const a = await signup('cvj', { old: true });
    const code = (await api().get('/api/v1/invites/me').set(auth(a)).expect(200)).body.code as string;
    // Cinco convidados já qualificados hoje (inseridos diretamente).
    for (let i = 0; i < INVITE.PER_DAY; i++) {
      const w = await signup(`cvw${i}`);
      await pool.query("INSERT INTO social.referrals (invitee_id, inviter_id, status, qualified_at, release_at) VALUES ($1, $2, 'qualified', now(), now() + interval '7 days')", [w.id, a.id]);
    }
    const late = await signup('cvk', { code });
    await post(late);
    await new Promise((r) => setTimeout(r, 150));
    await svc.sweep();
    expect((await status(late))?.status).toBe('registered'); // fica para amanhã
    // Passou o dia: já conta.
    await pool.query("UPDATE social.referrals SET qualified_at = now() - interval '2 days' WHERE inviter_id = $1 AND status = 'qualified'", [a.id]);
    await svc.sweep();
    expect((await status(late))?.status).toBe('qualified');
    // Teto total: com 50 já premiados, o seguinte fica sem prémio.
    const b = await signup('cvl', { old: true });
    const bcode = (await api().get('/api/v1/invites/me').set(auth(b)).expect(200)).body.code as string;
    await pool.query(
      `INSERT INTO social.referrals (invitee_id, inviter_id, status, amount, qualified_at, paid_at)
       SELECT u.id, $1, 'paid', 100, now() - interval '9 days', now() - interval '2 days' FROM identity.users u WHERE u.id <> $1 AND NOT EXISTS (SELECT 1 FROM social.referrals r WHERE r.invitee_id = u.id) ORDER BY u.created_at DESC LIMIT $2`,
      [b.id, INVITE.MAX_PAID],
    );
    const over = await signup('cvm', { code: bcode });
    await post(over);
    await new Promise((r) => setTimeout(r, 150));
    await svc.sweep();
    expect(await status(over)).toMatchObject({ status: 'blocked', reason: 'limite total' });
  });
});
