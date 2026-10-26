import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import type { Client } from '@elastic/elasticsearch';
import request from 'supertest';
import { Pool } from 'pg';
import { loadConfig } from '../config';
import { migrate } from '../db/migrate';
import { createApp } from '../main';
import { SearchIndexer } from './search-index';

const DB = process.env.TEST_DATABASE_URL ?? 'postgres://txill:txill_dev@localhost:5433/txillapp_test';
const PASSWORD = 'password-bem-longa-1';

interface U { token: string; id: string; username: string }

/**
 * Elasticsearch de mentira: devolve os ids que o teste mandar, e regista o que o servidor indexa.
 * O que se prova aqui: a ordem vem do Elasticsearch, mas a PRIVACIDADE continua a vir do PostgreSQL.
 */
function fakeEs() {
  const state = { postHits: [] as string[], userHits: [] as string[], fail: false, indexed: [] as { index: string; id: string; document: Record<string, unknown> }[], deleted: [] as { index: string; id: string }[], deleteByQuery: [] as unknown[] };
  const client = {
    indices: { exists: async () => true, create: async () => ({}), refresh: async () => ({}) },
    search: async ({ index }: { index: string }) => {
      if (state.fail) throw new Error('es em baixo');
      const ids = index.endsWith('-users') ? state.userHits : state.postHits;
      return { hits: { hits: ids.map((id) => ({ _id: id })) } };
    },
    index: async (p: { index: string; id: string; document: Record<string, unknown> }) => void state.indexed.push(p),
    delete: async (p: { index: string; id: string }) => void state.deleted.push(p),
    deleteByQuery: async (p: unknown) => void state.deleteByQuery.push(p),
    bulk: async () => ({}),
  };
  return { state, client: client as unknown as Client };
}

describe('pesquisa com Elasticsearch (cliente simulado)', () => {
  let app: INestApplication;
  let pool: Pool;
  const es = fakeEs();
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
  const search = async (x: U, q: string) => (await api().get(`/api/v1/search?q=${encodeURIComponent(q)}`).set(auth(x)).expect(200)).body as { people: { username: string }[]; posts: { id: string }[] };
  const drain = () => app.get(SearchIndexer).drain();

  beforeAll(async () => {
    await migrate(DB);
    pool = new Pool({ connectionString: DB });
    app = await createApp(
      loadConfig({ DATABASE_URL: DB, JWT_ACCESS_SECRET: 'e'.repeat(40), NODE_ENV: 'test', MEDIA_DIR: './uploads-test', SEARCH_BACKEND: 'elasticsearch', ELASTICSEARCH_URL: 'http://es.invalid:9200' }),
      { esClient: es.client },
    );
    await app.init();
    for (const n of ['ea', 'eb', 'ec', 'ed']) u[n] = await signup(n);
    await api().patch('/api/v1/settings/privacy').set(auth(u.ed)).send({ isPrivate: true }).expect(200);
    await drain();
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  it('a ordem é a do Elasticsearch; privados e bloqueados nunca aparecem, mesmo que ele os devolva', async () => {
    const { ea, eb, ec, ed } = u;
    const p1 = await post(eb, 'primeira da pesquisa');
    const p2 = await post(ec, 'segunda da pesquisa');
    const priv = await post(ed, 'conta privada da pesquisa');
    const blocked = await post(ea, 'de quem o eb bloqueou');
    await api().put(`/api/v1/blocks/${ea.username}`).set(auth(eb)).expect(200);

    // o Elasticsearch (mal sincronizado) devolve tudo, incluindo o que não devia
    es.state.postHits = [priv.id, p2.id, blocked.id, p1.id];
    es.state.userHits = [ed.id, ec.id, ea.id, eb.id]; // inclui o próprio (eb), um bloqueado (ea) e uma conta privada (ed)
    const r = await search(eb, 'da pesquisa');
    expect(r.posts.map((p) => p.id)).toEqual([p2.id, p1.id]); // ordem do ES, sem privada nem bloqueada
    expect(r.people.map((p) => p.username)).toEqual([ed.username, ec.username]); // sem o próprio nem o bloqueado; a privada aparece (o perfil existe, o conteúdo não)

    // quem segue a conta privada já vê as publicações dela
    await api().post(`/api/v1/users/${ed.username}/follow`).set(auth(eb)).expect(200);
    await api().post(`/api/v1/follow-requests/${eb.username}/accept`).set(auth(ed)).expect((x) => expect([200, 204]).toContain(x.status));
    expect((await search(eb, 'da pesquisa')).posts.map((p) => p.id)).toEqual([priv.id, p2.id, p1.id]);
  });

  it('se o Elasticsearch falhar, a pesquisa continua a funcionar pelo PostgreSQL', async () => {
    const { ec, eb } = u;
    const marker = `marcador${run}`;
    const p = await post(ec, `texto com ${marker} no meio`);
    es.state.fail = true;
    expect((await search(eb, marker)).posts.map((x) => x.id)).toContain(p.id);
    es.state.fail = false;
  });

  it('indexa em segundo plano (publicar, apagar, mudar o nome, eliminar a conta) com o que é preciso e nada mais', async () => {
    const { ea } = u;
    es.state.indexed.length = 0;
    const p = await post(ea, `Vamos à praia #Maputo`);
    await drain();
    const doc = es.state.indexed.find((i) => i.id === p.id)!;
    expect(doc.index).toBe('txillapp-posts');
    expect(doc.document).toMatchObject({ body: 'Vamos à praia #Maputo', tags: ['maputo'], author_id: ea.id });
    expect(Object.keys(doc.document).sort()).toEqual(['author_id', 'body', 'created_at', 'location', 'tags']); // sem email, senha, etc.

    await api().delete(`/api/v1/posts/${p.id}`).set(auth(ea)).expect(204);
    await drain();
    expect(es.state.deleted).toContainEqual({ index: 'txillapp-posts', id: p.id });

    es.state.indexed.length = 0;
    await api().patch('/api/v1/users/me').set(auth(ea)).send({ displayName: 'Nome Novo' }).expect(200);
    await drain();
    expect(es.state.indexed.find((i) => i.id === ea.id)!.document).toMatchObject({ display_name: 'Nome Novo', username: ea.username });

    await api().post('/api/v1/auth/delete-account').set(auth(ea)).send({ confirmUsername: ea.username, password: PASSWORD }).expect(204);
    await drain();
    expect(es.state.deleted).toContainEqual({ index: 'txillapp-users', id: ea.id });
    expect(JSON.stringify(es.state.deleteByQuery)).toContain(ea.id); // as publicações dela saem do índice
  });

  it('configuração: SEARCH_BACKEND=elasticsearch exige o endereço', () => {
    expect(() => loadConfig({ DATABASE_URL: DB, JWT_ACCESS_SECRET: 'x'.repeat(40), SEARCH_BACKEND: 'elasticsearch' })).toThrow(/ELASTICSEARCH_URL/);
  });
});
