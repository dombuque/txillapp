import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { execFileSync } from 'child_process';
import { existsSync, mkdtempSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import ffmpegPath from 'ffmpeg-static';
import request from 'supertest';
import { Pool } from 'pg';
import { loadConfig } from '../config';
import { migrate } from '../db/migrate';
import { createApp } from '../main';
import { ImageClassifier } from '../moderation/image-moderation.service';

const DB = process.env.TEST_DATABASE_URL ?? 'postgres://txill:txill_dev@localhost:5433/txillapp_test';
const PASSWORD = 'password-bem-longa-1';
const FF = ffmpegPath as unknown as string;

/** Cria um vídeo de teste (barras de cor + som) com `seconds` segundos. */
function makeVideo(seconds: number, name: string, ext = 'mp4') {
  const dir = mkdtempSync(join(tmpdir(), 'txill-vid-'));
  const file = join(dir, `${name}.${ext}`);
  execFileSync(FF, ['-y', '-f', 'lavfi', '-i', `testsrc=size=320x240:rate=15:duration=${seconds}`, '-f', 'lavfi', '-i', `sine=frequency=440:duration=${seconds}`, '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', file], { stdio: 'ignore' });
  return readFileSync(file);
}

let score = 0.05; // o que o classificador de mentira devolve para qualquer imagem
const fake: ImageClassifier = { nsfwScore: async () => score };

interface U { token: string; id: string; username: string }

describe('vídeos curtos (conversão, verificação e publicação)', () => {
  let app: INestApplication;
  let pool: Pool;
  let u: U;
  const run = Date.now().toString(36);
  const api = () => request(app.getHttpServer());
  const auth = () => ({ Authorization: `Bearer ${u.token}` });

  beforeAll(async () => {
    await migrate(DB);
    pool = new Pool({ connectionString: DB });
    app = await createApp(
      loadConfig({ DATABASE_URL: DB, JWT_ACCESS_SECRET: 'v'.repeat(40), NODE_ENV: 'test', MEDIA_DIR: './uploads-test', IMAGE_MODERATION: 'local' }),
      { imageClassifier: fake },
    );
    await app.init();
    const username = `vid${run}`.slice(0, 28);
    const r = await api().post('/api/v1/auth/register').send({ email: `${username}@example.com`, username, displayName: 'Vid', password: PASSWORD, birthDate: '1990-06-15', acceptTerms: true }).expect(201);
    u = { token: r.body.accessToken, id: r.body.user.id, username };
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  async function upload(bytes: Buffer, mime = 'video/mp4') {
    const up = await api().post('/api/v1/media/uploads').set(auth()).send({ mime, size: bytes.length }).expect(201);
    await api().put(up.body.uploadUrl).set('Content-Type', mime).send(bytes).expect(200);
    return up.body.assetId as string;
  }
  /** Pede a conversão e espera (a app faz o mesmo, a perguntar pelo estado). */
  async function convert(id: string) {
    const first = await api().post(`/api/v1/media/${id}/complete`).set(auth()).expect(200);
    expect(['processing', 'ready']).toContain(first.body.status);
    for (let i = 0; i < 60; i++) {
      const s = (await api().get(`/api/v1/media/${id}/status`).set(auth()).expect(200)).body as { status: string; error?: string; durationMs?: number };
      if (s.status === 'ready' || s.status === 'deleted') return s;
      await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error('conversão demorou demais');
  }

  it('converte para MP4, gera a capa, serve com Range e permite publicar', async () => {
    const id = await upload(makeVideo(3, 'ok'));
    // ainda não convertido: não se serve
    await api().get(`/api/v1/media/${id}`).expect(404);
    const s = await convert(id);
    expect(s.status).toBe('ready');
    expect(s.durationMs).toBeGreaterThan(2500);
    expect(s.durationMs).toBeLessThan(3600);

    const full = await api().get(`/api/v1/media/${id}`).expect(200).expect('Content-Type', /video\/mp4/);
    expect(full.headers['accept-ranges']).toBe('bytes');
    const part = await api().get(`/api/v1/media/${id}`).set('Range', 'bytes=0-99').expect(206);
    expect(part.headers['content-range']).toMatch(/^bytes 0-99\//);
    const poster = await api().get(`/api/v1/media/${id}?poster=1`).expect(200).expect('Content-Type', /image\/jpeg/);
    expect(poster.headers['cache-control']).toMatch(/immutable/);
    expect(existsSync(`./uploads-test/${id}.src`)).toBe(false); // o original enviado é apagado

    const post = (await api().post('/api/v1/posts').set(auth()).send({ body: 'meu primeiro #reel', mediaIds: [id] }).expect(201)).body;
    expect(post.media[0]).toMatchObject({ kind: 'video', url: `/api/v1/media/${id}`, posterUrl: `/api/v1/media/${id}?poster=1`, width: 320, height: 240 });
    expect(post.media[0].durationMs).toBeGreaterThan(2500);

    // um vídeo por publicação, sozinho; não se reutiliza
    const id2 = await upload(makeVideo(2, 'dois'));
    await convert(id2);
    await api().post('/api/v1/posts').set(auth()).send({ body: 'x', mediaIds: [id, id2] }).expect(400);
    await api().post('/api/v1/posts').set(auth()).send({ body: 'x', mediaIds: [id] }).expect(400); // já usado

    // aparece nos Reels de outra pessoa
    const other = `vio${run}`.slice(0, 28);
    const r = await api().post('/api/v1/auth/register').send({ email: `${other}@example.com`, username: other, displayName: 'Outro', password: PASSWORD, birthDate: '1990-06-15', acceptTerms: true }).expect(201);
    const reels = (await api().get('/api/v1/feed/reels?limit=15').set({ Authorization: `Bearer ${r.body.accessToken}` }).expect(200)).body.items as { id: string; media: { kind: string }[] }[];
    expect(reels.length).toBeGreaterThan(0);
    expect(reels.every((x) => x.media[0]?.kind === 'video')).toBe(true); // só vídeos
    expect(reels.map((x) => x.id)).toContain(post.id);
  }, 120_000);

  it('recusa vídeos com mais de 60 s, ficheiros que não são vídeo e vídeos impróprios', async () => {
    const long = await upload(makeVideo(62, 'longo'));
    const s = await convert(long);
    expect(s.status).toBe('deleted');
    expect(s.error).toMatch(/60 segundos/);
    await api().get(`/api/v1/media/${long}`).expect(404);
    expect(existsSync(`./uploads-test/${long}`)).toBe(false);

    // não é vídeo (conteúdo falso com tipo de vídeo)
    const fakeBytes = Buffer.from('isto não é um vídeo, só texto com mais de doze bytes');
    const up = await api().post('/api/v1/media/uploads').set(auth()).send({ mime: 'video/mp4', size: fakeBytes.length }).expect(201);
    await api().put(up.body.uploadUrl).set('Content-Type', 'video/mp4').send(fakeBytes).expect(415);
    // tipo não permitido
    await api().post('/api/v1/media/uploads').set(auth()).send({ mime: 'video/x-flv', size: 1000 }).expect(415);
    await api().post('/api/v1/media/uploads').set(auth()).send({ mime: 'video/mp4', size: 200 * 1024 * 1024 }).expect(413);

    // o detetor assinala as imagens do vídeo: recusado, e nada fica no disco
    score = 0.97;
    const bad = await upload(makeVideo(2, 'mau'));
    const sb = await convert(bad);
    expect(sb.status).toBe('deleted');
    expect(sb.error).toMatch(/nudez|sexual/i);
    expect(existsSync(`./uploads-test/${bad}`)).toBe(false);
    expect(existsSync(`./uploads-test/${bad}.poster.jpg`)).toBe(false);

    // zona duvidosa: passa e vai para a fila da moderação
    score = 0.65;
    const maybe = await upload(makeVideo(2, 'talvez'));
    expect((await convert(maybe)).status).toBe('ready');
    const rep = await pool.query(`SELECT note FROM social.reports WHERE target_type = 'media' AND target_id = $1`, [maybe]);
    expect(rep.rows[0].note).toMatch(/vídeo/);
    score = 0.05;
  }, 180_000);

  it('partilhar um reel no meu status: aparece aos meus seguidores como vídeo, com a origem; some se o original for apagado', async () => {
    const reg = async (n: string) => {
      const username = `${n}${run}`.slice(0, 28);
      const r = await api().post('/api/v1/auth/register').send({ email: `${username}@example.com`, username, displayName: n, password: PASSWORD, birthDate: '1990-06-15', acceptTerms: true }).expect(201);
      return { token: r.body.accessToken as string, id: r.body.user.id as string, username };
    };
    const hdr = (x: { token: string }) => ({ Authorization: `Bearer ${x.token}` });
    const sharer = await reg('shr');
    const fan = await reg('fan');
    await api().post(`/api/v1/users/${sharer.username}/follow`).set(hdr(fan)).expect(200);

    const vid = await upload(makeVideo(2, 'partilha'));
    await convert(vid);
    const reel = (await api().post('/api/v1/posts').set(auth()).send({ body: 'reel original', mediaIds: [vid] }).expect(201)).body;
    const textOnly = (await api().post('/api/v1/posts').set(auth()).send({ body: 'só texto' }).expect(201)).body;

    const story = (await api().post('/api/v1/stories/share').set(hdr(sharer)).send({ postId: reel.id, caption: 'vejam isto' }).expect(201)).body;
    expect(story).toMatchObject({ mediaKind: 'video', sharedFrom: { postId: reel.id, username: u.username }, caption: 'vejam isto' });
    expect(story.durationMs).toBeGreaterThan(1500);
    await api().post('/api/v1/stories/share').set(hdr(sharer)).send({ postId: textOnly.id }).expect(400); // sem foto nem vídeo
    await api().post('/api/v1/stories/share').set(hdr(sharer)).send({ postId: '00000000-0000-7000-8000-000000000000' }).expect(404);
    // duas pessoas podem partilhar o mesmo reel (o ficheiro é o mesmo)
    await api().post('/api/v1/stories/share').set(hdr(fan)).send({ postId: reel.id }).expect(201);

    const seen = (await api().get(`/api/v1/stories/user/${sharer.username}`).set(hdr(fan)).expect(200)).body;
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ mediaKind: 'video', sharedFrom: { postId: reel.id } });
    await api().get(seen[0].mediaUrl).set('Range', 'bytes=0-9').expect(206); // o vídeo toca a partir do story

    await api().delete(`/api/v1/posts/${reel.id}`).set(auth()).expect(204);
    expect((await api().get(`/api/v1/stories/user/${sharer.username}`).set(hdr(fan)).expect(200)).body).toHaveLength(0); // o original foi apagado

    // contas privadas não se partilham
    await api().patch('/api/v1/settings/privacy').set(auth()).send({ isPrivate: true }).expect(200);
    const hidden = (await api().post('/api/v1/posts').set(auth()).send({ body: 'privada' }).expect(201)).body;
    await api().post('/api/v1/stories/share').set(hdr(sharer)).send({ postId: hidden.id }).expect(404);
  }, 120_000);
});
