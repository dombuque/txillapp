import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { execFileSync, spawnSync } from 'child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import ffmpegPath from 'ffmpeg-static';
import request from 'supertest';
import { Pool } from 'pg';
import { loadConfig } from '../config';
import { migrate } from '../db/migrate';
import { createApp } from '../main';
import { uuidv7 } from '../common/uuid7';
import { probe } from '../compose/ffmpeg';
import { END_CARD_S } from '../media/end-card';
import { MusicBakeService } from './music-bake.service';

const DB = process.env.TEST_DATABASE_URL ?? 'postgres://txill:txill_dev@localhost:5433/txillapp_test';
const PASSWORD = 'password-bem-longa-1';
const FF = ffmpegPath as unknown as string;
const MEDIA = './uploads-test';
const MUSIC_URL = 'https://ccmixter.org/content/teste/fim-batida.mp3';
const work = mkdtempSync(join(tmpdir(), 'txill-fim-'));

/** Um ficheiro gerado com o ffmpeg (fontes de teste, nada de fora). */
function make(name: string, args: string[]) {
  const file = join(work, name);
  execFileSync(FF, ['-y', '-v', 'error', ...args, file], { stdio: 'ignore' });
  return readFileSync(file);
}
/** Vídeo com um apito (som próprio) ou mudo (sem pista de áudio). */
const video = (name: string, seconds: number, withAudio: boolean) =>
  make(`${name}.mp4`, [
    '-f', 'lavfi', '-i', `testsrc=size=360x640:rate=30:duration=${seconds}`,
    ...(withAudio ? ['-f', 'lavfi', '-i', `sine=frequency=440:duration=${seconds}`, '-c:a', 'aac', '-shortest'] : ['-an']),
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
  ]);
const beatMp3 = () => make('batida.mp3', ['-f', 'lavfi', '-i', "aevalsrc='0.9*sin(2*PI*220*t)*exp(-40*mod(t+0.1,0.5))':s=44100:d=20", '-c:a', 'libmp3lame', '-b:a', '96k']);

/** O volume médio (dB) do som de um ficheiro, entre `from` e `to` segundos (-91 = silêncio). */
function meanDb(file: string, from = 0, to?: number): number {
  const r = spawnSync(FF, ['-hide_banner', '-ss', String(from), ...(to !== undefined ? ['-t', String(to - from)] : []), '-i', file, '-vn', '-af', 'volumedetect', '-f', 'null', '-'], { encoding: 'utf8' });
  const m = /mean_volume:\s*(-?[\d.]+) dB/.exec(r.stderr ?? '');
  return m ? Number(m[1]) : -91;
}
/** A média de cada canal (R, G, B) de um frame inteiro no instante `t`, e quantos píxeis claros tem o meio. */
function frameStats(file: string, t: number): { avg: number; brightCenter: number } {
  const buf = execFileSync(FF, ['-v', 'error', '-ss', String(t), '-i', file, '-frames:v', '1', '-vf', 'scale=90:160,format=gray', '-f', 'rawvideo', '-']);
  let sum = 0, bright = 0;
  for (let i = 0; i < buf.length; i++) {
    sum += buf[i];
    const x = i % 90, y = Math.floor(i / 90);
    if (x > 15 && x < 75 && y > 55 && y < 90 && buf[i] > 200) bright++;
  }
  return { avg: sum / buf.length, brightCenter: bright };
}

/** Lê a resposta binária como Buffer. */
const binary = (res: NodeJS.ReadableStream, cb: (err: Error | null, body: Buffer) => void) => {
  const chunks: Buffer[] = [];
  res.on('data', (c: Buffer) => chunks.push(Buffer.from(c)));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
  res.on('error', (e: Error) => cb(e, Buffer.alloc(0)));
};

interface U { token: string; id: string; username: string }

