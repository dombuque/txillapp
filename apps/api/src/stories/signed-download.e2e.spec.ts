import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Pool } from 'pg';
import sharp from 'sharp';
import { loadConfig } from '../config';
import { migrate } from '../db/migrate';
import { createApp } from '../main';
import { signatureSvg } from '../media/signature';

const DB = process.env.TEST_DATABASE_URL ?? 'postgres://txill:txill_dev@localhost:5433/txillapp_test';
const PASSWORD = 'password-bem-longa-1';
const SIDE = 600;
const GRAY = 100;

interface U { token: string; id: string; username: string }

/** Lê a resposta binária (a cópia guardada) como Buffer. */
const binary = (res: NodeJS.ReadableStream & { setEncoding?: (e: string) => void }, cb: (err: Error | null, body: Buffer) => void) => {
  const chunks: Buffer[] = [];
  res.on('data', (c: Buffer) => chunks.push(Buffer.from(c)));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
  res.on('error', (e: Error) => cb(e, Buffer.alloc(0)));
};

/** O canal mais claro numa zona da imagem (o logótipo e o @ são brancos; a foto de teste é cinzenta). */
async function brightest(img: Buffer, left: number, top: number, width: number, height: number): Promise<number> {
  const px = await sharp(img).extract({ left, top, width, height }).removeAlpha().raw().toBuffer();
  let max = 0;
  for (const v of px) if (v > max) max = v;
  return max;
}
/** A zona da assinatura numa foto de 600×600 (em baixo à direita: logótipo e @). */
const signZone = (img: Buffer) => brightest(img, 440, 495, 150, 95);

describe('guardar um mimo: a assinatura não vai duas vezes (integração)', () => {
  let app: INestApplication;
  let pool: Pool;
  let jpeg: Buffer;
  const run = Date.now().toString(36);
  const api = () => request(app.getHttpServer());
  const auth = (x: U) => ({ Authorization: `Bearer ${x.token}` });
  let me: U;

  async function signup(name: string): Promise<U> {
    const username = `${name}${run}`.slice(0, 28);
    const r = await api().post('/api/v1/auth/register').send({ email: `${username}@example.com`, username, displayName: `${name} Teste`, password: PASSWORD, birthDate: '1990-06-15', acceptTerms: true }).expect(201);
    return { token: r.body.accessToken, id: r.body.user.id, username };
  }
  async function upload(x: U, extra: Record<string, unknown> = {}): Promise<string> {
    const up = await api().post('/api/v1/media/uploads').set(auth(x)).send({ mime: 'image/jpeg', size: jpeg.length, ...extra }).expect(201);
    await api().put(up.body.uploadUrl).set('Content-Type', 'image/jpeg').send(jpeg).expect(200);
    return up.body.assetId as string;
  }
  async function download(x: U, storyId: string): Promise<Buffer> {
    const r = await api().get(`/api/v1/stories/${storyId}/download`).set(auth(x)).buffer(true).parse(binary as never).expect(200);
    expect(r.headers['content-type']).toMatch(/^image\/jpeg/);
    return r.body as Buffer;
  }

  beforeAll(async () => {
    await migrate(DB);
    pool = new Pool({ connectionString: DB });
    app = await createApp(loadConfig({ DATABASE_URL: DB, JWT_ACCESS_SECRET: 'd'.repeat(40), NODE_ENV: 'test', MEDIA_DIR: './uploads-test' }));
    await app.init();
    me = await signup('sig');
    jpeg = await sharp({ create: { width: SIDE, height: SIDE, channels: 3, background: { r: GRAY, g: GRAY, b: GRAY } } }).jpeg({ quality: 95 }).toBuffer();
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  it('o pedido de envio guarda se o ficheiro já vem assinado (sem o campo: não vem); recusa valores que não sejam sim/não', async () => {
    const plain = await upload(me);
    const signed = await upload(me, { signed: true });
    const off = await upload(me, { signed: false });
    const rows = (await pool.query('SELECT id, signed FROM content.media_assets WHERE id = ANY($1)', [[plain, signed, off]])).rows as { id: string; signed: boolean }[];
    const by = Object.fromEntries(rows.map((r) => [r.id, r.signed]));
    expect(by).toEqual({ [plain]: false, [signed]: true, [off]: false });
    await api().post('/api/v1/media/uploads').set(auth(me)).send({ mime: 'image/jpeg', size: jpeg.length, signed: 'sim' }).expect(400);
  });

  it('sem `signed`: a cópia leva a assinatura do servidor, como antes', async () => {
    const m = await upload(me);
    const story = (await api().post('/api/v1/stories').set(auth(me)).send({ mediaId: m }).expect(201)).body;
    const img = await download(me, story.id);
    expect(await signZone(img)).toBeGreaterThan(200);
  });

  it('com `signed: true`: a cópia não junta outra assinatura (a zona fica como a foto)', async () => {
    const m = await upload(me, { signed: true });
    const story = (await api().post('/api/v1/stories').set(auth(me)).send({ mediaId: m }).expect(201)).body;
    const img = await download(me, story.id);
    const meta = await sharp(img).metadata();
    expect([meta.width, meta.height]).toEqual([SIDE, SIDE]);
    expect(Math.abs((await signZone(img)) - GRAY)).toBeLessThan(12);
  });

  it('com `signed: true` os stickers continuam gravados (e a assinatura não)', async () => {
    const m = await upload(me, { signed: true });
    const stickers = [{ id: 'm-fogo', x: 0.3, y: 0.3, s: 0.3, r: 0 }];
    const story = (await api().post('/api/v1/stories').set(auth(me)).send({ mediaId: m, stickers }).expect(201)).body;
    const img = await download(me, story.id);
    // O sticker (90×90 à volta de 180,180) muda a foto; a zona da assinatura não.
    const px = await sharp(img).extract({ left: 135, top: 135, width: 90, height: 90 }).removeAlpha().raw().toBuffer();
    expect(px.some((v) => Math.abs(v - GRAY) > 40)).toBe(true);
    expect(Math.abs((await signZone(img)) - GRAY)).toBeLessThan(12);
  });

  it('partilhar no mimo uma publicação já assinada: a cópia também não leva segunda assinatura', async () => {
    const m = await upload(me, { signed: true });
    const post = (await api().post('/api/v1/posts').set(auth(me)).send({ body: 'tirada na TxillCam', mediaIds: [m] }).expect(201)).body;
    const shared = (await api().post('/api/v1/stories/share').set(auth(me)).send({ postId: post.id }).expect(201)).body;
    const img = await download(me, shared.id);
    expect(Math.abs((await signZone(img)) - GRAY)).toBeLessThan(12);
  });

  it('signatureSvg com withSign a false só leva o que vai por cima (sem logótipo nem @)', () => {
    const extra = '<rect x="1" y="2" width="3" height="4"/>';
    const full = signatureSvg(1080, 1920, 'dombuque', extra);
    expect(full).toContain('@dombuque');
    expect(full).toContain('stroke="#ffffff"');
    const bare = signatureSvg(1080, 1920, 'dombuque', extra, false);
    expect(bare).toContain(extra);
    expect(bare).toContain('width="1080" height="1920"');
    expect(bare).not.toContain('@dombuque');
    expect(bare).not.toContain('<path');
    expect(bare).not.toContain('<text');
  });
});
