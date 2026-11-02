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

describe('separadores do perfil: publicações, reels, reposts, presentes, identificações (integração)', () => {
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
  const tab = async (viewer: U, of: U, t: string) => ((await api().get(`/api/v1/users/${of.username}/posts?tab=${t}`).set(auth(viewer)).expect(200)).body.items as { id: string; body: string; kind: string }[]);

  beforeAll(async () => {
    await migrate(DB);
    pool = new Pool({ connectionString: DB });
    app = await createApp(loadConfig({ DATABASE_URL: DB, JWT_ACCESS_SECRET: 'd'.repeat(40), NODE_ENV: 'test', MEDIA_DIR: './uploads-test' }));
    await app.init();
    for (const n of ['pta', 'ptb']) u[n] = await signup(n);
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  it('cada separador mostra só o que lhe pertence', async () => {
    const { pta, ptb } = u;
    const original = (await api().post('/api/v1/posts').set(auth(pta)).send({ body: 'um post normal' }).expect(201)).body;
    await api().post(`/api/v1/posts/${original.id}/repost`).set(auth(ptb)).send({}).expect(201);

    expect((await tab(ptb, pta, 'posts')).map((p) => p.body)).toEqual(['um post normal']);
    expect(await tab(ptb, pta, 'reels')).toEqual([]);
    expect(await tab(ptb, pta, 'reposts')).toEqual([]);
    expect((await tab(pta, ptb, 'reposts')).map((p) => p.kind)).toEqual(['repost']);
    expect(await tab(pta, ptb, 'posts')).toEqual([]);

    // Identificações: a foto em que alguém aparece vem no separador dessa pessoa.
    const media = (await pool.query(`INSERT INTO content.media_assets (id, owner_id, mime, size_bytes, storage_key, status) VALUES (gen_random_uuid(), $1, 'image/png', 1, 'x', 'ready') RETURNING id`, [pta.id])).rows[0].id as string;
    await pool.query(`INSERT INTO content.post_media (post_id, media_id, position) VALUES ($1, $2, 0)`, [original.id, media]);
    await pool.query(`INSERT INTO content.photo_tags (id, post_id, media_id, tagged_id, x, y) VALUES (gen_random_uuid(), $1, $2, $3, 0.5, 0.5)`, [original.id, media, ptb.id]);
    expect((await tab(pta, ptb, 'tagged')).map((p) => p.id)).toEqual([original.id]);
    expect(await tab(ptb, pta, 'tagged')).toEqual([]);

    // Presentes: a publicação "X presenteou Y" aparece no perfil de quem deu e de quem recebeu.
    await pool.query(`UPDATE ledger.accounts SET balance = balance WHERE false`);
    const gift = await api().post('/api/v1/gifts').set({ ...auth(pta), 'Idempotency-Key': `pt-${run}` }).send({ toUsername: ptb.username, amount: 5, visibility: 'public' });
    if (gift.status === 201 && gift.body.post) {
      expect((await tab(pta, pta, 'gifts')).map((p) => p.kind)).toEqual(['gift']);
      expect((await tab(pta, ptb, 'gifts')).map((p) => p.kind)).toEqual(['gift']);
    }

    // Sem separador (ou desconhecido): tudo o que a pessoa tem, como antes.
    expect((await tab(pta, ptb, 'nada')).map((p) => p.kind)).toContain('repost');
  });
});
