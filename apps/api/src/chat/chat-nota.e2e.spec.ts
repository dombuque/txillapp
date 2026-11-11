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

  it('sem nota, vem a bio (a nota ganha); nada com bio vazia, bloqueio, conta inativa, para mim nem nas páginas seguintes', async () => {
    const a = await signup('cba');
    const b = await signup('cbb');
    const c = await signup('cbc');
    const bio = 'Maputo de coração\nCafé, praia e boa malta';
    await api().patch('/api/v1/users/me').set(auth(a)).send({ bio }).expect(200);
    await pool.query('INSERT INTO social.follows (follower_id, followee_id) VALUES ($1, $2)', [b.id, a.id]);

    // a não tem nota: b vê a bio tal como está (com a quebra de linha; a app é que a limpa).
    const first = await thread(b, a);
    expect(first.peerNote).toBeNull();
    expect(first.peerBio).toBe(bio);

    // Com nota, a nota ganha e a bio não vem.
    await api().put('/api/v1/notes/me').set(auth(a)).send({ body: 'Bora txilar' }).expect(204);
    const withNote = await thread(b, a);
    expect(withNote.peerNote).toMatchObject({ body: 'Bora txilar' });
    expect(withNote.peerBio).toBeNull();
    // c não segue a, por isso não vê a nota; vê a bio (é do cabeçalho do perfil, que c também vê).
    const notFollower = await thread(c, a);
    expect(notFollower.peerNote).toBeNull();
    expect(notFollower.peerBio).toBe(bio);
    await api().delete('/api/v1/notes/me').set(auth(a)).expect(204);

    // Conta privada que não sigo: o perfil mostra a bio a quem não é seguidor (só esconde as publicações, as stories e
    // as listas), por isso aqui também aparece.
    await pool.query('UPDATE identity.users SET is_private = true WHERE id = $1', [a.id]);
    const privateProfile = (await api().get(`/api/v1/users/${a.username}`).set(auth(c)).expect(200)).body;
    expect(privateProfile).toMatchObject({ canView: false, bio });
    expect((await thread(c, a)).peerBio).toBe(bio);
    await pool.query('UPDATE identity.users SET is_private = false WHERE id = $1', [a.id]);

    // A minha própria bio não aparece na conversa comigo.
    expect((await thread(a, a)).peerBio).toBeNull();

    // Só na primeira página: as seguintes (com cursor) não trazem o campo.
    await api().post(`/api/v1/chat/with/${a.username}`).set(auth(b)).send({ body: 'olá' }).expect(201);
    const page1 = await thread(b, a);
    expect(page1.peerBio).toBe(bio);
    expect(await thread(b, a, page1.items[0].id)).not.toHaveProperty('peerBio');

    // Bio vazia (ou só espaços): nada.
    await pool.query("UPDATE identity.users SET bio = '   ' WHERE id = $1", [a.id]);
    expect((await thread(b, a)).peerBio).toBeNull();
    await pool.query('UPDATE identity.users SET bio = NULL WHERE id = $1', [a.id]);
    expect((await thread(b, a)).peerBio).toBeNull();
    await pool.query('UPDATE identity.users SET bio = $2 WHERE id = $1', [a.id, bio]);
    expect((await thread(b, a)).peerBio).toBe(bio);

    // Bloqueio, nos dois sentidos.
    await pool.query('INSERT INTO social.blocks (blocker_id, blocked_id) VALUES ($1, $2)', [a.id, c.id]);
    const blocked = await thread(c, a);
    expect(blocked.blocked).toBe(true);
    expect(blocked.peerBio).toBeNull();
    await pool.query('DELETE FROM social.blocks WHERE blocker_id = $1 AND blocked_id = $2', [a.id, c.id]);
    await pool.query('INSERT INTO social.blocks (blocker_id, blocked_id) VALUES ($1, $2)', [c.id, a.id]);
    expect((await thread(c, a)).peerBio).toBeNull();

    // Conta inativa (suspensa): a conversa já nem abre, por isso nada de bio.
    await pool.query("UPDATE identity.users SET status = 'suspended' WHERE id = $1", [a.id]);
    await api().get(`/api/v1/chat/with/${a.username}`).set(auth(b)).expect(404);
  });
});
