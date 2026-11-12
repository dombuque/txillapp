import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Pool } from 'pg';
import { loadConfig } from '../config';
import { migrate } from '../db/migrate';
import { createApp } from '../main';
import { stickersSvg } from './stickers';

const DB = process.env.TEST_DATABASE_URL ?? 'postgres://txill:txill_dev@localhost:5433/txillapp_test';
const PASSWORD = 'password-bem-longa-1';
const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');

interface U { token: string; id: string; username: string }

describe('stickers nos mimos e partilhar a própria publicação (integração)', () => {
  let app: INestApplication;
  let pool: Pool;
  const run = Date.now().toString(36);
  const api = () => request(app.getHttpServer());
  const auth = (x: U) => ({ Authorization: `Bearer ${x.token}` });
  let me: U;

  async function signup(name: string): Promise<U> {
    const username = `${name}${run}`.slice(0, 28);
    const r = await api().post('/api/v1/auth/register').send({ email: `${username}@example.com`, username, displayName: `${name} Teste`, password: PASSWORD, birthDate: '1990-06-15', acceptTerms: true }).expect(201);
    return { token: r.body.accessToken, id: r.body.user.id, username };
  }
  async function upload(x: U): Promise<string> {
    const up = await api().post('/api/v1/media/uploads').set(auth(x)).send({ mime: 'image/png', size: PNG.length }).expect(201);
    await api().put(up.body.uploadUrl).set('Content-Type', 'image/png').send(PNG).expect(200);
    return up.body.assetId as string;
  }

  beforeAll(async () => {
    await migrate(DB);
    pool = new Pool({ connectionString: DB });
    app = await createApp(loadConfig({ DATABASE_URL: DB, JWT_ACCESS_SECRET: 'd'.repeat(40), NODE_ENV: 'test', MEDIA_DIR: './uploads-test' }));
    await app.init();
    me = await signup('stk');
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  it('guarda os stickers do mimo e devolve-os a quem o vê; recusa stickers desconhecidos ou a mais', async () => {
    const stickers = [{ id: 'm-fogo', x: 0.5, y: 0.4, s: 0.3, r: -8 }, { id: 'bora', x: 0.2, y: 0.7, s: 0.25, r: 12.5 }];
    const m1 = await upload(me);
    const story = (await api().post('/api/v1/stories').set(auth(me)).send({ mediaId: m1, caption: 'com stickers', stickers }).expect(201)).body;
    expect(story.stickers).toEqual(stickers);
    const mine = (await api().get(`/api/v1/stories/user/${me.username}`).set(auth(me)).expect(200)).body as { id: string; stickers: unknown }[];
    expect(mine.find((s) => s.id === story.id)?.stickers).toEqual(stickers);

    const m2 = await upload(me);
    await api().post('/api/v1/stories').set(auth(me)).send({ mediaId: m2, stickers: [{ id: 'nao-existe', x: 0.5, y: 0.5, s: 0.3, r: 0 }] }).expect(400);
    await api().post('/api/v1/stories').set(auth(me)).send({ mediaId: m2, stickers: Array.from({ length: 13 }, () => ({ id: 'm-fogo', x: 0.5, y: 0.5, s: 0.3, r: 0 })) }).expect(400);

    // Sem stickers: lista vazia (não null), para a app não ter de adivinhar.
    const plain = (await api().post('/api/v1/stories').set(auth(me)).send({ mediaId: m2 }).expect(201)).body;
    expect(plain.stickers).toEqual([]);
  });

  it('a cópia guardada leva os stickers desenhados à escala da imagem', () => {
    const svg = stickersSvg(1080, 1920, [{ id: 'm-coracao', x: 0.5, y: 0.5, s: 0.5, r: 10 }]);
    expect(svg).toContain('rotate(10.00 540.00 960.00)');
    expect(svg).toContain('width="540.00"');
    expect(svg).toContain('viewBox="0 0 100 100"');
    expect(stickersSvg(1080, 1920, [])).toBe('');
  });

  it('uma conta privada partilha a sua própria publicação no mimo (com stickers); a de outra pessoa privada não', async () => {
    await pool.query('UPDATE identity.users SET is_private = true WHERE id = $1', [me.id]);
    const m3 = await upload(me);
    const post = (await api().post('/api/v1/posts').set(auth(me)).send({ body: 'a minha foto', mediaIds: [m3] }).expect(201)).body;
    const shared = (await api().post('/api/v1/stories/share').set(auth(me)).send({ postId: post.id, stickers: [{ id: 'm-txilla', x: 0.5, y: 0.8, s: 0.4, r: 0 }] }).expect(201)).body;
    expect(shared.sharedFrom?.postId).toBe(post.id);
    expect(shared.stickers).toHaveLength(1);

    const other = await signup('stko');
    await api().post('/api/v1/stories/share').set(auth(other)).send({ postId: post.id }).expect(404);
  });

  it('partilhar uma publicação no mimo também leva música', async () => {
    const good = { id: 'ov-share-1', title: 'Marrabenta da partilha', artist: 'Artista Livre', url: 'https://cdn.freesound.org/previews/1/1_1-hq.mp3', landing: 'https://freesound.org/s/1/', license: 'by', licenseUrl: 'https://creativecommons.org/licenses/by/4.0/', durationMs: 90000, cover: null };
    const track = { id: good.id, title: good.title, artist: good.artist, duration: 90, previewUrl: good.url, cover: null, source: 'ccmixter', license: 'by', licenseUrl: good.licenseUrl, landing: good.landing, styles: ['marrabenta'], kind: 'music' };
    await pool.query(
      `INSERT INTO content.music_catalog (id, source, kind, track, styles, quality) VALUES ($1, 'ccmixter', 'music', $2, '{marrabenta}', 0.8)
       ON CONFLICT (id) DO UPDATE SET track = EXCLUDED.track, refreshed_at = now()`,
      [good.id, JSON.stringify(track)],
    );
    const me = await signup('stkm');
    const m = await upload(me);
    const post = (await api().post('/api/v1/posts').set(auth(me)).send({ body: 'com música', mediaIds: [m] }).expect(201)).body;
    const shared = (await api().post('/api/v1/stories/share').set(auth(me)).send({ postId: post.id, music: good }).expect(201)).body;
    expect(shared.sharedFrom?.postId).toBe(post.id);
    expect(shared.music?.title).toBe(good.title);
    // sem música continua a funcionar
    const plain = (await api().post('/api/v1/stories/share').set(auth(me)).send({ postId: post.id }).expect(201)).body;
    expect(plain.music ?? null).toBeNull();
  });
});
