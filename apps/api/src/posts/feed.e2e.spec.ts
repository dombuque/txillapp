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
interface Item { id: string; body: string; feed: { source: string; seen: boolean }; author: { username: string } }

describe('feed por relevância (integração)', () => {
  let app: INestApplication;
  let pool: Pool;
  const run = Date.now().toString(36);
  const api = () => request(app.getHttpServer());
  const auth = (x: U) => ({ Authorization: `Bearer ${x.token}` });
  const u: Record<string, U> = {};

  async function signup(name: string): Promise<U> {
    const username = `${name}${run}`.slice(0, 28);
    const r = await api().post('/api/v1/auth/register').send({ email: `${username}@example.com`, username, displayName: name, password: PASSWORD, birthDate: '1990-06-15', acceptTerms: true }).expect(201);
    return { token: r.body.accessToken, id: r.body.user.id, username };
  }
  const post = async (a: U, body: string) => (await api().post('/api/v1/posts').set(auth(a)).send({ body }).expect(201)).body as { id: string };
  /** Percorre todas as páginas de uma sessão e devolve os itens por ordem. */
  async function session(viewer: U, limit = 5, maxPages = 40) {
    const items: Item[] = [];
    let cursor: string | undefined;
    for (let i = 0; i < maxPages; i++) {
      const r = (await api().get(`/api/v1/feed?limit=${limit}${cursor ? `&cursor=${cursor}` : ''}`).set(auth(viewer)).expect(200)).body;
      items.push(...r.items);
      if (!r.nextCursor) break;
      cursor = r.nextCursor;
    }
    return items;
  }
  // A base de testes acumula publicações de outras execuções: percorre-se a sessão inteira em vez de só a 1.ª página.
  const first = (viewer: U) => session(viewer, 30, 60);
  const seen = (viewer: U, ids: string[]) => api().post('/api/v1/feed/seen').set(auth(viewer)).send({ ids });

  beforeAll(async () => {
    await migrate(DB);
    pool = new Pool({ connectionString: DB });
    app = await createApp(loadConfig({ DATABASE_URL: DB, JWT_ACCESS_SECRET: 'f'.repeat(40), NODE_ENV: 'test', MEDIA_DIR: './uploads-test' }));
    await app.init();
    for (const n of ['fa', 'fb', 'fc', 'fd', 'fe']) u[n] = await signup(n);
    await api().post(`/api/v1/users/${u.fb.username}/follow`).set(auth(u.fa)).expect(200);
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  it('mistura quem sigo, as minhas e sugestões; diz de onde vem cada uma; respeita privacidade e bloqueios', async () => {
    const { fa, fb, fc, fd, fe } = u;
    const mine = await post(fa, 'minha');
    const followed = await post(fb, 'de quem sigo');
    const stranger = await post(fc, 'de um desconhecido público');
    await api().patch('/api/v1/settings/privacy').set(auth(fd)).send({ isPrivate: true }).expect(200);
    const priv = await post(fd, 'conta privada');
    const blockedOne = await post(fe, 'de quem bloqueei');
    await api().put(`/api/v1/blocks/${fe.username}`).set(auth(fa)).expect(200);

    const feed = await first(fa);
    const by = new Map(feed.map((i) => [i.id, i]));
    expect(by.get(mine.id)!.feed.source).toBe('self');
    expect(by.get(followed.id)!.feed.source).toBe('following');
    expect(by.get(stranger.id)!.feed.source).toBe('discover');
    expect(by.has(priv.id)).toBe(false); // privada e não a sigo
    expect(by.has(blockedOne.id)).toBe(false); // bloqueada
    // quem sigo pesa mais do que um desconhecido igual em tudo o resto
    expect(feed.findIndex((i) => i.id === followed.id)).toBeLessThan(feed.findIndex((i) => i.id === stranger.id));
  });

  it('o que já viste desce na sessão seguinte, para aparecerem novidades; esconder tira para sempre', async () => {
    const { fa, fb } = u;
    const old = [await post(fb, 'velha 1'), await post(fb, 'velha 2'), await post(fb, 'velha 3')];
    await seen(fa, old.map((p) => p.id)).expect(204);
    await new Promise((r) => setTimeout(r, 30)); // a nova sessão começa depois de teres visto
    const fresh = await post(fb, 'novidade');

    const feed = await first(fa);
    const idx = (id: string) => feed.findIndex((i) => i.id === id);
    expect(feed.find((i) => i.id === old[0].id)!.feed.seen).toBe(true);
    for (const o of old) expect(idx(fresh.id)).toBeLessThan(idx(o.id)); // a novidade passa à frente do que já viste
    expect(feed.find((i) => i.id === fresh.id)!.feed.seen).toBe(false);

    await api().post('/api/v1/feed/hide').set(auth(fa)).send({ postId: old[1].id }).expect(204);
    expect((await first(fa)).some((i) => i.id === old[1].id)).toBe(false);
    await api().post('/api/v1/feed/hide').set(auth(fa)).send({ postId: '00000000-0000-7000-8000-000000000000' }).expect(404);
  });

  it('interação sobe uma publicação; um autor não ocupa o ecrã todo; páginas sem repetições', async () => {
    const { fa, fb, fc, fd, fe } = u;
    // fc publica várias seguidas: as seguintes do mesmo autor perdem posição
    const many = [] as { id: string }[];
    for (let i = 0; i < 4; i++) many.push(await post(fc, `fc em série ${i}`));
    const other = await post(fb, 'fb no meio');
    const plain = await post(fb, 'fb sem reações');
    for (const x of [fc, fd, fe]) await api().post(`/api/v1/posts/${other.id}/cheers`).set(auth(x)).expect((r) => expect([200, 201]).toContain(r.status));
    await api().post(`/api/v1/posts/${other.id}/comments`).set(auth(fc)).send({ body: 'bom!' }).expect(201);

    const feed = await first(fa);
    const idx = (id: string) => feed.findIndex((i) => i.id === id);
    expect(idx(other.id)).toBeLessThan(idx(plain.id)); // mais reações, mesma idade
    // a 4.ª de fc em série fica atrás da publicação de fb com reações
    expect(idx(other.id)).toBeLessThan(idx(many[0].id) + 3);

    const all = await session(fa, 4);
    const ids = all.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length); // nenhuma repetida entre páginas
    for (const p of [...many, other, plain]) expect(ids).toContain(p.id);
    // no início do feed não há 4 do mesmo autor seguidas
    const head = all.slice(0, 8).map((i) => i.author.username);
    const longest = head.reduce((best, a, i) => (i && a === head[i - 1] ? { n: best.n + 1, max: Math.max(best.max, best.n + 1) } : { n: 1, max: Math.max(best.max, 1) }), { n: 0, max: 0 }).max;
    expect(longest).toBeLessThanOrEqual(3);
  });

  it('cursor inválido ou adulterado é recusado; sem sessão não há feed; lista longa de "visto" é limitada', async () => {
    const { fa } = u;
    await api().get('/api/v1/feed?cursor=lixo').set(auth(fa)).expect(400);
    await api().get('/api/v1/feed').expect(401);
    await seen(fa, Array.from({ length: 41 }, () => '00000000-0000-7000-8000-000000000000')).expect(400);
    await seen(fa, ['00000000-0000-7000-8000-000000000000']).expect(204); // ids que não existem são ignorados
  });
});
