import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Pool } from 'pg';
import { loadConfig } from '../config';
import { migrate } from '../db/migrate';
import { createApp } from '../main';

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
    const admin = await signup('boa');
    const user = await signup('bob');
    const peer = await signup('boc');
    await pool.query('UPDATE identity.users SET is_admin = true WHERE id = $1', [admin.id]);

    // Quem não é da moderação não entra.
    await api().get('/api/v1/admin/users').set(auth(user)).expect(403);
    await api().get('/api/v1/admin/overview').set(auth(user)).expect(403);

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
    const admin = await signup('bod');
    const bad = await signup('boe');
    const rep = await signup('bof');
    await pool.query('UPDATE identity.users SET is_admin = true, email_verified_at = now() WHERE id = $1', [admin.id]);
    await pool.query('UPDATE identity.users SET email_verified_at = now() WHERE id IN ($1, $2)', [bad.id, rep.id]);
    const p = (await api().post('/api/v1/posts').set(auth(bad)).send({ body: 'conteúdo duvidoso', mediaIds: [] }).expect(201)).body;
    await api().post('/api/v1/reports').set(auth(rep)).send({ type: 'post', id: p.id, reason: 'spam' }).expect(204);
    await api().post('/api/v1/admin/reports/resolve').set(auth(admin)).send({ type: 'post', id: p.id, action: 'remove', note: 'spam claro' }).expect(204);
    const hist = (await api().get('/api/v1/admin/reports/decided').query({ status: 'actioned' }).set(auth(admin)).expect(200)).body.items;
    const mine = hist.find((h: { id: string }) => h.id === p.id);
    expect(mine).toMatchObject({ type: 'post', resolution: 'remove', note: 'spam claro', decidedBy: admin.username, owner: bad.username });
  });

  it('equipas: cada uma só pode o que lhe cabe; a Administração gere a equipa e nunca fica sem ninguém', async () => {
    const boss = await signup('bog');
    const sup = await signup('boh');
    const mod = await signup('boi');
    const target = await signup('boj');
    await pool.query('UPDATE identity.users SET is_admin = true WHERE id = $1', [boss.id]);

    // Quem não é da equipa não entra; depois de entrar numa equipa, sim.
    await api().get('/api/v1/admin/me').set(auth(sup)).expect(403);
    await api().post('/api/v1/admin/staff').set(auth(boss)).send({ username: sup.username, teams: ['suporte'], reason: 'nova pessoa no suporte' }).expect(204);
    await api().post('/api/v1/admin/staff').set(auth(boss)).send({ username: mod.username, teams: ['moderacao', 'auditoria'], reason: 'moderadora e auditora' }).expect(204);
    const me = (await api().get('/api/v1/admin/me').set(auth(sup)).expect(200)).body;
    expect(me.teams).toEqual(['suporte']);
    expect(me.permissions).toEqual(expect.arrayContaining(['users.view', 'users.verify_email']));
    expect(me.permissions).not.toContain('users.suspend');

    // Suporte: vê contas e confirma email, mas não suspende, não vê a auditoria nem gere a equipa.
    await api().get(`/api/v1/admin/users/${target.id}`).set(auth(sup)).expect(200);
    await api().post(`/api/v1/admin/users/${target.id}/verify-email`).set(auth(sup)).send({ reason: 'sem receber email' }).expect(204);
    await api().post(`/api/v1/admin/users/${target.id}/suspend`).set(auth(sup)).send({ reason: 'não devia' }).expect(403);
    await api().get('/api/v1/admin/audit').set(auth(sup)).expect(403);
    await api().get('/api/v1/admin/staff').set(auth(sup)).expect(403);
    await api().get('/api/v1/admin/reports/decided').set(auth(sup)).expect(403);
    await api().get('/api/v1/admin/reports').set(auth(sup)).expect(403);

    // Moderação + Auditoria: suspende, vê a auditoria e as queixas, não gere a equipa nem confirma emails.
    await api().post(`/api/v1/admin/users/${target.id}/suspend`).set(auth(mod)).send({ reason: 'abuso' }).expect(204);
    await api().get('/api/v1/admin/audit').set(auth(mod)).expect(200);
    await api().get('/api/v1/admin/reports').set(auth(mod)).expect(200);
    await api().post(`/api/v1/admin/users/${target.id}/verify-email`).set(auth(mod)).send({ reason: 'não devia' }).expect(403);
    await api().post('/api/v1/admin/staff').set(auth(mod)).send({ username: target.username, teams: ['suporte'], reason: 'tentativa' }).expect(403);

    // A Administração vê a equipa, muda equipas, e o acesso retirado deixa de valer.
    const team = (await api().get('/api/v1/admin/staff').set(auth(boss)).expect(200)).body as { username: string; teams: string[] }[];
    expect(team.find((m) => m.username === mod.username)?.teams.sort()).toEqual(['auditoria', 'moderacao']);
    await api().post('/api/v1/admin/staff').set(auth(boss)).send({ username: sup.username, teams: ['suporte', 'verificacao'], reason: 'passa também a verificar' }).expect(204);
    expect((await api().get('/api/v1/admin/me').set(auth(sup)).expect(200)).body.permissions).toContain('verification.decide');
    await api().post(`/api/v1/admin/staff/${mod.id}/remove`).set(auth(boss)).send({ reason: 'saiu da equipa' }).expect(204);
    await api().get('/api/v1/admin/me').set(auth(mod)).expect(403);

    // Equipa desconhecida e último administrador.
    await api().post('/api/v1/admin/staff').set(auth(boss)).send({ username: sup.username, teams: ['inventada'], reason: 'teste' }).expect(400);
    await pool.query("UPDATE identity.users SET is_admin = false WHERE is_admin AND id <> $1", [boss.id]); // só resta o boss
    await api().post('/api/v1/admin/staff').set(auth(boss)).send({ username: boss.username, teams: ['suporte'], reason: 'deixar a administração' }).expect(403);
    await api().post(`/api/v1/admin/staff/${boss.id}/remove`).set(auth(boss)).send({ reason: 'sair' }).expect(403);
  });
});
