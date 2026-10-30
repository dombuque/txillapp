import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Pool } from 'pg';
import { loadConfig } from './config';
import { migrate } from './db/migrate';
import { createApp } from './main';

const DB = process.env.TEST_DATABASE_URL ?? 'postgres://txill:txill_dev@localhost:5433/txillapp_test';
const PASSWORD = 'password-bem-longa-1';

interface U { token: string; id: string; username: string; country: string }

describe('cada país é a sua rede (integração)', () => {
  let app: INestApplication;
  let pool: Pool;
  const run = Date.now().toString(36);
  const tag = `praia${run}`;
  const api = () => request(app.getHttpServer());
  // O nginx põe o país do Cloudflare neste cabeçalho; nos testes mandamo-lo à mão.
  const as = (x: U) => ({ Authorization: `Bearer ${x.token}`, 'X-Client-Country': x.country });
  const u: Record<string, U> = {};

  async function signup(name: string, country: string): Promise<U> {
    const username = `${name}${run}`.slice(0, 28);
    const r = await api()
      .post('/api/v1/auth/register')
      .send({ email: `${username}@example.com`, username, displayName: `Pessoa ${username}`, password: PASSWORD, birthDate: '1990-06-15', gender: 'unspecified', acceptTerms: true })
      .expect(201);
    const x: U = { token: r.body.accessToken, id: r.body.user.id, username, country };
    await api().get('/api/v1/health/geo').set(as(x)); // público; o país é registado no 1.º pedido autenticado:
    await api().get('/api/v1/feed').set(as(x)).expect(200);
    return x;
  }
  const post = async (a: U, body: string) => (await api().post('/api/v1/posts').set(as(a)).send({ body }).expect(201)).body as { id: string };
  // O feed é paginado e a base de testes guarda publicações de execuções anteriores: percorre as páginas todas.
  const feedIds = async (x: U) => {
    const ids: string[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 40; page++) {
      const r: { body: { items: { id: string }[]; nextCursor: string | null } } = await api().get(`/api/v1/feed?limit=30${cursor ? `&cursor=${cursor}` : ''}`).set(as(x)).expect(200);
      ids.push(...r.body.items.map((i) => i.id));
      cursor = r.body.nextCursor;
      if (!cursor) break;
    }
    return ids;
  };

  beforeAll(async () => {
    await migrate(DB);
    pool = new Pool({ connectionString: DB });
    app = await createApp(loadConfig({ DATABASE_URL: DB, JWT_ACCESS_SECRET: 'g'.repeat(40), NODE_ENV: 'test', MEDIA_DIR: './uploads-test' }));
    await app.init();
    u.mz1 = await signup('mza', 'MZ');
    u.mz2 = await signup('mzb', 'MZ');
    u.za = await signup('zaa', 'ZA');
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  it('o país vem do cabeçalho do Cloudflare e a publicação herda o de quem a escreve', async () => {
    expect((await api().get('/api/v1/health/geo').set({ 'X-Client-Country': 'za' })).body).toEqual({ country: 'ZA' });
    expect((await api().get('/api/v1/health/geo').set({ 'X-Client-Country': 'XX' })).body).toEqual({ country: null });
    expect((await api().get('/api/v1/health/geo').set({ 'X-Client-Country': 'T1' })).body).toEqual({ country: null });
    expect((await api().get('/api/v1/health/geo')).body).toEqual({ country: null });
    const p = await post(u.mz1, `Dia de praia #${tag}`);
    const { rows } = await pool.query('SELECT country FROM content.posts WHERE id = $1', [p.id]);
    expect(rows[0].country).toBe('MZ');
  });

  it('descoberta: no feed só entram sugestões do mesmo país', async () => {
    const p = await post(u.mz1, `Olá de Maputo #${tag}`);
    const q = await post(u.za, `Hello from Durban #${tag}`);
    // mz2 (Moçambique) vê a publicação de mz1 como sugestão, mas não a da África do Sul.
    const mz2 = await feedIds(u.mz2);
    expect(mz2).toContain(p.id);
    expect(mz2).not.toContain(q.id);
    // za vê a sua e não a de Moçambique.
    const za = await feedIds(u.za);
    expect(za).toContain(q.id);
    expect(za).not.toContain(p.id);
  });

  it('pesquisa, hashtags, em alta e sugestões também respeitam o país', async () => {
    const p = await post(u.mz1, `Conversa única ${run} em Maputo #${tag}`);
    const q = await post(u.za, `Conversa única ${run} em Durban #${tag}`);
    const find = async (x: U) => ((await api().get(`/api/v1/search?q=${encodeURIComponent(`Conversa única ${run}`)}`).set(as(x)).expect(200)).body.posts as { id: string }[]).map((i) => i.id);
    const mz = await find(u.mz2);
    expect(mz).toContain(p.id);
    expect(mz).not.toContain(q.id);
    const za = await find(u.za);
    expect(za).toContain(q.id);
    expect(za).not.toContain(p.id);

    const tagPage = async (x: U) => ((await api().get(`/api/v1/tags/${tag}?sort=recent`).set(as(x)).expect(200)).body.items as { id: string }[]).map((i) => i.id);
    expect(await tagPage(u.mz2)).toContain(p.id);
    expect(await tagPage(u.mz2)).not.toContain(q.id);

    // Pessoas: a pessoa de outro país não aparece na pesquisa nem nas sugestões.
    const people = async (x: U, name: string) => ((await api().get(`/api/v1/search?q=${name}`).set(as(x)).expect(200)).body.people as { username: string }[]).map((i) => i.username);
    expect(await people(u.mz2, u.mz1.username)).toContain(u.mz1.username);
    expect(await people(u.mz2, u.za.username)).not.toContain(u.za.username);
    const sug = ((await api().get('/api/v1/suggestions/people').set(as(u.mz2)).expect(200)).body as { username: string }[]).map((i) => i.username);
    expect(sug).not.toContain(u.za.username);
  });

  it('quem segues continua a aparecer onde quer que estejas', async () => {
    await api().post(`/api/v1/users/${u.za.username}/follow`).set(as(u.mz2)).expect((r) => expect([200, 201, 204]).toContain(r.status));
    const q = await post(u.za, `Cá de Joanesburgo ${run}`);
    expect(await feedIds(u.mz2)).toContain(q.id);
    const found = ((await api().get(`/api/v1/search?q=${u.za.username}`).set(as(u.mz2)).expect(200)).body.people as { username: string }[]).map((i) => i.username);
    expect(found).toContain(u.za.username);
  });

  it('quem viaja passa para a rede do país onde está, e o que escreveu antes fica no país de origem', async () => {
    const before = await post(u.mz1, `Antes de viajar ${run}`);
    const travel: U = { ...u.mz1, country: 'ZA' };
    await api().get('/api/v1/feed').set(as(travel)).expect(200); // 1.º pedido na África do Sul
    const after = await post(travel, `Já na África do Sul ${run}`);
    const { rows } = await pool.query('SELECT id, country FROM content.posts WHERE id = ANY($1::uuid[])', [[before.id, after.id]]);
    const byId = Object.fromEntries(rows.map((r) => [r.id, r.country]));
    expect(byId[before.id]).toBe('MZ');
    expect(byId[after.id]).toBe('ZA');
    const zaFeed = await feedIds(u.za);
    expect(zaFeed).toContain(after.id);
    expect(zaFeed).not.toContain(before.id);
  });
});
