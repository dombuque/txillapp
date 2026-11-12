import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { readFileSync } from 'fs';
import { join } from 'path';
import request from 'supertest';
import sharp from 'sharp';
import { Pool } from 'pg';
import { loadConfig } from '../config';
import { migrate } from '../db/migrate';
import { createApp } from '../main';

const DB = process.env.TEST_DATABASE_URL ?? 'postgres://txill:txill_dev@localhost:5433/txillapp_test';
const MEDIA_DIR = './uploads-test';

describe('fotos carregadas perdem o EXIF (GPS, aparelho) no envio real (armazenamento local)', () => {
  let app: INestApplication;
  let pool: Pool;
  let token = '';
  const api = () => request(app.getHttpServer());
  const auth = () => ({ Authorization: `Bearer ${token}` });

  beforeAll(async () => {
    await migrate(DB);
    pool = new Pool({ connectionString: DB });
    app = await createApp(loadConfig({ DATABASE_URL: DB, JWT_ACCESS_SECRET: 'x'.repeat(40), NODE_ENV: 'test', MEDIA_DIR }));
    await app.init();
    const username = `exf${Date.now().toString(36)}`.slice(0, 28);
    const r = await api().post('/api/v1/auth/register').send({ email: `${username}@example.com`, username, displayName: 'Exif', password: 'password-bem-longa-1', birthDate: '1990-06-15', acceptTerms: true }).expect(201);
    token = r.body.accessToken;
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  async function jpegWithGps() {
    const raw = Buffer.alloc(320 * 240 * 3);
    for (let i = 0; i < raw.length; i++) raw[i] = (i * 13) & 255;
    const jpeg = await sharp(raw, { raw: { width: 320, height: 240, channels: 3 } })
      .jpeg({ quality: 90 })
      .withExif({
        IFD0: { Make: 'TxillPhone', Model: 'Segredo 9000' },
        IFD3: { GPSLatitudeRef: 'S', GPSLatitude: '25/1 58/1 0/1', GPSLongitudeRef: 'E', GPSLongitude: '32/1 34/1 0/1' },
      })
      .toBuffer();
    const meta = await sharp(jpeg).metadata();
    // Garantia de que o teste parte de uma foto com EXIF e GPS a sério.
    expect(meta.exif).toBeDefined();
    expect(meta.exif!.toString('latin1')).toContain('TxillPhone');
    return jpeg;
  }

  it.each(['public', 'chat'] as const)('foto %s: o original guardado e o servido não têm EXIF', async (purpose) => {
    const jpeg = await jpegWithGps();
    const up = await api().post('/api/v1/media/uploads').set(auth()).send({ mime: 'image/jpeg', size: jpeg.length, purpose }).expect(201);
    await api().put(up.body.uploadUrl).set('Content-Type', 'image/jpeg').send(jpeg).expect(200);
    const id = up.body.assetId as string;

    // No disco.
    const stored = readFileSync(join(MEDIA_DIR, id));
    const sm = await sharp(stored).metadata();
    expect(sm.format).toBe('jpeg');
    expect(sm.exif).toBeUndefined();
    expect(stored.toString('latin1')).not.toContain('TxillPhone');
    expect(sm.width).toBe(320);

    // O tamanho registado é o do ficheiro limpo.
    const row = (await pool.query('SELECT status, size_bytes FROM content.media_assets WHERE id = $1', [id])).rows[0];
    expect(row.status).toBe('ready');
    expect(Number(row.size_bytes)).toBe(stored.length);

    // O original servido (sem ?w=). As do chat só saem pela conversa, não por /media/:id.
    if (purpose === 'chat') return;
    const served = await api().get(`/api/v1/media/${id}`).set(auth()).buffer(true).parse((res, cb) => { const c: Buffer[] = []; res.on('data', (x: Buffer) => c.push(x)); res.on('end', () => cb(null, Buffer.concat(c))); }).expect(200);
    expect(served.headers['content-type']).toMatch(/image\/jpeg/);
    expect((await sharp(served.body as Buffer).metadata()).exif).toBeUndefined();
    expect((served.body as Buffer).toString('latin1')).not.toContain('TxillPhone');
  });

  it('foto da TxillCam (JPEG de canvas, sem metadados): fica guardada tal e qual, sem recomprimir, e com as larguras todas', async () => {
    // 2160×2700: a foto 4:5 que a câmara do site tira agora no iPhone.
    const raw = Buffer.alloc(2160 * 2700 * 3);
    for (let i = 0; i < raw.length; i++) raw[i] = ((i * 7) ^ (i >> 9)) & 255;
    const jpeg = await sharp(raw, { raw: { width: 2160, height: 2700, channels: 3 } }).jpeg({ quality: 92 }).toBuffer();
    const up = await api().post('/api/v1/media/uploads').set(auth()).send({ mime: 'image/jpeg', size: jpeg.length, purpose: 'public' }).expect(201);
    await api().put(up.body.uploadUrl).set('Content-Type', 'image/jpeg').send(jpeg).expect(200);
    const id = up.body.assetId as string;
    const stored = readFileSync(join(MEDIA_DIR, id));
    expect(stored.equals(jpeg)).toBe(true);
    const row = (await pool.query('SELECT size_bytes FROM content.media_assets WHERE id = $1', [id])).rows[0];
    expect(Number(row.size_bytes)).toBe(jpeg.length);
    // O feed de um iPhone (DPR 3) pede 1080; o visor de fotos 1600.
    for (const w of [1080, 1600]) {
      const v = await api().get(`/api/v1/media/${id}?w=${w}`).set(auth()).buffer(true).parse((res, cb) => { const c: Buffer[] = []; res.on('data', (x: Buffer) => c.push(x)); res.on('end', () => cb(null, Buffer.concat(c))); }).expect(200);
      expect(v.headers['content-type']).toMatch(/image\/webp/);
      expect((await sharp(v.body as Buffer).metadata()).width).toBe(w);
    }
  }, 60_000);
});
