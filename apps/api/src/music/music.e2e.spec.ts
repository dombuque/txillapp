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
    await api().put('/api/v1/notes/me').set(auth(mua)).send({ body: 'só texto' }).expect(204); // sem música continua a funcionar
    await api().delete('/api/v1/notes/me').set(auth(mua)).expect(204);
  });
});
