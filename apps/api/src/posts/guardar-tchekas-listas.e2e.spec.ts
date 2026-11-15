import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { getStorageToken } from '@nestjs/throttler';
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
import { DOWNLOAD_BLOCKED } from './post-download.service';

/**
 * «Deixar guardar as minhas tchekas» (0153), o resto: o `canDownload` diz o mesmo que `GET /posts/:id/download` em todas as
 * listas (feed, Tchekas «A seguir», perfil, pesquisa, hashtag, guardadas, por código), mudar a conta para privada pelo perfil,
 * citações e reposts de citações, bloqueios, contas suspensas e contas eliminadas.
 */
const DB = process.env.TEST_DATABASE_URL ?? 'postgres://txill:txill_dev@localhost:5433/txillapp_test';
const PASSWORD = 'password-bem-longa-1';
const FF = ffmpegPath as unknown as string;
const MEDIA = './uploads-test';
const work = mkdtempSync(join(tmpdir(), 'txill-guardar-l-'));

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
interface P { id: string; code?: string; canDownload: boolean; repostOf?: P | null }

describe('guardar tchekas: canDownload em todas as listas e contas que mudam', () => {
  let app: INestApplication;
  let pool: Pool;
  let ana: U, dora: U, beto: U, xico: U;
  const run = Date.now().toString(36);
  const word = `gtl${run}`;
  const api = () => request(app.getHttpServer());
  const as = (u: U) => ({ Authorization: `Bearer ${u.token}` });
  const download = (u: U, id: string) => api().get(`/api/v1/posts/${id}/download`).set(as(u)).buffer(true).parse(binary as never);
  const getPost = async (u: U, id: string) => (await api().get(`/api/v1/posts/${id}`).set(as(u)).expect(200)).body as P;
  const setAllow = async (u: U, allow: boolean) => (await api().put('/api/v1/posts/me/download-settings').set(as(u)).send({ allow }).expect(200)).body;
  const resetThrottle = () => {
    const s = app.get(getStorageToken()) as { storage: Map<string, unknown>; hitExpirations?: Map<string, unknown> };
    s.storage.clear();
    s.hitExpirations?.clear();
  };
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
  async function tcheka(u: U, body = ''): Promise<P> {
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
    return (await api().post('/api/v1/posts').set(as(u)).send({ body, mediaIds: [id] }).expect(201)).body as P;
  }
  const follow = (a: U, b: U) => pool.query('INSERT INTO social.follows (follower_id, followee_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [a.id, b.id]);

  beforeAll(async () => {
    await migrate(DB);
    pool = new Pool({ connectionString: DB });
    app = await createApp(loadConfig({ DATABASE_URL: DB, JWT_ACCESS_SECRET: 'h'.repeat(40), NODE_ENV: 'test', MEDIA_DIR: MEDIA, IMAGE_MODERATION: 'off' }));
    await app.init();
    ana = await register('glana');
    dora = await register('gldora');
    beto = await register('glbeto');
    xico = await register('glxico');
    await follow(beto, ana);
    await follow(beto, dora);
    await follow(beto, xico);
  }, 120_000);

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  let anaPost: P, doraPost: P;

  it('canDownload é o mesmo em todas as listas e bate com o download (ligada: 200; desligada: 403)', async () => {
    anaPost = await tcheka(ana, `pode guardar ${word} #${word}`);
    doraPost = await tcheka(dora, `não deixa ${word} #${word}`);
    await setAllow(dora, false);
    // O que o download diz (uma vez por publicação).
    await download(beto, anaPost.id).expect(200);
    await blocked(beto, doraPost.id);
    const expected = new Map([[anaPost.id, true], [doraPost.id, false]]);
    await api().put(`/api/v1/posts/${anaPost.id}/save`).set(as(beto)).expect(200);
    await api().put(`/api/v1/posts/${doraPost.id}/save`).set(as(beto)).expect(200);

    const lists: Record<string, P[]> = {
      feed: (await api().get('/api/v1/feed?limit=30').set(as(beto)).expect(200)).body.items,
      reelsFollowing: (await api().get('/api/v1/feed/reels?following=1&limit=15').set(as(beto)).expect(200)).body.items,
      perfilAna: (await api().get(`/api/v1/users/${ana.username}/posts`).set(as(beto)).expect(200)).body.items,
      perfilDora: (await api().get(`/api/v1/users/${dora.username}/posts?tab=reels`).set(as(beto)).expect(200)).body.items,
      pesquisa: (await api().get(`/api/v1/search?q=${word}`).set(as(beto)).expect(200)).body.posts,
      hashtag: (await api().get(`/api/v1/tags/${word}`).set(as(beto)).expect(200)).body.items,
      guardadas: (await api().get('/api/v1/feed/saved').set(as(beto)).expect(200)).body.items,
      codigo: [
        (await api().get(`/api/v1/posts/code/${anaPost.code}`).set(as(beto)).expect(200)).body,
        (await api().get(`/api/v1/posts/code/${doraPost.code}`).set(as(beto)).expect(200)).body,
      ],
    };
    const seen: string[] = [];
    for (const [name, items] of Object.entries(lists)) {
      for (const [id, can] of expected) {
        const p = items.find((x) => x.id === id);
        if (name === 'perfilAna' && id === doraPost.id) continue;
        if (name === 'perfilDora' && id === anaPost.id) continue;
        expect({ list: name, id, present: !!p }).toEqual({ list: name, id, present: true });
        expect({ list: name, id, canDownload: p!.canDownload }).toEqual({ list: name, id, canDownload: can });
        seen.push(name);
      }
    }
    expect(new Set(seen).size).toBe(Object.keys(lists).length);
    // A própria Dora vê canDownload nas suas e guarda-as.
    expect((await getPost(dora, doraPost.id)).canDownload).toBe(true);
    await download(dora, doraPost.id).expect(200);
  }, 180_000);

  it('passar a conta para privada pelo perfil desliga; voltar a pública repõe a escolha', async () => {
    resetThrottle();
    await api().patch('/api/v1/users/me').set(as(ana)).send({ isPrivate: true }).expect(200);
    try {
      expect((await api().get('/api/v1/posts/me/download-settings').set(as(ana)).expect(200)).body).toEqual({ allow: true, effective: false, private: true, minor: false });
      // O Beto segue-a: continua a ver, mas já não guarda.
      expect((await getPost(beto, anaPost.id)).canDownload).toBe(false);
      await blocked(beto, anaPost.id);
      // Quem não a segue nem a vê.
      await download(xico, anaPost.id).expect(404);
      await api().get(`/api/v1/posts/${anaPost.id}`).set(as(xico)).expect(404);
    } finally {
      await api().patch('/api/v1/users/me').set(as(ana)).send({ isPrivate: false }).expect(200);
    }
    expect((await api().get('/api/v1/posts/me/download-settings').set(as(ana)).expect(200)).body).toEqual({ allow: true, effective: true, private: false, minor: false });
    expect((await getPost(beto, anaPost.id)).canDownload).toBe(true);
    await download(beto, anaPost.id).expect(200);
  }, 120_000);

  it('citação e repost de uma citação: vale sempre o autor da tcheka original, também na citação que vem dentro', async () => {
    resetThrottle();
    // O Xico cita a tcheka da Ana; o Beto reposta a citação. O Xico desliga (a regra dele não conta: a tcheka é da Ana).
    const quote = (await api().post(`/api/v1/posts/${anaPost.id}/repost`).set(as(xico)).send({ body: `olha isto ${word}` }).expect(201)).body as P;
    const rep = (await api().post(`/api/v1/posts/${quote.id}/repost`).set(as(beto)).send({}).expect(201)).body as P;
    await setAllow(xico, false);
    try {
      const q = await getPost(dora, quote.id);
      expect(q.canDownload).toBe(true);
      expect(q.repostOf?.canDownload).toBe(true);
      await download(dora, quote.id).expect(200); // a citação guarda a tcheka da Ana

      const r = await getPost(dora, rep.id);
      expect(r.repostOf?.id).toBe(quote.id);
      expect(r.repostOf?.repostOf?.id).toBe(anaPost.id);
      // A app desce até à tcheka: tudo pelo caminho diz o que vale para ela (a regra da Ana).
      expect(r.canDownload).toBe(true);
      expect(r.repostOf?.canDownload).toBe(true);
      expect(r.repostOf?.repostOf?.canDownload).toBe(true);

      // A Ana desliga: em todo o lado falso e 403.
      await setAllow(ana, false);
      const q2 = await getPost(dora, quote.id);
      expect(q2.canDownload).toBe(false);
      await blocked(dora, quote.id);
      const r2 = await getPost(dora, rep.id);
      expect([r2.canDownload, r2.repostOf?.canDownload, r2.repostOf?.repostOf?.canDownload]).toEqual([false, false, false]);
      await blocked(dora, anaPost.id);
      // A Ana, pela citação de outro, guarda a sua.
      expect((await getPost(ana, quote.id)).canDownload).toBe(true);
      await download(ana, quote.id).expect(200);
    } finally {
      await setAllow(ana, true);
      await setAllow(xico, true);
    }
  }, 120_000);

  it('bloqueio: quem está bloqueado não vê nem guarda (404), mesmo com a definição ligada', async () => {
    resetThrottle();
    await api().put(`/api/v1/blocks/${beto.username}`).set(as(ana)).expect(200);
    try {
      await download(beto, anaPost.id).expect(404);
      await api().get(`/api/v1/posts/${anaPost.id}`).set(as(beto)).expect(404);
    } finally {
      await api().delete(`/api/v1/blocks/${beto.username}`).set(as(ana)).expect(200);
    }
    await download(beto, anaPost.id).expect(200);
  }, 60_000);

  it('conta suspensa: ninguém guarda (404), nem a própria', async () => {
    resetThrottle();
    await pool.query("UPDATE identity.users SET status = 'suspended' WHERE id = $1", [ana.id]);
    try {
      await download(beto, anaPost.id).expect(404);
      await download(ana, anaPost.id).expect(404);
    } finally {
      await pool.query("UPDATE identity.users SET status = 'active' WHERE id = $1", [ana.id]);
    }
    await download(beto, anaPost.id).expect(200);
  }, 60_000);

  it('conta eliminada: as tchekas dela deixam de se guardar (404); a definição dela fica desligada', async () => {
    resetThrottle();
    const gone = await register('glgone');
    const p = await tcheka(gone, 'vou-me embora');
    await download(beto, p.id).expect(200);
    await api().post('/api/v1/auth/delete-account').set(as(gone)).send({ confirmUsername: gone.username, password: PASSWORD }).expect(204);
    await download(beto, p.id).expect(404);
    await api().get(`/api/v1/posts/${p.id}`).set(as(beto)).expect(404);
    // A linha fica (anonimizada): privada e sem data de nascimento, por isso nunca valeria.
    const row = (await pool.query('SELECT status, allow_downloads, is_private, birth_date FROM identity.users WHERE id = $1', [gone.id])).rows[0];
    expect(row).toMatchObject({ status: 'deleted', is_private: true, birth_date: null });
    // O token de acesso que sobrou ainda passa no JwtAuthGuard: a definição diz que não vale.
    const s = await api().get('/api/v1/posts/me/download-settings').set(as(gone));
    if (s.status === 200) expect(s.body).toMatchObject({ effective: false, private: true, minor: true });
    else expect(s.status).toBe(401);
  }, 120_000);
});
