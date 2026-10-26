import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Client } from '@elastic/elasticsearch';
import request from 'supertest';
import { Pool } from 'pg';
import { loadConfig } from '../config';
import { migrate } from '../db/migrate';
import { createApp } from '../main';
import { SearchIndexer } from './search-index';

const DB = process.env.TEST_DATABASE_URL ?? 'postgres://txill:txill_dev@localhost:5433/txillapp_test';
const ES = process.env.REAL_ES_URL ?? 'http://localhost:9200';
const PASSWORD = 'password-bem-longa-1';

interface U { token: string; id: string; username: string }

/**
 * Com o Elasticsearch a sério (docker compose --profile search up -d elasticsearch):
 *   REAL_ES=1 npx jest --runInBand src/search/elastic-real
 * Usa índices próprios (prefixo único) e apaga-os no fim.
 */
const real = process.env.REAL_ES ? describe : describe.skip;

real('pesquisa com Elasticsearch a sério', () => {
  let app: INestApplication;
  let pool: Pool;
  let client: Client;
  const run = Date.now().toString(36);
  const prefix = `t${run}`;
  const api = () => request(app.getHttpServer());
  const auth = (x: U) => ({ Authorization: `Bearer ${x.token}` });
  const u: Record<string, U> = {};

  async function signup(name: string, displayName = name): Promise<U> {
    const username = `${name}${run}`.slice(0, 28);
    const r = await api().post('/api/v1/auth/register').send({ email: `${username}@example.com`, username, displayName, password: PASSWORD, birthDate: '1990-06-15', acceptTerms: true }).expect(201);
    return { token: r.body.accessToken, id: r.body.user.id, username };
  }
  const post = async (a: U, body: string) => (await api().post('/api/v1/posts').set(auth(a)).send({ body }).expect(201)).body as { id: string };
  const settle = async () => {
    await app.get(SearchIndexer).drain();
    await client.indices.refresh({ index: `${prefix}-*` });
  };
  const find = async (x: U, q: string) => (await api().get(`/api/v1/search?q=${encodeURIComponent(q)}`).set(auth(x)).expect(200)).body as { people: { username: string }[]; posts: { id: string }[] };

  beforeAll(async () => {
    await migrate(DB);
    pool = new Pool({ connectionString: DB });
    client = new Client({ node: ES });
    app = await createApp(
      loadConfig({ DATABASE_URL: DB, JWT_ACCESS_SECRET: 'r'.repeat(40), NODE_ENV: 'test', MEDIA_DIR: './uploads-test', SEARCH_BACKEND: 'elasticsearch', ELASTICSEARCH_URL: ES, ELASTICSEARCH_INDEX_PREFIX: prefix }),
      { esClient: client },
    );
    await app.init();
    u.a = await signup('ra', `Margarida Silva ${run}`);
    u.b = await signup('rb', `Joaquim ${run}`);
    u.c = await signup('rc');
    u.p = await signup('rp'); // privada
    await api().patch('/api/v1/settings/privacy').set(auth(u.p)).send({ isPrivate: true }).expect(200);
  }, 90_000);

  afterAll(async () => {
    await client.indices.delete({ index: [`${prefix}-posts`, `${prefix}-users`], ignore_unavailable: true }).catch(() => undefined); // nomes explícitos: o ES recusa apagar com "*"
    await app.close();
    await pool.end();
    await client.close();
  });

  it('relevância em português: sem acentos, radicais ("praias" acha "praia") e tolerância a erros', async () => {
    const { a, c } = u;
    const w = `zumbaki${run}`;
    const p1 = await post(a, `Fomos ontem à praia com amigos, ${w} fantástico`);
    const p2 = await post(a, `Receita de bolo de cenoura, nada a ver com o mar ${w}`);
    await settle();

    const exact = (await find(c, `praia ${w}`)).posts.map((p) => p.id);
    expect(exact[0]).toBe(p1.id); // o que tem as duas palavras vem primeiro
    expect((await find(c, `praias ${w}`)).posts.map((p) => p.id)).toContain(p1.id); // plural → radical
    expect((await find(c, `fantastico ${w}`)).posts.map((p) => p.id)).toContain(p1.id); // sem acento
    expect((await find(c, `${w.slice(0, 7)}${w[7] === 'k' ? 'x' : 'k'}${w.slice(8)}`)).posts.map((p) => p.id)).toContain(p1.id); // gralha numa letra
    expect((await find(c, w)).posts.map((p) => p.id)).toEqual(expect.arrayContaining([p1.id, p2.id]));
  });

  it('pessoas por prefixo e com gralhas; quem é privado nunca expõe o conteúdo', async () => {
    const { a, b, c, p } = u;
    const names = async (q: string) => (await find(c, q)).people.map((x) => x.username);
    expect(await names('Marga')).toContain(a.username); // prefixo
    expect(await names('Margarita Silva')).toContain(a.username); // gralha
    expect(await names('joaq')).toContain(b.username);

    const secret = `segredo${run}`;
    const priv = await post(p, `texto privado ${secret}`);
    await settle();
    expect((await find(c, secret)).posts.map((x) => x.id)).not.toContain(priv.id); // o ES acha, o PostgreSQL esconde
    await api().post(`/api/v1/users/${p.username}/follow`).set(auth(c)).expect(200);
    await api().post(`/api/v1/follow-requests/${c.username}/accept`).set(auth(p)).expect((r) => expect([200, 204]).toContain(r.status));
    expect((await find(c, secret)).posts.map((x) => x.id)).toContain(priv.id); // seguidor aprovado vê
  });

  it('apagar a publicação ou a conta tira do índice', async () => {
    const { b, c } = u;
    const w = `efemero${run}`;
    const p = await post(b, `vai desaparecer ${w}`);
    await settle();
    expect((await find(c, w)).posts.map((x) => x.id)).toContain(p.id);
    const hits = async () => (await client.search({ index: `${prefix}-posts`, query: { term: { author_id: b.id } }, size: 50 })).hits.total as { value: number };
    expect((await hits()).value).toBeGreaterThan(0);

    await api().delete(`/api/v1/posts/${p.id}`).set(auth(b)).expect(204);
    await api().post('/api/v1/auth/delete-account').set(auth(b)).send({ confirmUsername: b.username, password: PASSWORD }).expect(204);
    await app.get(SearchIndexer).drain();
    await client.indices.refresh({ index: `${prefix}-*` });
    expect((await hits()).value).toBe(0);
    expect((await client.exists({ index: `${prefix}-users`, id: b.id }))).toBe(false);
  });

  it('reindexAll reconstrói a partir do PostgreSQL', async () => {
    const n = await app.get(SearchIndexer).reindexAll();
    expect(n).toBeGreaterThan(0);
  }, 120_000);
});
