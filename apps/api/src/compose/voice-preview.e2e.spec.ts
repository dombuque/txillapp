import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { execFileSync } from 'child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import ffmpegPath from 'ffmpeg-static';
import request from 'supertest';
import { Pool } from 'pg';
import { loadConfig } from '../config';
import { migrate } from '../db/migrate';
import { createApp } from '../main';
import { uuidv7 } from '../common/uuid7';
import { referencedAmong } from '../media/media-refs';
import { MediaService } from '../media/media.service';
import { UnusedMediaService } from '../media/unused-media.service';
import { FFPROBE } from './ffmpeg';
import { MAX_VOICE_PREVIEWS_PER_HOUR, previewId, VoicePreviewService } from './voice-preview.service';

const DB = process.env.TEST_DATABASE_URL ?? 'postgres://txill:txill_dev@localhost:5433/txillapp_test';
const PASSWORD = 'password-bem-longa-1';
const FF = ffmpegPath as unknown as string;
const MEDIA = './uploads-test';
const RATE = 48_000;
const work = mkdtempSync(join(tmpdir(), 'txill-vp-'));

/** Um ficheiro gerado com o ffmpeg (fontes de teste `lavfi`, nada de fora). */
function make(name: string, args: string[]) {
  const file = join(work, name);
  execFileSync(FF, ['-y', '-v', 'error', ...args, file], { stdio: 'ignore' });
  return readFileSync(file);
}
/** Um tom puro em AAC/M4A (como a voz-off gravada no telemóvel). */
const tone = (name: string, hz: number, seconds: number) => make(`${name}.m4a`, ['-f', 'lavfi', '-i', `sine=frequency=${hz}:sample_rate=${RATE}:duration=${seconds}`, '-c:a', 'aac', '-b:a', '128k']);
const video = (name: string, seconds: number, hz: number | null) =>
  make(`${name}.mp4`, [
    '-f', 'lavfi', '-i', `testsrc=size=360x640:rate=30:duration=${seconds}`,
    ...(hz ? ['-f', 'lavfi', '-i', `sine=frequency=${hz}:duration=${seconds}`, '-c:a', 'aac', '-shortest'] : []),
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
  ]);
const png = () => make('foto.png', ['-f', 'lavfi', '-i', 'color=c=red:size=64x64', '-frames:v', '1']);

/** As amostras (mono, 48 kHz) de um ficheiro. */
function samples(file: string): Float32Array {
  const buf = execFileSync(FF, ['-v', 'error', '-i', file, '-ac', '1', '-ar', String(RATE), '-f', 'f32le', '-'], { maxBuffer: 64 * 1024 * 1024 });
  const out = new Float32Array(Math.floor(buf.length / 4));
  for (let i = 0; i < out.length; i++) out[i] = buf.readFloatLE(i * 4);
  return out;
}
/** A frequência dominante de um tom (pelos cruzamentos do zero, no meio do ficheiro, longe das pontas). */
function dominantHz(x: Float32Array): number {
  const a = Math.floor(x.length * 0.25), b = Math.floor(x.length * 0.75);
  let n = 0;
  for (let i = a + 1; i < b; i++) if ((x[i - 1] < 0 && x[i] >= 0)) n++;
  return n / ((b - a) / RATE);
}
const rms = (x: Float32Array) => {
  const a = Math.floor(x.length * 0.25), b = Math.floor(x.length * 0.75);
  let s = 0;
  for (let i = a; i < b; i++) s += x[i] * x[i];
  return Math.sqrt(s / (b - a));
};
function streams(file: string) {
  return JSON.parse(execFileSync(FFPROBE, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file]).toString()) as {
    streams: { codec_name: string; codec_type: string; sample_rate: string; channels: number }[];
    format: { format_name: string; duration: string };
  };
}

interface U { token: string; id: string; username: string }

