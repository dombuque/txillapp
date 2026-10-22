import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Pool } from 'pg';
import { loadConfig } from '../config';
import { migrate } from '../db/migrate';
import { createApp } from '../main';

const DB = process.env.TEST_DATABASE_URL ?? 'postgres://txill:txill_dev@localhost:5433/txillapp_test';
const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');

interface U { token: string; id: string; username: string }

describe('rede social: seguir, sugestões, perfil e perfis privados (integração)', () => {
  let app: INestApplication;
  let pool: Pool;
  const run = Date.now().toString(36);
  const api = () => request(app.getHttpServer());
  const auth = (u: U) => ({ Authorization: `Bearer ${u.token}` });

  async function signup(name: string): Promise<U> {
    const username = `${name}${run}`.slice(0, 28);
    const r = await api()
      .post('/api/v1/auth/register')
      .send({ email: `${username}@example.com`, username, displayName: `${name} Teste`, password: 'password-bem-longa-1' })
      .expect(201);
    return { token: r.body.accessToken, id: r.body.user.id, username };
  }
  const follow = (a: U, b: U) => api().post(`/api/v1/users/${b.username}/follow`).set(auth(a));
  const u: Record<string, U> = {};
  const profile = async (viewer: U, of: U) => (await api().get(`/api/v1/users/${of.username}`).set(auth(viewer)).expect(200)).body;

  beforeAll(async () => {
    await migrate(DB);
    pool = new Pool({ connectionString: DB });
    app = await createApp(loadConfig({ DATABASE_URL: DB, JWT_ACCESS_SECRET: 's'.repeat(40), NODE_ENV: 'test', MEDIA_DIR: './uploads-test' }));
    await app.init();
    // O registo tem limite de 10/min: criam-se os utilizadores uma só vez e reutilizam-se.
    for (const n of ['sa', 'sb', 'sd', 'se', 'sf', 'sg', 'sp', 'sq', 'sr']) u[n] = await signup(n);
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  it('seguir é idempotente, não se segue a si próprio e as contagens batem', async () => {
    const { sa: a, sb: b } = u;
    expect(await follow(a, b).expect(200).then((r) => r.body)).toEqual({ following: true, requested: false, followers: 1 });
    expect((await follow(a, b).expect(200)).body.followers).toBe(1); // repetir não duplica
    await follow(a, a).expect(400);
    await api().post('/api/v1/users/nao_existe_mesmo/follow').set(auth(a)).expect(404);

    const pb = await profile(a, b);
    expect(pb).toMatchObject({ isMe: false, following: true, followsYou: false, canView: true, isPrivate: false, counts: { followers: 1, following: 0, posts: 0 } });
    expect((await profile(b, a)).counts.following).toBe(1);

    const followers = (await api().get(`/api/v1/users/${b.username}/followers`).set(auth(b)).expect(200)).body;
    expect(followers.items.map((x: { username: string }) => x.username)).toEqual([a.username]);
    const following = (await api().get(`/api/v1/users/${a.username}/following`).set(auth(b)).expect(200)).body;
    expect(following.items[0]).toMatchObject({ username: b.username, following: false });

    // Pesquisa dentro das listas (por @ ou nome); % não é padrão.
    const inList = async (path: string, q: string) =>
      (await api().get(`/api/v1/users/${path}?q=${encodeURIComponent(q)}`).set(auth(b)).expect(200)).body.items.map((x: { username: string }) => x.username);
    expect(await inList(`${b.username}/followers`, a.username.slice(0, 5))).toEqual([a.username]);
    expect(await inList(`${b.username}/followers`, '@' + a.username.toUpperCase())).toEqual([a.username]);
    expect(await inList(`${b.username}/followers`, 'nada_assim')).toEqual([]);
    expect(await inList(`${b.username}/followers`, '%')).toEqual([]);
    expect(await inList(`${a.username}/following`, b.username)).toEqual([b.username]);

    expect((await api().delete(`/api/v1/users/${b.username}/follow`).set(auth(a)).expect(200)).body).toEqual({ following: false, requested: false, followers: 0 });
  });

  it('editar o perfil: nome e bio validados; bio vazia limpa', async () => {
    const a = u.sa;
    const r = await api().patch('/api/v1/users/me').set(auth(a)).send({ displayName: 'Nome Novo', bio: 'Praia, música e boa vibe 🌴' }).expect(200);
    expect(r.body).toMatchObject({ displayName: 'Nome Novo', bio: 'Praia, música e boa vibe 🌴', isPrivate: false });
    expect(await profile(a, a)).toMatchObject({ isMe: true, displayName: 'Nome Novo', bio: 'Praia, música e boa vibe 🌴' });
    await api().patch('/api/v1/users/me').set(auth(a)).send({ bio: 'x'.repeat(151) }).expect(400);
    await api().patch('/api/v1/users/me').set(auth(a)).send({ displayName: '   ' }).expect(400);
    expect((await api().patch('/api/v1/users/me').set(auth(a)).send({ bio: '' }).expect(200)).body.bio).toBeNull();
    expect((await profile(a, a)).displayName).toBe('Nome Novo'); // não tocado
  });

  it('sugestões: amigos em comum primeiro, quem me segue, sem mim nem quem já sigo, e dá para dispensar', async () => {
    const { sd: me, se: friend, sf: friendOfFriend, sg: fan } = u;
    await follow(me, friend).expect(200);
    await follow(friend, friendOfFriend).expect(200);
    await follow(fan, me).expect(200);

    const list = (await api().get('/api/v1/suggestions/people').set(auth(me)).expect(200)).body as { username: string; mutual: number; reason: string; followsYou: boolean }[];
    const names = list.map((p) => p.username);
    expect(names).not.toContain(me.username);
    expect(names).not.toContain(friend.username); // já o sigo
    const ff = list.find((p) => p.username === friendOfFriend.username)!;
    expect(ff).toMatchObject({ mutual: 1, reason: `${'se'} Teste segue` });
    const f = list.find((p) => p.username === fan.username)!;
    expect(f).toMatchObject({ followsYou: true, reason: 'Segue-te' });
    expect(names.indexOf(friendOfFriend.username)).toBeLessThan(names.indexOf(fan.username)); // comum > só me segue

    await api().post(`/api/v1/suggestions/people/${friendOfFriend.username}/dismiss`).set(auth(me)).expect(204);
    const after = (await api().get('/api/v1/suggestions/people').set(auth(me)).expect(200)).body.map((p: { username: string }) => p.username);
    expect(after).not.toContain(friendOfFriend.username);
  });

  it('perfil privado: o conteúdo só aparece a seguidores aceites, em TODAS as superfícies', async () => {
    const { sp: owner, sq: stranger } = u;
    const mediaR = await api().post('/api/v1/media/uploads').set(auth(owner)).send({ mime: 'image/png', size: PNG.length }).expect(201);
    await api().put(mediaR.body.uploadUrl).set('Content-Type', 'image/png').send(PNG).expect(200);

    const post = (await api().post('/api/v1/posts').set(auth(owner)).send({ body: 'só para amigos 🔒' }).expect(201)).body;
    const comment = (await api().post(`/api/v1/posts/${post.id}/comments`).set(auth(owner)).send({ body: 'comentário privado' }).expect(201)).body;
    const story = (await api().post('/api/v1/stories').set(auth(owner)).send({ mediaId: mediaR.body.assetId }).expect(201)).body;

    // Público: o estranho vê tudo.
    expect((await api().get(`/api/v1/users/${owner.username}/posts`).set(auth(stranger)).expect(200)).body.items).toHaveLength(1);

    expect((await api().patch('/api/v1/users/me').set(auth(owner)).send({ isPrivate: true }).expect(200)).body.isPrivate).toBe(true);

    // O que o estranho NÃO pode ver nem fazer:
    expect(await profile(stranger, owner)).toMatchObject({ isPrivate: true, canView: false, activeStories: 0, counts: { posts: 1 } });
    await api().get(`/api/v1/users/${owner.username}/posts`).set(auth(stranger)).expect(403);
    await api().get(`/api/v1/users/${owner.username}/followers`).set(auth(stranger)).expect(403);
    await api().get(`/api/v1/users/${owner.username}/following`).set(auth(stranger)).expect(403);
    const feed = (await api().get('/api/v1/posts?limit=50').set(auth(stranger)).expect(200)).body.items;
    expect(feed.find((p: { id: string }) => p.id === post.id)).toBeUndefined();
    await api().get(`/api/v1/posts/${post.id}/comments`).set(auth(stranger)).expect(404);
    await api().post(`/api/v1/posts/${post.id}/comments`).set(auth(stranger)).send({ body: 'intruso' }).expect(404);
    await api().get(`/api/v1/comments/${comment.id}/replies`).set(auth(stranger)).expect(404);
    await api().post(`/api/v1/comments/${comment.id}/cheers`).set(auth(stranger)).expect(404);
    await api().post(`/api/v1/posts/${post.id}/cheers`).set(auth(stranger)).expect(404);
    await api().post(`/api/v1/posts/${post.id}/gifts`).set(auth(stranger)).set('Idempotency-Key', `pv-${run}-1`).send({ amount: 5 }).expect(404);
    expect((await api().get(`/api/v1/stories/user/${owner.username}`).set(auth(stranger)).expect(200)).body).toEqual([]);
    await api().post(`/api/v1/stories/${story.id}/view`).set(auth(stranger)).expect(404);
    await api().post(`/api/v1/stories/${story.id}/replies`).set(auth(stranger)).send({ body: '🔥' }).expect(404);

    // O dono continua a ver tudo.
    expect((await api().get(`/api/v1/users/${owner.username}/posts`).set(auth(owner)).expect(200)).body.items).toHaveLength(1);
    expect((await api().get('/api/v1/posts?limit=50').set(auth(owner)).expect(200)).body.items.some((p: { id: string }) => p.id === post.id)).toBe(true);

    // Seguir → pedido pendente: continua sem ver nada e não conta como seguidor.
    expect((await follow(stranger, owner).expect(200)).body).toEqual({ following: false, requested: true, followers: 0 });
    expect((await follow(stranger, owner).expect(200)).body.requested).toBe(true); // idempotente
    expect(await profile(stranger, owner)).toMatchObject({ requested: true, following: false, canView: false });
    await api().get(`/api/v1/users/${owner.username}/posts`).set(auth(stranger)).expect(403);
    expect((await profile(owner, owner)).pendingRequests).toBe(1);
    const reqs = (await api().get('/api/v1/follow-requests').set(auth(owner)).expect(200)).body;
    expect(reqs.map((r: { username: string }) => r.username)).toEqual([stranger.username]);

    // Só o dono responde aos pedidos.
    await api().post(`/api/v1/follow-requests/${stranger.username}/accept`).set(auth(stranger)).expect(404);

    // Aceitar → passa a ver tudo.
    await api().post(`/api/v1/follow-requests/${stranger.username}/accept`).set(auth(owner)).expect(204);
    await api().post(`/api/v1/follow-requests/${stranger.username}/accept`).set(auth(owner)).expect(404); // já tratado
    expect(await profile(stranger, owner)).toMatchObject({ following: true, requested: false, canView: true, activeStories: 1 });
    expect((await api().get(`/api/v1/users/${owner.username}/posts`).set(auth(stranger)).expect(200)).body.items).toHaveLength(1);
    expect((await api().get('/api/v1/posts?limit=50').set(auth(stranger)).expect(200)).body.items.some((p: { id: string }) => p.id === post.id)).toBe(true);
    await api().get(`/api/v1/posts/${post.id}/comments`).set(auth(stranger)).expect(200);
    await api().post(`/api/v1/stories/${story.id}/view`).set(auth(stranger)).expect(204);
    const tray = (await api().get('/api/v1/stories').set(auth(stranger)).expect(200)).body;
    expect(tray.some((t: { username: string }) => t.username === owner.username)).toBe(true);

    // Deixar de seguir → volta a esconder tudo.
    await api().delete(`/api/v1/users/${owner.username}/follow`).set(auth(stranger)).expect(200);
    await api().get(`/api/v1/users/${owner.username}/posts`).set(auth(stranger)).expect(403);
    await api().post(`/api/v1/posts/${post.id}/cheers`).set(auth(stranger)).expect(404);
  });

  it('recusar, cancelar e passar a público (aceita os pedidos pendentes)', async () => {
    const { sr: owner, sq: x, sb: y, sa: z } = u;
    await api().patch('/api/v1/users/me').set(auth(owner)).send({ isPrivate: true }).expect(200);

    await follow(x, owner).expect(200);
    await api().post(`/api/v1/follow-requests/${x.username}/decline`).set(auth(owner)).expect(204);
    expect(await profile(x, owner)).toMatchObject({ requested: false, following: false });

    await follow(z, owner).expect(200);
    expect((await api().delete(`/api/v1/users/${owner.username}/follow`).set(auth(z)).expect(200)).body.requested).toBe(false); // cancelar pedido
    expect((await api().get('/api/v1/follow-requests').set(auth(owner)).expect(200)).body).toEqual([]);

    await follow(y, owner).expect(200);
    await api().patch('/api/v1/users/me').set(auth(owner)).send({ isPrivate: false }).expect(200);
    expect(await profile(y, owner)).toMatchObject({ following: true, requested: false, canView: true });
    expect((await profile(owner, owner)).counts.followers).toBe(1);
    expect((await api().get('/api/v1/follow-requests').set(auth(owner)).expect(200)).body).toEqual([]);
  });

  it('exige login em todas as rotas sociais', async () => {
    for (const path of ['/users/alguem', '/users/alguem/posts', '/suggestions/people', '/follow-requests']) {
      await api().get(`/api/v1${path}`).expect(401);
    }
    await api().post('/api/v1/users/alguem/follow').expect(401);
    await api().patch('/api/v1/users/me').send({ bio: 'x' }).expect(401);
  });
});
