import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Pool } from 'pg';
import { loadConfig } from '../config';
import { migrate } from '../db/migrate';
import { createApp } from '../main';
import { staffLogin } from '../staff/staff-test';

const DB = process.env.TEST_DATABASE_URL ?? 'postgres://txill:txill_dev@localhost:5433/txillapp_test';
const PASSWORD = 'password-bem-longa-1';
const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');

interface U { token: string; id: string; username: string }

describe('verificação de perfis: requisitos, documentos, revisão e anúncio (integração)', () => {
  let app: INestApplication;
  let pool: Pool;
  const run = Date.now().toString(36);
  const api = () => request(app.getHttpServer());
  const auth = (x: U) => ({ Authorization: `Bearer ${x.token}` });
  const u: Record<string, U> = {};
  let staff = '';
  const sauth = () => ({ Authorization: `Bearer ${staff}` });

  async function signup(name: string): Promise<U> {
    const username = `${name}${run}`.slice(0, 28);
    const r = await api().post('/api/v1/auth/register').send({ email: `${username}@example.com`, username, displayName: `${name} Teste`, password: PASSWORD, birthDate: '1990-06-15', acceptTerms: true }).expect(201);
    return { token: r.body.accessToken, id: r.body.user.id, username };
  }
  async function upload(a: U) {
    const r = await api().post('/api/v1/media/uploads').set(auth(a)).send({ mime: 'image/png', size: PNG.length, purpose: 'chat' }).expect(201);
    await api().put(r.body.uploadUrl).set('Content-Type', 'image/png').send(PNG).expect(200);
    return r.body.assetId as string;
  }
  const me = async (x: U) => (await api().get('/api/v1/verification/me').set(auth(x)).expect(200)).body;
  const body = (docMediaId: string, selfieMediaId: string) => ({ kind: 'person', fullName: 'Nome Completo', proof: 'Músico, página oficial em exemplo.com', docMediaId, selfieMediaId });

  beforeAll(async () => {
    await migrate(DB);
    pool = new Pool({ connectionString: DB });
    app = await createApp(loadConfig({ DATABASE_URL: DB, JWT_ACCESS_SECRET: 'd'.repeat(40), NODE_ENV: 'test', MEDIA_DIR: './uploads-test' }));
    await app.init();
    for (const n of ['va', 'vb', 'vc', 'vd']) u[n] = await signup(n);
    staff = (await staffLogin(app, 'va')).token;
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  it('só pede quem cumpre os requisitos; aprovar dá o selo, anuncia e apaga os documentos; recusar exige motivo', async () => {
    const { va, vb, vc, vd } = u;

    // Conta nova: não cumpre.
    let s = await me(vb);
    expect(s.eligible).toBe(false);
    expect(s.items.find((i: { key: string }) => i.key === 'age').ok).toBe(false);
    const d0 = await upload(vb);
    const s0 = await upload(vb);
    await api().post('/api/v1/verification/request').set(auth(vb)).send(body(d0, s0)).expect(403);

    // Passa a cumprir: antiguidade, foto, bio, publicações e seguidores.
    await pool.query(`UPDATE identity.users SET created_at = now() - interval '45 days', email_verified_at = now(), bio = 'Músico', avatar_media_id = $2 WHERE id = $1`, [vb.id, d0]);
    for (let i = 0; i < 3; i++) await api().post('/api/v1/posts').set(auth(vb)).send({ body: `post ${i}` }).expect(201);
    // Seguidores criados direto na base (o registo tem limite de pedidos por IP).
    for (let i = 0; i < 10; i++) {
      const id = (await pool.query(`INSERT INTO identity.users (id, email, username, display_name) VALUES (gen_random_uuid(), $1, $2, $3) RETURNING id`, [`seg${i}${run}@example.com`, `seg${i}${run}`, `Seguidor ${i}`])).rows[0].id as string;
      await pool.query('INSERT INTO social.follows (follower_id, followee_id) VALUES ($1, $2)', [id, vb.id]);
    }
    s = await me(vb);
    expect(s.items.filter((i: { ok: boolean }) => !i.ok)).toEqual([]);
    expect(s.eligible).toBe(true);

    // Validações do pedido: fotos de outra pessoa ou repetidas não servem.
    const foreign = await upload(vc);
    await api().post('/api/v1/verification/request').set(auth(vb)).send(body(foreign, s0)).expect(400);
    await api().post('/api/v1/verification/request').set(auth(vb)).send(body(s0, s0)).expect(400);
    const doc = await upload(vb);
    const selfie = await upload(vb);
    await api().post('/api/v1/verification/request').set(auth(vb)).send(body(doc, selfie)).expect(204);
    await api().post('/api/v1/verification/request').set(auth(vb)).send(body(doc, selfie)).expect(409); // já há um em análise
    expect((await me(vb)).request.status).toBe('pending');

    // Só a moderação vê a fila, com ligações privadas para os documentos.
    await api().get('/api/v1/admin/verifications').set(auth(vc)).expect(401);
    const queue = (await api().get('/api/v1/admin/verifications').set(sauth()).expect(200)).body as { id: string; docUrl: string; selfieUrl: string; fullName: string }[];
    const item = queue.find((q) => q.fullName === 'Nome Completo')!;
    expect(item.docUrl).toContain('/chat/media/');
    await api().get(item.docUrl).expect(200);

    // Recusar exige motivo; a pessoa vê o motivo e só pode voltar a pedir passados 30 dias.
    await api().post(`/api/v1/admin/verifications/${item.id}/decide`).set(sauth()).send({ action: 'reject' }).expect(400);
    await api().post(`/api/v1/admin/verifications/${item.id}/decide`).set(sauth()).send({ action: 'reject', reason: 'Foto ilegível' }).expect(204);
    s = await me(vb);
    expect(s.request).toMatchObject({ status: 'rejected', reason: 'Foto ilegível' });
    expect(s.retryAfter).not.toBeNull();
    const [x1, x2] = [await upload(vb), await upload(vb)];
    await api().post('/api/v1/verification/request').set(auth(vb)).send(body(x1, x2)).expect(409);
    expect((await pool.query(`SELECT status FROM content.media_assets WHERE id = ANY($1)`, [[doc, selfie]])).rows.map((r) => r.status)).toEqual(['deleted', 'deleted']);

    // Passados 30 dias, pede outra vez e é aprovada como oficial.
    await pool.query(`UPDATE identity.verification_requests SET reviewed_at = now() - interval '31 days' WHERE user_id = $1`, [vb.id]);
    const [y1, y2] = [await upload(vb), await upload(vb)];
    await api().post('/api/v1/verification/request').set(auth(vb)).send(body(y1, y2)).expect(204);
    const again = ((await api().get('/api/v1/admin/verifications').set(sauth()).expect(200)).body as { id: string }[])[0];
    await api().post(`/api/v1/admin/verifications/${again.id}/decide`).set(auth(vc)).send({ action: 'approve' }).expect(401);
    await api().post(`/api/v1/admin/verifications/${again.id}/decide`).set(sauth()).send({ action: 'approve', tier: 'official' }).expect(204);
    await api().post(`/api/v1/admin/verifications/${again.id}/decide`).set(sauth()).send({ action: 'approve' }).expect(404); // já decidido

    s = await me(vb);
    expect(s).toMatchObject({ verified: true, tier: 'official' });
    const profile = (await api().get(`/api/v1/users/${vb.username}`).set(auth(vd)).expect(200)).body;
    expect(profile).toMatchObject({ verified: true, verifiedTier: 'official' });

    // Anúncio: a própria pessoa e quem a segue recebem o aviso.
    const kinds = async (x: U) => ((await api().get('/api/v1/notifications').set(auth(x)).expect(200)).body.items as { kind: string }[]).map((n) => n.kind);
    expect(await kinds(vb)).toContain('verified');
    const follower = (await pool.query(`SELECT follower_id FROM social.follows WHERE followee_id = $1 LIMIT 1`, [vb.id])).rows[0].follower_id as string;
    const n = (await pool.query(`SELECT 1 FROM social.notifications WHERE user_id = $1 AND kind = 'verified' AND actor_id = $2`, [follower, vb.id])).rowCount;
    expect(n).toBe(1);
  }, 120_000);
});
