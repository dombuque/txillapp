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
interface TrayRow { username: string; isMe: boolean; count: number; seenCount: number; seen: boolean }
interface StoryRow { id: string; seen: boolean; viewCount: number | null }

describe('"já vi os meus mimos": guardado na conta, sem contar o autor como espectador (integração)', () => {
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
  async function post(x: U, caption: string): Promise<{ id: string }> {
    const up = await api().post('/api/v1/media/uploads').set(auth(x)).send({ mime: 'image/png', size: PNG.length }).expect(201);
    await api().put(up.body.uploadUrl).set('Content-Type', 'image/png').send(PNG).expect(200);
    return (await api().post('/api/v1/stories').set(auth(x)).send({ mediaId: up.body.assetId, caption }).expect(201)).body;
  }
  const tray = async (x: U) => (await api().get('/api/v1/stories').set(auth(x)).expect(200)).body as TrayRow[];
  const listOf = async (x: U, of: U) => (await api().get(`/api/v1/stories/user/${of.username}`).set(auth(x)).expect(200)).body as StoryRow[];
  const view = (x: U, id: string) => api().post(`/api/v1/stories/${id}/view`).set(auth(x)).expect(204);

  beforeAll(async () => {
    await migrate(DB);
    pool = new Pool({ connectionString: DB });
    app = await createApp(loadConfig({ DATABASE_URL: DB, JWT_ACCESS_SECRET: 'd'.repeat(40), NODE_ENV: 'test', MEDIA_DIR: './uploads-test' }));
    await app.init();
    for (const n of ['osa', 'osb']) u[n] = await signup(n);
    // A e B seguem-se: cada um vê os mimos do outro na bandeja.
    await api().post(`/api/v1/users/${u.osb.username}/follow`).set(auth(u.osa)).expect(200);
    await api().post(`/api/v1/users/${u.osa.username}/follow`).set(auth(u.osb)).expect(200);
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  it('ver os meus apaga o anel (em qualquer aparelho); um mimo novo volta a pôr a cores; o meu fica sempre primeiro', async () => {
    const { osa, osb } = u;
    const s1 = await post(osa, 'primeiro');
    await post(osb, 'do outro'); // um mimo por ver de outra pessoa, mais recente que o meu

    let t = await tray(osa);
    expect(t[0]).toMatchObject({ username: osa.username, isMe: true, count: 1, seenCount: 0, seen: false });
    expect((await listOf(osa, osa)).map((s) => s.seen)).toEqual([false]);

    await view(osa, s1.id);
    t = await tray(osa);
    // Visto, mas continua primeiro (antes do mimo por ver do outro).
    expect(t[0]).toMatchObject({ username: osa.username, isMe: true, count: 1, seenCount: 1, seen: true });
    expect(t[1]).toMatchObject({ username: osb.username, seen: false });
    expect((await listOf(osa, osa)).map((s) => s.seen)).toEqual([true]);

    // "Outro aparelho": uma nova sessão da mesma conta vê o mesmo estado (vem do servidor, não do aparelho).
    const other = (await api().post('/api/v1/auth/login').send({ identifier: `${osa.username}@example.com`, password: PASSWORD }).expect(200)).body;
    const t2 = (await api().get('/api/v1/stories').set({ Authorization: `Bearer ${other.accessToken}` }).expect(200)).body as TrayRow[];
    expect(t2[0]).toMatchObject({ isMe: true, seen: true });

    // Um mimo novo: o anel volta a cores (um segmento visto, um por ver) e começa-se no novo.
    await new Promise((r) => setTimeout(r, 5));
    const s2 = await post(osa, 'segundo');
    t = await tray(osa);
    expect(t[0]).toMatchObject({ username: osa.username, isMe: true, count: 2, seenCount: 1, seen: false });
    expect((await listOf(osa, osa)).map((s) => [s.id, s.seen])).toEqual([[s1.id, true], [s2.id, false]]);

    // Rever um mais antigo não desfaz nem avança nada.
    await view(osa, s1.id);
    expect((await tray(osa))[0]).toMatchObject({ seen: false, seenCount: 1 });

    await view(osa, s2.id);
    expect((await tray(osa))[0]).toMatchObject({ isMe: true, count: 2, seenCount: 2, seen: true });
    expect((await listOf(osa, osa)).map((s) => s.seen)).toEqual([true, true]);

    // Para o outro, os meus continuam por ver: o que vi não conta para ele.
    const tb = await tray(osb);
    expect(tb.find((x) => x.username === osa.username)).toMatchObject({ seen: false, seenCount: 0, count: 2 });
    expect(tb[0]).toMatchObject({ username: osb.username, isMe: true, seen: false });
  });

  it('o autor não aparece em "quem viu" nem nas contagens', async () => {
    const { osa, osb } = u;
    const s = await post(osa, 'contas');
    await view(osa, s.id);
    await view(osa, s.id);
    expect((await listOf(osa, osa)).find((x) => x.id === s.id)).toMatchObject({ seen: true, viewCount: 0 });
    expect((await api().get(`/api/v1/stories/${s.id}/viewers`).set(auth(osa)).expect(200)).body).toEqual([]);

    await view(osb, s.id);
    expect((await listOf(osa, osa)).find((x) => x.id === s.id)).toMatchObject({ viewCount: 1 });
    const viewers = (await api().get(`/api/v1/stories/${s.id}/viewers`).set(auth(osa)).expect(200)).body as { username: string }[];
    expect(viewers.map((v) => v.username)).toEqual([osb.username]);

    const own = await pool.query('SELECT count(*)::int AS n FROM content.story_views WHERE viewer_id = $1', [osa.id]);
    expect(own.rows[0].n).toBe(0);
    // Quem viu o meu (osb) fica com o seu `seen`; o meu "visto" não lhe toca.
    expect((await listOf(osb, osa)).find((x) => x.id === s.id)).toMatchObject({ seen: true, viewCount: null });
  });

  it('eliminar a conta apaga o "já vi os meus"', async () => {
    const { osa } = u;
    const before = await pool.query('SELECT 1 FROM content.story_own_seen WHERE user_id = $1', [osa.id]);
    expect(before.rowCount).toBe(1);
    await api().post('/api/v1/auth/delete-account').set(auth(osa)).send({ confirmUsername: osa.username, password: PASSWORD }).expect(204);
    const after = await pool.query('SELECT 1 FROM content.story_own_seen WHERE user_id = $1', [osa.id]);
    expect(after.rowCount).toBe(0);
  });
});
