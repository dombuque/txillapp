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
import { MusicCatalogService } from '../music/catalog/catalog.service';
import { SoundsService } from '../sounds/sounds.service';
import { encodeWav, renderSfxTrack, reverbImpulse, VOICE_FX_IDS } from './audio';
import { ComposeService, RESTART_ERROR } from './compose.service';
import { probe } from './ffmpeg';
import { voiceFxGraph } from './plan';
import { createCanvas } from '@napi-rs/canvas';
import { applyFxPixel, fxSeconds, resolveFx, sanitizeOverlay, type Overlay } from './effects';
import { drawOverlays } from './renderOverlays';
import { drawTransition, type Scratch } from './renderTransitions';
import { ensureStudioFonts } from './studio-canvas';

const DB = process.env.TEST_DATABASE_URL ?? 'postgres://txill:txill_dev@localhost:5433/txillapp_test';
const PASSWORD = 'password-bem-longa-1';
const FF = ffmpegPath as unknown as string;
const MEDIA = './uploads-test';
const MUSIC_URL = 'https://ccmixter.org/content/teste/batida.mp3';
const work = mkdtempSync(join(tmpdir(), 'txill-comp-'));
/** Outras músicas «do catálogo» que o fetcher falso serve (o som dos testes do trecho, dos fades e do ducking). */
const servedMusic = new Map<string, Buffer>();

/** Um ficheiro gerado com o ffmpeg (nada de fora): `lavfi` são as fontes de teste (testsrc, color, sine…). */
function make(name: string, args: string[]) {
  const file = join(work, name);
  execFileSync(FF, ['-y', '-v', 'error', ...args, file], { stdio: 'ignore' });
  return readFileSync(file);
}
const photo = (name: string, src = 'testsrc2=size=720x1280') => make(`${name}.png`, ['-f', 'lavfi', '-i', src, '-frames:v', '1']);
/** Um vídeo com som (barras de cor e um apito), ou numa cor só (para ver onde fica no dueto). */
const video = (name: string, seconds: number, color?: string) =>
  make(`${name}.mp4`, ['-f', 'lavfi', '-i', color ? `color=c=${color}:size=360x640:rate=30:duration=${seconds}` : `testsrc=size=360x640:rate=30:duration=${seconds}`, '-f', 'lavfi', '-i', `sine=frequency=440:duration=${seconds}`, '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest']);
/** Uma batida a 120 BPM (um toque a cada 0,5 s, a começar em 0,4 s), em MP3, como a música do catálogo. */
const beatMp3 = () => make('batida.mp3', ['-f', 'lavfi', '-i', "aevalsrc='0.9*sin(2*PI*220*t)*exp(-40*mod(t+0.1,0.5))':s=44100:d=20", '-c:a', 'libmp3lame', '-b:a', '96k']);

/** A média de cada canal (R, G, B) num quadrado do frame no instante `t`. */
function rgbAt(file: string, t: number, x: number, y: number, size = 16): [number, number, number] {
  const buf = execFileSync(FF, ['-v', 'error', '-ss', String(t), '-i', file, '-frames:v', '1', '-vf', `crop=${size}:${size}:${x}:${y},format=rgb24`, '-f', 'rawvideo', '-']);
  const s = [0, 0, 0];
  for (let i = 0; i < buf.length; i += 3) for (let c = 0; c < 3; c++) s[c] += buf[i + c];
  const n = buf.length / 3;
  return [s[0] / n, s[1] / n, s[2] / n];
}
/** Quantos píxeis claros há numa zona do frame (o texto branco sobre fotos pretas). */
function brightAt(file: string, t: number, crop: string): number {
  const buf = execFileSync(FF, ['-v', 'error', '-ss', String(t), '-i', file, '-frames:v', '1', '-vf', `crop=${crop},format=gray`, '-f', 'rawvideo', '-']);
  let n = 0;
  for (const v of buf) if (v > 180) n++;
  return n;
}

interface U { token: string; id: string; username: string }

