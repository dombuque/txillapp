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
interface NewPosts { count: number; latestId: string | null }

/** "1 publicação nova" no cabeçalho da conversa: o que a outra pessoa publicou e eu ainda não vi. */
describe('publicações novas no cabeçalho da conversa (integração)', () => {
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
  const post = async (a: U, body: string) => (await api().post('/api/v1/posts').set(auth(a)).send({ body }).expect(201)).body as { id: string };
  const newPosts = async (x: U, other: U) => (await api().get(`/api/v1/chat/with/${other.username}`).set(auth(x)).expect(200)).body.newPosts as NewPosts;
  const follow = (a: U, b: U) => pool.query('INSERT INTO social.follows (follower_id, followee_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [a.id, b.id]);

  beforeAll(async () => {
    await migrate(DB);
    pool = new Pool({ connectionString: DB });
    app = await createApp(loadConfig({ DATABASE_URL: DB, JWT_ACCESS_SECRET: 'n'.repeat(40), NODE_ENV: 'test', MEDIA_DIR: './uploads-test' }));
    await app.init();
    for (const n of ['na', 'nb', 'nc', 'nd', 'ne']) u[n] = await signup(n);
    await follow(u.na, u.nb);
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  it('conta o que publicou e eu não vi; a mais recente vem em latestId; ver, apagar, repostar e posts antigos não contam', async () => {
    const { na, nb, nc } = u;
    expect(await newPosts(na, nb)).toEqual({ count: 0, latestId: null });

    const p1 = await post(nb, 'primeira');
    const p2 = await post(nb, 'segunda');
    const p3 = await post(nb, 'terceira');
    expect(await newPosts(na, nb)).toEqual({ count: 3, latestId: p3.id });

    // Já vista (o "visto" do Início, que o ecrã da publicação também regista): deixa de contar.
    await api().post('/api/v1/feed/seen').set(auth(na)).send({ ids: [p3.id] }).expect(204);
    expect(await newPosts(na, nb)).toEqual({ count: 2, latestId: p2.id });

    // Apagada pelo autor: não conta.
    await api().delete(`/api/v1/posts/${p2.id}`).set(auth(nb)).expect((r) => expect(r.status).toBeLessThan(300));
    expect(await newPosts(na, nb)).toEqual({ count: 1, latestId: p1.id });

    // Mais antiga do que 7 dias: não conta.
    const old = await post(nb, 'antiga');
    await pool.query("UPDATE content.posts SET created_at = now() - interval '8 days' WHERE id = $1", [old.id]);
    expect(await newPosts(na, nb)).toEqual({ count: 1, latestId: p1.id });

    // Repost (simples ou com comentário) da publicação de outra pessoa: não é dela, não conta.
    const theirs = await post(nc, 'de outra pessoa');
    await api().post(`/api/v1/posts/${theirs.id}/repost`).set(auth(nb)).send({}).expect((r) => expect(r.status).toBeLessThan(300));
    await api().post(`/api/v1/posts/${theirs.id}/repost`).set(auth(nb)).send({ body: 'olha isto' }).expect((r) => expect(r.status).toBeLessThan(300));
    expect(await newPosts(na, nb)).toEqual({ count: 1, latestId: p1.id });

    // Nas minhas próprias publicações nunca há "novas".
    expect(await newPosts(nb, nb)).toEqual({ count: 0, latestId: null });
  });

  it('conta privada que não sigo: não conta; passa a contar quando a sigo', async () => {
    const { na, nd } = u;
    await api().patch('/api/v1/settings/privacy').set(auth(nd)).send({ isPrivate: true }).expect(200);
    const p = await post(nd, 'só para quem me segue');
    expect(await newPosts(na, nd)).toEqual({ count: 0, latestId: null });
    await follow(na, nd);
    expect(await newPosts(na, nd)).toEqual({ count: 1, latestId: p.id });
  });

  it('bloqueio (em qualquer sentido) dá 0', async () => {
    const { na, ne } = u;
    await post(ne, 'pública');
    expect((await newPosts(na, ne)).count).toBe(1);
    await api().put(`/api/v1/blocks/${na.username}`).set(auth(ne)).expect(200);
    expect(await newPosts(na, ne)).toEqual({ count: 0, latestId: null });
    await api().delete(`/api/v1/blocks/${na.username}`).set(auth(ne)).expect((r) => expect(r.status).toBeLessThan(300));
    expect((await newPosts(na, ne)).count).toBe(1);
    await api().put(`/api/v1/blocks/${ne.username}`).set(auth(na)).expect(200);
    expect(await newPosts(na, ne)).toEqual({ count: 0, latestId: null });
  });
});
