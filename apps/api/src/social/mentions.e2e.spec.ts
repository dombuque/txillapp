import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Pool } from 'pg';
import { loadConfig } from '../config';
import { migrate } from '../db/migrate';
import { createApp } from '../main';

const DB = process.env.TEST_DATABASE_URL ?? 'postgres://txill:txill_dev@localhost:5433/txillapp_test';
const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');
const PASSWORD = 'password-bem-longa-1';

interface U { token: string; id: string; username: string }

describe('menções (@utilizador) e amigos próximos (integração)', () => {
  let app: INestApplication;
  let pool: Pool;
  const run = Date.now().toString(36);
  const api = () => request(app.getHttpServer());
  const auth = (x: U) => ({ Authorization: `Bearer ${x.token}` });
  const u: Record<string, U> = {};

  async function signup(name: string): Promise<U> {
    const username = `${name}${run}`.slice(0, 28);
    const r = await api().post('/api/v1/auth/register').send({ email: `${username}@example.com`, username, displayName: `${name} Teste`, password: PASSWORD , birthDate: '1990-06-15', acceptTerms: true}).expect(201);
    return { token: r.body.accessToken, id: r.body.user.id, username };
  }
  const follow = (a: U, b: U) => api().post(`/api/v1/users/${b.username}/follow`).set(auth(a));
  const names = async (viewer: U, q: string) => (await api().get(`/api/v1/mentionable?q=${q}`).set(auth(viewer)).expect(200)).body.map((p: { username: string }) => p.username);
  const mentions = async (x: U) => ((await api().get('/api/v1/notifications').set(auth(x)).expect(200)).body.items as { kind: string }[]).filter((n) => n.kind === 'mention');
  async function uploadPng(a: U) {
    const r = await api().post('/api/v1/media/uploads').set(auth(a)).send({ mime: 'image/png', size: PNG.length }).expect(201);
    await api().put(r.body.uploadUrl).set('Content-Type', 'image/png').send(PNG).expect(200);
    return r.body.assetId as string;
  }
  const me2 = () => u.me; // privada e sem seguir ma
  const wait = () => new Promise((r) => setTimeout(r, 300)); // as menções notificam em segundo plano

  beforeAll(async () => {
    await migrate(DB);
    pool = new Pool({ connectionString: DB });
    app = await createApp(loadConfig({ DATABASE_URL: DB, JWT_ACCESS_SECRET: 'm'.repeat(40), NODE_ENV: 'test', MEDIA_DIR: './uploads-test' }));
    await app.init();
    for (const n of ['ma', 'mb', 'mc', 'md', 'me']) u[n] = await signup(n);
    await api().patch('/api/v1/settings/privacy').set(auth(u.mc)).send({ isPrivate: true }).expect(200);
    await api().patch('/api/v1/settings/privacy').set(auth(u.md)).send({ mentionsAllowed: 'off' }).expect(200);
    await api().patch('/api/v1/settings/privacy').set(auth(u.me)).send({ isPrivate: true }).expect(200);
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  it('sugere contas públicas que aceitam menções; privadas só se eu as seguir; "ninguém" nunca', async () => {
    const { ma, mb, mc, md } = u;
    expect(await names(ma, ma.username.slice(0, 2))).not.toContain(ma.username); // nunca a própria pessoa
    expect(await names(ma, `mb${run}`)).toContain(mb.username);
    expect(await names(ma, `mc${run}`)).not.toContain(mc.username); // privada e não a sigo
    expect(await names(ma, `md${run}`)).not.toContain(md.username); // não aceita menções
    await follow(ma, mc).expect(200); // pedido pendente ainda não é seguir? 
  });

  it('notifica só quem pode ser mencionado, em publicações e comentários', async () => {
    const { ma, mb, mc, md, me } = u;
    // mc é privada: depois de aceitar o pedido, passa a poder ser mencionada por ma
    await api().post(`/api/v1/follow-requests/${ma.username}/accept`).set(auth(mc)).expect((r) => expect([200, 204]).toContain(r.status));
    expect(await names(ma, `mc${run}`)).toContain(mc.username);

    const p = (await api().post('/api/v1/posts').set(auth(ma)).send({ body: `olá @${mb.username} @${mc.username} @${md.username} @${me.username} e a@b.com` }).expect(201)).body;
    await wait();
    expect(await mentions(mb)).toHaveLength(1); // pública, aceita
    expect(await mentions(mc)).toHaveLength(1); // privada mas eu sigo
    expect(await mentions(md)).toHaveLength(0); // desligou as menções
    expect(await mentions(me)).toHaveLength(0); // (privada e não a sigo)

    await api().post(`/api/v1/posts/${p.id}/comments`).set(auth(ma)).send({ body: `outra vez @${mb.username}` }).expect(201);
    await wait();
    expect(await mentions(mb)).toHaveLength(2);
  });

  it('stories para amigos próximos: só a lista vê; só se pode juntar quem me segue', async () => {
    const { ma, mb, md } = u;
    await follow(mb, ma).expect(200);
    await follow(md, ma).expect(200);
    await api().put(`/api/v1/stories/close-friends/${u.me.username}`).set(auth(ma)).expect(400); // não me segue
    await api().put(`/api/v1/stories/close-friends/${mb.username}`).set(auth(ma)).expect(204);
    expect((await api().get('/api/v1/stories/close-friends').set(auth(ma)).expect(200)).body.map((f: { username: string }) => f.username)).toEqual([mb.username]);

    const mediaId = await uploadPng(ma);
    const story = (await api().post('/api/v1/stories').set(auth(ma)).send({ mediaId, caption: 'só para os meus', audience: 'close_friends' }).expect(201)).body;
    expect(story.audience).toBe('close_friends');

    const seenBy = async (viewer: U) => (await api().get(`/api/v1/stories/user/${ma.username}`).set(auth(viewer)).expect(200)).body.length;
    expect(await seenBy(mb)).toBe(1); // amigo próximo
    expect(await seenBy(md)).toBe(0); // seguidor normal
    const trayOf = async (viewer: U) => (await api().get('/api/v1/stories').set(auth(viewer)).expect(200)).body.find((t: { username: string }) => t.username === ma.username);
    expect((await trayOf(mb)).closeFriends).toBe(true);
    expect(await trayOf(md)).toBeUndefined();
    await api().post(`/api/v1/stories/${story.id}/view`).set(auth(md)).expect(404); // nem por id

    await api().delete(`/api/v1/stories/close-friends/${mb.username}`).set(auth(ma)).expect(204);
    expect(await seenBy(mb)).toBe(0);
  });

  it('identificar pessoas numa foto: só quem posso mencionar; aparece na foto; a pessoa pode sair', async () => {
    const { ma, mb, md, me } = u;
    const mediaId = await uploadPng(ma);
    const tag = (username: string, x = 0.4) => ({ index: 0, username, x, y: 0.5 });
    await api().post('/api/v1/posts').set(auth(ma)).send({ body: 'x', mediaIds: [mediaId], tags: [tag(md.username)] }).expect(400); // md não aceita menções
    await api().post('/api/v1/posts').set(auth(ma)).send({ body: 'x', mediaIds: [mediaId], tags: [tag(me.username)] }).expect(400); // privada que não sigo
    await api().post('/api/v1/posts').set(auth(ma)).send({ body: 'x', mediaIds: [mediaId], tags: [{ ...tag(mb.username), index: 3 }] }).expect(400); // foto inexistente
    await api().post('/api/v1/posts').set(auth(ma)).send({ body: 'x', mediaIds: [mediaId], tags: [tag(mb.username, 1.5)] }).expect(400); // fora da foto

    const mediaOk = await uploadPng(ma);
    const p = (await api().post('/api/v1/posts').set(auth(ma)).send({ body: 'com malta', mediaIds: [mediaOk], tags: [tag(mb.username)] }).expect(201)).body;
    expect(p.media[0].tags).toEqual([{ username: mb.username, displayName: `mb Teste`, x: 0.4, y: 0.5 }]);
    await wait();
    expect(((await api().get('/api/v1/notifications').set(auth(mb)).expect(200)).body.items as { kind: string }[]).some((n) => n.kind === 'tag')).toBe(true);

    const after = (await api().delete(`/api/v1/posts/${p.id}/tags/me`).set(auth(mb)).expect(200)).body;
    expect(after.media[0].tags).toEqual([]);
  });

  it('quem repostou / brindou: o dono decide quem vê os nomes (todos, só seguidores, só ele)', async () => {
    const { ma, mb, md } = u;
    const p = (await api().post('/api/v1/posts').set(auth(ma)).send({ body: 'lista de reações' }).expect(201)).body;
    await api().post(`/api/v1/posts/${p.id}/cheers`).set(auth(mb)).expect((r) => expect([200, 201]).toContain(r.status));
    await api().post(`/api/v1/posts/${p.id}/repost`).set(auth(mb)).send({}).expect((r) => expect([200, 201]).toContain(r.status));
    const names = async (viewer: U, kind: string) => (await api().get(`/api/v1/posts/${p.id}/people/${kind}`).set(auth(viewer)).expect(200)).body.map((x: { username: string }) => x.username);
    const set = (v: Record<string, string>) => api().patch('/api/v1/settings/privacy').set(auth(ma)).send(v).expect(200);

    // por omissão brindes e reposts são visíveis a todos
    expect(await names(md, 'cheers')).toEqual([mb.username]);
    expect(await names(md, 'reposts')).toEqual([mb.username]);
    const seen = ((await api().get(`/api/v1/users/${ma.username}/posts`).set(auth(md)).expect(200)).body.items as { id: string; lists: Record<string, boolean> }[]).find((x) => x.id === p.id)!;
    expect(seen.lists).toEqual({ reposts: true, cheers: true, gifts: true }); // md já segue ma (presentes: só seguidores)

    await set({ cheersVisible: 'followers' });
    await api().get(`/api/v1/posts/${p.id}/people/cheers`).set(auth(me2())).expect(403);
    await follow(md, ma).expect((r) => expect([200, 204]).toContain(r.status)); // md já seguia: idempotente
    expect(await names(md, 'cheers')).toEqual([mb.username]); // md segue ma
    await set({ cheersVisible: 'off' });
    await api().get(`/api/v1/posts/${p.id}/people/cheers`).set(auth(md)).expect(403);
    expect(await names(ma, 'cheers')).toEqual([mb.username]); // o dono vê sempre
    await api().get(`/api/v1/posts/${p.id}/people/xpto`).set(auth(ma)).expect(400);
  });

  it('repostar uma citação: mostra a citação e, dentro, o original; reposts simples não se repostam', async () => {
    const { ma, mb, md } = u;
    const original = (await api().post('/api/v1/posts').set(auth(ma)).send({ body: 'original' }).expect(201)).body;
    const quote = (await api().post(`/api/v1/posts/${original.id}/repost`).set(auth(mb)).send({ body: 'concordo' }).expect(201)).body;
    const plain = (await api().post(`/api/v1/posts/${original.id}/repost`).set(auth(md)).send({}).expect(201)).body;
    await api().post(`/api/v1/posts/${plain.id}/repost`).set(auth(ma)).send({}).expect(400); // repost simples: repostas o original

    const again = (await api().post(`/api/v1/posts/${quote.id}/repost`).set(auth(md)).send({}).expect(201)).body;
    expect(again.repostOf.id).toBe(quote.id);
    expect(again.repostOf.body).toBe('concordo');
    expect(again.repostOf.repostOf.id).toBe(original.id); // o original aparece dentro da citação
    const feed = ((await api().get(`/api/v1/users/${md.username}/posts`).set(auth(ma)).expect(200)).body.items as { id: string; repostOf: { repostOf: { id: string } } }[]).find((x) => x.id === again.id)!;
    expect(feed.repostOf.repostOf.id).toBe(original.id);
  });
});
