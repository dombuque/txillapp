import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Pool } from 'pg';
import { loadConfig } from '../config';
import { migrate } from '../db/migrate';
import { createApp } from '../main';

const DB = process.env.TEST_DATABASE_URL ?? 'postgres://txill:txill_dev@localhost:5433/txillapp_test';
interface U { token: string; id: string; username: string }

describe('música por ligação: notas e publicações (integração)', () => {
  let app: INestApplication;
  let pool: Pool;
  const run = Date.now().toString(36);
  const api = () => request(app.getHttpServer());
  const auth = (x: U) => ({ Authorization: `Bearer ${x.token}` });
  const SPOTIFY = 'https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC?si=abc';

  async function signup(name: string): Promise<U> {
    const username = `${name}${run}`.slice(0, 28);
    const r = await api().post('/api/v1/auth/register').send({ email: `${username}@example.com`, username, displayName: `${name} Teste`, password: 'password-bem-longa-1', birthDate: '1990-06-15', acceptTerms: true }).expect(201);
    await pool.query('UPDATE identity.users SET email_verified_at = now() WHERE id = $1', [r.body.user.id]);
    return { token: r.body.accessToken, id: r.body.user.id, username };
  }

  beforeAll(async () => {
    await migrate(DB);
    pool = new Pool({ connectionString: DB });
    app = await createApp(loadConfig({ DATABASE_URL: DB, JWT_ACCESS_SECRET: 'l'.repeat(40), NODE_ENV: 'test', MEDIA_DIR: './uploads-test' }));
    await app.init();
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  it('a pré-visualização: a ligação limpa e o leitor oficial; outros sítios recusados', async () => {
    const a = await signup('mla');
    await api().post('/api/v1/music/link').send({ url: SPOTIFY }).expect(401);
    const r = (await api().post('/api/v1/music/link').set(auth(a)).send({ url: SPOTIFY }).expect(200)).body;
    expect(r).toMatchObject({ kind: 'link', provider: 'spotify', link: 'https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC', embedUrl: 'https://open.spotify.com/embed/track/4uLU6hMCjMI75M1A2tKUQC', url: '', title: 'Música no Spotify' });
    await api().post('/api/v1/music/link').set(auth(a)).send({ url: 'https://evil.example/track/1' }).expect(400);
  });

  it('nota e publicação sem vídeo com a música por ligação; quem segue vê o cartão', async () => {
    const a = await signup('mlb');
    const b = await signup('mlc');
    await pool.query('INSERT INTO social.follows (follower_id, followee_id) VALUES ($1, $2)', [b.id, a.id]);
    await api().put('/api/v1/notes/me').set(auth(a)).send({ body: 'Esta é a minha', music: { kind: 'link', url: 'https://youtu.be/dQw4w9WgXcQ' } }).expect(204);
    const note = ((await api().get('/api/v1/notes').set(auth(b)).expect(200)).body.items as { username: string; music: Record<string, unknown> }[]).find((n) => n.username === a.username)!;
    expect(note.music).toMatchObject({ kind: 'link', provider: 'youtube', link: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', url: '' });

    const post = (await api().post('/api/v1/posts').set(auth(a)).send({ body: 'A música de hoje', music: { kind: 'link', url: SPOTIFY } }).expect(201)).body;
    expect(post.music).toMatchObject({ kind: 'link', provider: 'spotify', embedUrl: 'https://open.spotify.com/embed/track/4uLU6hMCjMI75M1A2tKUQC' });
    // Uma ligação inválida não entra.
    await api().post('/api/v1/posts').set(auth(a)).send({ body: 'x', music: { kind: 'link', url: 'https://evil.example/x' } }).expect(400);
  });

  it('guardar nas Guardadas uma música por ligação (e tirar)', async () => {
    const a = await signup('mld');
    await api().put('/api/v1/music/favorites').set(auth(a)).send({ kind: 'link', url: SPOTIFY }).expect(200);
    const favs = (await api().get('/api/v1/music/favorites').set(auth(a)).expect(200)).body as { id: string; kind?: string; link?: string }[];
    const fav = favs.find((x) => x.kind === 'link');
    expect(fav).toMatchObject({ id: 'link:spotify:4uLU6hMCjMI75M1A2tKUQC', link: 'https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC' });
    await api().delete(`/api/v1/music/favorites/${encodeURIComponent(fav!.id)}`).set(auth(a)).expect(200);
    expect(((await api().get('/api/v1/music/favorites').set(auth(a)).expect(200)).body as { kind?: string }[]).some((x) => x.kind === 'link')).toBe(false);
  });
});
