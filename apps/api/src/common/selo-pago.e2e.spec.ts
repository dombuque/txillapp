import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Pool } from 'pg';
import { loadConfig } from '../config';
import { migrate } from '../db/migrate';
import { createApp } from '../main';
import { staffLogin } from '../staff/staff-test';
import { tierOf } from './badge';

/**
 * As cores do selo: 'verified' (mérito ou pedido aceite) e 'official' (conta oficial) a vermelho, 'paid' (verificação paga)
 * a azul. Aqui: a base aceita o 'paid' (migração 0126), a API deixa-o passar em todo o lado (sessão, perfil, posts) e o
 * backoffice dá, muda e tira o selo, com a escolha do nível, tudo na auditoria.
 */
const DB = process.env.TEST_DATABASE_URL ?? 'postgres://txill:txill_dev@localhost:5433/txillapp_test';
const PASSWORD = 'password-bem-longa-1';

interface U { token: string; id: string; username: string }

describe('selo pago (azul) e os níveis do selo', () => {
  let app: INestApplication;
  let pool: Pool;
  const run = Date.now().toString(36);
  const api = () => request(app.getHttpServer());
  const auth = (x: U) => ({ Authorization: `Bearer ${x.token}` });
  let staff = { token: '', userId: '' };
  const sauth = () => ({ Authorization: `Bearer ${staff.token}` });
  let verifier = { token: '', userId: '' };
  let viewer = { token: '', userId: '' };

  async function signup(name: string): Promise<U> {
    const username = `${name}${run}`.slice(0, 28);
    const r = await api().post('/api/v1/auth/register').send({ email: `${username}@example.com`, username, displayName: `${name} Teste`, password: PASSWORD, birthDate: '1990-06-15', acceptTerms: true }).expect(201);
    return { token: r.body.accessToken, id: r.body.user.id, username };
  }
  const setTier = (x: U, tier: string | null) => pool.query('UPDATE identity.users SET verified = $2, verified_tier = $3 WHERE id = $1', [x.id, tier !== null, tier]);

  beforeAll(async () => {
    await migrate(DB);
    pool = new Pool({ connectionString: DB });
    app = await createApp(loadConfig({ DATABASE_URL: DB, JWT_ACCESS_SECRET: 'd'.repeat(40), NODE_ENV: 'test', MEDIA_DIR: './uploads-test' }));
    await app.init();
    staff = await staffLogin(app, 'selopago');
    verifier = await staffLogin(app, 'selover', ['verificacao']);
    viewer = await staffLogin(app, 'selovis', ['suporte']);
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  it('a base aceita os três níveis (verified, official, paid) e recusa outro', async () => {
    const u = await signup('selock');
    for (const t of ['verified', 'official', 'paid']) await setTier(u, t);
    await expect(setTier(u, 'gold')).rejects.toThrow(/verified_tier_check/);
    const c = (await pool.query(`SELECT pg_get_constraintdef(oid) AS d FROM pg_constraint WHERE conrelid = 'identity.users'::regclass AND conname = 'users_verified_tier_check'`)).rows;
    expect(c).toHaveLength(1);
    expect(c[0].d).toMatch(/'paid'/);
  });

  it('tierOf: o nível de uma conta verificada (sem nível, o verified de sempre); null se não é verificada', () => {
    expect(tierOf(true, 'paid')).toBe('paid');
    expect(tierOf(true, 'official')).toBe('official');
    expect(tierOf(true, 'verified')).toBe('verified');
    expect(tierOf(true, null)).toBe('verified');
    expect(tierOf(true, 'gold')).toBe('verified');
    expect(tierOf(false, 'paid')).toBeNull();
    expect(tierOf(null, null)).toBeNull();
  });

  it("uma conta 'paid' sai com verifiedTier 'paid' no /auth/me, no login, no perfil e nos posts", async () => {
    const p = await signup('selopg');
    const other = await signup('selopo');
    await setTier(p, 'paid');
    const me = (await api().get('/api/v1/auth/me').set(auth(p)).expect(200)).body;
    expect(me).toMatchObject({ id: p.id, verified: true, verifiedTier: 'paid' });
    const login = (await api().post('/api/v1/auth/login').send({ identifier: p.username, password: PASSWORD }).expect(200)).body;
    expect(login.user).toMatchObject({ verified: true, verifiedTier: 'paid' });

    const profile = (await api().get(`/api/v1/users/${p.username}`).set(auth(other)).expect(200)).body;
    expect(profile).toMatchObject({ verified: true, verifiedTier: 'paid' });

    const post = (await api().post('/api/v1/posts').set(auth(p)).send({ body: 'selo azul' }).expect(201)).body;
    const one = (await api().get(`/api/v1/posts/${post.id}`).set(auth(other)).expect(200)).body;
    expect(one.author).toMatchObject({ username: p.username, verified: true, verifiedTier: 'paid' });
    const list = (await api().get(`/api/v1/users/${p.username}/posts`).set(auth(other)).expect(200)).body;
    const items = (Array.isArray(list) ? list : list.items) as { id: string; author: { verifiedTier: string | null } }[];
    expect(items.find((x) => x.id === post.id)?.author).toMatchObject({ verified: true, verifiedTier: 'paid' });

    // Os outros níveis continuam como estavam.
    await setTier(p, 'verified');
    expect((await api().get('/api/v1/auth/me').set(auth(p)).expect(200)).body).toMatchObject({ verified: true, verifiedTier: 'verified' });
    await setTier(p, null);
    expect((await api().get('/api/v1/auth/me').set(auth(p)).expect(200)).body).toMatchObject({ verified: false, verifiedTier: null });
  });

  it('backoffice: dá, muda e tira o selo com o nível escolhido, e cada passo fica na auditoria', async () => {
    const u = await signup('selobo');
    const path = `/api/v1/admin/users/${u.id}/badge`;
    // Sem sessão da equipa, ou sem motivo, ou com um nível que não existe: não.
    await api().post(path).set(auth(u)).send({ tier: 'paid', reason: 'teste do selo' }).expect(401);
    await api().post(path).set(sauth()).send({ tier: 'paid' }).expect(400);
    await api().post(path).set(sauth()).send({ tier: 'gold', reason: 'teste do selo' }).expect(400);

    // Dar o azul (verificação paga).
    expect((await api().post(path).set(sauth()).send({ tier: 'paid', reason: 'subscrição de teste' }).expect(200)).body).toEqual({ verified: true, verifiedTier: 'paid' });
    expect((await api().get('/api/v1/auth/me').set(auth(u)).expect(200)).body).toMatchObject({ verified: true, verifiedTier: 'paid' });
    const sheet = (await api().get(`/api/v1/admin/users/${u.id}`).set(sauth()).expect(200)).body;
    expect(sheet.user.badge).toBe('paid');
    // O mesmo nível outra vez: nada a mudar.
    await api().post(path).set(sauth()).send({ tier: 'paid', reason: 'outra vez' }).expect(400);

    // Quem decide os pedidos de selo também pode; passar a vermelho (verificado por mérito).
    await api().post(path).set({ Authorization: `Bearer ${verifier.token}` }).send({ tier: 'verified', reason: 'mérito' }).expect(200);
    expect((await api().get('/api/v1/auth/me').set(auth(u)).expect(200)).body).toMatchObject({ verified: true, verifiedTier: 'verified' });

    // Tirar o selo.
    await api().post(path).set(sauth()).send({ tier: null, reason: 'fim do teste' }).expect(200);
    expect((await api().get('/api/v1/auth/me').set(auth(u)).expect(200)).body).toMatchObject({ verified: false, verifiedTier: null });
    const row = (await pool.query('SELECT verified, verified_tier, verified_at FROM identity.users WHERE id = $1', [u.id])).rows[0];
    expect(row).toEqual({ verified: false, verified_tier: null, verified_at: null });
    await api().post(path).set(sauth()).send({ tier: null, reason: 'outra vez' }).expect(400);

    // A auditoria: os três passos, com quem fez, o antes, o depois e o motivo; e aparecem no Histórico da ficha.
    const log = (await pool.query(`SELECT actor_id, action, metadata FROM audit.audit_log WHERE target = $1 AND action LIKE 'verification.%' ORDER BY created_at, id`, [`user:${u.id}`])).rows;
    expect(log).toEqual([
      { actor_id: staff.userId, action: 'verification.set_tier', metadata: { from: null, to: 'paid', reason: 'subscrição de teste' } },
      { actor_id: verifier.userId, action: 'verification.set_tier', metadata: { from: 'paid', to: 'verified', reason: 'mérito' } },
      { actor_id: staff.userId, action: 'verification.remove', metadata: { from: 'verified', to: null, reason: 'fim do teste' } },
    ]);
    const history = (await api().get(`/api/v1/admin/users/${u.id}`).set(sauth()).expect(200)).body.history as { action: string }[];
    expect(history.map((h) => h.action).filter((a) => a.startsWith('verification.'))).toEqual(['verification.remove', 'verification.set_tier', 'verification.set_tier']);
  });

  it('backoffice: sem a permissão de decidir os selos, não se mexe no selo', async () => {
    const u = await signup('selonp');
    const perms = (await api().get('/api/v1/admin/me').set({ Authorization: `Bearer ${viewer.token}` }).expect(200)).body.permissions as string[];
    expect(perms).not.toContain('verification.decide');
    await api().post(`/api/v1/admin/users/${u.id}/badge`).set({ Authorization: `Bearer ${viewer.token}` }).send({ tier: 'paid', reason: 'sem permissão' }).expect(403);
  });

  it('pedido de selo: aprovar com o nível escolhido (paid incluído) e fica na auditoria', async () => {
    const u = await signup('selorq');
    const id = (await pool.query(
      `INSERT INTO identity.verification_requests (id, user_id, kind, full_name, proof) VALUES (gen_random_uuid(), $1, 'person', 'Nome Completo', 'Uma justificação com mais de trinta letras para o pedido') RETURNING id`,
      [u.id],
    )).rows[0].id as string;
    await api().post(`/api/v1/admin/verifications/${id}/decide`).set(sauth()).send({ action: 'approve', tier: 'gold' }).expect(400);
    await api().post(`/api/v1/admin/verifications/${id}/decide`).set(sauth()).send({ action: 'approve', tier: 'paid' }).expect(204);
    expect((await api().get('/api/v1/auth/me').set(auth(u)).expect(200)).body).toMatchObject({ verified: true, verifiedTier: 'paid' });
    const log = (await pool.query(`SELECT action, metadata FROM audit.audit_log WHERE target = $1 AND action LIKE 'verification.%'`, [`user:${u.id}`])).rows;
    expect(log).toEqual([{ action: 'verification.approve', metadata: { request: id, tier: 'paid' } }]);
  });
});
