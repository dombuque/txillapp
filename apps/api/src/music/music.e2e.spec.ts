import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Pool } from 'pg';
import { loadConfig } from '../config';
import { migrate } from '../db/migrate';
import { createApp } from '../main';

const DB = process.env.TEST_DATABASE_URL ?? 'postgres://txill:txill_dev@localhost:5433/txillapp_test';
const PASSWORD = 'password-bem-longa-1';

interface U { token: string; id: string; username: string }

const good = { id: 'ov-1', title: 'Marrabenta de teste', artist: 'Artista Livre', url: 'https://cdn.freesound.org/previews/1/1_1-hq.mp3', landing: 'https://freesound.org/s/1/', license: 'by', licenseUrl: 'https://creativecommons.org/licenses/by/4.0/', durationMs: 90000, cover: null };

describe('música nas notas: catálogo de licenças abertas e crédito (integração)', () => {
  let app: INestApplication;
  let pool: Pool;
  let fetchSpy: jest.SpyInstance;
  const run = Date.now().toString(36);
  const api = () => request(app.getHttpServer());
  const auth = (x: U) => ({ Authorization: `Bearer ${x.token}` });
  const u: Record<string, U> = {};

  async function signup(name: string): Promise<U> {
    const username = `${name}${run}`.slice(0, 28);
    const r = await api().post('/api/v1/auth/register').send({ email: `${username}@example.com`, username, displayName: `${name} Teste`, password: PASSWORD, birthDate: '1990-06-15', acceptTerms: true }).expect(201);
    await pool.query('UPDATE identity.users SET email_verified_at = now() WHERE id = $1', [r.body.user.id]);
    return { token: r.body.accessToken, id: r.body.user.id, username };
  }

  beforeAll(async () => {
    await migrate(DB);
    pool = new Pool({ connectionString: DB });
    app = await createApp(loadConfig({ DATABASE_URL: DB, JWT_ACCESS_SECRET: 'd'.repeat(40), NODE_ENV: 'test', MEDIA_DIR: './uploads-test' }));
    await app.init();
    for (const n of ['mua', 'mub']) u[n] = await signup(n);
    await pool.query('INSERT INTO social.follows (follower_id, followee_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [u.mub.id, u.mua.id]);
    // O Openverse é simulado: nada sai da máquina nos testes.
    const real = global.fetch;
    fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (!url.startsWith('https://api.openverse.org/')) return real(input, init);
      return new Response(JSON.stringify({
        results: [
          { id: 'ov-1', title: 'Marrabenta de teste', creator: 'Artista Livre', url: good.url, foreign_landing_url: good.landing, license: 'by', license_url: good.licenseUrl, duration: 90000 },
          { id: 'ov-2', title: 'Só não comercial', creator: 'X', url: 'https://cdn.freesound.org/previews/2/2.mp3', license: 'by-nc' },
          { id: 'ov-3', title: 'Sítio estranho', creator: 'Y', url: 'https://evil.example.com/track.mp3', license: 'cc0' },
        ],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
  }, 60_000);

  afterAll(async () => {
    fetchSpy.mockRestore();
    await app.close();
    await pool.end();
  });

  it('pesquisa: só licenças que deixam usar e só de sítios permitidos; precisa de sessão e de 2 letras', async () => {
    const r = (await api().get('/api/v1/music/search?q=marrabenta').set(auth(u.mua)).expect(200)).body as { id: string; license: string }[];
    expect(r.map((t) => t.id)).toEqual(['ov-1']); // fora a não comercial e a de um sítio estranho
    expect(r[0]).toMatchObject({ title: 'Marrabenta de teste', artist: 'Artista Livre', license: 'by' });
    await api().get('/api/v1/music/search?q=a').set(auth(u.mua)).expect(400);
    await api().get('/api/v1/music/search?q=marrabenta').expect(401);
  });

  it('nota com música: guarda-se com o crédito, vê-se na lista; só música também vale; faixas inválidas são recusadas', async () => {
    const { mua, mub } = u;
    await api().put('/api/v1/notes/me').set(auth(mua)).send({ body: 'Som do dia', music: good }).expect(204);
    const seen = (await api().get('/api/v1/notes').set(auth(mub)).expect(200)).body.items.find((n: { username: string }) => n.username === mua.username);
    expect(seen.body).toBe('Som do dia');
    expect(seen.music).toMatchObject({ title: 'Marrabenta de teste', artist: 'Artista Livre', license: 'by', url: good.url });

    await api().delete('/api/v1/notes/me').set(auth(mua)).expect(204);
    await api().put('/api/v1/notes/me').set(auth(mua)).send({ body: '', music: good }).expect(204); // só música
    await api().delete('/api/v1/notes/me').set(auth(mua)).expect(204);

    await api().put('/api/v1/notes/me').set(auth(mua)).send({ body: '' }).expect(400); // nem texto nem música
    await api().put('/api/v1/notes/me').set(auth(mua)).send({ body: 'x', music: { ...good, url: 'https://evil.example.com/a.mp3' } }).expect(400); // sítio não permitido
    await api().put('/api/v1/notes/me').set(auth(mua)).send({ body: 'x', music: { ...good, url: 'http://cdn.freesound.org/a.mp3' } }).expect(400); // sem https
    await api().put('/api/v1/notes/me').set(auth(mua)).send({ body: 'x', music: { ...good, license: 'by-nc' } }).expect(400); // licença não permitida
    // Os endereços viram links na app: nada de javascript:, data: nem http (anti-XSS)
    await api().put('/api/v1/notes/me').set(auth(mua)).send({ body: 'x', music: { ...good, landing: 'javascript:alert(document.cookie)' } }).expect(400);
    await api().put('/api/v1/notes/me').set(auth(mua)).send({ body: 'x', music: { ...good, licenseUrl: 'data:text/html;base64,PHNjcmlwdD4=' } }).expect(400);
    await api().put('/api/v1/notes/me').set(auth(mua)).send({ body: 'x', music: { ...good, cover: 'http://evil.example.com/a.jpg' } }).expect(400);
    await api().put('/api/v1/notes/me').set(auth(mua)).send({ body: 'só texto' }).expect(204); // sem música continua a funcionar
    await api().delete('/api/v1/notes/me').set(auth(mua)).expect(204);
  });

  it('post com música: guarda-se com o crédito e vê-se no post; faixa inválida é recusada', async () => {
    const { mua, mub } = u;
    const post = (await api().post('/api/v1/posts').set(auth(mua)).send({ body: 'Som da praia', music: good }).expect(201)).body;
    expect(post.music).toMatchObject({ title: 'Marrabenta de teste', artist: 'Artista Livre', license: 'by' });
    const seen = (await api().get(`/api/v1/posts/code/${post.code}`).set(auth(mub)).expect(200)).body;
    expect(seen.music).toMatchObject({ title: 'Marrabenta de teste', url: good.url });
    expect((await api().post('/api/v1/posts').set(auth(mua)).send({ body: 'sem música' }).expect(201)).body.music).toBeNull();
    await api().post('/api/v1/posts').set(auth(mua)).send({ body: 'x', music: { ...good, url: 'https://evil.example.com/a.mp3' } }).expect(400);
    await api().post('/api/v1/posts').set(auth(mua)).send({ body: 'x', music: { ...good, license: 'by-nc' } }).expect(400);
  });

  it('clipe de áudio próprio: só áudio meu e privado; aparece com URL assinado em notas e posts', async () => {
    const { mua, mub } = u;
    const WEBM = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3, 4, 5, 6, 7, 8]);
    const up = async (who: U, mime: string, bytes: Buffer, purpose = 'chat') => {
      const r = await api().post('/api/v1/media/uploads').set(auth(who)).send({ mime, size: bytes.length, purpose }).expect(201);
      await api().put(r.body.uploadUrl).set('Content-Type', mime).send(bytes).expect(200);
      return r.body.assetId as string;
    };
    const clip = await up(mua, 'audio/webm', WEBM);
    const music = { kind: 'clip', mediaId: clip, durationMs: 8000 };

    await api().put('/api/v1/notes/me').set(auth(mua)).send({ body: 'Ouve isto', music }).expect(204);
    const note = (await api().get('/api/v1/notes').set(auth(mub)).expect(200)).body.items.find((n: { username: string }) => n.username === mua.username);
    expect(note.music).toMatchObject({ kind: 'clip', title: 'Áudio original', license: 'own' });
    expect(note.music.url).toContain('/chat/media/');
    await api().get(note.music.url).expect(200).expect('Content-Type', /audio\/webm/);
    await api().delete('/api/v1/notes/me').set(auth(mua)).expect(204);

    const post = (await api().post('/api/v1/posts').set(auth(mua)).send({ body: 'Som meu', music }).expect(201)).body;
    expect(post.music.url).toContain('/chat/media/');

    // Áudio de outra pessoa, imagem, duração a mais ou sem carregar: recusado.
    const other = await up(mub, 'audio/webm', WEBM);
    await api().post('/api/v1/posts').set(auth(mua)).send({ body: 'x', music: { kind: 'clip', mediaId: other, durationMs: 5000 } }).expect(400);
    await api().post('/api/v1/posts').set(auth(mua)).send({ body: 'x', music: { kind: 'clip', mediaId: clip, durationMs: 90000 } }).expect(400);
    await api().post('/api/v1/posts').set(auth(mua)).send({ body: 'x', music: { kind: 'clip', mediaId: '00000000-0000-4000-8000-000000000000', durationMs: 5000 } }).expect(400);
  });
  it('favoritas e sugestões: marco, listo e tiro; as sugestões trazem o que a malta usou (sem clipes)', async () => {
    const { mua, mub } = u;
    await api().put('/api/v1/music/favorites').set(auth(mua)).send(good).expect(200);
    await api().put('/api/v1/music/favorites').set(auth(mua)).send({ ...good, url: 'https://evil.example.com/t.mp3' }).expect(400);
    let favs = (await api().get('/api/v1/music/favorites').set(auth(mua)).expect(200)).body as { id: string }[];
    expect(favs.map((t) => t.id)).toEqual(['ov-1']);
    expect((await api().get('/api/v1/music/favorites').set(auth(mub)).expect(200)).body).toEqual([]); // são só minhas
    await api().post('/api/v1/posts').set(auth(mua)).send({ body: 'com música', music: good }).expect(201);
    const sugg = (await api().get('/api/v1/music/suggested').set(auth(mub)).expect(200)).body as { trending: { id: string }[]; recent: { id: string }[] };
    expect(sugg.trending.map((t) => t.id)).toContain('ov-1');
    expect(sugg.recent).toEqual([]); // o mub ainda não usou nenhuma
    const mine = (await api().get('/api/v1/music/suggested').set(auth(mua)).expect(200)).body as { recent: { id: string }[] };
    expect(mine.recent.map((t) => t.id)).toContain('ov-1');
    await api().delete('/api/v1/music/favorites/ov-1').set(auth(mua)).expect(200);
    favs = (await api().get('/api/v1/music/favorites').set(auth(mua)).expect(200)).body;
    expect(favs).toEqual([]);
  });
});