describe('fim de tcheka: música gravada no vídeo e cópia com o cartão do fim', () => {
  let app: INestApplication;
  let pool: Pool;
  let bakes: MusicBakeService;
  let a: U, b: U, c: U;
  const run = Date.now().toString(36);
  const api = () => request(app.getHttpServer());
  const as = (u: U) => ({ Authorization: `Bearer ${u.token}` });
  const music = { id: 'ccmixter:fim-batida', title: 'Batida do fim', artist: 'Teste', url: MUSIC_URL, landing: null, license: 'by', licenseUrl: 'https://creativecommons.org/licenses/by/4.0/', durationMs: 20_000, cover: null };
  let fetched: string[] = [];

  async function register(name: string): Promise<U> {
    const username = `${name}${run}`.slice(0, 28);
    const r = await api().post('/api/v1/auth/register').send({ email: `${username}@example.com`, username, displayName: `${name} Teste`, password: PASSWORD, birthDate: '1990-06-15', acceptTerms: true }).expect(201);
    await pool.query('UPDATE identity.users SET email_verified_at = now() WHERE id = $1', [r.body.user.id]);
    return { token: r.body.accessToken, id: r.body.user.id, username };
  }
  async function uploadVideo(u: U, bytes: Buffer) {
    const up = await api().post('/api/v1/media/uploads').set(as(u)).send({ mime: 'video/mp4', size: bytes.length }).expect(201);
    await api().put(up.body.uploadUrl).set('Content-Type', 'video/mp4').send(bytes).expect(200);
    const id = up.body.assetId as string;
    await api().post(`/api/v1/media/${id}/complete`).set(as(u)).expect(200);
    // Espera pela conversão na base de dados (sem gastar pedidos do limite por minuto).
    for (let i = 0; i < 240; i++) {
      const s = (await pool.query('SELECT status, processing_error FROM content.media_assets WHERE id = $1', [id])).rows[0];
      if (s?.status === 'ready') return id;
      if (s?.status === 'deleted') throw new Error(`vídeo recusado: ${s.processing_error}`);
      await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error('conversão demorou demais');
  }
  async function waitBake(postId: string) {
    for (let i = 0; i < 240; i++) {
      const r = (await pool.query('SELECT status, media_id, error FROM content.post_music_bakes WHERE post_id = $1', [postId])).rows[0];
      if (r && !['queued', 'working'].includes(r.status)) return r as { status: string; media_id: string | null; error: string | null };
      await new Promise((res) => setTimeout(res, 250));
    }
    throw new Error('a gravação da música demorou demais');
  }
  const getPost = async (u: U, id: string) => (await api().get(`/api/v1/posts/${id}`).set(as(u)).expect(200)).body;
  const idOf = (url: string) => /\/media\/([0-9a-f-]{36})/.exec(url)![1];
  const download = (u: U, id: string) => api().get(`/api/v1/posts/${id}/download`).set(as(u)).buffer(true).parse(binary as never);

  beforeAll(async () => {
    await migrate(DB);
    pool = new Pool({ connectionString: DB });
    app = await createApp(loadConfig({ DATABASE_URL: DB, JWT_ACCESS_SECRET: 'f'.repeat(40), NODE_ENV: 'test', MEDIA_DIR: MEDIA, IMAGE_MODERATION: 'off' }));
    await app.init();
    bakes = app.get(MusicBakeService);
    const mp3 = beatMp3();
    bakes.fetcher = (async (input: string | URL | Request) => {
      const url = String(input);
      fetched.push(url);
      if (url !== MUSIC_URL) return new Response('não', { status: 404 });
      return new Response(new Uint8Array(mp3), { status: 200, headers: { 'content-type': 'audio/mpeg', 'content-length': String(mp3.length) } });
    }) as typeof fetch;
    a = await register('fima');
    b = await register('fimb');
    c = await register('fimc');
  }, 120_000);

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  let silentPost = '';
  let silentMedia = '';

  it('tcheka muda + música do catálogo: o worker grava a música no vídeo e a publicação passa a musicBaked', async () => {
    fetched = [];
    silentMedia = await uploadVideo(a, video('mudo', 4, false));
    expect((await probe(join(MEDIA, silentMedia))).hasAudio).toBe(false);
    const p = (await api().post('/api/v1/posts').set(as(a)).send({ body: 'com música', mediaIds: [silentMedia], music }).expect(201)).body;
    silentPost = p.id;
    const job = await waitBake(p.id);
    expect(job.error).toBeNull();
    expect(job.status).toBe('done');
    expect(fetched).toContain(MUSIC_URL);
    expect(fetched.every((u) => u === MUSIC_URL)).toBe(true);
    // O vídeo novo: a mesma imagem e duração, agora com som (a música), público e pronto.
    const baked = join(MEDIA, job.media_id!);
    const info = await probe(baked);
    expect(info.hasAudio).toBe(true);
    expect(info.hasVideo).toBe(true);
    expect(Math.abs(info.seconds - 4)).toBeLessThan(0.15);
    expect(meanDb(baked)).toBeGreaterThan(-40);
    const row = (await pool.query(`SELECT purpose, status, owner_id FROM content.media_assets WHERE id = $1`, [job.media_id])).rows[0];
    expect(row).toMatchObject({ purpose: 'public', status: 'ready', owner_id: a.id });
    // Quem vê recebe o vídeo com a música (a capa continua a do original) e a música fica para o crédito.
    const seen = await getPost(b, p.id);
    expect(seen.musicBaked).toBe(true);
    expect(idOf(seen.media[0].url)).toBe(job.media_id);
    expect(idOf(seen.media[0].posterUrl)).toBe(silentMedia);
    expect(seen.music?.title).toBe('Batida do fim');
    await api().get(seen.media[0].url).expect(200);
  }, 120_000);

  it('enquanto a música não se pode ouvir pelo vídeo gravado, volta ao original com a música à parte', async () => {
    const job = (await pool.query('SELECT media_id FROM content.post_music_bakes WHERE post_id = $1', [silentPost])).rows[0];
    await pool.query(`UPDATE content.media_assets SET status = 'deleted' WHERE id = $1`, [job.media_id]);
    try {
      const seen = await getPost(b, silentPost);
      expect(seen.musicBaked).toBe(false);
      expect(idOf(seen.media[0].url)).toBe(silentMedia);
      expect(seen.music?.title).toBe('Batida do fim');
    } finally {
      await pool.query(`UPDATE content.media_assets SET status = 'ready', purged_at = NULL WHERE id = $1`, [job.media_id]);
    }
  });

  it('tcheka com som próprio: o som do vídeo fica (100 %) e a música entra por cima (70 %)', async () => {
    const mediaId = await uploadVideo(a, video('apito', 3, true));
    const p = (await api().post('/api/v1/posts').set(as(a)).send({ body: '', mediaIds: [mediaId], music }).expect(201)).body;
    const job = await waitBake(p.id);
    expect(job.status).toBe('done');
    const mix = (await pool.query('SELECT original_volume, music_volume FROM content.post_music_bakes WHERE post_id = $1', [p.id])).rows[0];
    expect(mix).toEqual({ original_volume: 1, music_volume: 0.7 });
    // Mais forte do que o apito sozinho (os dois juntos).
    expect(meanDb(join(MEDIA, job.media_id!))).toBeGreaterThan(meanDb(join(MEDIA, mediaId)));
  }, 120_000);

  it('montagem do estúdio (servidor) ou estúdio do site: a música já vai no vídeo, fica logo musicBaked sem gravar outra vez', async () => {
    // Uma montagem acabada (como a do ComposeService) que deu este vídeo.
    const composed = await uploadVideo(a, video('montada', 2, true));
    await pool.query(`INSERT INTO content.compose_jobs (id, owner_id, status, progress, spec, media_id, finished_at) VALUES ($1, $2, 'done', 1, '{}'::jsonb, $3, now())`, [uuidv7(), a.id, composed]);
    const p1 = (await api().post('/api/v1/posts').set(as(a)).send({ body: '', mediaIds: [composed], music }).expect(201)).body;
    expect(p1.musicBaked).toBe(true);
    expect(idOf(p1.media[0].url)).toBe(composed);
    // O estúdio do site manda musicInFile: o worker ouve o vídeo e, com som, fica 'inline' sem gravar outra vez.
    const web = await uploadVideo(a, video('estudio', 2, true));
    const p2 = (await api().post('/api/v1/posts').set(as(a)).send({ body: '', mediaIds: [web], music, musicInFile: true }).expect(201)).body;
    expect((await waitBake(p2.id)).status).toBe('inline');
    expect((await getPost(a, p2.id)).musicBaked).toBe(true);
    const rows = (await pool.query('SELECT post_id, status, media_id FROM content.post_music_bakes WHERE post_id = ANY($1)', [[p1.id, p2.id]])).rows;
    expect(rows.map((r) => r.status)).toEqual(['inline', 'inline']);
    expect(rows.every((r) => r.media_id === null)).toBe(true);
    // Sem música: nada a gravar.
    const plain = await uploadVideo(a, video('semmusica', 2, true));
    const p3 = (await api().post('/api/v1/posts').set(as(a)).send({ body: '', mediaIds: [plain] }).expect(201)).body;
    expect(p3.musicBaked).toBe(false);
    expect((await pool.query('SELECT 1 FROM content.post_music_bakes WHERE post_id = $1', [p3.id])).rowCount).toBe(0);
  }, 120_000);

  it('estúdio do site com musicInFile mas o vídeo saiu calado (Safari do iPhone): grava-se lá a música', async () => {
    for (const [label, withAudio] of [['webmudo', false], ['websilencio', true]] as const) {
      // Sem pista de áudio, ou com uma pista em silêncio.
      const file = withAudio
        ? make(`${label}.mp4`, ['-f', 'lavfi', '-i', 'testsrc=size=360x640:rate=30:duration=2', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo', '-t', '2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest'])
        : video(label, 2, false);
      const mediaId = await uploadVideo(a, file);
      const p = (await api().post('/api/v1/posts').set(as(a)).send({ body: '', mediaIds: [mediaId], music, musicInFile: true }).expect(201)).body;
      const job = await waitBake(p.id);
      expect(job.status).toBe('done');
      expect(meanDb(join(MEDIA, job.media_id!))).toBeGreaterThan(-40);
      expect((await getPost(b, p.id)).musicBaked).toBe(true);
    }
  }, 180_000);

  it('a música licenciada não se grava (fica à parte, como o contrato pede)', async () => {
    const mediaId = await uploadVideo(a, video('licenciada', 2, true));
    const p = (await api().post('/api/v1/posts').set(as(a)).send({ body: '', mediaIds: [mediaId], music }).expect(201)).body;
    await waitBake(p.id);
    // A mesma publicação com uma música licenciada guardada: o trabalho desiste sem tocar no vídeo.
    const other = await uploadVideo(a, video('licenciada2', 2, true));
    const q = (await api().post('/api/v1/posts').set(as(a)).send({ body: '', mediaIds: [other] }).expect(201)).body;
    await pool.query(`UPDATE content.posts SET music = '{"kind":"licensed","source":"teste","id":"x"}'::jsonb WHERE id = $1`, [q.id]);
    await pool.query(`INSERT INTO content.post_music_bakes (post_id, source_media_id) VALUES ($1, $2)`, [q.id, other]);
    await bakes.pump();
    const job = await waitBake(q.id);
    expect(job.status).toBe('skipped');
    expect(job.error).toMatch(/licenciada/);
    expect(job.media_id).toBeNull();
  }, 120_000);

  it('GET /posts/:id/download: a tcheka com o cartão do fim (mais END_CARD_S), com som, e da segunda vez sai da cache', async () => {
    const r1 = await download(b, silentPost).expect(200);
    expect(r1.headers['content-type']).toMatch(/^video\/mp4/);
    expect(r1.headers['content-disposition']).toMatch(/attachment; filename="txillapp-tcheka-.*\.mp4"/);
    expect(r1.headers['x-cache']).toBe('miss');
    const file = join(work, 'copia.mp4');
    writeFileSync(file, r1.body as Buffer);
    const info = await probe(file);
    expect(info.hasVideo).toBe(true);
    expect(info.hasAudio).toBe(true);
    expect(Math.abs(info.seconds - (4 + END_CARD_S))).toBeLessThan(0.2);
    // Toca: o ffmpeg lê-o todo sem erros.
    execFileSync(FF, ['-v', 'error', '-xerror', '-i', file, '-f', 'null', '-']);
    // O vídeo leva a música gravada (o original era mudo).
    expect(meanDb(file, 0.5, 3.5)).toBeGreaterThan(-40);
    // O cartão: fundo escuro e o logótipo branco ao meio.
    const card = frameStats(file, 4 + END_CARD_S - 0.3);
    expect(card.avg).toBeLessThan(60);
    expect(card.brightCenter).toBeGreaterThan(20);
    // No vídeo (barras de cor do testsrc) a imagem é clara.
    expect(frameStats(file, 1).avg).toBeGreaterThan(60);
    // A segunda vez: a mesma cópia, da cache.
    const r2 = await download(c, silentPost).expect(200);
    expect(r2.headers['x-cache']).toBe('hit');
    expect((r2.body as Buffer).equals(r1.body as Buffer)).toBe(true);
    const cached = (await pool.query(`SELECT d.version, m.purpose, m.status, m.expires_at FROM content.post_downloads d JOIN content.media_assets m ON m.id = d.media_id WHERE d.post_id = $1`, [silentPost])).rows;
    expect(cached).toHaveLength(1);
    expect(cached[0]).toMatchObject({ purpose: 'chat', status: 'ready' });
    expect(cached[0].expires_at).not.toBeNull();
    // O feed fica limpo: o vídeo da publicação não leva o cartão.
    const seen = await getPost(b, silentPost);
    expect(Math.abs((await probe(join(MEDIA, idOf(seen.media[0].url)))).seconds - 4)).toBeLessThan(0.15);
  }, 180_000);

  it('quem pode guardar: quem vê a publicação (conta privada: nem quem segue; bloqueios); sem vídeo dá 422', async () => {
    const mediaId = await uploadVideo(b, video('privada', 2, true));
    const p = (await api().post('/api/v1/posts').set(as(b)).send({ body: 'só para quem me segue', mediaIds: [mediaId] }).expect(201)).body;
    await pool.query('UPDATE identity.users SET is_private = true WHERE id = $1', [b.id]);
    try {
      await download(c, p.id).expect(404);
      await download(b, p.id).expect(200); // o próprio, sempre
      // Quem segue vê a tcheka, mas numa conta privada só o autor a guarda (0153, guardar-tchekas.e2e.spec.ts).
      await pool.query('INSERT INTO social.follows (follower_id, followee_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [c.id, b.id]);
      await download(c, p.id).expect(403);
    } finally {
      await pool.query('UPDATE identity.users SET is_private = false WHERE id = $1', [b.id]);
      await pool.query('DELETE FROM social.follows WHERE follower_id = $1 AND followee_id = $2', [c.id, b.id]);
    }
    await pool.query('INSERT INTO social.blocks (blocker_id, blocked_id) VALUES ($1, $2)', [b.id, c.id]);
    try {
      await download(c, p.id).expect(404);
    } finally {
      await pool.query('DELETE FROM social.blocks WHERE blocker_id = $1 AND blocked_id = $2', [b.id, c.id]);
    }
    const text = (await api().post('/api/v1/posts').set(as(b)).send({ body: 'só texto' }).expect(201)).body;
    await download(c, text.id).expect(422);
    await api().get(`/api/v1/posts/${p.id}/download`).expect(401);
  }, 120_000);

  it('a música ainda na fila: a cópia espera por ela (e leva-a)', async () => {
    const mediaId = await uploadVideo(c, video('fila', 2, false));
    const p = (await api().post('/api/v1/posts').set(as(c)).send({ body: '', mediaIds: [mediaId] }).expect(201)).body;
    // Como se tivesse acabado de entrar na fila (sem o worker lhe ter pegado).
    await pool.query(`UPDATE content.posts SET music = $2 WHERE id = $1`, [p.id, JSON.stringify(music)]);
    await pool.query(`INSERT INTO content.post_music_bakes (post_id, source_media_id) VALUES ($1, $2)`, [p.id, mediaId]);
    const r = await download(b, p.id).expect(200);
    const job = (await pool.query('SELECT status FROM content.post_music_bakes WHERE post_id = $1', [p.id])).rows[0];
    expect(job.status).toBe('done');
    const file = join(work, 'fila.mp4');
    writeFileSync(file, r.body as Buffer);
    expect(meanDb(file, 0.3, 1.8)).toBeGreaterThan(-40);
  }, 120_000);
});
