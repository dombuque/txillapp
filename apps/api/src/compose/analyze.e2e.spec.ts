import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { execFileSync } from 'child_process';
import { mkdtempSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import ffmpegPath from 'ffmpeg-static';
import request from 'supertest';
import { Pool } from 'pg';
import { loadConfig } from '../config';
import { migrate } from '../db/migrate';
import { createApp } from '../main';
import { ComposeAnalyzeService } from './analyze.service';

const DB = process.env.TEST_DATABASE_URL ?? 'postgres://txill:txill_dev@localhost:5433/txillapp_test';
const PASSWORD = 'password-bem-longa-1';
const FF = ffmpegPath as unknown as string;
const MEDIA = './uploads-test';
const work = mkdtempSync(join(tmpdir(), 'txill-analyze-'));

function make(name: string, args: string[]) {
  const file = join(work, name);
  execFileSync(FF, ['-y', '-v', 'error', ...args, file], { stdio: 'ignore' });
  return readFileSync(file);
}
const pic = (seconds: number) => ['-f', 'lavfi', '-i', `testsrc=size=320x568:rate=30:duration=${seconds}`];
const h264 = ['-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p'];
/** Um vídeo com um apito baixo e um estalo forte entre 2,0 e 2,5 s. */
const loudAt2 = () => make('alto.mp4', [...pic(4), '-f', 'lavfi', '-i', "aevalsrc='(if(between(t,2,2.5),0.9,0.08))*sin(2*PI*440*t)':s=44100:d=4", ...h264, '-c:a', 'aac', '-shortest']);
/** Sem pista de áudio. */
const mute = () => make('mudo.mp4', [...pic(3), ...h264, '-an']);
/** Com uma pista de áudio só com silêncio (como os telemóveis gravam com o microfone tapado). */
const hush = () => make('silencio.mp4', [...pic(3), '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo', ...h264, '-c:a', 'aac', '-shortest']);
const png = () => make('foto.png', ['-f', 'lavfi', '-i', 'testsrc2=size=360x640', '-frames:v', '1']);

interface U { token: string; id: string }

describe('o som dos vídeos para a Montagem mágica (POST /tchekas/compose/analyze)', () => {
  let app: INestApplication;
  let pool: Pool;
  let svc: ComposeAnalyzeService;
  let a: U, b: U;
  const run = Date.now().toString(36);
  const api = () => request(app.getHttpServer());
  const as = (u: U) => ({ Authorization: `Bearer ${u.token}` });
  const analyze = (u: U, body: unknown) => api().post('/api/v1/tchekas/compose/analyze').set(as(u)).send(body as object);

  async function register(name: string): Promise<U> {
    const username = `${name}${run}`.slice(0, 28);
    const r = await api().post('/api/v1/auth/register').send({ email: `${username}@example.com`, username, displayName: `${name} Teste`, password: PASSWORD, birthDate: '1990-06-15', acceptTerms: true }).expect(201);
    await pool.query('UPDATE identity.users SET email_verified_at = now() WHERE id = $1', [r.body.user.id]);
    return { token: r.body.accessToken, id: r.body.user.id };
  }
  async function send(u: U, bytes: Buffer, mime: string) {
    const up = await api().post('/api/v1/media/uploads').set(as(u)).send({ mime, size: bytes.length }).expect(201);
    await api().put(up.body.uploadUrl).set('Content-Type', mime).send(bytes).expect(200);
    return up.body.assetId as string;
  }
  async function ready(u: U, id: string) {
    for (let i = 0; i < 120; i++) {
      const s = (await api().get(`/api/v1/media/${id}/status`).set(as(u)).expect(200)).body;
      if (s.status === 'ready') return;
      if (s.status === 'deleted') throw new Error(`vídeo recusado: ${s.error}`);
      await new Promise((r) => setTimeout(r, 300));
    }
    throw new Error('conversão demorou demais');
  }

  beforeAll(async () => {
    await migrate(DB);
    pool = new Pool({ connectionString: DB });
    app = await createApp(loadConfig({ DATABASE_URL: DB, JWT_ACCESS_SECRET: 'c'.repeat(40), NODE_ENV: 'test', MEDIA_DIR: MEDIA, IMAGE_MODERATION: 'off' }));
    await app.init();
    svc = app.get(ComposeAnalyzeService);
    a = await register('mga');
    b = await register('mgb');
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await pool?.end();
  });

  it('ouve o original enquanto converte e o convertido depois (com cache: não volta a ouvir)', async () => {
    const id = await send(a, loudAt2(), 'video/mp4');
    // Antes de «complete» o vídeo ainda não chegou.
    await analyze(a, { mediaId: id }).expect(409);
    await api().post(`/api/v1/media/${id}/complete`).set(as(a)).expect(200);
    const first = (await analyze(a, { mediaId: id }).expect(200)).body;
    expect(first.hasAudio).toBe(true);
    expect(first.rate).toBe(4);
    expect(first.energy.length).toBeGreaterThanOrEqual(15);
    expect(first.energy.length).toBeLessThanOrEqual(18);
    expect(Math.max(...first.energy)).toBe(1);
    expect(first.loudestMs).toBeGreaterThanOrEqual(1900);
    expect(first.loudestMs).toBeLessThanOrEqual(2600);
    expect(first.durationMs).toBeGreaterThan(3500);
    const n = svc.decoded;
    await ready(a, id);
    const again = (await analyze(a, { mediaId: id }).expect(200)).body;
    expect(again).toEqual(first);
    expect(svc.decoded).toBe(n);
  }, 60_000);

  it('sem pista de áudio, ou só com silêncio: hasAudio false', async () => {
    for (const bytes of [mute(), hush()]) {
      const id = await send(a, bytes, 'video/mp4');
      await api().post(`/api/v1/media/${id}/complete`).set(as(a)).expect(200);
      await ready(a, id);
      const r = (await analyze(a, { mediaId: id }).expect(200)).body;
      expect(r).toMatchObject({ hasAudio: false, energy: [], loudestMs: null });
    }
  }, 60_000);

  it('só os vídeos do próprio, só vídeos, e o pedido tem de ser válido', async () => {
    const id = await send(a, mute(), 'video/mp4');
    await api().post(`/api/v1/media/${id}/complete`).set(as(a)).expect(200);
    await ready(a, id);
    await analyze(b, { mediaId: id }).expect(404);
    await analyze(a, { mediaId: '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b' }).expect(404);
    const photo = await send(a, png(), 'image/png');
    await analyze(a, { mediaId: photo }).expect(400);
    await analyze(a, { mediaId: 'nao-e-um-id' }).expect(400);
    await analyze(a, {}).expect(400);
    await api().post('/api/v1/tchekas/compose/analyze').send({ mediaId: id }).expect(401);
  }, 60_000);
});
