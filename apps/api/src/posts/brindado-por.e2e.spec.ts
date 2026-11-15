import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Pool } from 'pg';
import { loadConfig } from '../config';
import { migrate } from '../db/migrate';
import { createApp } from '../main';

const DB = process.env.TEST_DATABASE_URL ?? 'postgres://txill:txill_dev@localhost:5433/txillapp_test';
const PASSWORD = 'password-bem-longa-1';

interface U { token: string; id: string; username: string }
interface CheeredBy { users: { username: string; displayName: string; avatarUrl: string | null; verified: boolean; verifiedTier: string | null; close: boolean }[]; total: number }

/** «Brindado por @fulano e outras N pessoas» (posts/cheered-by.ts): quem aparece, por que ordem, e quem o pode ver. */
describe('brindado por (integração)', () => {
  let app: INestApplication;
  let pool: Pool;
  const run = Date.now().toString(36);
  const api = () => request(app.getHttpServer());
  const auth = (x: U) => ({ Authorization: `Bearer ${x.token}` });
  const u: Record<string, U> = {};
  let n = 0;

  async function signup(name: string): Promise<U> {
    const username = `${name}${run}`.slice(0, 28);
    const r = await api().post('/api/v1/auth/register').set('X-Forwarded-For', `10.77.${(n++ % 250) + 1}.9`).send({ email: `${username}@example.com`, username, displayName: `${name} Teste`, password: PASSWORD, birthDate: '1990-06-15', acceptTerms: true }).expect(201);
    return { token: r.body.accessToken, id: r.body.user.id, username };
  }
  const follow = (a: U, b: U) => api().post(`/api/v1/users/${b.username}/follow`).set(auth(a)).expect((r) => expect([200, 201, 204]).toContain(r.status));
  const cheer = (a: U, postId: string) => api().post(`/api/v1/posts/${postId}/cheers`).set(auth(a)).expect((r) => expect([200, 201]).toContain(r.status));
  const privacy = (a: U, v: Record<string, unknown>) => api().patch('/api/v1/settings/privacy').set(auth(a)).send(v).expect(200);
  const seen = async (viewer: U, postId: string) => (await api().get(`/api/v1/posts/${postId}`).set(auth(viewer)).expect(200)).body as { cheers: number; cheeredBy: CheeredBy | null };
  const who = (c: CheeredBy | null) => c?.users.map((x) => x.username);

  // Quem brinda, do mais antigo ao mais recente.
  const ORDER = ['f1', 'c1', 's1', 's2', 's3', 'bk', 'dz', 'pv', 'vw'];
  let postId = '';
  let second = '';

  beforeAll(async () => {
    await migrate(DB);
    pool = new Pool({ connectionString: DB });
    app = await createApp(loadConfig({ DATABASE_URL: DB, JWT_ACCESS_SECRET: 'b'.repeat(40), NODE_ENV: 'test', MEDIA_DIR: './uploads-test' }));
    await app.init();
    // ow publica; vw e ww veem; os outros brindam.
    for (const n of ['ow', 'vw', 'ww', ...ORDER.filter((x) => x !== 'vw')]) u[n] = await signup(n);
    const { ow, vw, f1, c1, bk, pv } = u;
    await follow(vw, ow);
    await follow(vw, f1); // vw segue f1
    await follow(c1, vw); // c1 segue vw: vw pode pô-lo nos amigos próximos
    await api().put(`/api/v1/stories/close-friends/${c1.username}`).set(auth(vw)).expect(204);
    await privacy(pv, { isPrivate: true }); // privada e vw não a segue
    await pool.query("UPDATE identity.users SET verified = true, verified_tier = 'paid' WHERE id = $1", [f1.id]);

    postId = (await api().post('/api/v1/posts').set(auth(ow)).send({ body: 'brindado por' }).expect(201)).body.id;
    second = (await api().post('/api/v1/posts').set(auth(ow)).send({ body: 'só um brinde' }).expect(201)).body.id;
    for (const n of ORDER) await cheer(u[n], postId);
    await cheer(u.s1, second);
    // Os brindes por ordem (o mais antigo primeiro), com segundos entre eles.
    for (const [i, n] of ORDER.entries()) {
      await pool.query("UPDATE content.cheers SET created_at = now() - make_interval(mins => $3) WHERE post_id = $1 AND user_id = $2", [postId, u[n].id, 60 - i]);
    }
    await api().put(`/api/v1/blocks/${bk.username}`).set(auth(vw)).expect((r) => expect([200, 204]).toContain(r.status)); // vw bloqueia bk
    await pool.query("UPDATE identity.users SET status = 'suspended' WHERE id = $1", [u.dz.id]); // conta desativada
  }, 120_000);

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  it('primeiro os amigos próximos, depois quem sigo, depois os mais recentes; nunca eu, bloqueados, desativados ou privadas', async () => {
    const { vw, c1, f1, s3 } = u;
    const p = await seen(vw, postId);
    expect(p.cheers).toBe(ORDER.length);
    expect(p.cheeredBy!.total).toBe(ORDER.length); // o total conta todos os brindes (os números são públicos)
    expect(who(p.cheeredBy)).toEqual([c1.username, f1.username, s3.username]);
    expect(p.cheeredBy!.users.map((x) => x.close)).toEqual([true, false, false]);
    const f = p.cheeredBy!.users[1];
    expect(f).toEqual({ username: f1.username, displayName: 'f1 Teste', avatarUrl: null, verified: true, verifiedTier: 'paid', close: false }); // o selo vai junto
  });

  it('quem não segue ninguém vê os mais recentes (privadas e desativadas fora; o bloqueio é só entre quem bloqueia)', async () => {
    const { ww, vw, bk, s3 } = u;
    expect(who((await seen(ww, postId)).cheeredBy)).toEqual([vw.username, bk.username, s3.username]);
  });

  it('na página do perfil: cada publicação com os seus (numa consulta para a página)', async () => {
    const { ww, ow, s1 } = u;
    const items = (await api().get(`/api/v1/users/${ow.username}/posts`).set(auth(ww)).expect(200)).body.items as { id: string; cheeredBy: CheeredBy | null }[];
    expect(who(items.find((x) => x.id === second)!.cheeredBy)).toEqual([s1.username]);
    expect(items.find((x) => x.id === second)!.cheeredBy!.total).toBe(1);
    expect(items.find((x) => x.id === postId)!.cheeredBy!.users).toHaveLength(3);
  });

  it('sem brindes: lista vazia e total 0', async () => {
    const { ow, ww } = u;
    const p = (await api().post('/api/v1/posts').set(auth(ow)).send({ body: 'ninguém brindou' }).expect(201)).body.id;
    expect((await seen(ww, p)).cheeredBy).toEqual({ users: [], total: 0 });
  });

  it('o dono decide quem vê os nomes: todos, só seguidores, só ele (e então só a contagem)', async () => {
    const { ow, vw, ww } = u;
    await privacy(ow, { cheersVisible: 'followers' });
    expect((await seen(ww, postId)).cheeredBy).toBeNull(); // ww não segue ow
    expect((await seen(ww, postId)).cheers).toBe(ORDER.length); // a contagem continua
    expect(who((await seen(vw, postId)).cheeredBy)).toHaveLength(3); // vw segue ow
    await privacy(ow, { cheersVisible: 'off' });
    expect((await seen(vw, postId)).cheeredBy).toBeNull();
    expect((await seen(ow, postId)).cheeredBy!.users).toHaveLength(3); // o dono vê sempre
    expect(who((await seen(ow, postId)).cheeredBy)).not.toContain(ow.username);
    await privacy(ow, { cheersVisible: 'everyone' });
    expect(who((await seen(ww, postId)).cheeredBy)).toHaveLength(3);
  });

  it('publicação com muitos brindes: o amigo próximo de há mais tempo continua à frente (procura-se pela lista)', async () => {
    const { ow, vw, c1, ww } = u;
    const p = (await api().post('/api/v1/posts').set(auth(ow)).send({ body: 'viral' }).expect(201)).body.id as string;
    // 600 brindes recentes de contas criadas aqui (mais do que os 500 onde se procuram os amigos); o de c1 é o mais antigo.
    await pool.query(
      `WITH nu AS (
         INSERT INTO identity.users (id, email, username, display_name)
         SELECT gen_random_uuid(), 'v' || g || '_' || $2 || '@example.com', 'v' || g || '_' || $2, 'Viral ' || g FROM generate_series(1, 600) g
         RETURNING id, username)
       INSERT INTO content.cheers (post_id, user_id, created_at)
       SELECT $1, nu.id, now() - make_interval(secs => substring(nu.username from 2 for position('_' in nu.username) - 2)::int) FROM nu`,
      [p, run],
    );
    await cheer(c1, p);
    await pool.query("UPDATE content.cheers SET created_at = now() - interval '2 days' WHERE post_id = $1 AND user_id = $2", [p, c1.id]);
    const seenBy = (await seen(vw, p)).cheeredBy!;
    expect(seenBy.total).toBe(601);
    expect(who(seenBy)).toEqual([c1.username, `v1_${run}`, `v2_${run}`]);
    expect(seenBy.users[0].close).toBe(true);
    expect(who((await seen(ww, p)).cheeredBy)).toEqual([`v1_${run}`, `v2_${run}`, `v3_${run}`]);
  });

  it('conta privada: aparece a quem a segue; o bloqueio tira a pessoa também aos amigos próximos', async () => {
    const { vw, pv, c1, f1 } = u;
    // vw passa a seguir pv (pedido aceite): pv entra pelo lado de quem sigo, à frente dos recentes.
    await pool.query('INSERT INTO social.follows (follower_id, followee_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [vw.id, pv.id]);
    expect(who((await seen(vw, postId)).cheeredBy)).toEqual([c1.username, pv.username, f1.username]); // seguidos: o mais recente primeiro
    await api().put(`/api/v1/blocks/${c1.username}`).set(auth(vw)).expect((r) => expect([200, 204]).toContain(r.status));
    const after = (await seen(vw, postId)).cheeredBy!;
    expect(who(after)).not.toContain(c1.username);
    expect(after.users.every((x) => !x.close)).toBe(true);
  });
});
