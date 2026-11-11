import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Pool } from 'pg';
import { loadConfig } from '../config';
import { migrate } from '../db/migrate';
import { createApp } from '../main';

const DB = process.env.TEST_DATABASE_URL ?? 'postgres://txill:txill_dev@localhost:5433/txillapp_test';

interface U { token: string; id: string; username: string }

/** A nota da outra pessoa no cabeçalho da conversa 1:1 (`peerNote` em GET /chat/with/:username). */
describe('Conversa: a nota da pessoa no cabeçalho (integração)', () => {
  let app: INestApplication;
  let pool: Pool;
  const run = Date.now().toString(36);
  const api = () => request(app.getHttpServer());
  const auth = (x: U) => ({ Authorization: `Bearer ${x.token}` });

  async function signup(name: string): Promise<U> {
    const username = `${name}${run}`.slice(0, 28);
    const r = await api().post('/api/v1/auth/register').send({ email: `${username}@example.com`, username, displayName: `${name} Teste`, password: 'password-bem-longa-1', birthDate: '1990-06-15', acceptTerms: true }).expect(201);
    await pool.query('UPDATE identity.users SET email_verified_at = now() WHERE id = $1', [r.body.user.id]);
    return { token: r.body.accessToken, id: r.body.user.id, username };
  }
  const thread = async (who: U, other: U, cursor?: string) =>
    (await api().get(`/api/v1/chat/with/${other.username}${cursor ? `?cursor=${cursor}` : ''}`).set(auth(who)).expect(200)).body;

  beforeAll(async () => {
    await migrate(DB);
    pool = new Pool({ connectionString: DB });
    app = await createApp(loadConfig({ DATABASE_URL: DB, JWT_ACCESS_SECRET: 'e'.repeat(40), NODE_ENV: 'test', MEDIA_DIR: './uploads-test' }));
    await app.init();
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  it('aparece a quem a pode ver, com o brinde; não aparece a quem não pode, com bloqueio, a mim nem depois de expirar', async () => {
    const a = await signup('cna');
    const b = await signup('cnb');
    const c = await signup('cnc');
    const d = await signup('cnd');
    await api().put('/api/v1/notes/me').set(auth(a)).send({ body: 'Loko angali yeso' }).expect(204);
    // b e d seguem a; c não segue.
    await pool.query('INSERT INTO social.follows (follower_id, followee_id) VALUES ($1, $3), ($2, $3)', [b.id, d.id, a.id]);

    // b vê a nota no cabeçalho da conversa com a, mesmo antes de haver mensagens.
    const seen = (await thread(b, a)).peerNote;
    expect(seen).toMatchObject({ body: 'Loko angali yeso', music: null, cheered: false });
    expect(new Date(seen.expiresAt).getTime()).toBeGreaterThan(Date.now());
    expect(new Date(seen.createdAt).getTime()).toBeLessThanOrEqual(Date.now() + 1000);
    expect(Object.keys(seen).sort()).toEqual(['body', 'cheered', 'createdAt', 'expiresAt', 'music']);

    // Depois de brindar, vem marcado.
    await api().post(`/api/v1/notes/${a.username}/cheer`).set(auth(b)).expect(200);
    expect((await thread(b, a)).peerNote).toMatchObject({ cheered: true });

    // c não segue a: nada.
    expect((await thread(c, a)).peerNote).toBeNull();
    // a, na conversa com b (que não tem nota): nada; e a minha própria nota não aparece na conversa comigo.
    expect((await thread(a, b)).peerNote).toBeNull();
    expect((await thread(a, a)).peerNote).toBeNull();

    // Só na primeira página: as seguintes (com cursor) não trazem o campo.
    await api().post(`/api/v1/chat/with/${a.username}`).set(auth(b)).send({ body: 'olá' }).expect(201);
    const first = await thread(b, a);
    expect(first.peerNote).not.toBeNull();
    const later = await thread(b, a, first.items[0].id);
    expect(later).not.toHaveProperty('peerNote');

    // Bloqueio: a regra conta por si (o bloqueio pela app também desfaz o seguir; aqui o seguir fica, para provar a regra).
    expect((await thread(d, a)).peerNote).toMatchObject({ body: 'Loko angali yeso' });
    await pool.query('INSERT INTO social.blocks (blocker_id, blocked_id) VALUES ($1, $2)', [a.id, d.id]);
    const blocked = await thread(d, a);
    expect(blocked.blocked).toBe(true);
    expect(blocked.peerNote).toBeNull();

    // Depois de expirar: deixa de aparecer.
    await pool.query("UPDATE social.notes SET expires_at = now() - interval '1 minute' WHERE user_id = $1", [a.id]);
    expect((await thread(b, a)).peerNote).toBeNull();
  });
});