describe('pré-visualização dos efeitos de voz (POST /tchekas/compose/voice-preview)', () => {
  let app: INestApplication;
  let pool: Pool;
  let svc: VoicePreviewService;
  let unused: UnusedMediaService;
  let media: MediaService;
  let a: U, b: U, c: U;
  const run = Date.now().toString(36);
  const api = () => request(app.getHttpServer());
  const as = (u: U) => ({ Authorization: `Bearer ${u.token}` });
  const preview = (u: U, body: unknown) => api().post('/api/v1/tchekas/compose/voice-preview').set(as(u)).send(body as object);

  async function register(name: string): Promise<U> {
    const username = `${name}${run}`.slice(0, 28);
    const r = await api().post('/api/v1/auth/register').send({ email: `${username}@example.com`, username, displayName: `${name} Teste`, password: PASSWORD, birthDate: '1990-06-15', acceptTerms: true }).expect(201);
    await pool.query('UPDATE identity.users SET email_verified_at = now() WHERE id = $1', [r.body.user.id]);
    return { token: r.body.accessToken, id: r.body.user.id, username };
  }
  async function upload(u: U, bytes: Buffer, mime: string, purpose: 'public' | 'chat' = 'public') {
    const up = await api().post('/api/v1/media/uploads').set(as(u)).send({ mime, size: bytes.length, purpose }).expect(201);
    await api().put(up.body.uploadUrl).set('Content-Type', mime).send(bytes).expect(200);
    return up.body.assetId as string;
  }
  async function uploadVideo(u: U, bytes: Buffer) {
    const id = await upload(u, bytes, 'video/mp4');
    await api().post(`/api/v1/media/${id}/complete`).set(as(u)).expect(200);
    for (let i = 0; i < 120; i++) {
      const s = (await api().get(`/api/v1/media/${id}/status`).set(as(u)).expect(200)).body;
      if (s.status === 'ready') return id;
      if (s.status === 'deleted') throw new Error(`vídeo recusado: ${s.error}`);
      await new Promise((r) => setTimeout(r, 300));
    }
    throw new Error('conversão demorou demais');
  }
  /** Descarrega o áudio pelo `url` devolvido (sem cabeçalhos de sessão, como o leitor da app) e guarda-o num ficheiro. */
  async function fetchAudio(url: string, name: string) {
    expect(url).toMatch(/^\/api\/v1\/chat\/media\/[0-9a-f-]{36}\?exp=\d+&sig=/);
    const r = await api().get(url).responseType('blob').expect(200);
    expect(r.headers['content-type']).toMatch(/audio\/mp4/);
    const file = join(work, `${name}.out.m4a`);
    writeFileSync(file, r.body as Buffer);
    return file;
  }

  let voice440: string;
  let inputSamples: Float32Array;

  beforeAll(async () => {
    await migrate(DB);
    pool = new Pool({ connectionString: DB });
    app = await createApp(loadConfig({ DATABASE_URL: DB, JWT_ACCESS_SECRET: 'v'.repeat(40), NODE_ENV: 'test', MEDIA_DIR: MEDIA, IMAGE_MODERATION: 'off' }));
    await app.init();
    svc = app.get(VoicePreviewService);
    unused = app.get(UnusedMediaService);
    media = app.get(MediaService);
    a = await register('vpa');
    b = await register('vpb');
    c = await register('vpc');
    const bytes = tone('voz440', 440, 3);
    inputSamples = samples(join(work, 'voz440.m4a'));
    voice440 = await upload(a, bytes, 'audio/mp4', 'chat');
  }, 120_000);

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  it('o limite por omissão são 30 por hora', () => {
    expect(MAX_VOICE_PREVIEWS_PER_HOUR).toBe(30);
    expect(svc.limit).toBe(30);
  });

  it('Esquilo: o tom sobe 1,5× com a mesma duração; sai AAC em MP4, privado, pronto e meu, e o URL toca sem sessão', async () => {
    const r = await preview(a, { mediaId: voice440, effect: 'esquilo' }).expect(200);
    expect(r.body).toEqual({ mediaId: expect.stringMatching(/^[0-9a-f-]{36}$/), url: expect.any(String), durationMs: expect.any(Number), cached: false });
    expect(r.body.mediaId).not.toBe(voice440);
    expect(Math.abs(r.body.durationMs - 3000)).toBeLessThan(80);
    const file = await fetchAudio(r.body.url, 'esquilo');
    const info = streams(file);
    expect(info.format.format_name).toMatch(/mp4/);
    expect(info.streams).toHaveLength(1);
    expect(info.streams[0]).toMatchObject({ codec_type: 'audio', codec_name: 'aac', sample_rate: String(RATE), channels: 2 });
    expect(Math.abs(Number(info.format.duration) - 3)).toBeLessThan(0.08);
    // +faststart: o índice (moov) vem antes dos dados.
    const head = readFileSync(file).subarray(0, 4096).toString('latin1');
    expect(head.indexOf('moov')).toBeGreaterThan(-1);
    expect(head.indexOf('moov')).toBeLessThan(head.indexOf('mdat') === -1 ? Infinity : head.indexOf('mdat'));
    const hz = dominantHz(samples(file));
    expect(hz).toBeGreaterThan(440 * 1.5 * 0.97);
    expect(hz).toBeLessThan(440 * 1.5 * 1.03);
    const m = (await pool.query('SELECT owner_id, status, purpose, mime, duration_ms FROM content.media_assets WHERE id = $1', [r.body.mediaId])).rows[0];
    expect(m).toMatchObject({ owner_id: a.id, status: 'ready', purpose: 'chat', mime: 'audio/mp4', duration_ms: r.body.durationMs });
    // Nunca pelo caminho público dos ficheiros.
    await api().get(`/api/v1/media/${r.body.mediaId}`).expect(404);
    expect(readdirSync(tmpdir()).filter((f) => f.startsWith('txvoicefx-'))).toEqual([]);
  }, 60_000);

  it('Grave baixa o tom (0,72×); todos os efeitos mudam o som e mantêm a duração da entrada', async () => {
    const r = await preview(a, { mediaId: voice440, effect: 'grave' }).expect(200);
    const hz = dominantHz(samples(await fetchAudio(r.body.url, 'grave')));
    expect(hz).toBeGreaterThan(440 * 0.72 * 0.97);
    expect(hz).toBeLessThan(440 * 0.72 * 1.03);
    for (const effect of ['robo', 'eco', 'radio', 'estadio']) {
      const p = await preview(a, { mediaId: voice440, effect }).expect(200);
      expect([effect, p.body.cached]).toEqual([effect, false]);
      const file = await fetchAudio(p.body.url, effect);
      expect([effect, Math.abs(Number(streams(file).format.duration) - 3) < 0.08]).toEqual([effect, true]);
      const out = samples(file);
      // A mesma duração, amostra a amostra (sem cauda do eco e do reverb; no máximo um bloco do AAC de diferença).
      expect([effect, Math.abs(out.length - inputSamples.length) <= 1024]).toEqual([effect, true]);
      // O sinal muda (em relação ao tom de entrada, amostra a amostra, no meio do ficheiro). No Estádio, com um tom parado,
      // o reverb é quase o mesmo tom: vê-se abaixo, com um toque curto.
      if (effect === 'estadio') continue;
      const at = Math.floor(out.length / 2);
      let diff = 0;
      for (let i = at; i < at + 4800; i++) diff += Math.abs(out[i] - (inputSamples[i] ?? 0));
      expect([effect, diff / 4800 > 0.02]).toEqual([effect, true]);
    }
  }, 120_000);

  it('Eco e Estádio: depois de um toque curto o som continua (as repetições, o reverb), mas o ficheiro acaba quando a entrada acaba', async () => {
    // 0,2 s de tom e depois silêncio, 2 s ao todo.
    const bytes = make('toque.m4a', ['-f', 'lavfi', '-i', `aevalsrc='0.5*sin(2*PI*440*t)*lt(t,0.2)':s=${RATE}:d=2`, '-c:a', 'aac', '-b:a', '128k']);
    const hit = await upload(a, bytes, 'audio/mp4', 'chat');
    const input = samples(join(work, 'toque.m4a'));
    const win = (x: Float32Array, from: number, to: number) => {
      let s = 0;
      for (let i = Math.floor(from * RATE); i < Math.floor(to * RATE); i++) s += x[i] * x[i];
      return Math.sqrt(s / ((to - from) * RATE));
    };
    expect(win(input, 0.4, 1.2)).toBeLessThan(0.002);
    for (const effect of ['eco', 'estadio']) {
      const r = await preview(a, { mediaId: hit, effect }).expect(200);
      const out = samples(await fetchAudio(r.body.url, `toque-${effect}`));
      expect([effect, win(out, 0.4, 1.2) > 0.01]).toEqual([effect, true]);
      expect([effect, Math.abs(out.length - input.length) <= 1024]).toEqual([effect, true]);
    }
  }, 60_000);

  it('Rádio tira os graves (100 Hz quase desaparece) e deixa passar o meio (1 kHz)', async () => {
    const low = await upload(a, tone('grave100', 100, 2), 'audio/mp4', 'chat');
    const mid = await upload(a, tone('meio1k', 1000, 2), 'audio/mp4', 'chat');
    const rl = await preview(a, { mediaId: low, effect: 'radio' }).expect(200);
    const rm = await preview(a, { mediaId: mid, effect: 'radio' }).expect(200);
    const inLow = rms(samples(join(work, 'grave100.m4a')));
    const inMid = rms(samples(join(work, 'meio1k.m4a')));
    expect(rms(samples(await fetchAudio(rl.body.url, 'radio100'))) / inLow).toBeLessThan(0.3);
    expect(rms(samples(await fetchAudio(rm.body.url, 'radio1k'))) / inMid).toBeGreaterThan(0.6);
  }, 60_000);

  it('um clipe de vídeo: usa o som original dele', async () => {
    const clip = await uploadVideo(a, video('clipe', 2, 440));
    const r = await preview(a, { mediaId: clip, effect: 'esquilo' }).expect(200);
    const file = await fetchAudio(r.body.url, 'clipe');
    const info = streams(file);
    expect(info.streams.map((s) => s.codec_type)).toEqual(['audio']);
    expect(Math.abs(Number(info.format.duration) - 2)).toBeLessThan(0.1);
    const hz = dominantHz(samples(file));
    expect(hz).toBeGreaterThan(660 * 0.97);
    expect(hz).toBeLessThan(660 * 1.03);
  }, 90_000);

  it('uma voz gravada no browser (WebM/Opus) também dá', async () => {
    const webm = await upload(a, make('voz.webm', ['-f', 'lavfi', '-i', 'sine=frequency=440:duration=1.5', '-c:a', 'libopus', '-b:a', '48k']), 'audio/webm', 'chat');
    const r = await preview(a, { mediaId: webm, effect: 'esquilo' }).expect(200);
    expect(Math.abs(r.body.durationMs - 1500)).toBeLessThan(80);
    const hz = dominantHz(samples(await fetchAudio(r.body.url, 'webm')));
    expect(hz).toBeGreaterThan(660 * 0.97);
    expect(hz).toBeLessThan(660 * 1.03);
  }, 60_000);

  it('só o primeiro minuto', async () => {
    const long = await upload(a, tone('longo', 440, 65), 'audio/mp4', 'chat');
    const r = await preview(a, { mediaId: long, effect: 'eco' }).expect(200);
    expect(r.body.durationMs).toBeGreaterThan(59_900);
    expect(r.body.durationMs).toBeLessThan(60_100);
  }, 90_000);

  it('a segunda vez vem guardada: o mesmo ficheiro, sem correr o ffmpeg outra vez', async () => {
    const first = await preview(a, { mediaId: voice440, effect: 'eco' }).expect(200);
    const spy = jest.spyOn(svc, 'render');
    try {
      const again = await preview(a, { mediaId: voice440, effect: 'eco' }).expect(200);
      expect(again.body).toMatchObject({ mediaId: first.body.mediaId, durationMs: first.body.durationMs, cached: true });
      await fetchAudio(again.body.url, 'eco-cache');
      // Dois pedidos ao mesmo tempo para um par novo: um só ffmpeg.
      const [x, y] = await Promise.all([preview(a, { mediaId: voice440, effect: 'robo' }), preview(a, { mediaId: voice440, effect: 'robo' })]);
      expect(x.status).toBe(200);
      expect(y.body.mediaId).toBe(x.body.mediaId);
      expect(spy).toHaveBeenCalledTimes(0); // o robô já estava guardado do teste anterior
      const fresh = await upload(a, tone('nova', 300, 1), 'audio/mp4', 'chat');
      const [p, q] = await Promise.all([preview(a, { mediaId: fresh, effect: 'grave' }), preview(a, { mediaId: fresh, effect: 'grave' })]);
      expect([p.status, q.status]).toEqual([200, 200]);
      expect(q.body.mediaId).toBe(p.body.mediaId);
      expect(spy).toHaveBeenCalledTimes(1);
      expect([p.body.cached, q.body.cached].sort()).toEqual([false, true]);
    } finally {
      spy.mockRestore();
    }
    // Apagado o guardado, volta a fazer-se.
    await pool.query(`UPDATE content.media_assets SET status = 'deleted' WHERE id = $1`, [first.body.mediaId]);
    const redo = await preview(a, { mediaId: voice440, effect: 'eco' }).expect(200);
    expect(redo.body.cached).toBe(false);
    expect(redo.body.mediaId).not.toBe(first.body.mediaId);
  }, 90_000);

  it('só ficheiros meus: o de outra pessoa, um que não existe, um apagado ou uma música de artista → 404 (a mesma resposta)', async () => {
    const other = await preview(b, { mediaId: voice440, effect: 'eco' }).expect(404);
    const missing = await preview(b, { mediaId: uuidv7(), effect: 'eco' }).expect(404);
    expect(other.body).toEqual(missing.body);
    const gone = await upload(b, tone('apagada', 440, 1), 'audio/mp4', 'chat');
    await pool.query(`UPDATE content.media_assets SET status = 'deleted' WHERE id = $1`, [gone]);
    expect((await preview(b, { mediaId: gone, effect: 'eco' }).expect(404)).body).toEqual(missing.body);
    const pending = (await api().post('/api/v1/media/uploads').set(as(b)).send({ mime: 'audio/mp4', size: 100, purpose: 'chat' }).expect(201)).body.assetId;
    await preview(b, { mediaId: pending, effect: 'eco' }).expect(404);
    const music = await media.storeDerived(b.id, readFileSync(join(work, 'voz440.m4a')), 'audio/mp4', 'music', 3000);
    await preview(b, { mediaId: music, effect: 'eco' }).expect(404);
  }, 60_000);

  it('pedido inválido → 400 com a dica; sem som → 422', async () => {
    expect((await preview(a, { mediaId: voice440, effect: 'xpto' }).expect(400)).body.message).toBe('Efeito de voz desconhecido');
    expect((await preview(a, { mediaId: voice440, effect: 'normal' }).expect(400)).body.message).toMatch(/Normal/);
    await preview(a, { mediaId: voice440 }).expect(400);
    await preview(a, { mediaId: 'nao-e-um-id', effect: 'eco' }).expect(400);
    await api().post('/api/v1/tchekas/compose/voice-preview').send({ mediaId: voice440, effect: 'eco' }).expect(401);
    const silent = await uploadVideo(a, video('mudo', 1, null));
    expect((await preview(a, { mediaId: silent, effect: 'eco' }).expect(422)).body.message).toBe('Este vídeo não tem som.');
    const photo = await upload(a, png(), 'image/png');
    expect((await preview(a, { mediaId: photo, effect: 'eco' }).expect(422)).body.message).toBe('Uma foto não tem som.');
    // Os falhados não ficam (nem contam para o limite).
    const left = (await pool.query(`SELECT count(*)::int AS n FROM content.media_assets WHERE id = ANY($1::uuid[])`, [[previewId(a.id, silent, 'eco'), previewId(a.id, photo, 'eco')]])).rows[0].n;
    expect(left).toBe(0);
  }, 90_000);

  it('limite por hora: as processadas contam, as guardadas não → 429', async () => {
    svc.limit = 3;
    try {
      const v = await upload(c, tone('limite', 500, 1), 'audio/mp4', 'chat');
      for (const effect of ['robo', 'eco', 'radio']) await preview(c, { mediaId: v, effect }).expect(200);
      const r = await preview(c, { mediaId: v, effect: 'grave' }).expect(429);
      expect(r.body.message).toMatch(/última hora/);
      // As que já estão guardadas continuam a vir.
      expect((await preview(c, { mediaId: v, effect: 'eco' }).expect(200)).body.cached).toBe(true);
      // Passada a hora, volta a dar.
      await pool.query(`UPDATE content.media_assets SET created_at = now() - interval '61 minutes' WHERE owner_id = $1 AND purpose = 'chat' AND id <> $2`, [c.id, v]);
      await preview(c, { mediaId: v, effect: 'grave' }).expect(200);
    } finally {
      svc.limit = MAX_VOICE_PREVIEWS_PER_HOUR;
    }
  }, 60_000);

  it('limpeza das 48 horas: a pré-visualização não está em uso, sai, e não segura o ficheiro de origem', async () => {
    const src = await upload(b, tone('limpar', 440, 1), 'audio/mp4', 'chat');
    const r = await preview(b, { mediaId: src, effect: 'estadio' }).expect(200);
    const id = r.body.mediaId as string;
    expect(existsSync(join(MEDIA, id))).toBe(true);
    expect([...(await referencedAmong(pool, [id, src]))]).toEqual([]);
    // Com 47 horas já não se dá (podia desaparecer antes de o URL deixar de valer): faz-se outra.
    await pool.query(`UPDATE content.media_assets SET created_at = now() - interval '47 hours 30 minutes' WHERE id = $1`, [id]);
    const again = await preview(b, { mediaId: src, effect: 'estadio' }).expect(200);
    expect(again.body.cached).toBe(false);
    expect(again.body.mediaId).not.toBe(id);
    await pool.query(`UPDATE content.media_assets SET created_at = now() - interval '49 hours' WHERE id = ANY($1::uuid[])`, [[id, again.body.mediaId, src]]);
    await unused.run();
    for (const x of [id, again.body.mediaId, src]) {
      expect((await pool.query('SELECT 1 FROM content.media_assets WHERE id = $1', [x])).rowCount).toBe(0);
      expect(existsSync(join(MEDIA, x))).toBe(false);
    }
    // A origem foi-se: 404.
    await preview(b, { mediaId: src, effect: 'estadio' }).expect(404);
  }, 90_000);
});
