import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Pool } from 'pg';
import { loadConfig } from '../config';
import { migrate } from '../db/migrate';
import { createApp } from '../main';
import { ImageClassifier } from './image-moderation.service';

const DB = process.env.TEST_DATABASE_URL ?? 'postgres://txill:txill_dev@localhost:5433/txillapp_test';
const PASSWORD = 'password-bem-longa-1';
const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');

/** Classificador de mentira: lê a pontuação do último byte da imagem (byte/255). 0xff = falha do modelo. */
const fake: ImageClassifier = {
  async nsfwScore(image) {
    const last = image[image.length - 1];
    if (last === 0xff) throw new Error('modelo indisponível');
    return last / 255;
  },
};
const img = (score: number) => Buffer.concat([PNG, Buffer.from([Math.round(score * 254)])]);

interface U { token: string; id: string; username: string }

describe('verificação automática de fotos (nudez / conteúdo sexual)', () => {
  let app: INestApplication;
  let pool: Pool;
  const run = Date.now().toString(36);
  const api = () => request(app.getHttpServer());
  const u: Record<string, U> = {};
  const auth = (x: U) => ({ Authorization: `Bearer ${x.token}` });

  async function signup(name: string): Promise<U> {
    const username = `${name}${run}`.slice(0, 28);
    const r = await api().post('/api/v1/auth/register').send({ email: `${username}@example.com`, username, displayName: name, password: PASSWORD, birthDate: '1990-06-15', acceptTerms: true }).expect(201);
    return { token: r.body.accessToken, id: r.body.user.id, username };
  }
  const prepare = async (x: U, bytes: Buffer, purpose = 'public') =>
    (await api().post('/api/v1/media/uploads').set(auth(x)).send({ mime: 'image/png', size: bytes.length, purpose }).expect(201)).body as { assetId: string; uploadUrl: string };
  const put = (url: string, bytes: Buffer) => api().put(url).set('Content-Type', 'image/png').send(bytes);

  beforeAll(async () => {
    await migrate(DB);
    pool = new Pool({ connectionString: DB });
    app = await createApp(
      loadConfig({ DATABASE_URL: DB, JWT_ACCESS_SECRET: 'i'.repeat(40), NODE_ENV: 'test', MEDIA_DIR: './uploads-test', IMAGE_MODERATION: 'local' }),
      { imageClassifier: fake },
    );
    await app.init();
    for (const n of ['ia', 'ib']) u[n] = await signup(n);
    await pool.query('UPDATE identity.users SET is_admin = true WHERE id = $1', [u.ib.id]);
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  it('foto normal passa; foto explícita é recusada e nunca fica disponível', async () => {
    const { ia } = u;
    const ok = img(0.05);
    const a = await prepare(ia, ok);
    await put(a.uploadUrl, ok).expect(200);
    await api().get(`/api/v1/media/${a.assetId}`).expect(200);
    expect((await pool.query('SELECT nsfw_score FROM content.media_assets WHERE id = $1', [a.assetId])).rows[0].nsfw_score).toBeLessThan(0.1);

    const bad = img(0.97);
    const b = await prepare(ia, bad);
    const res = await put(b.uploadUrl, bad).expect(422);
    expect(res.body.message).toMatch(/nudez|sexual/i);
    await api().get(`/api/v1/media/${b.assetId}`).expect(404);
    // e não dá para a usar numa publicação
    await api().post('/api/v1/posts').set(auth(ia)).send({ body: 'tentativa', mediaIds: [b.assetId] }).expect(400);
    expect((await pool.query('SELECT status FROM content.media_assets WHERE id = $1', [b.assetId])).rows[0].status).toBe('deleted');
  });

  it('zona duvidosa: passa, mas vai para a fila da moderação, que pode remover a foto', async () => {
    const { ia, ib } = u;
    const maybe = img(0.65);
    const m = await prepare(ia, maybe);
    await put(m.uploadUrl, maybe).expect(200);
    await api().get(`/api/v1/media/${m.assetId}`).expect(200);

    const q = ((await api().get('/api/v1/admin/reports').set(auth(ib)).expect(200)).body as { type: string; id: string; imageUrl: string | null; preview: string; owner: { username: string } }[]).find((x) => x.id === m.assetId)!;
    expect(q).toMatchObject({ type: 'media', imageUrl: `/api/v1/media/${m.assetId}`, owner: { username: ia.username } });
    expect(q.preview).toMatch(/verificação automática/i);

    await api().post('/api/v1/admin/reports/resolve').set(auth(ib)).send({ type: 'media', id: m.assetId, action: 'remove' }).expect(204);
    await api().get(`/api/v1/media/${m.assetId}`).expect(404);
    // as pessoas não conseguem denunciar "media" à mão
    await api().post('/api/v1/reports').set(auth(ia)).send({ type: 'media', id: m.assetId, reason: 'spam' }).expect(400);
  });

  it('fotos no chat também são verificadas; se o modelo falhar, a foto é recusada (falha fechada)', async () => {
    const { ia } = u;
    const bad = img(0.99);
    const c = await prepare(ia, bad, 'chat');
    await put(c.uploadUrl, bad).expect(422);

    const broken = Buffer.concat([PNG, Buffer.from([0xff])]);
    const f = await prepare(ia, broken);
    await put(f.uploadUrl, broken).expect(503);
    await api().get(`/api/v1/media/${f.assetId}`).expect(404);
  });

  it('gravações de voz não passam pelo classificador de imagens', async () => {
    const { ia } = u;
    const audio = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]);
    const r = await api().post('/api/v1/media/uploads').set(auth(ia)).send({ mime: 'audio/webm', size: audio.length, purpose: 'chat' }).expect(201);
    await api().put(r.body.uploadUrl).set('Content-Type', 'audio/webm').send(audio).expect(200);
  });
});
