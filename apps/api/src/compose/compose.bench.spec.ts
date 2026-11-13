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
 *   COMPOSE_BENCH=1 [COMPOSE_THREADS=6] TEST_DATABASE_URL=… npx jest --runInBand src/compose/compose.bench
 * Conteúdo realista: vídeos 1080×1920 a 30 fps com movimento (testsrc2) e som, fotos, transições, filtro, texto, sticker e música.
 */
const RUN = process.env.COMPOSE_BENCH === '1';
const DB = process.env.TEST_DATABASE_URL ?? 'postgres://txill:txill_dev@localhost:5433/txillapp_test';
const FF = ffmpegPath as unknown as string;
const MUSIC_URL = 'https://ccmixter.org/content/teste/bench.mp3';
const GIF_URL = 'https://media.giphy.com/media/Bench42gif/giphy.gif';
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
    // COMPOSE_THREADS=6 imita um servidor de 6 núcleos (os fios do x264 e dos filtros).
    app = await createApp(loadConfig({ DATABASE_URL: DB, JWT_ACCESS_SECRET: 'b'.repeat(40), NODE_ENV: 'test', MEDIA_DIR: './uploads-test', IMAGE_MODERATION: 'off', ...(process.env.COMPOSE_THREADS ? { COMPOSE_THREADS: process.env.COMPOSE_THREADS } : {}) }));
    await app.init();
    svc = app.get(ComposeService);
    const mp3 = make('bench.mp3', ['-f', 'lavfi', '-i', "aevalsrc='0.6*sin(2*PI*220*t)*exp(-30*mod(t,0.5))+0.2*sin(2*PI*330*t)':s=44100:d=70", '-c:a', 'libmp3lame', '-b:a', '128k']);
    const gif = make('bench.gif', ['-f', 'lavfi', '-i', 'testsrc2=size=240x240:rate=10:duration=2', '-filter_complex', 'split[a][b];[a]palettegen[p];[b][p]paletteuse', '-loop', '0']);
    svc.fetcher = (async (u: string | URL | Request) => String(u) === GIF_URL
      ? new Response(new Uint8Array(gif), { headers: { 'content-type': 'image/gif' } })
      : new Response(new Uint8Array(mp3), { headers: { 'content-type': 'audio/mpeg' } })) as typeof fetch;
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

  async function bench(label: string, videos: number, videoS: number, photos: number, studio?: (clips: { mediaId: string; kind: 'video' | 'photo'; durationMs?: number }[]) => object) {
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
    const job = (await api().post('/api/v1/tchekas/compose').set(auth()).send(studio ? { sound: { kind: 'music', music }, originalVolume: 0.4, ...studio(clips) } : {
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

  /**
   * Os efeitos do estúdio todos de uma vez (docs/estudio-efeitos.md): filtros e ajustes (nitidez, vinheta, grão) em todos os
   * clipes, uma rampa, um vídeo invertido, uma transição diferente em cada junção (as do canvas: girar, brilho, glitch,
   * o pano de capulana a desenrolar, zoom), uma foto em moldura de capulana, 3 textos animados e uma faixa de pano, um sticker de pano (néon, máquina de escrever, ondulação a balançar), emoji a pulsar, local, hora,
   * sticker do Txillapp e um GIF: ~30 s.
   */
  it('30 s com os efeitos do estúdio todos', () => bench('fx30s', 4, 6, 2, (clips) => {
    const fxs = [
      { filter: { id: 'costa-do-sol', amount: 0.8 }, adjust: { contrast: 0.2, sharpen: 0.3 }, ramp: 'heroi' },
      { filter: { id: 'noite-de-maputo', amount: 1 }, transition: { type: 'girar', dur: 0.6 } },
      { filter: { id: 'vintage', amount: 1 }, adjust: { vignette: 0.4 }, transition: { type: 'brilho', dur: 0.8 }, reverse: true },
      { filter: { id: 'capulana', amount: 0.7 }, transition: { type: 'glitch', dur: 0.6 }, moldura: { pattern: 'sol', palette: 'marginal', seed: 2 } },
      { filter: { id: 'pb', amount: 1 }, transition: { type: 'capulana-desenrolar', dur: 0.8, pano: { pattern: 'ziguezague', palette: 'indico', seed: 7 } } },
      { filter: { id: 'limpopo', amount: 1 }, adjust: { grain: 0.3 }, transition: { type: 'zoom', dur: 0.6 } },
    ];
    const anim = (inA: string, loop = 'nenhuma') => ({ in: inA, out: 'aparecer', loop, inDur: 0.6, outDur: 0.35 });
    return {
      clips: clips.map((c, i) => ({ ...c, ...(c.kind === 'video' && i === clips.length - 1 ? { trimEndMs: 4000 } : {}), fx: fxs[i] })),
      overlays: [
        { id: 't1', kind: 'text', start: 0.5, end: 6, x: 0.5, y: 0.3, text: 'Bom dia, Maputo!', font: 'futuro', size: 96, color: '#ff4fd8', neon: true, anim: anim('pop') },
        { id: 't2', kind: 'text', start: 8, end: 16, x: 0.5, y: 0.45, text: 'Máquina de escrever\nem duas linhas', font: 'maquina', size: 70, color: '#ffd60a', bg: 'cheio', anim: { ...anim('maquina'), inDur: 1.5 } },
        { id: 't3', kind: 'text', start: 18, end: 28, x: 0.5, y: 0.35, rot: -6, text: 'Ondas no mar', font: 'praia', size: 110, color: '#ffffff', outline: true, shadow: true, anim: anim('ondulacao', 'balancar') },
        { id: 't4', kind: 'text', start: 20, end: 29, x: 0.5, y: 0.8, text: 'Capulana', font: 'classica', size: 70, bg: 'pano', pano: { pattern: 'losangos', palette: 'coral', seed: 1 }, anim: anim('aparecer') },
        { id: 's6', kind: 'sticker', start: 6, end: 18, x: 0.75, y: 0.4, scale: 0.6, sticker: { type: 'capulana', shape: 'estrela', pano: { pattern: 'flores', palette: 'neon', seed: 4 } }, anim: anim('pop', 'pulsar') },
        { id: 's1', kind: 'sticker', start: 0, end: 30, x: 0.25, y: 0.7, sticker: { type: 'emoji', emoji: '🔥' }, anim: anim('pop', 'pulsar') },
        { id: 's2', kind: 'sticker', start: 2, end: 30, x: 0.5, y: 0.66, rot: -4, sticker: { type: 'location', name: 'Costa do Sol' }, variant: 'coral', anim: anim('subir') },
        { id: 's3', kind: 'sticker', start: 4, end: 20, x: 0.7, y: 0.2, sticker: { type: 'time', format: 'hora-data', at: Date.UTC(2026, 10, 12, 20, 41) }, variant: 'escuro', anim: anim('pop') },
        { id: 's4', kind: 'sticker', start: 10, end: 25, x: 0.3, y: 0.25, scale: 0.8, sticker: { type: 'txill', id: 'm-fogo' }, anim: anim('pop', 'pulsar') },
        { id: 's5', kind: 'sticker', start: 12, end: 24, x: 0.72, y: 0.55, scale: 0.7, rot: 8, sticker: { type: 'gif', id: 'Bench42gif', url: GIF_URL, w: 240, h: 240 }, anim: anim('pop') },
      ],
    };
  }), 900_000);
});
