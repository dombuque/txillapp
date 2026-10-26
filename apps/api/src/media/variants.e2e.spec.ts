import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { readdirSync } from 'fs';
import request from 'supertest';
import sharp from 'sharp';
import { Pool } from 'pg';
import { loadConfig } from '../config';
import { migrate } from '../db/migrate';
import { createApp } from '../main';

const DB = process.env.TEST_DATABASE_URL ?? 'postgres://txill:txill_dev@localhost:5433/txillapp_test';

describe('fotos em várias larguras (mais leves para o telemóvel)', () => {
  let app: INestApplication;
  let pool: Pool;
  let token = '';
  let username = '';
  const api = () => request(app.getHttpServer());
  const auth = () => ({ Authorization: `Bearer ${token}` });

  beforeAll(async () => {
    await migrate(DB);
    pool = new Pool({ connectionString: DB });
    app = await createApp(loadConfig({ DATABASE_URL: DB, JWT_ACCESS_SECRET: 'v'.repeat(40), NODE_ENV: 'test', MEDIA_DIR: './uploads-test' }));
    await app.init();
    username = `var${Date.now().toString(36)}`.slice(0, 28);
    const r = await api().post('/api/v1/auth/register').send({ email: `${username}@example.com`, username, displayName: 'Var', password: 'password-bem-longa-1', birthDate: '1990-06-15', acceptTerms: true }).expect(201);
    token = r.body.accessToken;
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  async function uploadPhoto() {
    // Uma foto "de telemóvel": 2400×1800, com ruído para não comprimir demais.
    const raw = Buffer.alloc(2400 * 1800 * 3);
    for (let i = 0; i < raw.length; i++) raw[i] = (i * 7 + (i >> 9)) & 255;
    const jpeg = await sharp(raw, { raw: { width: 2400, height: 1800, channels: 3 } }).jpeg({ quality: 90 }).toBuffer();
    const up = await api().post('/api/v1/media/uploads').set(auth()).send({ mime: 'image/jpeg', size: jpeg.length }).expect(201);
    await api().put(up.body.uploadUrl).set('Content-Type', 'image/jpeg').send(jpeg).expect(200);
    return { id: up.body.assetId as string, jpeg };
  }

  it('devolve WebP na largura pedida (a mais próxima), mais pequeno que o original, com cache longa', async () => {
    const { id, jpeg } = await uploadPhoto();
    const small = await api().get(`/api/v1/media/${id}?w=480`).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    }).expect(200);
    expect(small.headers['content-type']).toMatch(/image\/webp/);
    expect(small.headers['cache-control']).toMatch(/immutable/);
    const meta = await sharp(small.body).metadata();
    expect(meta.width).toBe(480);
    expect(meta.format).toBe('webp');
    expect(small.body.length).toBeLessThan(jpeg.length / 5);

    // 100 sobe para a variante de 160; pedidos enormes ficam em 1600; sem ?w= vem o original
    const tiny = await api().get(`/api/v1/media/${id}?w=100`).buffer(true).parse((res, cb) => { const c: Buffer[] = []; res.on('data', (x: Buffer) => c.push(x)); res.on('end', () => cb(null, Buffer.concat(c))); }).expect(200);
    expect((await sharp(tiny.body).metadata()).width).toBe(160);
    const huge = await api().get(`/api/v1/media/${id}?w=9999`).buffer(true).parse((res, cb) => { const c: Buffer[] = []; res.on('data', (x: Buffer) => c.push(x)); res.on('end', () => cb(null, Buffer.concat(c))); }).expect(200);
    expect((await sharp(huge.body).metadata()).width).toBe(1600);
    await api().get(`/api/v1/media/${id}`).expect(200).expect('Content-Type', /image\/jpeg/);
    await api().get(`/api/v1/media/${id}?w=abc`).expect(200).expect('Content-Type', /image\/jpeg/); // pedido inválido: original

    // várias pedidas ao mesmo tempo geram a variante uma só vez, sem ficheiros temporários à solta
    const fresh = await uploadPhoto();
    await Promise.all([1, 2, 3, 4].map(() => api().get(`/api/v1/media/${fresh.id}?w=720`).expect(200)));
    const files = readdirSync('./uploads-test').filter((f) => f.startsWith(fresh.id));
    expect(files.sort()).toEqual([fresh.id, `${fresh.id}.720.webp`].sort());
  });

  it('o avatar serve sempre a versão pequena e sem a localização GPS da foto', async () => {
    const { id } = await uploadPhoto();
    await api().put('/api/v1/users/me/avatar').set(auth()).send({ mediaId: id }).expect((r) => expect([200, 204]).toContain(r.status));
    const av = await api().get(`/api/v1/avatars/${username}`).buffer(true).parse((res, cb) => { const c: Buffer[] = []; res.on('data', (x: Buffer) => c.push(x)); res.on('end', () => cb(null, Buffer.concat(c))); }).expect(200);
    const meta = await sharp(av.body).metadata();
    expect(meta.width).toBeLessThanOrEqual(256);
    expect(meta.exif).toBeUndefined(); // metadados (como o GPS) não saem na versão servida
  });
});
