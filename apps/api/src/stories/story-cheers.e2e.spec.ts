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

describe('brindar um story: conta e mostra quem brindou, sem enviar mensagem (integração)', () => {
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

  beforeAll(async () => {
    await migrate(DB);
    pool = new Pool({ connectionString: DB });
    app = await createApp(loadConfig({ DATABASE_URL: DB, JWT_ACCESS_SECRET: 'd'.repeat(40), NODE_ENV: 'test', MEDIA_DIR: './uploads-test' }));
    await app.init();
    for (const n of ['sca', 'scb', 'scc']) u[n] = await signup(n);
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  it('brindar e tirar o brinde: o autor vê a contagem e quem brindou; o espectador vê o seu estado; nenhuma mensagem é criada', async () => {
    const { sca, scb, scc } = u;
    const up = await api().post('/api/v1/media/uploads').set(auth(sca)).send({ mime: 'image/png', size: PNG.length }).expect(201);
    await api().put(up.body.uploadUrl).set('Content-Type', 'image/png').send(PNG).expect(200);
    const story = (await api().post('/api/v1/stories').set(auth(sca)).send({ mediaId: up.body.assetId, caption: 'brindem' }).expect(201)).body;

    const mine = async () => ((await api().get(`/api/v1/stories/user/${sca.username}`).set(auth(sca)).expect(200)).body as { id: string; cheerCount: number | null; cheered: boolean }[]).find((s) => s.id === story.id)!;
    const theirs = async (x: U) => ((await api().get(`/api/v1/stories/user/${sca.username}`).set(auth(x)).expect(200)).body as { id: string; cheerCount: number | null; cheered: boolean }[]).find((s) => s.id === story.id)!;

    expect(await mine()).toMatchObject({ cheerCount: 0 });
    await api().put(`/api/v1/stories/${story.id}/cheer`).set(auth(scb)).expect(200);
    await api().put(`/api/v1/stories/${story.id}/cheer`).set(auth(scb)).expect(200); // repetir não duplica
    await api().put(`/api/v1/stories/${story.id}/cheer`).set(auth(scc)).expect(200);
    expect(await mine()).toMatchObject({ cheerCount: 2 });
    expect(await theirs(scb)).toMatchObject({ cheered: true, cheerCount: null }); // só o autor vê o número
    expect((await theirs(scc)).cheered).toBe(true);

    // Quem brindou aparece na lista de quem viu, marcado.
    const viewers = (await api().get(`/api/v1/stories/${story.id}/viewers`).set(auth(sca)).expect(200)).body as { username: string; cheered: boolean }[];
    expect(viewers.find((v) => v.username === scb.username)?.cheered).toBe(true);

    // NÃO enviou mensagem nenhuma ao autor.
    const msgs = await pool.query(`SELECT count(*)::int AS n FROM social.messages m JOIN social.conversations c ON c.id = m.conversation_id WHERE m.sender_id = $1 AND (c.user_a = $2 OR c.user_b = $2)`, [scb.id, sca.id]);
    expect(msgs.rows[0].n).toBe(0);

    await api().delete(`/api/v1/stories/${story.id}/cheer`).set(auth(scb)).expect(200);
    expect(await mine()).toMatchObject({ cheerCount: 1 });
    expect((await theirs(scb)).cheered).toBe(false);

    await api().put(`/api/v1/stories/${story.id}/cheer`).set(auth(sca)).expect(400); // não se brinda o próprio story
    await api().put(`/api/v1/stories/${story.id}/cheer`).expect(401);
  });
});
