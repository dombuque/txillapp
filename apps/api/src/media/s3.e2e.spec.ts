import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import http from 'http';
import { AddressInfo } from 'net';
import { execFileSync } from 'child_process';
import { mkdtempSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import ffmpegPath from 'ffmpeg-static';
import sharp from 'sharp';
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
    // A chave inclui o bucket ("test/<id>" público, "private/<id>" privado): assim vê-se em qual ficou cada ficheiro.
    const key = decodeURIComponent((req.url ?? '').split('?')[0]).replace(/^\//, '');
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
  let username = '';

  beforeAll(async () => {
    await new Promise<void>((r) => s3.server.listen(0, '127.0.0.1', r));
    const port = (s3.server.address() as AddressInfo).port;
    await migrate(DB);
    pool = new Pool({ connectionString: DB });
    app = await createApp(
      loadConfig({
        DATABASE_URL: DB, JWT_ACCESS_SECRET: 's'.repeat(40), NODE_ENV: 'test',
        STORAGE_DRIVER: 's3', S3_BUCKET: 'test', S3_PRIVATE_BUCKET: 'private', S3_ENDPOINT: `http://127.0.0.1:${port}`, S3_FORCE_PATH_STYLE: 'true',
        S3_ACCESS_KEY_ID: 'chave-de-teste', S3_SECRET_ACCESS_KEY: 'segredo-de-teste',
      }),
    );
    await app.init();
    username = `s3u${run}`.slice(0, 28);
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
    expect(r.body.uploadUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/(test|private)\//); // vai directo para o bucket
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
    expect(s3.objects.has(`test/${fake}`)).toBe(false);

    const r = await api().post('/api/v1/media/uploads').set(auth()).send({ mime: 'image/png', size: 10 }).expect(201);
    await api().post(`/api/v1/media/${r.body.assetId}/complete`).set(auth()).expect(404); // nunca enviado
  });

  it('chat: só por URL assinado do servidor; apagar a conta apaga o ficheiro do bucket', async () => {
    const mine = await signupOther();
    const id = await upload('image/png', PNG, 'chat');
    await api().post(`/api/v1/media/${id}/complete`).set(auth()).expect(200);
    await api().get(`/api/v1/media/${id}`).expect(404); // chat nunca pela rota pública
    expect(s3.objects.has(`private/${id}`)).toBe(true); // vive no bucket privado…
    expect(s3.objects.has(`test/${id}`)).toBe(false); // …e nunca no público

    await api().post(`/api/v1/chat/with/${mine.username}`).set(auth()).send({ kind: 'image', mediaId: id }).expect(201);
    const t = (await api().get(`/api/v1/chat/with/${mine.username}`).set(auth()).expect(200)).body;
    const signed = await api().get(t.items[0].mediaUrl).expect(302);
    expect(signed.headers.location).toMatch(/X-Amz-Signature=/);
    expect(Buffer.from(await (await fetch(signed.headers.location)).arrayBuffer()).equals(PNG)).toBe(true);

    await pool.query(`UPDATE content.media_assets SET status = 'deleted' WHERE owner_id = $1`, [userId]);
    await app.get(MediaService).sweepDeleted();
    expect(s3.objects.has(`private/${id}`)).toBe(false);
  });

  async function signupOther() {
    const username = `s3o${run}`.slice(0, 28);
    await api().post('/api/v1/auth/register').send({ email: `${username}@example.com`, username, displayName: 'Outro', password: PASSWORD, birthDate: '1990-06-15', acceptTerms: true }).expect(201);
    return { username };
  }

  it('fotos públicas ganham versões leves; o avatar serve a pequena; tudo é apagado com a conta', async () => {
    const raw = Buffer.alloc(1600 * 1200 * 3);
    for (let i = 0; i < raw.length; i++) raw[i] = (i * 7 + (i >> 9)) & 255;
    const jpeg = await sharp(raw, { raw: { width: 1600, height: 1200, channels: 3 } }).jpeg({ quality: 90 }).toBuffer();
    const id = await upload('image/jpeg', jpeg);
    await api().post(`/api/v1/media/${id}/complete`).set(auth()).expect(200);
    for (const w of [160, 256, 480, 720, 1080, 1600]) expect(s3.objects.has(`test/${id}.${w}.webp`)).toBe(true);

    const small = await api().get(`/api/v1/media/${id}?w=480`).expect(302);
    expect(small.headers.location).toContain(`${id}.480.webp`);
    const bytes = Buffer.from(await (await fetch(small.headers.location)).arrayBuffer());
    expect((await sharp(bytes).metadata()).width).toBe(480);
    expect(bytes.length).toBeLessThan(jpeg.length / 4);
    expect((await api().get(`/api/v1/media/${id}?w=999999`).expect(302)).headers.location).toContain(`${id}.1600.webp`);
    expect((await api().get(`/api/v1/media/${id}`).expect(302)).headers.location).not.toContain('.webp'); // sem ?w= vem o original

    await api().put('/api/v1/users/me/avatar').set(auth()).send({ mediaId: id }).expect((r) => expect([200, 204]).toContain(r.status));
    const av = await api().get(`/api/v1/avatars/${username}`).expect(302);
    expect(av.headers.location).toContain(`${id}.256.webp`);

    await pool.query(`UPDATE content.media_assets SET status = 'deleted' WHERE id = $1`, [id]);
    await app.get(MediaService).sweepDeleted();
    expect([...s3.objects.keys()].filter((k) => k.includes(id))).toEqual([]); // original e todas as versões
  });

  it('vídeos na nuvem: o original espera no bucket privado, converte-se, e só o resultado fica público', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'txill-s3v-'));
    const file = join(dir, 'v.mp4');
    execFileSync(ffmpegPath as unknown as string, ['-y', '-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=15:duration=2', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', file], { stdio: 'ignore' });
    const bytes = readFileSync(file);

    const r = await api().post('/api/v1/media/uploads').set(auth()).send({ mime: 'video/mp4', size: bytes.length }).expect(201);
    expect(r.body.uploadUrl).toContain('/private/'); // o original vai para o bucket privado
    expect(r.body.uploadUrl).toContain(`${r.body.assetId}.src`);
    expect((await fetch(r.body.uploadUrl, { method: 'PUT', body: bytes, headers: { 'Content-Type': 'video/mp4' } })).ok).toBe(true);
    const id = r.body.assetId as string;
    expect(s3.objects.has(`test/${id}`)).toBe(false); // nada público ainda

    expect((await api().post(`/api/v1/media/${id}/complete`).set(auth()).expect(200)).body.status).toBe('processing');
    let st = { status: 'processing' } as { status: string };
    for (let i = 0; i < 60 && st.status === 'processing'; i++) {
      await new Promise((r2) => setTimeout(r2, 500));
      st = (await api().get(`/api/v1/media/${id}/status`).set(auth()).expect(200)).body;
    }
    expect(st.status).toBe('ready');
    expect(s3.objects.get(`test/${id}`)?.type).toBe('video/mp4'); // convertido, público
    expect(s3.objects.has(`test/${id}.poster.jpg`)).toBe(true);
    expect(s3.objects.has(`private/${id}.src`)).toBe(false); // o original foi apagado

    const play = await api().get(`/api/v1/media/${id}`).expect(302);
    expect(play.headers.location).toContain(`/${id}`);
    expect((await api().get(`/api/v1/media/${id}?poster=1`).expect(302)).headers.location).toContain('.poster.jpg');

    // um ficheiro que não é vídeo é recusado e some dos dois buckets
    const fake = Buffer.from('isto não é um vídeo, mas tem mais de doze bytes');
    const f = await api().post('/api/v1/media/uploads').set(auth()).send({ mime: 'video/mp4', size: fake.length }).expect(201);
    await fetch(f.body.uploadUrl, { method: 'PUT', body: fake, headers: { 'Content-Type': 'video/mp4' } });
    await api().post(`/api/v1/media/${f.body.assetId}/complete`).set(auth()).expect(415);
    expect([...s3.objects.keys()].filter((k) => k.includes(f.body.assetId))).toEqual([]);
  }, 120_000);

  it('com leitura pública é obrigatório um bucket privado (conversas nunca no público)', () => {
    const base = { DATABASE_URL: DB, JWT_ACCESS_SECRET: 'x'.repeat(40), STORAGE_DRIVER: 's3', S3_BUCKET: 'a', S3_ACCESS_KEY_ID: 'k', S3_SECRET_ACCESS_KEY: 's' };
    expect(() => loadConfig({ ...base, S3_PUBLIC_URL: 'https://media.exemplo.com' })).toThrow(/S3_PRIVATE_BUCKET/);
    expect(() => loadConfig({ ...base, S3_PUBLIC_URL: 'https://media.exemplo.com', S3_PRIVATE_BUCKET: 'b' })).not.toThrow();
    expect(() => loadConfig(base)).not.toThrow(); // sem URL pública tudo é servido por URLs assinados
  });

  it('sem credenciais o servidor nem arranca com STORAGE_DRIVER=s3', () => {
    expect(() => loadConfig({ DATABASE_URL: DB, JWT_ACCESS_SECRET: 'x'.repeat(40), STORAGE_DRIVER: 's3' })).toThrow(/S3_BUCKET/);
  });
});