describe('montagem das tchekas no servidor (POST /tchekas/compose)', () => {
  let app: INestApplication;
  let pool: Pool;
  let svc: ComposeService;
  let a: U, b: U, c: U;
  const run = Date.now().toString(36);
  const api = () => request(app.getHttpServer());
  const as = (u: U) => ({ Authorization: `Bearer ${u.token}` });
  const music = { id: 'ccmixter:teste-batida', title: 'Batida de teste', artist: 'Teste', url: MUSIC_URL, landing: null, license: 'by', licenseUrl: 'https://creativecommons.org/licenses/by/4.0/', durationMs: 20_000, cover: null };
  let fetched: string[] = [];

  async function register(name: string): Promise<U> {
    const username = `${name}${run}`.slice(0, 28);
    const r = await api().post('/api/v1/auth/register').send({ email: `${username}@example.com`, username, displayName: `${name} Teste`, password: PASSWORD, birthDate: '1990-06-15', acceptTerms: true }).expect(201);
    await pool.query('UPDATE identity.users SET email_verified_at = now() WHERE id = $1', [r.body.user.id]);
    return { token: r.body.accessToken, id: r.body.user.id, username };
  }
  async function upload(u: U, bytes: Buffer, mime: string) {
    const up = await api().post('/api/v1/media/uploads').set(as(u)).send({ mime, size: bytes.length }).expect(201);
    await api().put(up.body.uploadUrl).set('Content-Type', mime).send(bytes).expect(200);
    return up.body.assetId as string;
  }
  /** Envia um vídeo e espera pela conversão (o upload de sempre). */
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
  async function waitJob(u: U, jobId: string) {
    const seen: number[] = [];
    for (let i = 0; i < 600; i++) {
      const s = (await api().get(`/api/v1/tchekas/compose/${jobId}`).set(as(u)).expect(200)).body as { status: string; progress: number; mediaId?: string; error?: string; durationMs?: number };
      seen.push(s.progress);
      if (s.status === 'done' || s.status === 'failed') return { ...s, seen };
      await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error('a montagem demorou demais');
  }
  const compose = (u: U, body: unknown) => api().post('/api/v1/tchekas/compose').set(as(u)).send(body as object);
  const out = (mediaId: string) => join(MEDIA, mediaId);

  let photos: string[] = [];
  let black: string[] = [];

  beforeAll(async () => {
    await migrate(DB);
    pool = new Pool({ connectionString: DB });
    app = await createApp(loadConfig({ DATABASE_URL: DB, JWT_ACCESS_SECRET: 'c'.repeat(40), NODE_ENV: 'test', MEDIA_DIR: MEDIA, IMAGE_MODERATION: 'off' }));
    await app.init();
    svc = app.get(ComposeService);
    // A música «do catálogo» vem daqui (nunca da rede): só o endereço permitido responde.
    const mp3 = beatMp3();
    svc.fetcher = (async (input: string | URL | Request) => {
      const url = String(input);
      fetched.push(url);
      const body = url === MUSIC_URL ? mp3 : servedMusic.get(url);
      if (!body) return new Response('não', { status: 404 });
      return new Response(new Uint8Array(body), { status: 200, headers: { 'content-type': 'audio/mpeg', 'content-length': String(body.length) } });
    }) as typeof fetch;
    a = await register('cpa');
    b = await register('cpb');
    c = await register('cpc');
    photos = [];
    for (let i = 0; i < 3; i++) photos.push(await upload(a, photo(`p${i}`), 'image/png'));
    black = [];
    for (let i = 0; i < 3; i++) black.push(await upload(a, photo(`k${i}`, 'color=c=black:size=720x1280'), 'image/png'));
  }, 120_000);

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  it('3 fotos com música: 1080×1920, a duração certa, com som, capa e pronto para publicar', async () => {
    fetched = [];
    const r = await compose(a, {
      clips: photos.map((id) => ({ mediaId: id, kind: 'photo', durationMs: 2000 })),
      sound: { kind: 'music', music },
      transition: 'fade',
      filter: 'vivo',
      stickers: [{ id: 'amor', x: 0.3, y: 0.3, s: 0.25, r: 10 }],
      coverMs: 3000,
    }).expect(202);
    expect(r.body.jobId).toMatch(/^[0-9a-f-]{36}$/);
    const job = await waitJob(a, r.body.jobId);
    expect(job.error).toBeUndefined();
    expect(job.status).toBe('done');
    expect(job.progress).toBe(1);
    expect(job.seen.some((p) => p > 0 && p < 1)).toBe(true); // o progresso vai subindo
    expect(fetched).toEqual([MUSIC_URL]);
    const p = await probe(out(job.mediaId!));
    expect(p).toMatchObject({ width: 1080, height: 1920, hasVideo: true, hasAudio: true });
    expect(p.seconds).toBeGreaterThan(5.9);
    expect(p.seconds).toBeLessThan(6.15);
    expect(job.durationMs).toBeGreaterThan(5900);
    // H.264 + AAC a 30 fps, com o índice no início (faststart).
    const info = JSON.parse(execFileSync(require('ffprobe-static').path, ['-v', 'error', '-show_streams', '-of', 'json', out(job.mediaId!)]).toString()) as { streams: { codec_name: string; codec_type: string; r_frame_rate: string }[] };
    expect(info.streams.find((s) => s.codec_type === 'video')).toMatchObject({ codec_name: 'h264', r_frame_rate: '30/1' });
    expect(info.streams.find((s) => s.codec_type === 'audio')).toMatchObject({ codec_name: 'aac' });
    const head = readFileSync(out(job.mediaId!)).subarray(0, 4096).toString('latin1');
    expect(head.indexOf('moov')).toBeGreaterThan(-1);
    expect(head.indexOf('moov')).toBeLessThan(head.indexOf('mdat') === -1 ? Infinity : head.indexOf('mdat'));
    // O ficheiro: público, pronto, meu e assinado (o servidor já não volta a pôr a assinatura).
    const m = (await pool.query('SELECT owner_id, status, purpose, mime, signed, width, height FROM content.media_assets WHERE id = $1', [job.mediaId])).rows[0];
    expect(m).toMatchObject({ owner_id: a.id, status: 'ready', purpose: 'public', mime: 'video/mp4', signed: true, width: 1080, height: 1920 });
    // A capa serve-se, e a tcheka publica-se como sempre.
    await api().get(`/api/v1/media/${job.mediaId}?poster=1`).expect(200).expect('Content-Type', /image\/jpeg/);
    const post = (await api().post('/api/v1/posts').set(as(a)).send({ body: 'montada no servidor', mediaIds: [job.mediaId], music }).expect(201)).body;
    expect(post.media[0]).toMatchObject({ kind: 'video', width: 1080, height: 1920 });
    expect(post.music).toMatchObject({ title: 'Batida de teste' });
    // Os temporários foram limpos.
    expect(readdirSync(tmpdir()).filter((f) => f.startsWith('txcompose-'))).toEqual([]);
  }, 180_000);

  it('ao ritmo: as fotos acabam nas batidas da música (deteção no servidor)', async () => {
    const r = await compose(a, {
      clips: photos.map((id) => ({ mediaId: id, kind: 'photo' })),
      sound: { kind: 'music', music },
      beats: { mode: 'auto', perPhoto: 2 },
    }).expect(202);
    const job = await waitJob(a, r.body.jobId);
    expect(job.status).toBe('done');
    const p = await probe(out(job.mediaId!));
    // 120 BPM, a primeira batida a 0,4 s: a 1.ª foto acaba na 2.ª batida (0,9 s), as outras ficam 2 batidas (1 s) → 2,9 s.
    expect(Math.abs(p.seconds - 2.9)).toBeLessThan(0.08);
  }, 180_000);

  it('vídeo cortado e a 2×, com o filtro P&B e o som do próprio vídeo', async () => {
    const v = await uploadVideo(a, video('oito', 8));
    const r = await compose(a, { clips: [{ mediaId: v, kind: 'video', trimStartMs: 1000, trimEndMs: 8000, speed: 2 }], filter: 'pb' }).expect(202);
    const job = await waitJob(a, r.body.jobId);
    expect(job.error).toBeUndefined();
    const p = await probe(out(job.mediaId!));
    expect(p).toMatchObject({ width: 1080, height: 1920, hasAudio: true });
    expect(Math.abs(p.seconds - 3.5)).toBeLessThan(0.1); // 7 s a 2×
    const [R, G, B] = rgbAt(out(job.mediaId!), 1.5, 200, 600, 64);
    expect(Math.abs(R - G) + Math.abs(G - B)).toBeLessThan(12); // a preto e branco
  }, 180_000);

  it('texto com tempo de entrada e saída', async () => {
    const r = await compose(a, {
      clips: black.map((id) => ({ mediaId: id, kind: 'photo', durationMs: 1500 })),
      sound: { kind: 'music', music },
      texts: [{ text: 'OLÁ MALTA', color: '#ffffff', x: 0.5, y: 0.5, size: 0.09, startMs: 1500, endMs: 3200 }],
    }).expect(202);
    const job = await waitJob(a, r.body.jobId);
    expect(job.status).toBe('done');
    const f = out(job.mediaId!);
    const zone = '800:240:140:840'; // o meio do ecrã, onde fica o texto
    expect(brightAt(f, 0.5, zone)).toBe(0); // ainda não entrou
    expect(brightAt(f, 2.3, zone)).toBeGreaterThan(500); // já se vê
    expect(brightAt(f, 4.0, zone)).toBe(0); // já saiu
  }, 180_000);

  it('«Usar este som»: um som original (do armazenamento privado) e o som de uma faixa do catálogo', async () => {
    // O som original sai de uma tcheka de B com som próprio (o SoundsService tira-o em segundo plano).
    const v = await uploadVideo(b, video('som-b', 3));
    const p = (await api().post('/api/v1/posts').set(as(b)).send({ body: 'o meu som', mediaIds: [v] }).expect(201)).body;
    await app.get(SoundsService).idle();
    const soundId = (await pool.query(`SELECT id FROM content.sounds WHERE source_post_id = $1 AND kind = 'original'`, [p.id])).rows[0]?.id as string;
    expect(soundId).toBeTruthy();
    const body = { clips: photos.map((id) => ({ mediaId: id, kind: 'photo', durationMs: 1000 })), sound: { kind: 'sound', soundId } };
    const job = await waitJob(a, (await compose(a, body).expect(202)).body.jobId);
    expect(job.error).toBeUndefined();
    expect(await probe(out(job.mediaId!))).toMatchObject({ hasAudio: true });
    // Em análise, ou com «Deixar usar o meu som» desligado: não.
    await pool.query('UPDATE content.sounds SET hold_at = now() WHERE id = $1', [soundId]);
    expect((await compose(a, body).expect(403)).body.message).toBe('Este som está em análise e não pode ser usado agora');
    await pool.query('UPDATE content.sounds SET hold_at = NULL WHERE id = $1', [soundId]);
    await pool.query('UPDATE identity.users SET sound_reuse = false WHERE id = $1', [b.id]);
    expect((await compose(a, body).expect(403)).body.message).toBe('Quem publicou este som não deixa usá-lo');
    await pool.query('UPDATE identity.users SET sound_reuse = true WHERE id = $1', [b.id]);
    // O som de uma faixa do catálogo (`cat:<faixa>`): o áudio vem do endereço do catálogo, não do que a app mandaria.
    const catId = `ccmixter:comp-${run}`;
    const track = { id: catId, title: 'Faixa do som', artist: 'Teste', duration: 20, previewUrl: MUSIC_URL, cover: null, source: 'ccmixter', license: 'by', licenseUrl: null, landing: null, styles: [], kind: 'music' };
    await pool.query(`INSERT INTO content.music_catalog (id, source, kind, track, styles, quality) VALUES ($1, 'ccmixter', 'music', $2, '{}', 0.5) ON CONFLICT (id) DO UPDATE SET track = EXCLUDED.track`, [catId, JSON.stringify(track)]);
    app.get(MusicCatalogService).invalidate();
    try {
      fetched = [];
      const j2 = await waitJob(a, (await compose(a, { ...body, sound: { kind: 'sound', soundId: `cat:${catId}` } }).expect(202)).body.jobId);
      expect(j2.status).toBe('done');
      expect(fetched).toEqual([MUSIC_URL]);
    } finally {
      await pool.query('DELETE FROM content.music_catalog WHERE id = $1', [catId]);
    }
  }, 180_000);

  it('valida as regras do estúdio, os ficheiros e a música (400 com a dica)', async () => {
    const msg = async (body: unknown, code = 400) => (await compose(a, body).expect(code)).body.message as string;
    expect(await msg({ clips: [{ mediaId: photos[0], kind: 'photo' }], sound: { kind: 'music', music } })).toBe('Junta mais 2 fotos');
    expect(await msg({ clips: photos.map((id) => ({ mediaId: id, kind: 'photo' })) })).toBe('Escolhe uma música');
    expect(await msg({ clips: Array.from({ length: 31 }, (_, i) => ({ mediaId: photos[i % 3], kind: 'photo' })), sound: { kind: 'music', music } })).toBe('No máximo 30 clipes numa tcheka');
    expect(await msg({ clips: Array.from({ length: 7 }, (_, i) => ({ mediaId: photos[i % 3], kind: 'photo', durationMs: 10_000 })), sound: { kind: 'music', music } })).toBe('Tira 10 s (máximo 60 s)');
    expect(await msg({ clips: [{ mediaId: photos[0], kind: 'video' }, { mediaId: photos[1], kind: 'photo' }, { mediaId: photos[2], kind: 'photo' }], sound: { kind: 'music', music } })).toBe('O clipe 1 não é um vídeo');
    expect(await msg({ clips: photos.map((id) => ({ mediaId: id, kind: 'photo', speed: 4 })), sound: { kind: 'music', music } })).toBe('A velocidade é 0,5×, 1×, 2× ou 3×');
    // Ficheiros de outra pessoa (ou que não existem) não entram.
    const theirs = await upload(b, photo('b0'), 'image/png');
    expect(await msg({ clips: [theirs, photos[1], photos[2]].map((id) => ({ mediaId: id, kind: 'photo' })), sound: { kind: 'music', music } })).toMatch(/não é teu/);
    expect(await msg({ clips: [uuidv7(), photos[1], photos[2]].map((id) => ({ mediaId: id, kind: 'photo' })), sound: { kind: 'music', music } })).toMatch(/não é teu/);
    // A música só de anfitriões permitidos e por https.
    expect(await msg({ clips: photos.map((id) => ({ mediaId: id, kind: 'photo' })), sound: { kind: 'music', music: { ...music, id: 'x:1', url: 'https://evil.example.com/a.mp3' } } })).toMatch(/sítio que não é permitido/);
    expect(await msg({ clips: photos.map((id) => ({ mediaId: id, kind: 'photo' })), sound: { kind: 'music', music: { ...music, id: 'x:2', url: 'http://ccmixter.org/a.mp3' } } })).toMatch(/sítio que não é permitido/);
    expect(await msg({ clips: photos.map((id) => ({ mediaId: id, kind: 'photo' })), sound: { kind: 'music', music: { ...music, id: 'x:3', license: 'by-nc' } } })).toMatch(/licença/);
    expect(await msg({ clips: photos.map((id) => ({ mediaId: id, kind: 'photo' })), sound: { kind: 'sound', soundId: 'isto-nao' } })).toBe('Som inválido');
    // Um som original que não existe (ou, sem a 0133 dos sons, nenhum) e uma faixa que saiu do catálogo.
    expect(await msg({ clips: photos.map((id) => ({ mediaId: id, kind: 'photo' })), sound: { kind: 'sound', soundId: uuidv7() } }, 404)).toBe('Este som já não está disponível');
    expect(await msg({ clips: photos.map((id) => ({ mediaId: id, kind: 'photo' })), sound: { kind: 'sound', soundId: 'cat:ccmixter:nao-existe' } })).toBe('Esta música já não está disponível');
    // A música licenciada ainda não se monta aqui; um clipe de áudio tem de ser meu.
    expect(await msg({ clips: photos.map((id) => ({ mediaId: id, kind: 'photo' })), sound: { kind: 'music', music: { kind: 'licensed', source: 'fake', id: 'x' } } })).toMatch(/licenciada/);
    expect(await msg({ clips: photos.map((id) => ({ mediaId: id, kind: 'photo' })), sound: { kind: 'music', music: { kind: 'clip', mediaId: uuidv7(), durationMs: 5000 } } })).toMatch(/Áudio inválido/);
    expect(await msg({ clips: photos.map((id) => ({ mediaId: id, kind: 'photo' })), sound: { kind: 'music', music }, filter: 'neon' })).toBe('Filtro desconhecido');
    expect(await msg({ clips: photos.map((id) => ({ mediaId: id, kind: 'photo' })), sound: { kind: 'music', music }, stickers: [{ id: 'nao-existe', x: 0.5, y: 0.5, s: 0.2, r: 0 }] })).toBe('Sticker desconhecido');
    expect(await msg({ clips: photos.map((id) => ({ mediaId: id, kind: 'photo' })), sound: { kind: 'music', music }, coverMs: 30_000 })).toBe('A capa tem de ser um momento da tcheka');
    // Sem sessão, nada.
    await api().post('/api/v1/tchekas/compose').send({ clips: [] }).expect(401);
  }, 60_000);

  it('o estado do job: só para o dono, um de cada vez por pessoa, e falha depois de um reinício', async () => {
    await api().get(`/api/v1/tchekas/compose/${uuidv7()}`).set(as(a)).expect(404);
    await api().get('/api/v1/tchekas/compose/nao-e-um-id').set(as(a)).expect(404);
    const body = { clips: photos.map((id) => ({ mediaId: id, kind: 'photo', durationMs: 1000 })), sound: { kind: 'music', music } };
    const first = (await compose(a, body).expect(202)).body.jobId as string;
    const again = await compose(a, body).expect(409);
    expect(again.body.message).toBe('Já tens uma tcheka a montar. Espera que acabe.');
    await api().get(`/api/v1/tchekas/compose/${first}`).set(as(b)).expect(404); // de outra pessoa
    const s = (await api().get(`/api/v1/tchekas/compose/${first}`).set(as(a)).expect(200)).body;
    expect(['queued', 'working', 'done']).toContain(s.status);
    expect(s.progress).toBeGreaterThanOrEqual(0);
    expect(s.progress).toBeLessThanOrEqual(1);
    expect((await waitJob(a, first)).status).toBe('done');
    // Um reinício a meio: o que estava a correr passa a falhado, com «Tenta outra vez».
    const ghost = uuidv7();
    await pool.query(`INSERT INTO content.compose_jobs (id, owner_id, status, progress, spec, started_at) VALUES ($1, $2, 'working', 0.4, '{}', now())`, [ghost, c.id]);
    await svc.recover();
    const g = (await api().get(`/api/v1/tchekas/compose/${ghost}`).set(as(c)).expect(200)).body;
    expect(g).toMatchObject({ status: 'failed', error: RESTART_ERROR });
    // E já pode pedir outra.
    expect((await pool.query(`SELECT count(*)::int AS n FROM content.compose_jobs WHERE owner_id = $1 AND status IN ('queued', 'working')`, [c.id])).rows[0].n).toBe(0);
  }, 180_000);

  it('dueto: a pessoa à esquerda, o original à direita, com o som dos dois; com as permissões do remix', async () => {
    // A tcheka original (de B): azul, 6 s.
    const orig = await uploadVideo(b, video('azul', 6, 'blue'));
    const post = (await api().post('/api/v1/posts').set(as(b)).send({ body: 'dança comigo', mediaIds: [orig] }).expect(201)).body;
    const mine = await uploadVideo(a, video('vermelho', 4, 'red'));
    const r = await compose(a, { clips: [{ mediaId: mine, kind: 'video' }], duet: { postId: post.id, layout: 'side' } }).expect(202);
    const job = await waitJob(a, r.body.jobId);
    expect(job.error).toBeUndefined();
    const f = out(job.mediaId!);
    const p = await probe(f);
    expect(p).toMatchObject({ width: 1080, height: 1920, hasAudio: true });
    expect(Math.abs(p.seconds - 4)).toBeLessThan(0.1); // o meu vídeo (o original é mais comprido)
    const left = rgbAt(f, 1, 200, 900), right = rgbAt(f, 1, 740, 900), top = rgbAt(f, 1, 500, 200);
    expect(left[0]).toBeGreaterThan(180); expect(left[2]).toBeLessThan(80); // vermelho à esquerda
    expect(right[2]).toBeGreaterThan(180); expect(right[0]).toBeLessThan(80); // azul à direita
    expect(Math.max(...top)).toBeLessThan(30); // faixa preta por cima (quadros 9:16 ao meio)

    // Sem ser uma tcheka: não.
    const pic = await upload(b, photo('b1'), 'image/png');
    const photoPost = (await api().post('/api/v1/posts').set(as(b)).send({ body: 'foto', mediaIds: [pic] }).expect(201)).body;
    expect((await compose(a, { clips: [{ mediaId: mine, kind: 'video' }], duet: { postId: photoPost.id } }).expect(400)).body.message).toBe('Só dá para fazer dueto com uma tcheka');
    // Conta privada: sem a seguir, não se vê; a seguir, vê-se mas não deixa (numa conta privada o remix nunca vale).
    await pool.query('UPDATE identity.users SET is_private = true WHERE id = $1', [b.id]);
    await compose(a, { clips: [{ mediaId: mine, kind: 'video' }], duet: { postId: post.id } }).expect(404);
    await pool.query('INSERT INTO social.follows (follower_id, followee_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [a.id, b.id]);
    expect((await compose(a, { clips: [{ mediaId: mine, kind: 'video' }], duet: { postId: post.id } }).expect(403)).body.message).toBe('Esta pessoa não deixa fazer duetos nem responder com tchekas');
    await pool.query('UPDATE identity.users SET is_private = false WHERE id = $1', [b.id]);
    // «Deixar fazer duetos» desligado (a coluna chega com o ramo do remix, 0134).
    const hasCol = (await pool.query(`SELECT 1 FROM information_schema.columns WHERE table_schema = 'identity' AND table_name = 'users' AND column_name = 'remix_allowed'`)).rowCount;
    if (hasCol) {
      await pool.query('UPDATE identity.users SET remix_allowed = false WHERE id = $1', [b.id]);
      await compose(a, { clips: [{ mediaId: mine, kind: 'video' }], duet: { postId: post.id } }).expect(403);
      await pool.query('UPDATE identity.users SET remix_allowed = true WHERE id = $1', [b.id]);
    }
    // Publicação apagada: não.
    await pool.query('UPDATE content.posts SET removed_at = now() WHERE id = $1', [post.id]);
    await compose(a, { clips: [{ mediaId: mine, kind: 'video' }], duet: { postId: post.id } }).expect(404);
  }, 240_000);

  // ------------------------------------------------------------------ o som do estúdio (trecho, fades, voz-off, efeitos)

  /** Uma música de teste servida pelo fetcher falso (a faixa como vem do catálogo). */
  function catalogTrack(name: string, expr: string) {
    const url = `https://ccmixter.org/content/teste/${name}.mp3`;
    servedMusic.set(url, make(`${name}.mp3`, ['-f', 'lavfi', '-i', `aevalsrc='${expr}':s=44100:d=20`, '-c:a', 'libmp3lame', '-b:a', '128k']));
    return { ...music, id: `ccmixter:teste-${name}`, title: name, url };
  }
  /** Uma voz-off (opus em webm, como grava o browser), enviada como os clipes de áudio: `purpose: 'chat'`, privada. */
  async function uploadVoice(u: U, name: string, expr: string, seconds: number) {
    const bytes = make(`${name}.webm`, ['-f', 'lavfi', '-i', `aevalsrc='${expr}':s=48000:d=${seconds}`, '-c:a', 'libopus', '-b:a', '64k']);
    const up = await calm(() => api().post('/api/v1/media/uploads').set(as(u)).send({ mime: 'audio/webm', size: bytes.length, purpose: 'chat' }));
    expect(up.status).toBe(201);
    expect((await calm(() => api().put(up.body.uploadUrl).set('Content-Type', 'audio/webm').send(bytes))).status).toBe(200);
    return up.body.assetId as string;
  }
  const SR = 16_000;
  /** O som do vídeo final, mono a 16 kHz. */
  function pcm(file: string): Float32Array {
    const b = execFileSync(FF, ['-v', 'error', '-i', file, '-vn', '-ac', '1', '-ar', String(SR), '-f', 'f32le', '-'], { maxBuffer: 64 * 1024 * 1024 });
    return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.length));
  }
  /** A amplitude de uma frequência entre t0 e t1 (Goertzel): um seno de amplitude A dá ≈ A. */
  function tone(x: Float32Array, hz: number, t0: number, t1: number) {
    const a = Math.round(t0 * SR), b = Math.min(x.length, Math.round(t1 * SR));
    const c = 2 * Math.cos((2 * Math.PI * hz) / SR);
    let s1 = 0, s2 = 0;
    for (let i = a; i < b; i++) { const s0 = x[i] + c * s1 - s2; s2 = s1; s1 = s0; }
    return (2 * Math.sqrt(Math.max(0, s1 * s1 + s2 * s2 - c * s1 * s2))) / Math.max(1, b - a);
  }
  function rms(x: Float32Array, t0: number, t1: number) {
    const a = Math.round(t0 * SR), b = Math.min(x.length, Math.round(t1 * SR));
    let e = 0;
    for (let i = a; i < b; i++) e += x[i] * x[i];
    return Math.sqrt(e / Math.max(1, b - a));
  }
  /**
   * Muitas montagens seguidas passam o limite de pedidos por minuto da API (120): estes testes perguntam de 1 em 1 s (como a
   * app) e, se mesmo assim levarem 429, esperam e repetem.
   */
  async function calm<T extends { status: number }>(send: () => PromiseLike<T>): Promise<T> {
    for (let i = 0; ; i++) {
      const r = await send();
      if (r.status !== 429 || i > 40) return r;
      await new Promise((ok) => setTimeout(ok, 3000));
    }
  }
  async function waitCalm(u: U, jobId: string) {
    for (let i = 0; i < 240; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      const res = await calm(() => api().get(`/api/v1/tchekas/compose/${jobId}`).set(as(u)));
      expect(res.status).toBe(200);
      const s = res.body as { status: string; mediaId?: string; error?: string };
      if (s.status === 'done' || s.status === 'failed') return s;
    }
    throw new Error('a montagem demorou demais');
  }
  const done = async (u: U, body: unknown) => {
    const r = await calm(() => compose(u, body));
    expect(r.status).toBe(202);
    const job = await waitCalm(u, r.body.jobId);
    expect(job.error).toBeUndefined();
    expect(job.status).toBe('done');
    return out(job.mediaId!);
  };
  /** Um pedido recusado: 400 e a mensagem. */
  const bad = async (body: unknown) => { const r = await calm(() => compose(a, body)); expect(r.status).toBe(400); return r.body.message as string; };
  /** Um vídeo enviado e convertido (com calma no limite de pedidos). */
  async function calmVideo(u: U, bytes: Buffer) {
    const up = await calm(() => api().post('/api/v1/media/uploads').set(as(u)).send({ mime: 'video/mp4', size: bytes.length }));
    if (up.status !== 201) throw new Error(`envio do vídeo: ${up.status} ${JSON.stringify(up.body)}`);
    await calm(() => api().put(up.body.uploadUrl).set('Content-Type', 'video/mp4').send(bytes));
    const id = up.body.assetId as string;
    await calm(() => api().post(`/api/v1/media/${id}/complete`).set(as(u)));
    for (let i = 0; i < 120; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      const st = (await calm(() => api().get(`/api/v1/media/${id}/status`).set(as(u)))).body as { status: string };
      if (st.status === 'ready') return id;
    }
    throw new Error('conversão demorou demais');
  }
  const three = () => photos.map((id) => ({ mediaId: id, kind: 'photo', durationMs: 2000 }));
  /** Voz de 1 kHz dos 0,5 aos 3,5 s (4 s de gravação). */
  const VOICE = '0.5*sin(2*PI*1000*t)*between(t,0.5,3.5)';
  let voiceId = '';
  /** A voz-off de teste (enviada uma vez; cada teste do som pode correr sozinho). */
  const ensureVoice = async () => (voiceId ||= await uploadVoice(a, 'voz', VOICE, 4));

  it('som: o trecho escolhido (musicStartMs) e os fades da música', async () => {
    // 300 Hz nos primeiros 10 s, 900 Hz a seguir: começar aos 10 s ouve-se só o 900.
    const duas = catalogTrack('duas', '0.5*sin(2*PI*if(lt(t,10),300,900)*t)');
    const f = await done(a, { clips: three(), sound: { kind: 'music', music: duas }, musicStartMs: 10_000, musicFadeInMs: 2000, musicFadeOutMs: 1500 });
    const x = pcm(f);
    expect(tone(x, 900, 2.5, 3.5)).toBeGreaterThan(0.3);
    expect(tone(x, 300, 2.5, 3.5)).toBeLessThan(0.03);
    // Fade-in de 2 s (a direito: a 0,1 s quase nada, a 1 s metade) e fade-out de 1,5 s.
    const mid = rms(x, 2.5, 3.5);
    expect(rms(x, 0, 0.2)).toBeLessThan(mid * 0.15);
    const half = rms(x, 0.9, 1.1) / mid;
    expect(half).toBeGreaterThan(0.35);
    expect(half).toBeLessThan(0.65);
    expect(rms(x, 5.8, 6)).toBeLessThan(mid * 0.15);
    // Ao ritmo: as batidas leem-se do trecho (a batida a 0,4 s na faixa fica a 0,2 s começando aos 200 ms).
    const r = await done(a, { clips: photos.map((id) => ({ mediaId: id, kind: 'photo' })), sound: { kind: 'music', music }, beats: { mode: 'auto', perPhoto: 2 }, musicStartMs: 200 });
    expect(Math.abs((await probe(r)).seconds - 3.2)).toBeLessThan(0.08);
  }, 240_000);

  it('som: a voz-off sozinha conta como som (3 s ou mais), entra no instante dela e a música baixa por baixo (ducking)', async () => {
    await ensureVoice();
    // Só fotos e a voz-off (sem música): monta, e a voz entra aos 1 + 0,5 s.
    const solo = pcm(await done(a, { clips: three(), voiceOver: { mediaId: voiceId, startMs: 1000 } }));
    expect(tone(solo, 1000, 2, 3)).toBeGreaterThan(0.3);
    expect(rms(solo, 0.2, 1.3)).toBeLessThan(0.01);
    expect(rms(solo, 4.7, 5.5)).toBeLessThan(0.01); // sem efeito, nada de cauda depois da voz
    // Com música constante de 300 Hz: com ducking a música desce mais de 6 dB enquanto se fala; sem ducking, não.
    const flat = catalogTrack('plana', '0.5*sin(2*PI*300*t)');
    const ducked = pcm(await done(a, { clips: three(), sound: { kind: 'music', music: flat }, voiceOver: { mediaId: voiceId, startMs: 1000 } }));
    const before = tone(ducked, 300, 0.2, 1.2), during = tone(ducked, 300, 2.2, 4.2);
    expect(before).toBeGreaterThan(0.3);
    expect(during / before).toBeLessThan(0.5);
    expect(tone(ducked, 300, 5.4, 5.9) / before).toBeGreaterThan(0.8); // volta depois da voz
    const open = pcm(await done(a, { clips: three(), sound: { kind: 'music', music: flat }, voiceOver: { mediaId: voiceId, startMs: 1000, volume: 0.5 }, ducking: false }));
    expect(tone(open, 300, 2.2, 4.2) / tone(open, 300, 0.2, 1.2)).toBeGreaterThan(0.85);
    // O volume da voz-off: a metade.
    expect(tone(open, 1000, 2, 3) / tone(solo, 1000, 2, 3)).toBeGreaterThan(0.4);
    expect(tone(open, 1000, 2, 3) / tone(solo, 1000, 2, 3)).toBeLessThan(0.6);
  }, 300_000);

  it('som: a voz-off curta não chega; e só uma voz-off minha, de áudio e com efeitos conhecidos (400 com a dica)', async () => {
    await ensureVoice();
    const short = await uploadVoice(a, 'curta', '0.5*sin(2*PI*1000*t)', 1.5);
    const r = await calm(() => compose(a, { clips: three(), voiceOver: { mediaId: short } }));
    expect(r.status).toBe(202);
    const job = await waitCalm(a, r.body.jobId);
    expect(job.status).toBe('failed');
    expect(job.error).toBe('Grava mais 2 s de voz-off ou escolhe uma música');
    const hers = await uploadVoice(b, 'dela', VOICE, 4);
    const notMine = 'A voz-off não é tua ou ainda não está pronta. Envia-a outra vez.';
    expect(await bad({ clips: three(), voiceOver: { mediaId: hers } })).toBe(notMine);
    expect(await bad({ clips: three(), voiceOver: { mediaId: photos[0] } })).toBe(notMine);
    expect(await bad({ clips: three(), sound: { kind: 'music', music }, voiceOver: { mediaId: voiceId, effect: 'gato' } })).toBe('Efeito de voz desconhecido');
    expect(await bad({ clips: three(), sound: { kind: 'music', music }, originalEffect: 'gato' })).toBe('Efeito de voz desconhecido');
    expect(await bad({ clips: three(), sound: { kind: 'music', music }, musicFadeInMs: 4000 })).toBe('O fade vai de 0 a 3 s');
    expect(await bad({ clips: three(), sound: { kind: 'music', music }, soundEffects: [{ id: 'buzina', atMs: 0 }] })).toBe('Efeito sonoro desconhecido');
    expect(await bad({ clips: three(), sound: { kind: 'music', music }, soundEffects: Array.from({ length: 31 }, () => ({ id: 'pop', atMs: 0 })) })).toBe('No máximo 30 efeitos sonoros');
  }, 240_000);

  it('som: efeitos de voz — o Esquilo sobe o tom, o Estádio deixa cauda, o Grave baixa o som original', async () => {
    await ensureVoice();
    const squirrel = pcm(await done(a, { clips: three(), voiceOver: { mediaId: voiceId, effect: 'esquilo' } }));
    expect(tone(squirrel, 1500, 1, 3)).toBeGreaterThan(tone(squirrel, 1000, 1, 3) * 3);
    const stadium = pcm(await done(a, { clips: three(), voiceOver: { mediaId: voiceId, effect: 'estadio' } }));
    expect(tone(stadium, 1000, 1, 3)).toBeGreaterThan(0.3);
    expect(rms(stadium, 3.7, 4.3)).toBeGreaterThan(0.01); // a cauda do reverb depois da voz (acaba aos 3,5 s)
    const echo = pcm(await done(a, { clips: three(), voiceOver: { mediaId: voiceId, effect: 'eco' } }));
    expect(tone(echo, 1000, 3.62, 3.75)).toBeGreaterThan(0.1); // a primeira repetição (280 ms) depois do fim
    // No som original de um vídeo (440 Hz): Grave = × 0,72 ≈ 317 Hz. (Com a conta c: a «a» já passou dos 10 vídeos por hora,
    // que contam também as tchekas montadas.)
    const v = await calmVideo(c, video('quatro', 4));
    const low = pcm(await done(c, { clips: [{ mediaId: v, kind: 'video' }], originalEffect: 'grave' }));
    expect(tone(low, 317, 1, 3)).toBeGreaterThan(tone(low, 440, 1, 3) * 3);
  }, 300_000);

  it('som: todos os efeitos de voz montam no ffmpeg e dão som com a duração certa', () => {
    const ir = join(work, 'ir.wav');
    writeFileSync(ir, encodeWav(reverbImpulse(48_000), 48_000));
    const got: Record<string, { seconds: number; loud: boolean }> = {};
    const want: Record<string, { seconds: number; loud: boolean }> = {};
    for (const id of VOICE_FX_IDS) {
      const graph = ['[0:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo[i]', ...voiceFxGraph(id, '[i]', '[o]', 'fx', id === 'estadio' ? '[1:a]' : null)].join(';');
      const outFile = join(work, `fx_${id}.wav`);
      execFileSync(FF, ['-y', '-v', 'error', '-f', 'lavfi', '-i', "aevalsrc='0.5*sin(2*PI*440*t)':s=48000:d=1", ...(id === 'estadio' ? ['-i', ir] : []), '-filter_complex', graph, '-map', '[o]', '-t', '1', outFile]);
      const x = pcm(outFile);
      got[id] = { seconds: Math.round((x.length / SR) * 10) / 10, loud: rms(x, 0.2, 0.9) > 0.05 };
      want[id] = { seconds: 1, loud: true };
    }
    expect(got).toEqual(want);
  }, 120_000);

  it('som: os efeitos sonoros são gerados no servidor com o mesmo desenho e tocam no instante deles', async () => {
    const x = pcm(await done(a, { clips: three(), sound: { kind: 'music', music }, musicVolume: 0, soundEffects: [{ id: 'tambor', atMs: 1000 }, { id: 'ding', atMs: 3000 }] }));
    expect(rms(x, 0.1, 0.95)).toBeLessThan(0.003); // a música calada e nada antes do tambor
    expect(rms(x, 1, 1.3)).toBeGreaterThan(0.05);
    expect(tone(x, 880, 3.02, 3.4)).toBeGreaterThan(0.05); // o ding (880 Hz)
    // A mesma faixa que o estúdio gera (renderSfxTrack): o envelope bate (correlação alta, em blocos de 20 ms), não é só
    // «algum som» (as amostras não se comparam: o AAC e a reamostragem mexem na fase).
    const ref = renderSfxTrack([{ id: 'tambor', at: 1 }, { id: 'ding', at: 3 }], 6, SR);
    const env = (s: Float32Array) => Array.from({ length: 200 }, (_, k) => rms(s, 0.9 + k * 0.02, 0.92 + k * 0.02));
    const ex = env(x), er = env(ref);
    const mean = (v: number[]) => v.reduce((p, q) => p + q, 0) / v.length;
    const mx = mean(ex), mr = mean(er);
    let xy = 0, xx = 0, yy = 0;
    for (let k = 0; k < ex.length; k++) { xy += (ex[k] - mx) * (er[k] - mr); xx += (ex[k] - mx) ** 2; yy += (er[k] - mr) ** 2; }
    expect(xy / Math.sqrt(xx * yy)).toBeGreaterThan(0.9);
  }, 240_000);

  // ------------------------------------------------------------------ os efeitos do estúdio (docs/estudio-efeitos.md)

  /** O frame `k` do vídeo (RGB, W×H inteiro). */
  function frameAt(file: string, k: number): Buffer {
    return execFileSync(FF, ['-v', 'error', '-i', file, '-vf', `select='eq(n\\,${k})',format=rgb24`, '-frames:v', '1', '-fps_mode', 'passthrough', '-f', 'rawvideo', '-'], { maxBuffer: 64 * 1024 * 1024 });
  }
  const FW = 1080, FH = 1920;
  /** A média RGB de um quadrado de um frame já lido. */
  const meanAt = (f: Buffer, x: number, y: number, s = 16, w = FW): [number, number, number] => {
    const m = [0, 0, 0];
    for (let j = 0; j < s; j++) for (let i = 0; i < s; i++) for (let c = 0; c < 3; c++) m[c] += f[((y + j) * w + x + i) * 3 + c];
    return m.map((v) => v / (s * s)) as [number, number, number];
  };
  const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  function deltaE(a: readonly number[], b: readonly number[]): number {
    const lab = (rgb: readonly number[]) => {
      const [R, G, B] = rgb.map((v) => lin(Math.min(255, Math.max(0, v)) / 255));
      const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
      const x = f((0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047), y = f(0.2126 * R + 0.7152 * G + 0.0722 * B), z = f((0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883);
      return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
    };
    const A = lab(a), B = lab(b);
    return Math.hypot(A[0] - B[0], A[1] - B[1], A[2] - B[2]);
  }
  /** O canvas do Node com o desenho do site (as mesmas funções que a montagem usa) → RGB por cima de um fundo. */
  function canvasRgb(draw: (g: CanvasRenderingContext2D) => void, bg = '#000'): Buffer {
    ensureStudioFonts();
    const c = createCanvas(FW, FH);
    const g = c.getContext('2d');
    g.fillStyle = bg;
    g.fillRect(0, 0, FW, FH);
    draw(g as unknown as CanvasRenderingContext2D);
    const d = g.getImageData(0, 0, FW, FH).data;
    const out = Buffer.alloc(FW * FH * 3);
    for (let i = 0; i < FW * FH; i++) { out[i * 3] = d[i * 4]; out[i * 3 + 1] = d[i * 4 + 1]; out[i * 3 + 2] = d[i * 4 + 2]; }
    return out;
  }
  /** A diferença média (0–255) entre dois frames numa caixa, e quantos píxeis claros cada um tem lá. */
  function compare(a: Buffer, b: Buffer, box: { x: number; y: number; w: number; h: number }) {
    let diff = 0, n = 0, ba = 0, bb = 0;
    for (let y = box.y; y < box.y + box.h; y += 2) for (let x = box.x; x < box.x + box.w; x += 2) {
      const i = (y * FW + x) * 3;
      let la = 0, lb = 0;
      for (let c = 0; c < 3; c++) { diff += Math.abs(a[i + c] - b[i + c]); la += a[i + c]; lb += b[i + c]; }
      if (la > 300) ba++;
      if (lb > 300) bb++;
      n += 3;
    }
    return { diff: diff / n, bright: ba, brightRef: bb };
  }
  const GIF_URL = 'https://media.giphy.com/media/Txill42gif/giphy.gif';

  it('efeitos: o filtro (ΔE à fórmula do site) e um ajuste (brilho e vinheta) no vídeo final', async () => {
    // Retalhos de cor grandes (a compressão e o 4:2:0 não mexem no meio deles) e um cinzento liso para o ajuste.
    const colors = ['0xc0392b', '0x2e86c1', '0xf1c40f', '0x27ae60', '0x8e44ad', '0xe67e22', '0xecf0f1', '0x34495e'];
    const boxes = colors.map((c, i) => `drawbox=x=${(i % 2) * 180}:y=${Math.floor(i / 2) * 160}:w=180:h=160:c=${c}:t=fill`).join(',');
    const patches = make('retalhos.mp4', ['-f', 'lavfi', '-i', `color=c=gray:size=360x640:rate=30:duration=3,${boxes}`, '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '10', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest']);
    const gray = make('cinza.mp4', ['-f', 'lavfi', '-i', 'color=c=0x808080:size=360x640:rate=30:duration=3', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '10', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest']);
    const u = await register('fxcor'); // uma conta por teste: o envio de vídeos tem um limite por hora
    const v1 = await calmVideo(u, patches), v2 = await calmVideo(u, gray);
    const filterFx = { filter: { id: 'limpopo', amount: 1 } };
    const adjustFx = { transition: { type: 'corte' as const, dur: 0.5 }, adjust: { brightness: 0.4, vignette: 0.8 } };
    const f = await done(u, { clips: [{ mediaId: v1, kind: 'video', trimEndMs: 3000, fx: filterFx }, { mediaId: v2, kind: 'video', trimEndMs: 3000, fx: adjustFx }] });
    const p = await probe(f);
    expect(p).toMatchObject({ width: 1080, height: 1920, hasAudio: true });
    expect(Math.abs(p.seconds - 6)).toBeLessThan(0.1);

    // O filtro: cada retalho do vídeo final contra applyFxPixel(o mesmo píxel da fonte), com a vinheta no sítio dele.
    const src = execFileSync(FF, ['-v', 'error', '-ss', '1', '-i', join(work, 'retalhos.mp4'), '-frames:v', '1', '-vf', 'format=rgb24', '-f', 'rawvideo', '-']);
    const got = frameAt(f, 30);
    const fx = resolveFx(filterFx);
    const dE = colors.map((_, i) => {
      const sx = (i % 2) * 180 + 82, sy = Math.floor(i / 2) * 160 + 72; // o meio do retalho na fonte (360×640)
      const s = meanAt(src, sx, sy, 16, 360);
      const ox = sx * 3, oy = sy * 3; // no quadro de 1080×1920 (×3)
      const want = applyFxPixel(fx, s.map((v) => v / 255) as [number, number, number], (ox + 24) / FW, (oy + 24) / FH).map((v) => v * 255);
      return deltaE(meanAt(got, ox, oy, 48), want);
    });
    const mean = dE.reduce((x, y) => x + y, 0) / dE.length;
    console.log(`ΔE76 do filtro Limpopo no vídeo final (8 retalhos): média ${mean.toFixed(2)}, máximo ${Math.max(...dE).toFixed(2)}`);
    expect(mean).toBeLessThan(2.5);
    expect(Math.max(...dE)).toBeLessThan(5);

    // O ajuste: o cinzento fica mais claro no meio (brilho 1 + 0,45·0,4) e escurece nos cantos pela vinheta (cos⁴).
    const g2 = frameAt(f, 120);
    const adj = resolveFx(adjustFx);
    const g0 = meanAt(execFileSync(FF, ['-v', 'error', '-ss', '1', '-i', join(work, 'cinza.mp4'), '-frames:v', '1', '-vf', 'format=rgb24', '-f', 'rawvideo', '-']), 170, 310, 16, 360)[0] / 255;
    for (const [x, y] of [[532, 952], [100, 100], [60, 1400], [900, 300]]) {
      const want = applyFxPixel(adj, [g0, g0, g0], (x + 8) / FW, (y + 8) / FH)[0] * 255;
      expect(Math.abs(meanAt(g2, x, y)[0] - want)).toBeLessThan(6); // ±2 %: o H.264 num cinzento liso
    }
    expect(meanAt(g2, 532, 952)[0] - meanAt(g2, 20, 20)[0]).toBeGreaterThan(60); // a vinheta vê-se
  }, 300_000);

  it('efeitos: a rampa muda a duração como no estúdio e inverter toca do fim para o início, calado', async () => {
    // Vermelho no 1.º segundo, azul no 2.º: invertido, começa azul e acaba vermelho.
    const rb = make('vermelho-azul.mp4', ['-f', 'lavfi', '-i', 'color=c=red:size=360x640:rate=30:duration=1', '-f', 'lavfi', '-i', 'color=c=blue:size=360x640:rate=30:duration=1', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-filter_complex', '[0:v][1:v]concat=n=2:v=1[v]', '-map', '[v]', '-map', '2:a', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest']);
    const u = await register('fxtempo');
    const v1 = await calmVideo(u, video('rampa', 4));
    const v2 = await calmVideo(u, rb);
    const f = await done(u, {
      clips: [
        { mediaId: v1, kind: 'video', trimEndMs: 4000, fx: { ramp: 'heroi' } },
        { mediaId: v2, kind: 'video', trimEndMs: 2000, fx: { reverse: true, transition: { type: 'corte', dur: 0.5 } } },
      ],
      originalVolume: 1,
    });
    const p = await probe(f);
    const ramp = fxSeconds(4, 1, { ramp: 'heroi' }); // 4 s / 0,7 = 5,71 s
    expect(Math.abs(p.seconds - (Math.round(ramp * 30) / 30 + 2))).toBeLessThan(0.05);
    // Ao contrário: azul no início do clipe, vermelho no fim.
    const k0 = Math.round(ramp * 30);
    const [r1, , b1] = meanAt(frameAt(f, k0 + 8), 500, 400);
    const [r2, , b2] = meanAt(frameAt(f, k0 + 52), 500, 400);
    expect(b1).toBeGreaterThan(150);
    expect(r1).toBeLessThan(80);
    expect(r2).toBeGreaterThan(150);
    expect(b2).toBeLessThan(80);
    // O som do clipe invertido fica calado (o apito de 440 Hz só toca na rampa).
    const x = pcm(f);
    expect(tone(x, 440, 0.5, ramp - 0.5)).toBeGreaterThan(0.02);
    expect(rms(x, ramp + 0.2, ramp + 1.8)).toBeLessThan(0.003);
  }, 300_000);

  it('efeitos: as transições (fundido, deslizar e glitch) iguais ao desenho do site, sem mudar o ritmo dos cortes', async () => {
    const cols = ['red', 'blue', 'lime', 'yellow'];
    const u = await register('fxtrans');
    const ids: string[] = [];
    for (const c of cols) ids.push(await calmVideo(u, video(`cor-${c}`, 2, c)));
    const trs = [{ type: 'fundido', dur: 1 }, { type: 'deslizar-esquerda', dur: 1 }, { type: 'glitch', dur: 0.8 }] as const;
    const f = await done(u, { clips: ids.map((id, i) => ({ mediaId: id, kind: 'video', trimEndMs: 2000, ...(i ? { fx: { transition: trs[i - 1] } } : {}) })) });
    const p = await probe(f);
    expect(Math.abs(p.seconds - 8)).toBeLessThan(0.05); // 4 × 2 s: as transições não mudam a duração
    const scratch: Scratch = (() => { const m = new Map<string, { c: HTMLCanvasElement; g: CanvasRenderingContext2D }>(); return (n: string, w: number, h: number) => { let s = m.get(n); if (!s || s.c.width !== w || s.c.height !== h) { const c = createCanvas(w, h) as unknown as HTMLCanvasElement; s = { c, g: (c as unknown as { getContext: (k: '2d') => CanvasRenderingContext2D }).getContext('2d') }; m.set(n, s); } return s; }; })();
    const solid = (rgb: number[]) => { const c = createCanvas(FW, FH); const g = c.getContext('2d'); g.fillStyle = `rgb(${rgb.map(Math.round).join(',')})`; g.fillRect(0, 0, FW, FH); return c as unknown as CanvasImageSource; };
    const area = { x: 0, y: 0, w: FW, h: 1500 }; // fora da assinatura (em baixo)
    const report: string[] = [];
    for (let i = 1; i < 4; i++) {
      const start = 60 * i;
      // As cores tal como saíram (antes e depois da transição), como o site usa o último frame do anterior e o frame de agora.
      const prev = solid(meanAt(frameAt(f, start - 1), 500, 500));
      const cur = solid(meanAt(frameAt(f, start + 40), 500, 500));
      for (const k of [start + 3, start + Math.round(trs[i - 1].dur * 15), start + Math.round(trs[i - 1].dur * 30) - 3]) {
        const want = canvasRgb((g) => drawTransition(g, prev, cur, trs[i - 1].type, (k - start) / 30 / trs[i - 1].dur, FW, FH, scratch));
        const c = compare(frameAt(f, k), want, area);
        report.push(`${trs[i - 1].type} p=${((k - start) / 30 / trs[i - 1].dur).toFixed(2)}: ${c.diff.toFixed(2)}`);
        expect(c.diff).toBeLessThan(trs[i - 1].type === 'glitch' ? 6 : 3);
      }
    }
    console.log(`Transições (diferença média 0–255 ao desenho do site):\n  ${report.join('\n  ')}`);
    // A curva do site (easeInOutCubic) e não a linear do xfade: a 7/30 do deslizar, o anterior (azul) ainda vai até
    // x = W·(1 − 0,051) ≈ 1025 px; a direito ficava em 828 px e em x = 900 já se via o verde.
    const q = frameAt(f, 120 + 7);
    expect(meanAt(q, 900, 500)[2]).toBeGreaterThan(150);
    expect(meanAt(q, 900, 500)[1]).toBeLessThan(80);
  }, 300_000);

  it('efeitos: um texto néon a entrar, um emoji e um GIF do GIPHY (com o fetcher falso) iguais ao site', async () => {
    // Um GIF de 2 frames (vermelho e verde, 0,5 s cada), servido como se viesse da CDN do GIPHY.
    const gif = make('anim.gif', ['-f', 'lavfi', '-i', 'color=c=red:size=120x120:rate=2:duration=0.5', '-f', 'lavfi', '-i', 'color=c=lime:size=120x120:rate=2:duration=0.5', '-filter_complex', '[0:v][1:v]concat=n=2:v=1,split[a][b];[a]palettegen[p];[b][p]paletteuse', '-loop', '0']);
    servedMusic.set(GIF_URL, gif);
    const text = { id: 't1', kind: 'text', start: 1, end: 5, x: 0.5, y: 0.35, text: 'Bom dia, Maputo!', font: 'futuro', size: 96, color: '#ff4fd8', neon: true, anim: { in: 'pop', out: 'aparecer', loop: 'nenhuma', inDur: 0.45, outDur: 0.35 } };
    const emoji = { id: 's1', kind: 'sticker', start: 0, end: 6, x: 0.3, y: 0.62, rot: 0, sticker: { type: 'emoji', emoji: '🔥' }, anim: { in: 'nenhuma', out: 'nenhuma', loop: 'nenhuma' } };
    const gifOv = { id: 'g1', kind: 'sticker', start: 0.5, end: 5.5, x: 0.72, y: 0.62, scale: 0.5, rot: 10, sticker: { type: 'gif', id: 'Txill42gif', url: GIF_URL, w: 120, h: 120 }, anim: { in: 'nenhuma', out: 'nenhuma', loop: 'nenhuma' } };
    const f = await done(a, { clips: black.map((id) => ({ mediaId: id, kind: 'photo', durationMs: 2000 })), sound: { kind: 'music', music }, overlays: [text, emoji, gifOv] });
    expect(fetched).toContain(GIF_URL);
    const ovs = [text, emoji, gifOv].map((o) => sanitizeOverlay(o) as Overlay);
    const ref = (t: number, list: Overlay[]) => canvasRgb((g) => drawOverlays(g, list, t, { W: FW, H: FH, image: () => null }));
    const textBox = { x: 40, y: 520, w: 1000, h: 300 };
    // Antes: nada; a entrar (pop a meio): igual ao site; depois, parado: igual ao site.
    expect(compare(frameAt(f, 27), ref(0.9, []), textBox).bright).toBe(0);
    for (const k of [36, 75]) {
      const c = compare(frameAt(f, k), ref(k / 30, [ovs[0]]), textBox);
      console.log(`Texto néon no frame ${k}: diferença média ${c.diff.toFixed(2)}, píxeis claros ${c.bright} (site ${c.brightRef})`);
      expect(c.brightRef).toBeGreaterThan(500);
      expect(c.diff).toBeLessThan(4);
      expect(Math.abs(c.bright - c.brightRef) / c.brightRef).toBeLessThan(0.15);
    }
    // O emoji: igual ao desenho do site (a mesma fonte de emojis) e com as cores dele.
    const eb = { x: 170, y: 1040, w: 300, h: 300 };
    const ce = compare(frameAt(f, 90), ref(3, [ovs[1]]), eb);
    expect(ce.brightRef).toBeGreaterThan(1000);
    expect(ce.diff).toBeLessThan(6);
    const [er, eg, ebl] = meanAt(frameAt(f, 90), 312, 1180, 24);
    expect(er - ebl).toBeGreaterThan(60); // laranja/vermelho, não cinzento
    expect(er).toBeGreaterThan(eg);
    // O GIF mexe-se: vermelho no 1.º meio segundo da vida dele, verde no seguinte, vermelho outra vez (em ciclo).
    const at = (k: number) => meanAt(frameAt(f, k), Math.round(0.72 * FW) - 8, Math.round(0.62 * FH) - 8);
    const [c1, c2, c3] = [at(15 + 7), at(15 + 22), at(15 + 37)];
    expect(c1[0]).toBeGreaterThan(180);
    expect(c1[1]).toBeLessThan(80);
    expect(c2[1]).toBeGreaterThan(180);
    expect(c2[0]).toBeLessThan(80);
    expect(c3[0]).toBeGreaterThan(180);
    expect(meanAt(frameAt(f, 8), Math.round(0.72 * FW) - 8, Math.round(0.62 * FH) - 8)[0]).toBeLessThan(30); // antes de entrar
  }, 300_000);

  it('efeitos: as validações (400 com a dica) e o filtro de texto nas camadas', async () => {
    const u = await register('fxval');
    const v = await calmVideo(u, video('val', 3));
    const long = await calmVideo(u, video('longo', 16));
    const badU = async (body: unknown) => { const r = await calm(() => compose(u, body)); expect(r.status).toBe(400); return r.body.message as string; };
    expect(await badU({ clips: [{ mediaId: long, kind: 'video', trimEndMs: 16000, fx: { reverse: true } }] })).toBe('Para inverter, o clipe pode ter até 15 s');
    expect(await badU({ sound: { kind: 'music', music }, clips: [{ mediaId: v, kind: 'video', fx: { freeze: { from: 'x', at: 1 } } }] })).toBe('Um frame congelado vai como uma foto');
    const ok = { clips: three(), sound: { kind: 'music', music } };
    expect(await bad({ ...ok, clips: [{ ...three()[0], fx: { ramp: 'heroi' } }, ...three().slice(1)] })).toBe('A rampa e o inverter são só para vídeos');
    expect(await bad({ ...ok, clips: three().map((c) => ({ ...c, fx: { transition: { type: 'explosao', dur: 0.5 } } })) })).toBe('Transição desconhecida');
    expect(await bad({ ...ok, clips: three().map((c) => ({ ...c, fx: { transition: { type: 'zoom', dur: 3 } } })) })).toBe('A transição dura de 0,15 a 1,5 s');
    expect(await bad({ ...ok, clips: three().map((c) => ({ ...c, fx: { filter: { id: 'instagram', amount: 1 } } })) })).toBe('Filtro desconhecido');
    expect(await bad({ ...ok, clips: three().map((c) => ({ ...c, fx: { adjust: { contrast: 2 } } })) })).toBe('O ajuste Contraste vai de -1 a 1');
    expect(await bad({ ...ok, filter: 'pb', clips: three().map((c) => ({ ...c, fx: {} })) })).toBe('Com os efeitos do estúdio (fx), a transição e o filtro vão em cada clipe');
    const t = (o: object) => ({ id: 't', kind: 'text', start: 0, end: 2, x: 0.5, y: 0.5, text: 'Olá', ...o });
    expect(await bad({ ...ok, overlays: [t({ end: 0 })] })).toBe('A camada tem de sair depois de entrar');
    expect(await bad({ ...ok, overlays: [t({ font: 'comic' })] })).toBe('Fonte desconhecida');
    expect(await bad({ ...ok, overlays: Array.from({ length: 21 }, (_, i) => t({ id: `t${i}` })) })).toBe('No máximo 20 textos e stickers');
    const s = (sticker: object) => ({ id: 's', kind: 'sticker', start: 0, end: 2, x: 0.5, y: 0.5, sticker });
    expect(await bad({ ...ok, overlays: [s({ type: 'gif', id: 'abcd1234', url: 'https://example.com/media/abcd1234/giphy.gif', w: 200, h: 200 })] })).toBe('O GIF tem de vir do GIPHY');
    expect(await bad({ ...ok, overlays: [s({ type: 'gif', id: 'abcd1234', url: 'http://media.giphy.com/media/abcd1234/giphy.gif', w: 200, h: 200 })] })).toBe('O GIF tem de vir do GIPHY');
    expect(await bad({ ...ok, overlays: [s({ type: 'emoji', emoji: 'olá' })] })).toBe('O sticker de emoji só leva emojis');
    expect(await bad({ ...ok, overlays: [s({ type: 'txill', id: 'nao-existe' })] })).toBe('Sticker desconhecido');
    const r = await calm(() => compose(a, { ...ok, overlays: [t({ text: 'vou te matar' })] }));
    expect(r.status).toBe(422);
    const r2 = await calm(() => compose(a, { ...ok, overlays: [s({ type: 'location', name: 'preto de merda' })] }));
    expect(r2.status).toBe(422);
  }, 300_000);

  it('os temporários e os ficheiros: nada fica para trás', () => {
    expect(readdirSync(tmpdir()).filter((f) => f.startsWith('txcompose-'))).toEqual([]);
    expect(existsSync(MEDIA)).toBe(true);
  });
});
