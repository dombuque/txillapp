import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Pool } from 'pg';
import { loadConfig } from '../config';
import { migrate } from '../db/migrate';
import { createApp } from '../main';

/**
 * O selo de verificado nos outros DTOs com pessoas (o resto está em badge.e2e.spec.ts): À tua volta (malta e publicações),
 * locais (gestores), SuperTxill, TxillGroups (pedidos para entrar e contas do Plano), quem brindou a geleira e as notas.
 */
const DB = process.env.TEST_DATABASE_URL ?? 'postgres://txill:txill_dev@localhost:5433/txillapp_test';
const PASSWORD = 'password-bem-longa-1';
const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');
const VIP = { verified: true, verifiedTier: 'verified' };
const NONE = { verified: false, verifiedTier: null };

interface U { token: string; id: string; username: string }
type Row = { username: string; verified?: boolean; verifiedTier?: string | null };

describe('selo de verificado: À tua volta, locais, SuperTxill, grupos, geleira e notas (integração)', () => {
  let app: INestApplication;
  let pool: Pool;
  const run = Date.now().toString(36);
  const C = { lat: Math.round((-55 + Math.random() * 30) * 100) / 100, lng: Math.round((-150 + Math.random() * 40) * 100) / 100 };
  const api = () => request(app.getHttpServer());
  const auth = (x: U) => ({ Authorization: `Bearer ${x.token}` });
  const u: Record<string, U> = {};
  const find = <T extends Row>(rows: T[], who: U) => rows.find((r) => r.username === who.username);

  async function signup(name: string): Promise<U> {
    const username = `${name}${run}`.slice(0, 28);
    const r = await api().post('/api/v1/auth/register').send({ email: `${username}@example.com`, username, displayName: `${name} Teste`, password: PASSWORD, birthDate: '1990-06-15', acceptTerms: true }).expect(201);
    return { token: r.body.accessToken, id: r.body.user.id, username };
  }
  async function photo(x: U): Promise<string> {
    const up = await api().post('/api/v1/media/uploads').set(auth(x)).send({ mime: 'image/png', size: PNG.length }).expect(201);
    await api().put(up.body.uploadUrl).set('Content-Type', 'image/png').send(PNG).expect(200);
    return up.body.assetId as string;
  }
  const follow = (a: U, b: U) => api().post(`/api/v1/users/${b.username}/follow`).set(auth(a)).expect(200);

  beforeAll(async () => {
    await migrate(DB);
    pool = new Pool({ connectionString: DB });
    app = await createApp(loadConfig({ DATABASE_URL: DB, JWT_ACCESS_SECRET: 's'.repeat(40), NODE_ENV: 'test', MEDIA_DIR: './uploads-test' }));
    await app.init();
    for (const n of ['sma', 'smv', 'smc', 'smo']) u[n] = await signup(n);
    // smv tem o selo azul (pessoa ou negócio verificado).
    await pool.query(`UPDATE identity.users SET verified = true, verified_at = now(), verified_tier = 'verified' WHERE id = $1`, [u.smv.id]);
    const { sma, smv, smc } = u;
    await follow(sma, smv); await follow(smv, sma);
    await follow(sma, smc); await follow(smc, sma);
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  it('À tua volta: a malta perto e as publicações de quem está perto', async () => {
    const { sma, smv } = u;
    await api().put('/api/v1/nearby/settings').set(auth(smv)).send({ visibility: 'mutual' }).expect(200);
    await api().post('/api/v1/nearby/presence').set(auth(smv)).send({ lat: C.lat, lng: C.lng }).expect(200);
    const media = await photo(smv);
    await api().post('/api/v1/posts').set(auth(smv)).send({ body: `perto ${run}`, locationLabel: 'Praia', locationLat: C.lat, locationLng: C.lng, mediaIds: [media] }).expect(201);
    const d = (await api().get(`/api/v1/nearby?lat=${C.lat}&lng=${C.lng}&kinds=people,posts`).set(auth(sma)).expect(200)).body as { people: Row[]; posts: { author: Row }[] };
    expect(find(d.people, smv)).toMatchObject(VIP);
    expect(d.posts.find((p) => p.author.username === smv.username)!.author).toMatchObject(VIP);
  });

  it('locais: os gestores trazem o selo (o dono e quem foi convidado)', async () => {
    const { sma, smv } = u;
    const v = (await api().post('/api/v1/venues').set(auth(smv)).send({ name: `Barraca Selo ${run}`, kind: 'bar', city: 'Maputo' }).expect(201)).body as { id: string; slug: string };
    await pool.query("UPDATE content.venues SET review_status = 'approved' WHERE slug = $1", [v.slug]);
    await api().post(`/api/v1/venues/${v.slug}/managers`).set(auth(smv)).send({ username: sma.username, role: 'editor' }).expect(201);
    const managers = (await api().get(`/api/v1/venues/${v.slug}/managers`).set(auth(smv)).expect(200)).body as (Row & { role: string })[];
    expect(managers[0]).toMatchObject({ username: smv.username, role: 'owner', ...VIP });
    expect(find(managers, sma)).toMatchObject(NONE);
  });

  it('SuperTxill: «Malta para ti» traz o selo', async () => {
    const { smc, smv, smo } = u;
    // smo segue o mesmo que smc e ainda segue smv: smv é sugerido a smc.
    await follow(smo, smc);
    await follow(smc, smo);
    await follow(smo, smv);
    await api().post(`/api/v1/users/${smv.username}/unfollow`).set(auth(smc)).expect((r) => expect(r.status).toBeLessThan(500));
    const list = (await api().get('/api/v1/supertxill/for-you').set(auth(smc)).expect(200)).body as Row[];
    const hit = find(list, smv);
    // Pode não ser sugerido (outras contas de testes na mesma base): quando é, vem com o selo; os outros têm o par a falso.
    if (hit) expect(hit).toMatchObject(VIP);
    for (const p of list) expect(p).toHaveProperty('verified');
  });

  it('TxillGroups: pedidos para entrar e as contas do Plano', async () => {
    const { sma, smv, smc, smo } = u;
    const g = (await api().post('/api/v1/chat/groups').set(auth(sma)).send({ name: `Contas ${run}`, members: [smv.username, smc.username] }).expect(201)).body.id as string;
    const plan = (await api().get(`/api/v1/chat/groups/${g}/plan`).set(auth(sma)).expect(200)).body as { expenses: { balances: Row[] } };
    expect(find(plan.expenses.balances, smv)).toMatchObject(VIP);
    expect(find(plan.expenses.balances, smc)).toMatchObject(NONE);
    // O pedido de smo para entrar (o pedido em si está testado em public-groups): o admin vê-o com o selo de quem pede.
    await pool.query(`UPDATE identity.users SET verified = true, verified_tier = 'official' WHERE id = $1`, [smo.id]);
    await pool.query('INSERT INTO social.group_join_requests (group_id, user_id) VALUES ($1, $2)', [g, smo.id]);
    const reqs = (await api().get(`/api/v1/chat/groups/${g}/join-requests`).set(auth(sma)).expect(200)).body as Row[];
    expect(find(reqs, smo)).toMatchObject({ verified: true, verifiedTier: 'official' });
    await pool.query(`UPDATE identity.users SET verified = false, verified_tier = NULL WHERE id = $1`, [smo.id]);
  });

  it('geleira: quem brindou traz o selo', async () => {
    const { sma, smv } = u;
    await api().put(`/api/v1/users/${sma.username}/geleira/cheer`).set(auth(smv)).expect(200);
    const items = (await api().get(`/api/v1/users/${sma.username}/geleira/cheers`).set(auth(sma)).expect(200)).body.items as Row[];
    expect(find(items, smv)).toMatchObject(VIP);
  });

  it('notas: a nota e a malta das conversas (sem nota) trazem o selo', async () => {
    const { sma, smv } = u;
    await api().post(`/api/v1/chat/with/${smv.username}`).set(auth(sma)).send({ body: 'olá' }).expect(201);
    await api().post(`/api/v1/chat/with/${sma.username}`).set(auth(smv)).send({ body: 'boas' }).expect(201);
    const before = (await api().get('/api/v1/notes').set(auth(sma)).expect(200)).body as { items: Row[]; people: Row[] };
    expect(find(before.people, smv)).toMatchObject(VIP);
    await api().put('/api/v1/notes/me').set(auth(smv)).send({ body: 'praia hoje?' }).expect(204);
    const after = (await api().get('/api/v1/notes').set(auth(sma)).expect(200)).body as { items: Row[] };
    expect(find(after.items, smv)).toMatchObject(VIP);
  });
});
