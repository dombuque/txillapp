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
interface Post { id: string; remixOf: { canTakeDown: boolean; kind: string } | null }

/** «Retirar o dueto» (0140): o autor da tcheka original esconde um dueto feito com ela; com a conta dele eliminada, todos. */
describe('retirar um dueto feito com a minha tcheka (integração)', () => {
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
  const video = async (owner: U) =>
    (await pool.query(`INSERT INTO content.media_assets (id, owner_id, mime, size_bytes, storage_key, status, duration_ms, width, height) VALUES (gen_random_uuid(), $1, 'video/mp4', 1, 'x', 'ready', 5000, 720, 1280) RETURNING id`, [owner.id])).rows[0].id as string;
  const tcheka = async (owner: U) => (await api().post('/api/v1/posts').set(auth(owner)).send({ body: 'a minha tcheka', mediaIds: [await video(owner)] }).expect(201)).body as Post;
  const remix = async (who: U, remixOf: object) => (await api().post('/api/v1/posts').set(auth(who)).send({ body: 'remix', mediaIds: [await video(who)], remixOf }).expect(201)).body as Post;
  const notes = async (who: U) => (await api().get('/api/v1/notifications').set(auth(who)).expect(200)).body.items as { kind: string; data: Record<string, unknown>; actor: { username: string } }[];

  beforeAll(async () => {
    await migrate(DB);
    pool = new Pool({ connectionString: DB });
    app = await createApp(loadConfig({ DATABASE_URL: DB, JWT_ACCESS_SECRET: 't'.repeat(40), NODE_ENV: 'test', MEDIA_DIR: './uploads-test' }));
    await app.init();
    for (const n of ['tka', 'tkb', 'tkc']) u[n] = await signup(n);
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  it('o autor do original retira o dueto: fica escondido para todos e o dono recebe o aviso', async () => {
    const { tka, tkb, tkc } = u;
    const orig = await tcheka(tka);
    const duet = await remix(tkb, { postId: orig.id, kind: 'duet' });
    // Só o autor do original vê a ação (nem o dono do dueto, nem outra pessoa).
    expect(((await api().get(`/api/v1/posts/${duet.id}`).set(auth(tka)).expect(200)).body as Post).remixOf).toMatchObject({ kind: 'duet', canTakeDown: true });
    expect(((await api().get(`/api/v1/posts/${duet.id}`).set(auth(tkb)).expect(200)).body as Post).remixOf?.canTakeDown).toBe(false);
    expect(((await api().get(`/api/v1/posts/${duet.id}`).set(auth(tkc)).expect(200)).body as Post).remixOf?.canTakeDown).toBe(false);
    await api().post(`/api/v1/posts/${duet.id}/duet-takedown`).set(auth(tkc)).expect(404);
    await api().post(`/api/v1/posts/${duet.id}/duet-takedown`).set(auth(tkb)).expect(404);
    await api().post(`/api/v1/posts/${orig.id}/duet-takedown`).set(auth(tka)).expect(404); // não é um dueto

    // Com um bloqueio entre os dois, continua a poder.
    await pool.query('INSERT INTO social.blocks (blocker_id, blocked_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [tkb.id, tka.id]);
    await api().post(`/api/v1/posts/${duet.id}/duet-takedown`).set(auth(tka)).expect(204);
    await api().post(`/api/v1/posts/${duet.id}/duet-takedown`).set(auth(tka)).expect(404); // já está retirado
    for (const who of [tka, tkb, tkc]) await api().get(`/api/v1/posts/${duet.id}`).set(auth(who)).expect(404);
    expect((await api().get(`/api/v1/posts/${orig.id}/remixes`).set(auth(tka)).expect(200)).body.items).toEqual([]);
    expect((await pool.query('SELECT removed_by FROM content.posts WHERE id = $1', [duet.id])).rows[0].removed_by).toBe('original');

    const n = (await notes(tkb)).find((x) => x.kind === 'remix_takedown');
    expect(n).toMatchObject({ actor: { username: tka.username }, data: { postId: duet.id, originalId: orig.id } });
    await pool.query('DELETE FROM social.blocks WHERE blocker_id = $1', [tkb.id]);
    // Não se desliga: com «Duetos e respostas» desligado, o aviso chega na mesma.
    await api().put('/api/v1/notifications/settings').set(auth(tkb)).send({ off: ['remixes'] }).expect(204);
    const duet2 = await remix(tkb, { postId: orig.id, kind: 'duet' });
    await api().post(`/api/v1/posts/${duet2.id}/duet-takedown`).set(auth(tka)).expect(204);
    expect((await notes(tkb)).filter((x) => x.kind === 'remix_takedown')).toHaveLength(2);
  });

  it('só duetos: uma resposta com tcheka não se retira por aqui', async () => {
    const { tka, tkb } = u;
    const orig = await tcheka(tka);
    const c = (await api().post(`/api/v1/posts/${orig.id}/comments`).set(auth(tka)).send({ body: 'responde-me' }).expect(201)).body as { id: string };
    const reply = await remix(tkb, { postId: orig.id, kind: 'reply', commentId: c.id });
    expect(((await api().get(`/api/v1/posts/${reply.id}`).set(auth(tka)).expect(200)).body as Post).remixOf?.canTakeDown).toBe(false);
    await api().post(`/api/v1/posts/${reply.id}/duet-takedown`).set(auth(tka)).expect(404);
  });

  it('o original apagado não impede: o vídeo continua gravado no dueto', async () => {
    const { tka, tkc } = u;
    const orig = await tcheka(tka);
    const duet = await remix(tkc, { postId: orig.id, kind: 'duet' });
    await api().delete(`/api/v1/posts/${orig.id}`).set(auth(tka)).expect(204);
    expect(((await api().get(`/api/v1/posts/${duet.id}`).set(auth(tka)).expect(200)).body as Post).remixOf?.canTakeDown).toBe(true);
    await api().post(`/api/v1/posts/${duet.id}/duet-takedown`).set(auth(tka)).expect(204);
    await api().get(`/api/v1/posts/${duet.id}`).set(auth(tkc)).expect(404);
  });

  it('eliminar a conta do autor original esconde os duetos feitos com as tchekas dele (as respostas ficam)', async () => {
    const del = await signup('tkdel');
    const orig = await tcheka(del);
    const duet = await remix(u.tkb, { postId: orig.id, kind: 'duet' });
    const c = (await api().post(`/api/v1/posts/${orig.id}/comments`).set(auth(del)).send({ body: 'comentário' }).expect(201)).body as { id: string };
    const reply = await remix(u.tkc, { postId: orig.id, kind: 'reply', commentId: c.id });
    const own = await remix(del, { postId: orig.id, kind: 'duet' }); // um dueto com a própria tcheka sai como as outras publicações
    await api().post('/api/v1/auth/delete-account').set(auth(del)).send({ confirmUsername: del.username, password: PASSWORD }).expect(204);
    await api().get(`/api/v1/posts/${duet.id}`).set(auth(u.tkc)).expect(404);
    expect((await pool.query('SELECT removed_by FROM content.posts WHERE id = $1', [duet.id])).rows[0].removed_by).toBe('original');
    expect((await pool.query('SELECT removed_by FROM content.posts WHERE id = $1', [own.id])).rows[0].removed_by).toBe('author');
    await api().get(`/api/v1/posts/${reply.id}`).set(auth(u.tkb)).expect(200);
  });
});
