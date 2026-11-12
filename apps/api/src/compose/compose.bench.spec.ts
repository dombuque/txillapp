import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { execFileSync } from 'child_process';
import { mkdtempSync, readFileSync } from 'fs';
import { cpus, tmpdir, totalmem } from 'os';
import { join } from 'path';
import ffmpegPath from 'ffmpeg-static';
import request from 'supertest';
import { loadConfig } from '../config';
import { migrate } from '../db/migrate';
import { createApp } from '../main';
import { ComposeService } from './compose.service';

/**
 * Quanto demora a montar uma tcheka de 15 s e de 60 s nesta máquina (para dimensionar o servidor; ver docs/montagem.md).
 * Só corre com COMPOSE_BENCH=1:
 *   COMPOSE_BENCH=1 TEST_DATABASE_URL=… npx jest --runInBand src/compose/compose.bench
 * Conteúdo realista: vídeos 1080×1920 a 30 fps com movimento (testsrc2) e som, fotos, transições, filtro, texto, sticker e música.
 */
const RUN = process.env.COMPOSE_BENCH === '1';
const DB = process.env.TEST_DATABASE_URL ?? 'postgres://txill:txill_dev@localhost:5433/txillapp_test';
const FF = ffmpegPath as unknown as string;
const MUSIC_URL = 'https://ccmixter.org/content/teste/bench.mp3';
const work = mkdtempSync(join(tmpdir(), 'txill-bench-'));

function make(name: string, args: string[]) {
  const file = join(work, name);
  execFileSync(FF, ['-y', '-v', 'error', ...args, file], { stdio: 'ignore' });
  return readFileSync(file);
}

(RUN ? describe : describe.skip)('montagem: tempos (COMPOSE_BENCH=1)', () => {
  let app: INestApplication;
  let svc: ComposeService;
  let token = '';
  const api = () => request(app.getHttpServer());
  const auth = () => ({ Authorization: `Bearer ${token}` });
  const music = { id: 'ccmixter:bench', title: 'Bench', artist: 'Teste', url: MUSIC_URL, landing: null, license: 'by', licenseUrl: null, durationMs: 70_000, cover: null };
  const timings: Record<string, unknown>[] = [];

  async function upload(bytes: Buffer, mime: string) {
    const up = await api().post('/api/v1/media/uploads').set(auth()).send({ mime, size: bytes.length }).expect(201);
    await api().put(up.body.uploadUrl).set('Content-Type', mime).send(bytes).expect(200);
    const id = up.body.assetId as string;
    if (!mime.startsWith('video/')) return id;
    await api().post(`/api/v1/media/${id}/complete`).set(auth()).expect(200);
    for (;;) {
      const s = (await api().get(`/api/v1/media/${id}/status`).set(auth()).expect(200)).body;
      if (s.status === 'ready') return id;
      if (s.status === 'deleted') throw new Error(s.error);
      await new Promise((r) => setTimeout(r, 300));
    }
  }

  beforeAll(async () => {
    await migrate(DB);
    app = await createApp(loadConfig({ DATABASE_URL: DB, JWT_ACCESS_SECRET: 'b'.repeat(40), NODE_ENV: 'test', MEDIA_DIR: './uploads-test', IMAGE_MODERATION: 'off' }));
    await app.init();
    svc = app.get(ComposeService);
    const mp3 = make('bench.mp3', ['-f', 'lavfi', '-i', "aevalsrc='0.6*sin(2*PI*220*t)*exp(-30*mod(t,0.5))+0.2*sin(2*PI*330*t)':s=44100:d=70", '-c:a', 'libmp3lame', '-b:a', '128k']);
    svc.fetcher = (async () => new Response(new Uint8Array(mp3), { headers: { 'content-type': 'audio/mpeg' } })) as typeof fetch;
    const original = svc.render.bind(svc);
    svc.render = (async (...args: Parameters<ComposeService['render']>) => {
      const out = await original(...args);
      timings.push(out.timings);
      return out;
    }) as ComposeService['render'];
  }, 300_000);

  afterAll(async () => {
    await app?.close();
  });

  async function bench(label: string, videos: number, videoS: number, photos: number) {
    // Uma conta por medição (o envio de vídeos tem um limite por hora).
    const username = `bench${label}${Date.now().toString(36)}`;
    const r = await api().post('/api/v1/auth/register').send({ email: `${username}@example.com`, username, displayName: 'Bench', password: 'password-bem-longa-1', birthDate: '1990-06-15', acceptTerms: true }).expect(201);
    token = r.body.accessToken;
    const clips: { mediaId: string; kind: 'video' | 'photo'; durationMs?: number }[] = [];
    for (let i = 0; i < videos; i++) {
      const v = make(`v${label}${i}.mp4`, ['-f', 'lavfi', '-i', `testsrc2=size=1080x1920:rate=30:duration=${videoS}`, '-f', 'lavfi', '-i', `sine=frequency=${300 + i * 40}:duration=${videoS}`, '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest']);
      clips.push({ mediaId: await upload(v, 'video/mp4'), kind: 'video' });
    }
    for (let i = 0; i < photos; i++) {
      const p = make(`p${label}${i}.jpg`, ['-f', 'lavfi', '-i', `testsrc2=size=1440x1920`, '-frames:v', '1', '-q:v', '3']);
      clips.splice(i * 2 + 1, 0, { mediaId: await upload(p, 'image/jpeg'), kind: 'photo', durationMs: 2900 }); // os vídeos convertidos ficam com ~6,02 s
    }
    const t0 = Date.now();
    const job = (await api().post('/api/v1/tchekas/compose').set(auth()).send({
      clips, sound: { kind: 'music', music }, originalVolume: 0.4, transition: 'fade', filter: 'quente',
      texts: [{ text: 'Bora malta', color: '#ffffff', startMs: 0, endMs: 4000 }, { text: 'Txillapp', color: '#ffffff', bg: '#d6334f', y: 0.3, startMs: 5000, endMs: 9000 }],
      stickers: [{ id: 'amor', x: 0.25, y: 0.75, s: 0.24, r: -8 }],
    }).expect(202)).body.jobId as string;
    let s: { status: string; durationMs?: number; error?: string };
    for (;;) {
      s = (await api().get(`/api/v1/tchekas/compose/${job}`).set(auth()).expect(200)).body;
      if (s.status === 'done' || s.status === 'failed') break;
      await new Promise((r) => setTimeout(r, 200));
    }
    const ms = Date.now() - t0;
    expect(s.error).toBeUndefined();
    console.log(`[bench] ${label}: tcheka de ${((s.durationMs ?? 0) / 1000).toFixed(1)} s montada em ${(ms / 1000).toFixed(1)} s`, timings[timings.length - 1], `(${cpus().length} CPUs, ${(totalmem() / 1e9).toFixed(0)} GB)`);
  }

  it('15 s: 2 vídeos de 6 s e 1 foto de 3 s', () => bench('15s', 2, 6, 1), 600_000);
  it('60 s: 8 vídeos de 6 s e 4 fotos de 3 s', () => bench('60s', 8, 6, 4), 900_000);
});
