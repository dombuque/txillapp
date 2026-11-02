import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Pool } from 'pg';
import { loadConfig } from '../config';
import { migrate } from '../db/migrate';
import { createApp } from '../main';
import { ChatEvents } from './chat.events';

const DB = process.env.TEST_DATABASE_URL ?? 'postgres://txill:txill_dev@localhost:5433/txillapp_test';
const PASSWORD = 'password-bem-longa-1';

interface U { token: string; id: string; username: string }

describe('presença fora do chat: online e a escrever comentário (integração)', () => {
  let app: INestApplication;
  let pool: Pool;
  let events: ChatEvents;
  const run = Date.now().toString(36);
  const api = () => request(app.getHttpServer());
  const auth = (x: U) => ({ Authorization: `Bearer ${x.token}` });
  const u: Record<string, U> = {};

  async function signup(name: string): Promise<U> {
    const username = `${name}${run}`.slice(0, 28);
    const r = await api().post('/api/v1/auth/register').send({ email: `${username}@example.com`, username, displayName: `${name} Teste`, password: PASSWORD, birthDate: '1990-06-15', acceptTerms: true }).expect(201);
    return { token: r.body.accessToken, id: r.body.user.id, username };
  }
  const online = async (viewer: U, names: string[]) => ((await api().post('/api/v1/presence/online').set(auth(viewer)).send({ usernames: names }).expect(200)).body.online as string[]);

  beforeAll(async () => {
    await migrate(DB);
    pool = new Pool({ connectionString: DB });
    app = await createApp(loadConfig({ DATABASE_URL: DB, JWT_ACCESS_SECRET: 'd'.repeat(40), NODE_ENV: 'test', MEDIA_DIR: './uploads-test' }));
    await app.init();
    events = app.get(ChatEvents);
    for (const n of ['oa', 'ob', 'oc']) u[n] = await signup(n);
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  it('online: só quem tem a app aberta; quem esconde a presença não aparece nem vê os outros', async () => {
    const { oa, ob, oc } = u;
    expect(await online(oa, [ob.username, oc.username])).toEqual([]); // ninguém com a app aberta
    events.connect(ob.id);
    events.connect(oc.id);
    expect((await online(oa, [ob.username, oc.username])).sort()).toEqual([ob.username, oc.username].sort());
    expect(await online(oa, [oa.username])).toEqual([]); // nunca a própria pessoa

    await pool.query('UPDATE identity.users SET show_presence = false WHERE id = $1', [oc.id]);
    expect(await online(oa, [ob.username, oc.username])).toEqual([ob.username]); // oc esconde
    expect(await online(oc, [ob.username])).toEqual([]); // e por isso também não vê os outros
    await pool.query('UPDATE identity.users SET show_presence = true WHERE id = $1', [oc.id]);

    await api().post('/api/v1/presence/online').send({ usernames: [ob.username] }).expect(401);
    events.disconnect(ob.id);
    events.disconnect(oc.id);
    expect(await online(oa, [ob.username])).toEqual([]);
  });

  it('a escrever um comentário: aparece a quem está a ver o post; some passado pouco tempo; esconder a presença esconde', async () => {
    const { oa, ob, oc } = u;
    const post = (await api().post('/api/v1/posts').set(auth(oa)).send({ body: 'comentem' }).expect(201)).body;
    const names = async (viewer: U) => ((await api().get(`/api/v1/presence/typing?postId=${post.id}`).set(auth(viewer)).expect(200)).body.names as string[]);

    expect(await names(oa)).toEqual([]);
    await api().post('/api/v1/presence/typing').set(auth(ob)).send({ postId: post.id }).expect(204);
    expect(await names(oa)).toEqual(['ob']);
    expect(await names(ob)).toEqual([]); // não se vê a si mesma
    await api().post('/api/v1/presence/typing').set(auth(oc)).send({ postId: post.id }).expect(204);
    expect((await names(oa)).sort()).toEqual(['ob', 'oc']);

    await pool.query('UPDATE identity.users SET show_presence = false WHERE id = $1', [oc.id]);
    expect(await names(oa)).toEqual(['ob']);
    expect(await names(oc)).toEqual([]);
    await pool.query('UPDATE identity.users SET show_presence = true WHERE id = $1', [oc.id]);

    await api().get('/api/v1/presence/typing?postId=nao-e-id').set(auth(oa)).expect(400);
  });
});
