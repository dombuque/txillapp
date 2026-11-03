import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Pool } from 'pg';
import { loadConfig } from '../config';
import { migrate } from '../db/migrate';
import { createApp } from '../main';

const DB = process.env.TEST_DATABASE_URL ?? 'postgres://txill:txill_dev@localhost:5433/txillapp_test';
const PASSWORD = 'password-bem-longa-1';
const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');

interface U { token: string; id: string; username: string }

describe('Instants: fotos de 24 h, vistas uma só vez, só para amigos próximos e seguidores mútuos (integração)', () => {
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
  const follow = (a: U, b: U) => pool.query('INSERT INTO social.follows (follower_id, followee_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [a.id, b.id]);
  async function photo(a: U) {
    const up = await api().post('/api/v1/media/uploads').set(auth(a)).send({ mime: 'image/png', size: PNG.length, purpose: 'chat' }).expect(201);
    await api().put(up.body.uploadUrl).set('Content-Type', 'image/png').send(PNG).expect(200);
    await api().post(`/api/v1/media/${up.body.assetId}/complete`).set(auth(a)).send({}).expect(200);
    return up.body.assetId as string;
  }

  beforeAll(async () => {
    await migrate(DB);
    pool = new Pool({ connectionString: DB });
    app = await createApp(loadConfig({ DATABASE_URL: DB, JWT_ACCESS_SECRET: 'e'.repeat(40), NODE_ENV: 'test', MEDIA_DIR: './uploads-test' }));
    await app.init();
    for (const n of ['ina', 'inb', 'inc', 'ind', 'ine']) u[n] = await signup(n);
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  it('só mutuamente seguidores ou amigos próximos veem; cada pessoa vê uma vez; o autor vê quem viu', async () => {
    const { ina, inb, inc, ind, ine } = u;
    await follow(ina, inb); await follow(inb, ina); // mútuos
    await follow(inc, ina); // só ela segue: não vê
    await pool.query('INSERT INTO social.close_friends (owner_id, friend_id) VALUES ($1, $2)', [ina.id, ind.id]); // amigo próximo (sem se seguirem)

    const media = await photo(ina);
    const made = (await api().post('/api/v1/instants').set(auth(ina)).send({ mediaId: media, caption: 'cheguei ao Tofo' }).expect(201)).body;
    await api().post('/api/v1/instants').set(auth(ina)).send({ mediaId: media, caption: 'repetida' }).expect(400); // a mesma foto não serve duas vezes
    const second = await photo(ina);
    await api().post('/api/v1/instants').set(auth(ina)).send({ mediaId: second, caption: 'x'.repeat(81) }).expect(400);

    const names = async (x: U) => ((await api().get('/api/v1/instants').set(auth(x)).expect(200)).body.others as { username: string }[]).map((o) => o.username);
    expect(await names(inb)).toContain(ina.username);
    const tray = (await api().get('/api/v1/instants').set(auth(inb)).expect(200)).body.others as { username: string; previewUrl: string }[];
    expect(tray.find((x) => x.username === ina.username)?.previewUrl).toMatch(/chat\/media\//); // pré-visualização para o atalho
    expect(await names(ind)).toContain(ina.username);
    expect(await names(inc)).not.toContain(ina.username);
    expect(await names(ine)).not.toContain(ina.username);
    await api().get(`/api/v1/instants/of/${ina.username}`).set(auth(inc)).expect(200).expect([]);

    const items = (await api().get(`/api/v1/instants/of/${ina.username}`).set(auth(inb)).expect(200)).body as { id: string; url: string; caption: string }[];
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id: made.id, caption: 'cheguei ao Tofo' });
    await api().get(items[0].url.startsWith('http') ? new URL(items[0].url).pathname + new URL(items[0].url).search : items[0].url).expect(200);

    // vista uma só vez
    await api().post(`/api/v1/instants/${made.id}/view`).set(auth(inb)).expect(204);
    expect(await names(inb)).not.toContain(ina.username);
    await api().get(`/api/v1/instants/of/${ina.username}`).set(auth(inb)).expect(200).expect([]);
    await api().post(`/api/v1/instants/${made.id}/view`).set(auth(inc)).expect(204); // sem acesso: não regista
    await api().post(`/api/v1/instants/${made.id}/view`).set(auth(ina)).expect(204); // o autor não conta

    const viewers = (await api().get(`/api/v1/instants/${made.id}/viewers`).set(auth(ina)).expect(200)).body as { username: string }[];
    expect(viewers.map((v) => v.username)).toEqual([inb.username]);
    await api().get(`/api/v1/instants/${made.id}/viewers`).set(auth(inb)).expect(404);
    const mine = (await api().get('/api/v1/instants').set(auth(ina)).expect(200)).body.mine;
    expect(mine).toMatchObject({ count: 1, views: 1 });
    // reações: uma por pessoa; o autor vê o resumo
    await api().put(`/api/v1/instants/${made.id}/reaction`).set(auth(ind)).send({ reaction: ':amor:' }).expect(204);
    await api().put(`/api/v1/instants/${made.id}/reaction`).set(auth(inb)).send({ reaction: ':rir:' }).expect(204);
    await api().put(`/api/v1/instants/${made.id}/reaction`).set(auth(inb)).send({ reaction: ':amor:' }).expect(204); // muda, não soma
    await api().put(`/api/v1/instants/${made.id}/reaction`).set(auth(inc)).send({ reaction: ':amor:' }).expect(404); // sem acesso
    await api().put(`/api/v1/instants/${made.id}/reaction`).set(auth(ina)).send({ reaction: ':amor:' }).expect(404); // o autor não reage ao seu
    await api().put(`/api/v1/instants/${made.id}/reaction`).set(auth(inb)).send({ reaction: 'rir' }).expect(400);
    const own = (await api().get(`/api/v1/instants/of/${ina.username}`).set(auth(ina)).expect(200)).body as { views: number; reactions: { reaction: string; count: number }[] }[];
    expect(own[0].views).toBe(1);
    expect(own[0].reactions).toEqual([{ reaction: ':amor:', count: 2 }]);
  });

  it('"só amigos próximos": quem só se segue mutuamente não vê esse Zás', async () => {
    const { ina, inb, ind } = u;
    const pic = await photo(ina);
    const made = (await api().post('/api/v1/instants').set(auth(ina)).send({ mediaId: pic, caption: 'só próximos', audience: 'close' }).expect(201)).body;
    const items = async (x: U) => ((await api().get(`/api/v1/instants/of/${ina.username}`).set(auth(x)).expect(200)).body as { id: string }[]).map((i) => i.id);
    expect(await items(ind)).toContain(made.id); // amigo próximo
    expect(await items(inb)).not.toContain(made.id); // só mútuo
    const third = await photo(ina);
    await api().post('/api/v1/instants').set(auth(ina)).send({ mediaId: third, audience: 'todos' }).expect(400);
  });

  it('dura 24 h, bloqueios escondem e só o autor apaga', async () => {
    const { inb, inc } = u;
    await follow(inb, inc); await follow(inc, inb);
    const pic = await photo(inc);
    const made = (await api().post('/api/v1/instants').set(auth(inc)).send({ mediaId: pic, caption: '' }).expect(201)).body;
    const names = async (x: U) => ((await api().get('/api/v1/instants').set(auth(x)).expect(200)).body.others as { username: string }[]).map((o) => o.username);
    expect(await names(inb)).toContain(inc.username);

    await pool.query('INSERT INTO social.blocks (blocker_id, blocked_id) VALUES ($1, $2)', [inb.id, inc.id]);
    expect(await names(inb)).not.toContain(inc.username);
    await pool.query('DELETE FROM social.blocks WHERE blocker_id = $1', [inb.id]);
    expect(await names(inb)).toContain(inc.username);

    await api().delete(`/api/v1/instants/${made.id}`).set(auth(inb)).expect(404);
    await pool.query("UPDATE social.instants SET expires_at = now() - interval '1 minute' WHERE id = $1", [made.id]);
    expect(await names(inb)).not.toContain(inc.username);
    await api().delete(`/api/v1/instants/${made.id}`).set(auth(inc)).expect(204);
  });
});
