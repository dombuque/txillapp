import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { execFileSync } from 'child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync } from 'fs';
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
import { ComposeService, RESTART_ERROR } from './compose.service';
import { probe } from './ffmpeg';

const DB = process.env.TEST_DATABASE_URL ?? 'postgres://txill:txill_dev@localhost:5433/txillapp_test';
const PASSWORD = 'password-bem-longa-1';
const FF = ffmpegPath as unknown as string;
const MEDIA = './uploads-test';
const MUSIC_URL = 'https://ccmixter.org/content/teste/batida.mp3';
const work = mkdtempSync(join(tmpdir(), 'txill-comp-'));

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
      if (url !== MUSIC_URL) return new Response('não', { status: 404 });
      return new Response(new Uint8Array(mp3), { status: 200, headers: { 'content-type': 'audio/mpeg', 'content-length': String(mp3.length) } });
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

  it('os temporários e os ficheiros: nada fica para trás', () => {
    expect(readdirSync(tmpdir()).filter((f) => f.startsWith('txcompose-'))).toEqual([]);
    expect(existsSync(MEDIA)).toBe(true);
  });
});
