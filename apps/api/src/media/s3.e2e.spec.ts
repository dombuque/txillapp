import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import http from 'http';
import { AddressInfo } from 'net';
import request from 'supertest';
import { Pool } from 'pg';
import { loadConfig } from '../config';
import { migrate } from '../db/migrate';
import { createApp } from '../main';
import { MediaService } from './media.service';

const DB = process.env.TEST_DATABASE_URL ?? 'postgres://txill:txill_dev@localhost:5433/txillapp_test';
const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');
const JPEG = Buffer.from('ffd8ffe000104a46494600010100000100010000', 'hex');
const PASSWORD = 'password-bem-longa-1';

/** Um S3 mínimo em memória (PUT, GET com Range, HEAD, DELETE): chega para testar o fluxo do servidor sem a nuvem. */
function fakeS3() {
  const objects = new Map<string, { body: Buffer; type: string }>();
  const server = http.createServer((req, res) => {
    const key = decodeURIComponent((req.url ?? '').split('?')[0]).replace(/^\/test\//, '');
    if (req.method === 'PUT') {
      const chunks: Buffer[] = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        objects.set(key, { body: Buffer.concat(chunks), type: String(req.headers['content-type']) });
        res.writeHead(200, { ETag: '"x"' }).end();
      });
      return;
    }
    const o = objects.get(key);
    if (req.method === 'DELETE') {
      objects.delete(key);
      return void res.writeHead(204).end();
    }
    if (!o) return void res.writeHead(404, { 'Content-Type': 'application/xml' }).end('<Error><Code>NoSuchKey</Code></Error>');
    if (req.method === 'HEAD') return void res.writeHead(200, { 'Content-Length': o.body.length, 'Content-Type': o.type }).end();
    const m = /bytes=(\d+)-(\d+)/.exec(String(req.headers.range ?? ''));
    const part = m ? o.body.subarray(Number(m[1]), Number(m[2]) + 1) : o.body;
    res.writeHead(m ? 206 : 200, { 'Content-Length': part.length, 'Content-Type': o.type }).end(part);
  });
  return { server, objects };
}

describe('armazenamento S3 (servidor S3 simulado)', () => {
  let app: INestApplication;
  let pool: Pool;
  const s3 = fakeS3();
  const run = Date.now().toString(36);
  const api = () => request(app.getHttpServer());
  let token = '';
  let userId = '';

  beforeAll(async () => {
    await new Promise<void>((r) => s3.server.listen(0, '127.0.0.1', r));
    const port = (s3.server.address() as AddressInfo).port;
    await migrate(DB);
    pool = new Pool({ connectionString: DB });
    app = await createApp(
      loadConfig({
        DATABASE_URL: DB, JWT_ACCESS_SECRET: 's'.repeat(40), NODE_ENV: 'test',
        STORAGE_DRIVER: 's3', S3_BUCKET: 'test', S3_ENDPOINT: `http://127.0.0.1:${port}`, S3_FORCE_PATH_STYLE: 'true',
        S3_ACCESS_KEY_ID: 'chave-de-teste', S3_SECRET_ACCESS_KEY: 'segredo-de-teste',
      }),
    );
    await app.init();
    const username = `s3u${run}`.slice(0, 28);
    const r = await api().post('/api/v1/auth/register').send({ email: `${username}@example.com`, username, displayName: 'S3', password: PASSWORD, birthDate: '1990-06-15', acceptTerms: true }).expect(201);
    token = r.body.accessToken;
    userId = r.body.user.id;
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await pool.end();
    await new Promise((r) => s3.server.close(r));
  });

  const auth = () => ({ Authorization: `Bearer ${token}` });
  const upload = async (mime: string, bytes: Buffer, purpose?: string) => {
    const r = await api().post('/api/v1/media/uploads').set(auth()).send({ mime, size: bytes.length, purpose }).expect(201);
    expect(r.body.uploadUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/test\//); // vai directo para o bucket
    const put = await fetch(r.body.uploadUrl, { method: 'PUT', body: bytes, headers: { 'Content-Type': mime } });
    expect(put.ok).toBe(true);
    return r.body.assetId as string;
  };

  it('upload directo para o bucket; só fica pronto depois de validado; a leitura redirecciona', async () => {
    const id = await upload('image/png', PNG);
    // ainda 'pending': não se serve
    await api().get(`/api/v1/media/${id}`).expect(404);
    await api().post(`/api/v1/media/${id}/complete`).expect(401);
    await api().post(`/api/v1/media/${id}/complete`).set(auth()).expect(200);
    await api().post(`/api/v1/media/${id}/complete`).set(auth()).expect(200); // idempotente

    const res = await api().get(`/api/v1/media/${id}`).expect(302);
    const file = await fetch(res.headers.location);
    expect(Buffer.from(await file.arrayBuffer()).equals(PNG)).toBe(true);
  });

  it('tipo falso ou ficheiro que não existe: recusado e apagado do bucket', async () => {
    const fake = await upload('image/png', JPEG); // diz PNG, mas é JPEG
    await api().post(`/api/v1/media/${fake}/complete`).set(auth()).expect(415);
    expect(s3.objects.has(fake)).toBe(false);

    const r = await api().post('/api/v1/media/uploads').set(auth()).send({ mime: 'image/png', size: 10 }).expect(201);
    await api().post(`/api/v1/media/${r.body.assetId}/complete`).set(auth()).expect(404); // nunca enviado
  });

  it('chat: só por URL assinado do servidor; apagar a conta apaga o ficheiro do bucket', async () => {
    const mine = await signupOther();
    const id = await upload('image/png', PNG, 'chat');
    await api().post(`/api/v1/media/${id}/complete`).set(auth()).expect(200);
    await api().get(`/api/v1/media/${id}`).expect(404); // chat nunca pela rota pública

    await api().post(`/api/v1/chat/with/${mine.username}`).set(auth()).send({ kind: 'image', mediaId: id }).expect(201);
    const t = (await api().get(`/api/v1/chat/with/${mine.username}`).set(auth()).expect(200)).body;
    const signed = await api().get(t.items[0].mediaUrl).expect(302);
    expect(signed.headers.location).toMatch(/X-Amz-Signature=/);
    expect(Buffer.from(await (await fetch(signed.headers.location)).arrayBuffer()).equals(PNG)).toBe(true);

    await pool.query(`UPDATE content.media_assets SET status = 'deleted' WHERE owner_id = $1`, [userId]);
    await app.get(MediaService).sweepDeleted();
    expect(s3.objects.has(id)).toBe(false);
  });

  async function signupOther() {
    const username = `s3o${run}`.slice(0, 28);
    await api().post('/api/v1/auth/register').send({ email: `${username}@example.com`, username, displayName: 'Outro', password: PASSWORD, birthDate: '1990-06-15', acceptTerms: true }).expect(201);
    return { username };
  }

  it('sem credenciais o servidor nem arranca com STORAGE_DRIVER=s3', () => {
    expect(() => loadConfig({ DATABASE_URL: DB, JWT_ACCESS_SECRET: 'x'.repeat(40), STORAGE_DRIVER: 's3' })).toThrow(/S3_BUCKET/);
  });
});
