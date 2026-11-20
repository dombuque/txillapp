import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { loadConfig } from '../config';
import { migrate } from '../db/migrate';
import { createApp } from '../main';
import { normalizeImageMime } from './media.service';

const DB = process.env.TEST_DATABASE_URL ?? 'postgres://txill:txill_dev@localhost:5433/txillapp_test';

describe('tipos de ficheiro ao pedir o envio (integração)', () => {
  let app: INestApplication;
  let token = '';
  const run = Date.now().toString(36);
  const api = () => request(app.getHttpServer());

  beforeAll(async () => {
    await migrate(DB);
    app = await createApp(loadConfig({ DATABASE_URL: DB, JWT_ACCESS_SECRET: 'q'.repeat(40), NODE_ENV: 'test', MEDIA_DIR: './uploads-test' }));
    await app.init();
    const username = `mime${run}`.slice(0, 28);
    const r = await api().post('/api/v1/auth/register').send({ email: `${username}@example.com`, username, displayName: 'Mime', password: 'password-bem-longa-1', birthDate: '1990-06-15', acceptTerms: true }).expect(201);
    token = r.body.accessToken;
  }, 60_000);

  afterAll(async () => {
    await app.close();
  });

  it('«image/jpg», «image/pjpeg» e maiúsculas são JPEG (alguns Android mandam assim); HEIC continua recusado', async () => {
    expect(normalizeImageMime('image/jpg')).toBe('image/jpeg');
    expect(normalizeImageMime(' IMAGE/PJPEG ')).toBe('image/jpeg');
    expect(normalizeImageMime('image/png')).toBe('image/png');
    const ask = (mime: string) => api().post('/api/v1/media/uploads').set({ Authorization: `Bearer ${token}` }).send({ mime, size: 1000, purpose: 'public' });
    for (const mime of ['image/jpg', 'image/pjpeg', 'IMAGE/JPEG']) expect((await ask(mime)).status).toBe(201);
    expect((await ask('image/heic')).status).toBe(415);
  });
});
