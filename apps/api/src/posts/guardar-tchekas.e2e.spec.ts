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
import { uuidv7 } from '../common/uuid7';
import { DOWNLOAD_BLOCKED } from './post-download.service';

/**
 * «Deixar guardar as minhas tchekas» (0153): a definição (GET/PUT /posts/me/download-settings), o `canDownload` das
 * publicações e o 403 de `GET /posts/:id/download` quando quem publicou não deixa (desligou, conta privada ou de um menor).
 * O próprio autor guarda sempre as suas; num repost vale o autor do original; num post de um sítio, a conta de quem o publicou.
 */
const DB = process.env.TEST_DATABASE_URL ?? 'postgres://txill:txill_dev@localhost:5433/txillapp_test';
const PASSWORD = 'password-bem-longa-1';
const FF = ffmpegPath as unknown as string;
const MEDIA = './uploads-test';
const work = mkdtempSync(join(tmpdir(), 'txill-guardar-'));

/** Uma tcheka curta gerada com o ffmpeg (nada de fora). */
function clip(name: string): Buffer {
  const file = join(work, `${name}.mp4`);
  execFileSync(FF, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc=size=240x426:rate=24:duration=1.5', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1.5',
    '-c:a', 'aac', '-shortest', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', file], { stdio: 'ignore' });
  return readFileSync(file);
}

const binary = (res: NodeJS.ReadableStream, cb: (err: Error | null, body: Buffer) => void) => {
  const chunks: Buffer[] = [];
  res.on('data', (c: Buffer) => chunks.push(Buffer.from(c)));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
  res.on('error', (e: Error) => cb(e, Buffer.alloc(0)));
};

interface U { token: string; id: string; username: string }

describe('guardar tchekas: «Deixar guardar as minhas tchekas»', () => {
  let app: INestApplication;
  let pool: Pool;
  let ana: U, beto: U, menor: U, priv: U, gestor: U;
  const run = Date.now().toString(36);
  const api = () => request(app.getHttpServer());
  const as = (u: U) => ({ Authorization: `Bearer ${u.token}` });
  const download = (u: U, id: string) => api().get(`/api/v1/posts/${id}/download`).set(as(u)).buffer(true).parse(binary as never);
  const getPost = async (u: U, id: string) => (await api().get(`/api/v1/posts/${id}`).set(as(u)).expect(200)).body as { id: string; canDownload: boolean; repostOf?: { id: string; canDownload: boolean } | null };
  const settings = async (u: U) => (await api().get('/api/v1/posts/me/download-settings').set(as(u)).expect(200)).body;
  const setAllow = async (u: U, allow: boolean) => (await api().put('/api/v1/posts/me/download-settings').set(as(u)).send({ allow }).expect(200)).body;
  /** O 403 com a mensagem de quem publicou (o corpo vem em JSON, não em vídeo). */
  const blocked = async (u: U, id: string) => {
    const r = await download(u, id).expect(403);
    expect(JSON.parse((r.body as Buffer).toString('utf8')).message).toBe(DOWNLOAD_BLOCKED);
  };

  async function register(name: string): Promise<U> {
    const username = `${name}${run}`.slice(0, 28);
    const r = await api().post('/api/v1/auth/register').send({ email: `${username}@example.com`, username, displayName: `${name} Teste`, password: PASSWORD, birthDate: '1990-06-15', acceptTerms: true }).expect(201);
    await pool.query('UPDATE identity.users SET email_verified_at = now() WHERE id = $1', [r.body.user.id]);
    return { token: r.body.accessToken, id: r.body.user.id, username };
  }
  async function tcheka(u: U, body = ''): Promise<string> {
    const bytes = clip(`${u.username}-${Math.random().toString(36).slice(2, 8)}`);
    const up = await api().post('/api/v1/media/uploads').set(as(u)).send({ mime: 'video/mp4', size: bytes.length }).expect(201);
    await api().put(up.body.uploadUrl).set('Content-Type', 'video/mp4').send(bytes).expect(200);
    const id = up.body.assetId as string;
    await api().post(`/api/v1/media/${id}/complete`).set(as(u)).expect(200);
    for (let i = 0; i < 240; i++) {
      const s = (await pool.query('SELECT status, processing_error FROM content.media_assets WHERE id = $1', [id])).rows[0];
      if (s?.status === 'ready') break;
      if (s?.status === 'deleted') throw new Error(`vídeo recusado: ${s.processing_error}`);
      await new Promise((r) => setTimeout(r, 250));
    }
    return (await api().post('/api/v1/posts').set(as(u)).send({ body, mediaIds: [id] }).expect(201)).body.id as string;
  }

  beforeAll(async () => {
    await migrate(DB);
    pool = new Pool({ connectionString: DB });
    app = await createApp(loadConfig({ DATABASE_URL: DB, JWT_ACCESS_SECRET: 'g'.repeat(40), NODE_ENV: 'test', MEDIA_DIR: MEDIA, IMAGE_MODERATION: 'off' }));
    await app.init();
    ana = await register('gtana');
    beto = await register('gtbeto');
    menor = await register('gtmenor');
    priv = await register('gtpriv');
    gestor = await register('gtgest');
    await pool.query(`UPDATE identity.users SET birth_date = current_date - interval '16 years' WHERE id = $1`, [menor.id]);
    await pool.query('UPDATE identity.users SET is_private = true WHERE id = $1', [priv.id]);
  }, 120_000);

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  it('a definição: ligada por omissão; desligar e voltar a ligar; numa conta privada ou de menor vale como desligada', async () => {
    expect(await settings(ana)).toEqual({ allow: true, effective: true, private: false, minor: false });
    expect(await setAllow(ana, false)).toEqual({ allow: false, effective: false, private: false, minor: false });
    expect(await settings(ana)).toMatchObject({ allow: false, effective: false });
    expect(await setAllow(ana, true)).toMatchObject({ allow: true, effective: true });
    expect(await settings(menor)).toEqual({ allow: true, effective: false, private: false, minor: true });
    expect(await settings(priv)).toEqual({ allow: true, effective: false, private: true, minor: false });
    // Ligar numa conta privada guarda a escolha, mas não passa a valer.
    expect(await setAllow(priv, true)).toMatchObject({ allow: true, effective: false });
    await api().put('/api/v1/posts/me/download-settings').set(as(ana)).send({ allow: 'sim' }).expect(400);
    await api().put('/api/v1/posts/me/download-settings').set(as(ana)).send({}).expect(400);
    await api().get('/api/v1/posts/me/download-settings').expect(401);
  });

  let anaPost = '';

  it('ligada: os outros guardam (canDownload); desligada: 403 com a mensagem e canDownload falso; o próprio autor guarda sempre', async () => {
    anaPost = await tcheka(ana, 'para guardar');
    expect((await getPost(beto, anaPost)).canDownload).toBe(true);
    const first = await download(beto, anaPost).expect(200);
    expect(first.headers['content-type']).toMatch(/^video\/mp4/);

    await setAllow(ana, false);
    expect((await getPost(beto, anaPost)).canDownload).toBe(false);
    await blocked(beto, anaPost);
    // O próprio: vê canDownload e guarda (a cópia já feita sai da cache).
    expect((await getPost(ana, anaPost)).canDownload).toBe(true);
    const own = await download(ana, anaPost).expect(200);
    expect(own.headers['x-cache']).toBe('hit');
    // No feed do perfil também.
    const tab = (await api().get(`/api/v1/users/${ana.username}/posts?tab=reels`).set(as(beto)).expect(200)).body.items as { id: string; canDownload: boolean }[];
    expect(tab.find((p) => p.id === anaPost)?.canDownload).toBe(false);

    await setAllow(ana, true);
    expect((await getPost(beto, anaPost)).canDownload).toBe(true);
    await download(beto, anaPost).expect(200);
  }, 120_000);

  it('num repost conta o autor do original', async () => {
    const rep = (await api().post(`/api/v1/posts/${anaPost}/repost`).set(as(beto)).send({}).expect(201)).body as { id: string };
    const repostId = rep.id;
    expect((await getPost(gestor, repostId)).canDownload).toBe(true);
    await setAllow(ana, false);
    try {
      const seen = await getPost(gestor, repostId);
      expect(seen.canDownload).toBe(false);
      expect(seen.repostOf?.canDownload).toBe(false);
      await blocked(gestor, repostId);
      // Quem repostou também não guarda (não é o autor do original); a Ana guarda pelo repost.
      expect((await getPost(beto, repostId)).canDownload).toBe(false);
      await blocked(beto, repostId);
      expect((await getPost(ana, repostId)).canDownload).toBe(true);
    } finally {
      await setAllow(ana, true);
    }
  }, 120_000);

  it('conta de um menor: os outros nunca guardam (mesmo com a definição ligada); o próprio sim', async () => {
    const p = await tcheka(menor);
    expect((await getPost(beto, p)).canDownload).toBe(false);
    await blocked(beto, p);
    expect((await getPost(menor, p)).canDownload).toBe(true);
    // Sem data de nascimento conta como menor.
    await pool.query('UPDATE identity.users SET birth_date = NULL WHERE id = $1', [ana.id]);
    try {
      expect((await getPost(beto, anaPost)).canDownload).toBe(false);
      await blocked(beto, anaPost);
      expect(await settings(ana)).toMatchObject({ allow: true, effective: false, minor: true });
    } finally {
      await pool.query(`UPDATE identity.users SET birth_date = '1990-06-15' WHERE id = $1`, [ana.id]);
    }
  }, 120_000);

  it('conta privada: quem a segue vê a tcheka mas não a guarda; o próprio guarda', async () => {
    await pool.query('UPDATE identity.users SET is_private = false WHERE id = $1', [priv.id]);
    const p = await tcheka(priv);
    await pool.query('UPDATE identity.users SET is_private = true WHERE id = $1', [priv.id]);
    await download(beto, p).expect(404); // sem seguir nem se vê
    await pool.query('INSERT INTO social.follows (follower_id, followee_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [beto.id, priv.id]);
    expect((await getPost(beto, p)).canDownload).toBe(false);
    await blocked(beto, p);
    expect((await getPost(priv, p)).canDownload).toBe(true);
    await download(priv, p).expect(200);
  }, 120_000);

  it('num post de um sítio vale a conta de quem o publicou', async () => {
    const venueId = uuidv7();
    await pool.query(`INSERT INTO content.venues (id, slug, name, kind, owner_id, check_token) VALUES ($1, $2, 'Bar da Guarda', 'bar', $3, 'tok')`, [venueId, `bar-gt-${run}`, gestor.id]);
    const p = await tcheka(gestor);
    await pool.query('UPDATE content.posts SET venue_id = $2 WHERE id = $1', [p, venueId]);
    expect((await getPost(beto, p)).canDownload).toBe(true);
    await setAllow(gestor, false);
    expect((await getPost(beto, p)).canDownload).toBe(false);
    await blocked(beto, p);
    expect((await getPost(gestor, p)).canDownload).toBe(true);
  }, 120_000);

  it('a exportação leva a definição', async () => {
    expect((await api().get('/api/v1/me/export').set(as(gestor)).expect(200)).body.allowDownloads).toBe(false);
    expect((await api().get('/api/v1/me/export').set(as(beto)).expect(200)).body.allowDownloads).toBe(true);
  }, 60_000);
});
