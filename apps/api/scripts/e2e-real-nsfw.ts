// Prova ponta a ponta com o modelo real (fora do Jest, que isola o Float32Array do onnxruntime):
//   npx ts-node scripts/e2e-real-nsfw.ts caminho/para/foto.jpg
import 'reflect-metadata';
import { readFileSync } from 'fs';
import request from 'supertest';
import { Pool } from 'pg';
import { loadConfig } from '../src/config';
import { migrate } from '../src/db/migrate';
import { createApp } from '../src/main';

const DB = process.env.TEST_DATABASE_URL ?? 'postgres://txill:txill_dev@localhost:5433/txillapp_test';

(async () => {
  const file = process.argv[2];
  if (!file) throw new Error('indica uma foto');
  await migrate(DB);
  const pool = new Pool({ connectionString: DB });
  const app = await createApp(loadConfig({ DATABASE_URL: DB, JWT_ACCESS_SECRET: 'r'.repeat(40), NODE_ENV: 'test', MEDIA_DIR: './uploads-test', IMAGE_MODERATION: 'local' }));
  await app.init();
  const api = () => request(app.getHttpServer());
  const name = `real${Date.now().toString(36)}`.slice(0, 28);
  const reg = await api().post('/api/v1/auth/register').send({ email: `${name}@example.com`, username: name, displayName: 'Real', password: 'password-bem-longa-1', birthDate: '1990-06-15', acceptTerms: true });
  const bytes = readFileSync(file);
  const mime = /\.png$/i.test(file) ? 'image/png' : 'image/jpeg';
  const auth = { Authorization: `Bearer ${reg.body.accessToken}` };
  const up = await api().post('/api/v1/media/uploads').set(auth).send({ mime, size: bytes.length });
  const put = await api().put(up.body.uploadUrl).set('Content-Type', mime).send(bytes);
  const row = (await pool.query('SELECT status, nsfw_score FROM content.media_assets WHERE id = $1', [up.body.assetId])).rows[0];
  console.log(`${file}: HTTP ${put.status} · estado=${row.status} · nsfw=${(row.nsfw_score * 100).toFixed(1)}%${put.status === 422 ? ' · RECUSADA: ' + put.body.message : ''}`);
  await app.close();
  await pool.end();
})().catch((e) => {
  console.error('ERRO:', e.message);
  process.exit(1);
});
