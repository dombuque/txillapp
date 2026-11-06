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

describe('filtro de texto ligado a publicações, comentários, mensagens, notas e perfil (integração)', () => {
  let app: INestApplication;
  let pool: Pool;
  const run = Date.now().toString(36);
  const api = () => request(app.getHttpServer());
  const auth = (x: U) => ({ Authorization: `Bearer ${x.token}` });
  const u: Record<string, U> = {};
  const BAD = 'Vou-te matar amanhã';

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
    for (const n of ['fta', 'ftb']) u[n] = await signup(n);
    await pool.query('INSERT INTO social.follows (follower_id, followee_id) VALUES ($1, $2), ($2, $1) ON CONFLICT DO NOTHING', [u.fta.id, u.ftb.id]);
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  it('publicação, comentário, mensagem, nota, bio e nome: o que é ameaça ou ódio é recusado com uma mensagem clara; o normal passa', async () => {
    const { fta, ftb } = u;

    const bad = await api().post('/api/v1/posts').set(auth(fta)).send({ body: BAD }).expect(422);
    expect(bad.body.message).toMatch(/ameaça/);
    await api().post('/api/v1/posts').set(auth(fta)).send({ body: 'preto de merda' }).expect(422);
    await api().post('/api/v1/posts').set(auth(fta)).send({ body: 'kys' }).expect(422);
    const ok = (await api().post('/api/v1/posts').set(auth(fta)).send({ body: 'Vou matar a fome com matapa 🍲' }).expect(201)).body;

    await api().post(`/api/v1/posts/${ok.id}/comments`).set(auth(ftb)).send({ body: BAD }).expect(422);
    const mine = (await api().post(`/api/v1/posts/${ok.id}/comments`).set(auth(ftb)).send({ body: 'Que fome! Guarda-me um prato' }).expect(201)).body;
    // Editar o comentário: só o autor, com o mesmo filtro, e fica marcado como editado.
    expect(mine.editedAt).toBeNull();
    await api().patch(`/api/v1/comments/${mine.id}`).set(auth(ftb)).send({ body: BAD }).expect(422);
    await api().patch(`/api/v1/comments/${mine.id}`).set(auth(fta)).send({ body: 'não é meu' }).expect(403);
    const edited = (await api().patch(`/api/v1/comments/${mine.id}`).set(auth(ftb)).send({ body: 'Que fome! Guarda-me dois pratos' }).expect(200)).body;
    expect(edited).toMatchObject({ body: 'Que fome! Guarda-me dois pratos' });
    expect(edited.editedAt).toEqual(expect.any(String));
    expect(edited.authorFollowed).toBe(false);
    const listed = (await api().get(`/api/v1/posts/${ok.id}/comments`).set(auth(fta)).expect(200)).body.items;
    expect(listed.find((c: { id: string }) => c.id === mine.id)).toMatchObject({ body: 'Que fome! Guarda-me dois pratos', authorFollowed: true });

    await api().post(`/api/v1/chat/with/${fta.username}`).set(auth(ftb)).send({ kind: 'text', body: BAD }).expect(422);
    await api().post(`/api/v1/chat/with/${fta.username}`).set(auth(ftb)).send({ kind: 'text', body: 'Bora almoçar?' }).expect(201);

    await api().put('/api/v1/notes/me').set(auth(fta)).send({ body: 'mata-te' }).expect(422);
    await api().put('/api/v1/notes/me').set(auth(fta)).send({ body: 'Hoje é dia de praia' }).expect(204);
    await api().delete('/api/v1/notes/me').set(auth(fta)).expect(204);

    await api().patch('/api/v1/users/me').set(auth(fta)).send({ bio: 'vou te esfaquear' }).expect(422);
    await api().patch('/api/v1/users/me').set(auth(fta)).send({ bio: 'Malta de Maputo, sempre a txilar' }).expect(200);
  });
});
