import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Pool } from 'pg';
import { loadConfig } from '../config';
import { migrate } from '../db/migrate';
import { createApp } from '../main';
import { staffLogin } from '../staff/staff-test';
import { totp } from '../staff/totp';

const DB = process.env.TEST_DATABASE_URL ?? 'postgres://txill:txill_dev@localhost:5433/txillapp_test';

interface U { token: string; id: string; username: string; email: string }

describe('Backoffice: contas, motivos, notas, auditoria e histórico de queixas (integração)', () => {
  let app: INestApplication;
  let pool: Pool;
  const run = Date.now().toString(36);
  let n = 0;
  const api = () => request(app.getHttpServer());
  const auth = (x: U) => ({ Authorization: `Bearer ${x.token}` });

  async function signup(name: string): Promise<U> {
    const username = `${name}${run}${n++}`.slice(0, 28);
    const email = `${username}@example.com`;
    const r = await api().post('/api/v1/auth/register').set('X-Forwarded-For', `10.8.0.${(n % 250) + 1}`).send({ email, username, displayName: `${name} Teste`, password: 'password-bem-longa-1', birthDate: '1990-06-15', acceptTerms: true }).expect(201);
    return { token: r.body.accessToken, id: r.body.user.id, username, email };
  }

  /** Conta de equipa já configurada, no formato de U (id = identidade interna, usada na auditoria). */
  async function mkStaff(name: string, teams: string[] = ['administracao']): Promise<U & { accountId: string }> {
    const st = await staffLogin(app, name, teams);
    const r = (await pool.query('SELECT u.id, u.username FROM identity.staff_accounts a JOIN identity.users u ON u.id = a.user_id WHERE a.id = $1', [st.accountId])).rows[0];
    return { token: st.token, id: r.id, username: r.username, email: st.email, accountId: st.accountId };
  }

  beforeAll(async () => {
    await migrate(DB);
    pool = new Pool({ connectionString: DB });
    app = await createApp(loadConfig({ DATABASE_URL: DB, JWT_ACCESS_SECRET: 'e'.repeat(40), NODE_ENV: 'test', MEDIA_DIR: './uploads-test' }));
    await app.init();
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  it('só a moderação entra; pesquisa por @ e email; ficha; confirmar email, suspender e reativar exigem motivo e ficam na auditoria', async () => {
    const admin = await mkStaff('boa');
    const user = await signup('bob');
    const peer = await signup('boc');

    // Quem não é da equipa (a sessão da rede social não vale) não entra.
    await api().get('/api/v1/admin/users').set(auth(user)).expect(401);
    await api().get('/api/v1/admin/overview').set(auth(user)).expect(401);

    // Resumo e pesquisa (por @ e por email).
    expect((await api().get('/api/v1/admin/overview').set(auth(admin)).expect(200)).body).toHaveProperty('reports_open');
    const byName = (await api().get('/api/v1/admin/users').query({ q: `@${user.username}` }).set(auth(admin)).expect(200)).body.items;
    expect(byName.map((x: { username: string }) => x.username)).toEqual([user.username]);
    const byEmail = (await api().get('/api/v1/admin/users').query({ q: user.email }).set(auth(admin)).expect(200)).body.items;
    expect(byEmail[0]).toMatchObject({ username: user.username, verified: false, status: 'active' });

    // Ficha.
    const sheet = (await api().get(`/api/v1/admin/users/${user.id}`).set(auth(admin)).expect(200)).body;
    expect(sheet.user).toMatchObject({ username: user.username, email: user.email, status: 'active', posts: 0 });

    // Confirmar email: sem motivo falha; com motivo funciona e fica registado.
    await api().post(`/api/v1/admin/users/${user.id}/verify-email`).set(auth(admin)).send({}).expect(400);
    await api().post(`/api/v1/admin/users/${user.id}/verify-email`).set(auth(admin)).send({ reason: 'o email do utilizador não recebe mensagens' }).expect(204);
    expect((await pool.query('SELECT email_verified_at IS NOT NULL AS v FROM identity.users WHERE id = $1', [user.id])).rows[0].v).toBe(true);

    // Suspender (com motivo), a conta perde as sessões; reativar.
    await api().post(`/api/v1/admin/users/${user.id}/suspend`).set(auth(admin)).send({ reason: 'abuso repetido' }).expect(204);
    expect((await pool.query('SELECT status FROM identity.users WHERE id = $1', [user.id])).rows[0].status).toBe('suspended');
    await api().post(`/api/v1/admin/users/${user.id}/suspend`).set(auth(admin)).send({ reason: 'outra vez' }).expect(400); // já suspensa
    await api().post(`/api/v1/admin/users/${user.id}/reactivate`).set(auth(admin)).send({ reason: 'foi um engano' }).expect(204);
    expect((await pool.query('SELECT status FROM identity.users WHERE id = $1', [user.id])).rows[0].status).toBe('active');
    // Uma conta de moderação não se suspende.
    await api().post(`/api/v1/admin/users/${admin.id}/suspend`).set(auth(admin)).send({ reason: 'teste' }).expect(403);

    // Notas internas.
    await api().post(`/api/v1/admin/users/${user.id}/notes`).set(auth(admin)).send({ body: 'Confirmei por telefone.' }).expect(204);
    const after = (await api().get(`/api/v1/admin/users/${user.id}`).set(auth(admin)).expect(200)).body;
    expect(after.notes[0]).toMatchObject({ body: 'Confirmei por telefone.', author: admin.username });
    expect(after.history.map((h: { action: string }) => h.action)).toEqual(expect.arrayContaining(['backoffice.verify_email', 'backoffice.suspend', 'backoffice.reactivate', 'backoffice.note']));

    // Auditoria com filtro por ação e por quem.
    const aud = (await api().get('/api/v1/admin/audit').query({ action: 'backoffice.', actor: admin.username }).set(auth(admin)).expect(200)).body.items;
    expect(aud.length).toBeGreaterThanOrEqual(4);
    expect(aud.every((a: { actor: string }) => a.actor === admin.username)).toBe(true);
    void peer;
  });

  it('queixas decididas ficam no histórico com quem decidiu e porquê', async () => {
    const admin = await mkStaff('bod');
    const bad = await signup('boe');
    const rep = await signup('bof');
    await pool.query('UPDATE identity.users SET email_verified_at = now() WHERE id IN ($1, $2)', [bad.id, rep.id]);
    const p = (await api().post('/api/v1/posts').set(auth(bad)).send({ body: 'conteúdo duvidoso', mediaIds: [] }).expect(201)).body;
    await api().post('/api/v1/reports').set(auth(rep)).send({ type: 'post', id: p.id, reason: 'spam' }).expect(204);
    await api().post('/api/v1/admin/reports/resolve').set(auth(admin)).send({ type: 'post', id: p.id, action: 'remove', note: 'spam claro' }).expect(204);
    const hist = (await api().get('/api/v1/admin/reports/decided').query({ status: 'actioned' }).set(auth(admin)).expect(200)).body.items;
    const mine = hist.find((h: { id: string }) => h.id === p.id);
    expect(mine).toMatchObject({ type: 'post', resolution: 'remove', note: 'spam claro', decidedBy: admin.username, owner: bad.username });
  });

  it('equipas: cada uma só pode o que lhe cabe; a Administração convida e gere; a senha só se define pela ligação, com dois passos', async () => {
    const boss = await mkStaff('bog');
    const sup = await mkStaff('boh', ['suporte']);
    const mod = await mkStaff('boi', ['moderacao', 'auditoria']);
    const target = await signup('boj');

    // Sessão da rede social nunca entra; a de equipa entra só no que a equipa pode.
    await api().get('/api/v1/admin/me').set(auth(target)).expect(401);
    const me = (await api().get('/api/v1/admin/me').set(auth(sup)).expect(200)).body;
    expect(me.teams).toEqual(['suporte']);
    expect(me.permissions).toEqual(expect.arrayContaining(['users.view', 'users.verify_email']));
    expect(me.permissions).not.toContain('users.suspend');

    await api().get(`/api/v1/admin/users/${target.id}`).set(auth(sup)).expect(200);
    await api().post(`/api/v1/admin/users/${target.id}/verify-email`).set(auth(sup)).send({ reason: 'sem receber email' }).expect(204);
    await api().post(`/api/v1/admin/users/${target.id}/suspend`).set(auth(sup)).send({ reason: 'não devia' }).expect(403);
    await api().get('/api/v1/admin/audit').set(auth(sup)).expect(403);
    await api().get('/api/v1/admin/staff').set(auth(sup)).expect(403);
    await api().get('/api/v1/admin/reports').set(auth(sup)).expect(403);

    await api().post(`/api/v1/admin/users/${target.id}/suspend`).set(auth(mod)).send({ reason: 'abuso' }).expect(204);
    await api().get('/api/v1/admin/audit').set(auth(mod)).expect(200);
    await api().get('/api/v1/admin/reports').set(auth(mod)).expect(200);
    await api().post(`/api/v1/admin/users/${target.id}/verify-email`).set(auth(mod)).send({ reason: 'não devia' }).expect(403);
    await api().post('/api/v1/admin/staff/invite').set(auth(mod)).send({ email: 'x@equipa.test', name: 'X', teams: ['suporte'] }).expect(403);

    // Convite: a ligação é de uso único; a senha é definida pela pessoa, com código dos dois passos.
    const email = `novo${run}@equipa.test`;
    const inv = (await api().post('/api/v1/admin/staff/invite').set(auth(boss)).send({ email, name: 'Pessoa Nova', teams: ['suporte'] }).expect(201)).body as { accountId: string; setupUrl: string };
    const token = new URL(inv.setupUrl).searchParams.get('token')!;
    await api().post('/api/v1/staff-auth/login').send({ email, password: 'qualquer-senha-longa-1', code: '123456' }).expect(401); // ainda sem senha
    const info = (await api().get('/api/v1/staff-auth/setup').query({ token }).expect(200)).body as { email: string; secret: string; otpauth: string };
    expect(info).toMatchObject({ email });
    expect(info.otpauth).toContain('otpauth://totp/');
    await api().post('/api/v1/staff-auth/setup').send({ token, password: 'curta', code: totp(info.secret) }).expect(400);
    await api().post('/api/v1/staff-auth/setup').send({ token, password: 'senha-bem-comprida-1', code: '000000' }).expect(400);
    const done = (await api().post('/api/v1/staff-auth/setup').send({ token, password: 'senha-bem-comprida-1', code: totp(info.secret) }).expect(200)).body as { token: string };
    await api().get('/api/v1/staff-auth/me').set({ Authorization: `Bearer ${done.token}` }).expect(200);
    await api().post('/api/v1/staff-auth/setup').send({ token, password: 'senha-bem-comprida-1', code: totp(info.secret) }).expect(404); // uso único

    // Login: senha e código certos entram; errados não.
    await api().post('/api/v1/staff-auth/login').send({ email, password: 'senha-errada-qualquer', code: totp(info.secret) }).expect(401);
    await api().post('/api/v1/staff-auth/login').send({ email, password: 'senha-bem-comprida-1', code: '000000' }).expect(401);
    const login = (await api().post('/api/v1/staff-auth/login').send({ email, password: 'senha-bem-comprida-1', code: totp(info.secret) }).expect(200)).body as { token: string };
    const novo = { Authorization: `Bearer ${login.token}` };
    expect((await api().get('/api/v1/admin/me').set(novo).expect(200)).body.teams).toEqual(['suporte']);
    // O token de equipa não serve como sessão da rede social.
    await api().get('/api/v1/users/me').set(novo).expect(401);

    // A Administração vê a equipa, muda equipas, repõe e desativa; o acesso retirado deixa de valer logo.
    const team = (await api().get('/api/v1/admin/staff').set(auth(boss)).expect(200)).body as { id: string; email: string; teams: string[] }[];
    expect(team.find((m) => m.email === email)?.teams).toEqual(['suporte']);
    expect(JSON.stringify(team)).not.toMatch(/password|secret|totp_/i);
    await api().post(`/api/v1/admin/staff/${inv.accountId}/teams`).set(auth(boss)).send({ teams: ['suporte', 'verificacao'], reason: 'passa também a verificar' }).expect(204);
    expect((await api().get('/api/v1/admin/me').set(novo).expect(200)).body.permissions).toContain('verification.decide');
    await api().post(`/api/v1/admin/staff/${inv.accountId}/teams`).set(auth(boss)).send({ teams: ['inventada'], reason: 'teste' }).expect(400);
    await api().post(`/api/v1/admin/staff/${inv.accountId}/reset`).set(auth(boss)).send({ reason: 'perdeu o telemóvel' }).expect(200);
    await api().get('/api/v1/admin/me').set(novo).expect(401); // sessões antigas caem
    await api().post(`/api/v1/admin/staff/${inv.accountId}/active`).set(auth(boss)).send({ active: false, reason: 'saiu da equipa' }).expect(204);
    await api().post('/api/v1/staff-auth/login').send({ email, password: 'senha-bem-comprida-1', code: totp(info.secret) }).expect(401);

    // Auditoria dos passos sensíveis e último administrador.
    expect((await pool.query("SELECT count(*)::int AS n FROM audit.audit_log WHERE action LIKE 'staff.%' AND target = $1", [`staff:${inv.accountId}`])).rows[0].n).toBeGreaterThanOrEqual(4);
    await pool.query('UPDATE identity.staff_accounts SET active = false WHERE id <> $1 AND user_id IN (SELECT id FROM identity.users WHERE is_admin)', [boss.accountId]);
    await api().post(`/api/v1/admin/staff/${boss.accountId}/teams`).set(auth(boss)).send({ teams: ['suporte'], reason: 'deixar a administração' }).expect(403);
    await api().post(`/api/v1/admin/staff/${boss.accountId}/active`).set(auth(boss)).send({ active: false, reason: 'sair' }).expect(403);
  });

  it('5 tentativas falhadas bloqueiam o login da equipa, mesmo com a senha e o código certos', async () => {
    const st = await staffLogin(app, 'bloq');
    for (let i = 0; i < 5; i++) await api().post('/api/v1/staff-auth/login').send({ email: st.email, password: 'senha-errada-qualquer', code: '000000' }).expect(401);
    await api().post('/api/v1/staff-auth/login').send({ email: st.email, password: st.password, code: totp(st.secret) }).expect(429);
  });
});
