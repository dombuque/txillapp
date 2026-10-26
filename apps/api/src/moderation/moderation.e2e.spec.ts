import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Pool } from 'pg';
import { loadConfig } from '../config';
import { migrate } from '../db/migrate';
import { createApp } from '../main';
import { MediaService } from '../media/media.service';

const DB = process.env.TEST_DATABASE_URL ?? 'postgres://txill:txill_dev@localhost:5433/txillapp_test';
const PASSWORD = 'password-bem-longa-1';

interface U { token: string; id: string; username: string }

describe('denúncias, moderação e apagar publicações (integração)', () => {
  let app: INestApplication;
  let pool: Pool;
  const run = Date.now().toString(36);
  const api = () => request(app.getHttpServer());
  const auth = (x: U) => ({ Authorization: `Bearer ${x.token}` });
  const u: Record<string, U> = {};

  async function signup(name: string): Promise<U> {
    const username = `${name}${run}`.slice(0, 28);
    const r = await api().post('/api/v1/auth/register').send({ email: `${username}@example.com`, username, displayName: `${name} Teste`, password: PASSWORD, birthDate: '1990-06-15', acceptTerms: true }).expect(201);
    return { token: r.body.accessToken, id: r.body.user.id, username };
  }
  const post = async (a: U, body: string) => (await api().post('/api/v1/posts').set(auth(a)).send({ body }).expect(201)).body;
  const report = (x: U, type: string, id: string, reason = 'spam') => api().post('/api/v1/reports').set(auth(x)).send({ type, id, reason });
  const queue = async (x: U) => (await api().get('/api/v1/admin/reports').set(auth(x)).expect(200)).body as { type: string; id: string; reports: number; reasons: string[]; owner: { username: string } }[];

  beforeAll(async () => {
    await migrate(DB);
    pool = new Pool({ connectionString: DB });
    app = await createApp(loadConfig({ DATABASE_URL: DB, JWT_ACCESS_SECRET: 'd'.repeat(40), NODE_ENV: 'test', MEDIA_DIR: './uploads-test' }));
    await app.init();
    for (const n of ['ra', 'rb', 'rc', 'rd']) u[n] = await signup(n);
    await pool.query('UPDATE identity.users SET is_admin = true WHERE id = $1', [u.ra.id]);
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  it('apagar a própria publicação: some para todos; só o dono apaga; os reposts dela também somem', async () => {
    const { rb, rc } = u;
    const p = await post(rb, 'para apagar');
    const rp = (await api().post(`/api/v1/posts/${p.id}/repost`).set(auth(rc)).send({}).expect(201)).body;
    await api().delete(`/api/v1/posts/${p.id}`).set(auth(rc)).expect(404); // não é dela
    await api().delete(`/api/v1/posts/${p.id}`).set(auth(rb)).expect(204);
    await api().get(`/api/v1/posts/${p.id}`).set(auth(rc)).expect(404);
    await api().get(`/api/v1/posts/${rp.id}`).set(auth(rc)).expect(404); // o repost do apagado também some
    await api().post(`/api/v1/posts/${p.id}/comments`).set(auth(rc)).send({ body: 'oi' }).expect(404); // nem se comenta
    await api().delete(`/api/v1/posts/${p.id}`).set(auth(rb)).expect(404); // já apagado
  });

  it('denunciar: só o que posso ver, não o meu, sem duplicar; a fila é só da moderação', async () => {
    const { ra, rb, rc, rd } = u;
    const p = await post(rb, 'conteúdo duvidoso');
    await report(rb, 'post', p.id).expect(400); // o próprio conteúdo
    await report(rc, 'post', '00000000-0000-7000-8000-000000000000').expect(404);
    await report(rc, 'post', p.id, 'invalida').expect(400);
    await report(rc, 'post', p.id, 'harassment').expect(204);
    await report(rc, 'post', p.id, 'harassment').expect(204); // repetir não duplica
    await report(rd, 'post', p.id, 'spam').expect(204);

    await api().get('/api/v1/admin/reports').set(auth(rc)).expect(403); // não é moderação
    const q = (await queue(ra)).find((x) => x.id === p.id)!;
    expect(q).toMatchObject({ type: 'post', reports: 2, owner: { username: rb.username } });
    expect(q.reasons.sort()).toEqual(['harassment', 'spam']);

    await api().post('/api/v1/admin/reports/resolve').set(auth(rc)).send({ type: 'post', id: p.id, action: 'remove' }).expect(403);
    await api().post('/api/v1/admin/reports/resolve').set(auth(ra)).send({ type: 'post', id: p.id, action: 'remove' }).expect(204);
    await api().get(`/api/v1/posts/${p.id}`).set(auth(rd)).expect(404); // removido
    expect((await queue(ra)).some((x) => x.id === p.id)).toBe(false); // a fila fechou
    const log = await pool.query(`SELECT action FROM audit.audit_log WHERE actor_id = $1 AND target = $2`, [ra.id, `post:${p.id}`]);
    expect(log.rows.map((r) => r.action)).toEqual(['moderation.remove']);
  });

  it('suspender a conta do dono: perde as sessões e não entra mais; contas de moderação são intocáveis', async () => {
    const { ra, rb, rc } = u;
    const p = await post(rb, 'segundo conteúdo duvidoso');
    await report(rc, 'post', p.id, 'scam').expect(204);
    await api().post('/api/v1/admin/reports/resolve').set(auth(ra)).send({ type: 'post', id: p.id, action: 'suspend' }).expect(204);
    await api().post('/api/v1/auth/login').send({ identifier: rb.username, password: PASSWORD }).expect(401);
    const row = (await pool.query('SELECT status FROM identity.users WHERE id = $1', [rb.id])).rows[0];
    expect(row.status).toBe('suspended');

    const pa = await post(ra, 'conteúdo da moderação');
    await report(rc, 'post', pa.id, 'spam').expect(204);
    await api().post('/api/v1/admin/reports/resolve').set(auth(ra)).send({ type: 'post', id: pa.id, action: 'suspend' }).expect(403);
    await api().post('/api/v1/admin/reports/resolve').set(auth(ra)).send({ type: 'post', id: pa.id, action: 'dismiss' }).expect(204);
    await api().get(`/api/v1/posts/${pa.id}`).set(auth(rc)).expect(200); // ignorada: continua visível
  });

  it('descarregar os meus dados: JSON só meu, sem senha; eliminar conta apaga conversas e ficheiros', async () => {
    const { rc, rd } = u;
    const mine = await post(rc, 'um post meu');
    await api().post(`/api/v1/chat/with/${rd.username}`).set(auth(rc)).send({ body: 'olá rd' }).expect(201);
    await api().post(`/api/v1/chat/with/${rc.username}`).set(auth(rd)).send({ body: 'olá rc' }).expect(201);

    const res = await api().get('/api/v1/me/export').set(auth(rc)).expect(200);
    expect(res.headers['content-disposition']).toMatch(/attachment; filename="txillapp-dados-/);
    const data = JSON.parse(res.text);
    expect(data.profile).toMatchObject({ username: rc.username, birthDate: expect.anything() });
    expect(data.posts.map((p: { id: string }) => p.id)).toContain(mine.id);
    expect(data.messagesSent.map((m: { body: string }) => m.body)).toEqual(['olá rd']); // só as minhas
    expect(res.text).not.toMatch(/password|argon2/i);
    await api().get('/api/v1/me/export').expect(401);

    // eliminar a conta
    const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');
    const up = await api().post('/api/v1/media/uploads').set(auth(rc)).send({ mime: 'image/png', size: PNG.length }).expect(201);
    await api().put(up.body.uploadUrl).set('Content-Type', 'image/png').send(PNG).expect(200);
    await api().get(`/api/v1/media/${up.body.assetId}`).expect(200);
    await api().post('/api/v1/auth/delete-account').set(auth(rc)).send({ confirmUsername: rc.username, password: PASSWORD }).expect(204);

    const conv = await pool.query('SELECT 1 FROM social.conversations WHERE user_a = $1 OR user_b = $1', [rc.id]);
    expect(conv.rowCount).toBe(0); // conversas e mensagens apagadas
    const row = (await pool.query('SELECT gender, birth_date FROM identity.users WHERE id = $1', [rc.id])).rows[0];
    expect(row).toEqual({ gender: null, birth_date: null });
    await api().get(`/api/v1/posts/${mine.id}`).set(auth(rd)).expect(404);
    await api().get(`/api/v1/media/${up.body.assetId}`).expect(404); // deixa de servir logo
    expect(await app.get(MediaService).sweepDeleted()).toBeGreaterThanOrEqual(1);
    const asset = (await pool.query('SELECT purged_at FROM content.media_assets WHERE id = $1', [up.body.assetId])).rows[0];
    expect(asset.purged_at).not.toBeNull(); // ficheiro apagado do armazenamento
  });
});
