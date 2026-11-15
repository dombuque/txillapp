import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Pool } from 'pg';
import { loadConfig } from '../config';
import { migrate } from '../db/migrate';
import { createApp } from '../main';
import type { LiveKitRooms } from '../txillada/livekit';

const DB = process.env.TEST_DATABASE_URL ?? 'postgres://txill:txill_dev@localhost:5433/txillapp_test';
const PASSWORD = 'password-bem-longa-1';
const LK = { LIVEKIT_URL: 'ws://localhost:7880', LIVEKIT_API_KEY: 'devkey', LIVEKIT_API_SECRET: 'secret' };

interface U { token: string; id: string; username: string; ip: string }
interface Entry { username: string; count: number; seen: boolean; live: { id: string } | null; isMe: boolean }

/** A fila dos mimos com as Txilladas dos amigos (`?live=1`): entram mesmo sem mimos, primeiro, só para quem as pode ver. */
describe('Mimos: os amigos ao vivo na fila', () => {
  let app: INestApplication;
  let pool: Pool;
  const run = Date.now().toString(36);
  const api = () => request(app.getHttpServer());
  const auth = (x: U) => ({ Authorization: `Bearer ${x.token}`, 'X-Forwarded-For': x.ip });
  const rooms: LiveKitRooms = { removeParticipant: async () => undefined, deleteRoom: async () => undefined, participants: async () => [] };
  const u: Record<string, U> = {};
  let n = 0;

  async function signup(name: string): Promise<U> {
    const username = `${name}${run}`.slice(0, 28);
    n++;
    const ip = `10.159.${n >> 8}.${n & 255}`;
    const r = await api().post('/api/v1/auth/register').set('X-Forwarded-For', ip)
      .send({ email: `${username}@example.com`, username, displayName: `${name[0].toUpperCase()}${name.slice(1)} Teste`, password: PASSWORD, birthDate: '1990-06-15', acceptTerms: true }).expect(201);
    await pool.query('UPDATE identity.users SET email_verified_at = now() WHERE id = $1', [r.body.user.id]);
    return { token: r.body.accessToken, id: r.body.user.id, username, ip };
  }
  const follow = (a: U, b: U) => api().post(`/api/v1/users/${b.username}/follow`).set(auth(a)).expect(200);
  const open = async (x: U, audience = 'everyone') => (await api().post('/api/v1/txilladas').set(auth(x)).send({ title: 'Ao vivo', audience }).expect(201)).body.txillada.id as string;
  const end = (x: U, id: string) => api().post(`/api/v1/txilladas/${id}/end`).set(auth(x)).expect(200);
  const tray = async (x: U, live = true) => (await api().get(`/api/v1/stories${live ? '?live=1' : ''}`).set(auth(x)).expect(200)).body as Entry[];
  const names = (t: Entry[]) => t.filter((e) => !e.isMe).map((e) => e.username);
  async function story(x: U) {
    const media = (await pool.query(`INSERT INTO content.media_assets (id, owner_id, mime, size_bytes, storage_key, status) VALUES (gen_random_uuid(), $1, 'image/jpeg', 1, 'x', 'ready') RETURNING id`, [x.id])).rows[0].id;
    await pool.query('INSERT INTO content.stories (id, author_id, media_id) VALUES (gen_random_uuid(), $1, $2)', [x.id, media]);
  }

  beforeAll(async () => {
    await migrate(DB);
    pool = new Pool({ connectionString: DB });
    app = await createApp(loadConfig({ DATABASE_URL: DB, JWT_ACCESS_SECRET: 't'.repeat(40), NODE_ENV: 'test', MEDIA_DIR: './uploads-test', ...LK }), { livekitRooms: rooms });
    await app.init();
    // ana segue host, mimo e cf; rui não segue ninguém; cf tem a ana nos próximos (sem ela o seguir).
    for (const name of ['host', 'mimo', 'cf', 'ana', 'rui', 'eva']) u[name] = await signup(name);
    await follow(u.ana, u.host);
    await follow(u.ana, u.mimo);
    await follow(u.eva, u.host);
    await story(u.mimo);
    // A Ana seguia o cf, ele pô-la nos próximos e ela deixou de o seguir (a lista dele fica como estava).
    await follow(u.ana, u.cf);
    await api().put(`/api/v1/stories/close-friends/${u.ana.username}`).set(auth(u.cf)).expect(204);
    await api().delete(`/api/v1/users/${u.cf.username}/follow`).set(auth(u.ana)).expect((r) => expect([200, 204]).toContain(r.status));
    expect((await pool.query('SELECT 1 FROM social.close_friends WHERE owner_id = $1 AND friend_id = $2', [u.cf.id, u.ana.id])).rowCount).toBe(1);
  }, 180_000);

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  it('ao vivo sem mimos: aparece primeiro (de quem sigo antes), com count 0; sem ?live=1 não aparece; sai quando acaba', async () => {
    const { host, mimo, cf, ana, rui } = u;
    expect(names(await tray(ana))).toEqual([mimo.username]);
    const id = await open(host);
    const cfId = await open(cf, 'close');
    const t = await tray(ana);
    expect(names(t)).toEqual([host.username, cf.username, mimo.username]);
    expect(t[0]).toMatchObject({ username: host.username, count: 0, seenCount: 0, seen: false, closeFriends: false, live: { id } });
    expect(typeof (t[0] as unknown as { latestAt: string }).latestAt).toBe('string');
    expect(t.find((e) => e.username === cf.username)).toMatchObject({ count: 0, live: { id: cfId } });
    expect(t.find((e) => e.username === mimo.username)).toMatchObject({ count: 1, live: null });
    // A app antiga (sem o parâmetro): só quem tem mimos, como antes.
    expect(names(await tray(ana, false))).toEqual([mimo.username]);
    // Pública, mas o Rui não é amigo de ninguém: a fila dele fica vazia.
    expect(names(await tray(rui))).toEqual([]);
    // Também com mimos: a mesma entrada, ao vivo e primeiro.
    await story(host);
    expect((await tray(ana))[0]).toMatchObject({ username: host.username, count: 1, live: { id } });
    await end(host, id);
    await end(cf, cfId);
    const after = await tray(ana);
    expect(names(after).sort()).toEqual([host.username, mimo.username].sort());
    expect(after.find((e) => e.username === host.username)).toMatchObject({ count: 1, live: null });
    expect(after.find((e) => e.username === cf.username)).toBeUndefined();
    await pool.query('DELETE FROM content.stories WHERE author_id = $1', [host.id]);
  });

  it('só para quem a pode ver: seguidores, próximos, bloqueio, conta privada, expulso e denunciada', async () => {
    const { host, ana, eva } = u;
    const has = async (x: U) => (await tray(x)).some((e) => e.username === host.username);

    const fol = await open(host, 'followers');
    expect(await has(ana)).toBe(true);
    await end(host, fol);

    // Próximos: a Ana está, a Eva (que segue) não.
    await api().put(`/api/v1/stories/close-friends/${ana.username}`).set(auth(host)).expect(204);
    const close = await open(host, 'close');
    expect(await has(ana)).toBe(true);
    expect(await has(eva)).toBe(false);
    await end(host, close);

    const id = await open(host);
    expect(await has(eva)).toBe(true);
    // Conta privada: a Eva segue, por isso continua a ver; sem seguir deixa de ver.
    await pool.query('UPDATE identity.users SET is_private = true WHERE id = $1', [host.id]);
    expect(await has(eva)).toBe(true);
    await pool.query('DELETE FROM social.follows WHERE follower_id = $1 AND followee_id = $2', [eva.id, host.id]);
    await pool.query(`INSERT INTO social.close_friends (owner_id, friend_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [host.id, eva.id]);
    expect(await has(eva)).toBe(false); // nos próximos, mas a conta é privada e ela não segue
    await pool.query('UPDATE identity.users SET is_private = false WHERE id = $1', [host.id]);
    expect(await has(eva)).toBe(true); // pública e a Eva está nos próximos do anfitrião
    await pool.query('DELETE FROM social.close_friends WHERE owner_id = $1 AND friend_id = $2', [host.id, eva.id]);
    await follow(eva, host);

    // Expulsa: sai da fila dela.
    await api().post(`/api/v1/txilladas/${id}/ban/${eva.username}`).set(auth(host)).expect(204);
    expect(await has(eva)).toBe(false);
    // Denunciada pela Ana: deixa de lhe aparecer.
    expect(await has(ana)).toBe(true);
    await api().post(`/api/v1/txilladas/${id}/report`).set(auth(ana)).send({ reason: 'spam' }).expect(204);
    expect(await has(ana)).toBe(false);
    await end(host, id);

    // Bloqueio: a Ana bloqueia o anfitrião (e deixa de o seguir).
    const id2 = await open(host);
    expect(await has(ana)).toBe(true); // a denúncia era da outra Txillada
    await api().put(`/api/v1/blocks/${host.username}`).set(auth(ana)).expect((r) => expect([200, 204]).toContain(r.status));
    expect(await has(ana)).toBe(false);
    await end(host, id2);
  });
});
