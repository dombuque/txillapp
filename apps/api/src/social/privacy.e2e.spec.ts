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

interface U { token: string; id: string; username: string; cookie: string }

describe('privacidade, bloqueios, notificações, pesquisa, foto e segurança da conta (integração)', () => {
  let app: INestApplication;
  let pool: Pool;
  const run = Date.now().toString(36);
  const api = () => request(app.getHttpServer());
  const auth = (u: U) => ({ Authorization: `Bearer ${u.token}` });
  const u: Record<string, U> = {};

  async function signup(name: string): Promise<U> {
    const username = `${name}${run}`.slice(0, 28);
    const r = await api().post('/api/v1/auth/register').send({ email: `${username}@example.com`, username, displayName: `${name} Teste`, password: PASSWORD , birthDate: '1990-06-15', acceptTerms: true}).expect(201);
    return { token: r.body.accessToken, id: r.body.user.id, username, cookie: (r.headers['set-cookie'] as unknown as string[])[0].split(';')[0] };
  }
  const profile = async (viewer: U, of: U) => (await api().get(`/api/v1/users/${of.username}`).set(auth(viewer)).expect(200)).body;
  const follow = (a: U, b: U) => api().post(`/api/v1/users/${b.username}/follow`).set(auth(a));
  const post = async (a: U, body: string) => (await api().post('/api/v1/posts').set(auth(a)).send({ body }).expect(201)).body;
  const notes = async (viewer: U) => (await api().get('/api/v1/notifications').set(auth(viewer)).expect(200)).body.items as { kind: string; actor: { username: string }; data: Record<string, unknown>; read: boolean }[];
  async function uploadPng(a: U) {
    const r = await api().post('/api/v1/media/uploads').set(auth(a)).send({ mime: 'image/png', size: PNG.length }).expect(201);
    await api().put(r.body.uploadUrl).set('Content-Type', 'image/png').send(PNG).expect(200);
    return r.body.assetId as string;
  }

  beforeAll(async () => {
    await migrate(DB);
    pool = new Pool({ connectionString: DB });
    app = await createApp(loadConfig({ DATABASE_URL: DB, JWT_ACCESS_SECRET: 'p'.repeat(40), NODE_ENV: 'test', MEDIA_DIR: './uploads-test' }));
    await app.init();
    // O registo tem limite de 10/min: criam-se uma só vez.
    for (const n of ['pa', 'pb', 'pc', 'pd', 'pe']) u[n] = await signup(n);
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  it('bloqueio ao estilo do X: a pessoa bloqueada é avisada, vê o aviso no perfil e fica sem acesso', async () => {
    const { pa: blocker, pb: blocked } = u;
    const p = await post(blocker, 'post do bloqueador');
    await follow(blocked, blocker).expect(200);
    await follow(blocker, blocked).expect(200);
    await api().post('/api/v1/auth/login').send({ identifier: 'x', password: 'y' }); // (ruído: não afecta nada)

    await api().put(`/api/v1/blocks/${blocker.username}`).set(auth(blocker)).expect(400); // a si próprio
    const list = (await api().put(`/api/v1/blocks/${blocked.username}`).set(auth(blocker)).expect(200)).body;
    expect(list.map((x: { username: string }) => x.username)).toEqual([blocked.username]);

    // Notificação "bloqueou-te" (e só uma, mesmo bloqueando outra vez).
    await api().delete(`/api/v1/blocks/${blocked.username}`).set(auth(blocker)).expect(200);
    await api().put(`/api/v1/blocks/${blocked.username}`).set(auth(blocker)).expect(200);
    const n = (await notes(blocked)).filter((x) => x.kind === 'blocked');
    expect(n).toHaveLength(1);
    expect(n[0].actor.username).toBe(blocker.username);
    expect((await api().get('/api/v1/notifications/unread-count').set(auth(blocked)).expect(200)).body.count).toBeGreaterThanOrEqual(1);

    // Perfil como no X: cabeçalho visível com aviso, sem conteúdo nem seguir.
    expect(await profile(blocked, blocker)).toMatchObject({ blockedMe: true, blockedByMe: false, canView: false, canSeeConnections: false, following: false });
    expect(await profile(blocker, blocked)).toMatchObject({ blockedByMe: true, blockedMe: false, following: false });
    await api().get(`/api/v1/users/${blocker.username}/posts`).set(auth(blocked)).expect(403);
    await follow(blocked, blocker).expect(403);
    await follow(blocker, blocked).expect(403); // quem bloqueou também tem de desbloquear primeiro

    // Nada de conteúdo, em ambos os sentidos.
    const feed = (await api().get('/api/v1/posts?limit=50').set(auth(blocked)).expect(200)).body.items;
    expect(feed.find((x: { id: string }) => x.id === p.id)).toBeUndefined();
    await api().get(`/api/v1/posts/${p.id}/comments`).set(auth(blocked)).expect(404);
    await api().post(`/api/v1/posts/${p.id}/comments`).set(auth(blocked)).send({ body: 'olá' }).expect(404);
    await api().post(`/api/v1/posts/${p.id}/cheers`).set(auth(blocked)).expect(404);
    await api().post('/api/v1/gifts').set(auth(blocked)).set('Idempotency-Key', `bk-${run}-1`).send({ toUsername: blocker.username, amount: 5 }).expect(403);
    const sug = (await api().get('/api/v1/suggestions/people').set(auth(blocked)).expect(200)).body.map((x: { username: string }) => x.username);
    expect(sug).not.toContain(blocker.username);
    const found = (await api().get(`/api/v1/search?q=${blocker.username}`).set(auth(blocked)).expect(200)).body;
    // (a pesquisa tolera erros de escrita, por isso podem aparecer nomes parecidos, mas nunca quem me bloqueou)
    expect(found.people.map((x: { username: string }) => x.username)).not.toContain(blocker.username);

    // Desbloquear devolve a visibilidade (mas não os seguidores).
    await api().delete(`/api/v1/blocks/${blocked.username}`).set(auth(blocker)).expect(200);
    expect(await profile(blocked, blocker)).toMatchObject({ blockedMe: false, canView: true, following: false });
    expect((await api().get(`/api/v1/users/${blocker.username}/posts`).set(auth(blocked)).expect(200)).body.items).toHaveLength(1);
  });

  it('definições: quem pode comentar e quem pode presentear são aplicadas no servidor', async () => {
    const { pc: owner, pd: other } = u;
    const p = await post(owner, 'post com regras');
    const set = (b: object) => api().patch('/api/v1/settings/privacy').set(auth(owner)).send(b).expect(200);
    const comment = (a: U) => api().post(`/api/v1/posts/${p.id}/comments`).set(auth(a)).send({ body: 'olá!' });
    const seen = async (a: U) => (await api().get('/api/v1/posts?limit=50').set(auth(a)).expect(200)).body.items.find((x: { id: string }) => x.id === p.id);

    expect(await seen(other)).toMatchObject({ canComment: true, canGift: false, authorFollowed: false }); // sem seguir não se presenteia
    await follow(other, owner).expect(200);
    expect(await seen(other)).toMatchObject({ canComment: true, canGift: true, authorFollowed: true });
    expect((await set({ commentsAllowed: 'off' })).body.commentsAllowed).toBe('off');
    expect((await seen(other)).canComment).toBe(false);
    await comment(other).expect(403);
    await comment(owner).expect(201); // o dono pode sempre

    await set({ commentsAllowed: 'following' });
    await comment(other).expect(403); // o dono ainda não segue esta pessoa
    await follow(owner, other).expect(200);
    await comment(other).expect(201);

    await set({ giftsAllowed: 'off' });
    expect((await seen(other)).canGift).toBe(false);
    await api().post(`/api/v1/posts/${p.id}/gifts`).set(auth(other)).set('Idempotency-Key', `pg-${run}-1`).send({ amount: 5 }).expect(403);
    await api().post('/api/v1/gifts').set(auth(other)).set('Idempotency-Key', `pg-${run}-2`).send({ toUsername: owner.username, amount: 5 }).expect(403);
    await set({ giftsAllowed: 'everyone' });
    await api().post('/api/v1/gifts').set(auth(other)).set('Idempotency-Key', `pg-${run}-3`).send({ toUsername: owner.username, amount: 5 }).expect(201);

    await api().patch('/api/v1/settings/privacy').set(auth(owner)).send({ commentsAllowed: 'ninguem' }).expect(400); // valor inválido
    expect(await api().get('/api/v1/settings/privacy').set(auth(owner)).expect(200).then((r) => r.body)).toMatchObject({ commentsAllowed: 'following', giftsAllowed: 'everyone' });
  });

  it('definições: quem vê seguidores/seguindo e aparecer nas sugestões', async () => {
    const { pc: owner, pe: other } = u;
    const set = (b: object) => api().patch('/api/v1/settings/privacy').set(auth(owner)).send(b).expect(200);

    await set({ showConnections: 'me' });
    expect((await profile(other, owner)).canSeeConnections).toBe(false);
    await api().get(`/api/v1/users/${owner.username}/followers`).set(auth(other)).expect(403);
    await api().get(`/api/v1/users/${owner.username}/following`).set(auth(other)).expect(403);
    expect((await profile(owner, owner)).canSeeConnections).toBe(true);
    await api().get(`/api/v1/users/${owner.username}/followers`).set(auth(owner)).expect(200);

    await set({ showConnections: 'followers' });
    await api().get(`/api/v1/users/${owner.username}/followers`).set(auth(other)).expect(403);
    await follow(other, owner).expect(200);
    expect((await profile(other, owner)).canSeeConnections).toBe(true);
    await api().get(`/api/v1/users/${owner.username}/followers`).set(auth(other)).expect(200);

    // Fora das sugestões, mas encontrável na pesquisa.
    await api().delete(`/api/v1/users/${owner.username}/follow`).set(auth(other)).expect(200);
    await set({ suggestable: false });
    const sug = (await api().get('/api/v1/suggestions/people').set(auth(other)).expect(200)).body.map((x: { username: string }) => x.username);
    expect(sug).not.toContain(owner.username);
    expect((await api().get(`/api/v1/search?q=${owner.username}`).set(auth(other)).expect(200)).body.people.map((x: { username: string }) => x.username)).toContain(owner.username);
  });

  it('notificações: seguidor, comentário, resposta, presente, resposta a story; ler tudo', async () => {
    const { pc: author, pd: fan } = u;
    await api().patch('/api/v1/settings/privacy').set(auth(author)).send({ commentsAllowed: 'everyone', showConnections: 'everyone' }).expect(200);
    await api().delete(`/api/v1/users/${author.username}/follow`).set(auth(fan)).expect(200);
    await api().post('/api/v1/notifications/read').set(auth(author)).expect(204); // começa do zero (o aviso de seguir só se repete depois de lido)
    const base = (await notes(author)).length;

    await follow(fan, author).expect(200);
    await api().delete(`/api/v1/users/${author.username}/follow`).set(auth(fan)).expect(200);
    await follow(fan, author).expect(200); // repetir seguir não spamma
    const p = await post(author, 'olá mundo');
    const c = (await api().post(`/api/v1/posts/${p.id}/comments`).set(auth(fan)).send({ body: 'bom post!' }).expect(201)).body;
    await api().post(`/api/v1/posts/${p.id}/comments`).set(auth(author)).send({ body: 'obrigado', parentId: c.id }).expect(201);
    await api().post('/api/v1/gifts').set(auth(fan)).set('Idempotency-Key', `nt-${run}-1`).send({ toUsername: author.username, amount: 7, note: 'parabéns', visibility: 'private' }).expect(201);
    const storyMedia = await uploadPng(author);
    const story = (await api().post('/api/v1/stories').set(auth(author)).send({ mediaId: storyMedia }).expect(201)).body;
    await api().post(`/api/v1/stories/${story.id}/replies`).set(auth(fan)).send({ body: '🔥' }).expect(201);

    const mine = await notes(author);
    const kinds = mine.slice(0, mine.length - base).map((x) => x.kind).sort();
    expect(kinds).toEqual(['comment', 'follow', 'gift', 'story_reply']);
    expect(mine.find((x) => x.kind === 'gift')).toMatchObject({ actor: { username: fan.username }, data: { amount: 7, note: 'parabéns' } });
    expect(mine.find((x) => x.kind === 'comment')!.data.snippet).toBe('bom post!');
    expect((await notes(fan)).some((x) => x.kind === 'reply' && x.actor.username === author.username)).toBe(true); // a resposta avisa quem foi respondido

    expect((await api().get('/api/v1/notifications/unread-count').set(auth(author)).expect(200)).body.count).toBeGreaterThanOrEqual(4);
    await api().post('/api/v1/notifications/read').set(auth(author)).expect(204);
    expect((await api().get('/api/v1/notifications/unread-count').set(auth(author)).expect(200)).body.count).toBe(0);
    await api().get('/api/v1/notifications').expect(401);
  });

  it('repost: simples e com comentário; regras de privacidade, idempotência, desfazer e notificação', async () => {
    const { pa: author, pb: sharer, pc: viewer } = u;
    const p = await post(author, 'vale a pena repostar');
    const rp = (a: U, id: string, body?: string) => api().post(`/api/v1/posts/${id}/repost`).set(auth(a)).send(body === undefined ? {} : { body });
    const feedOf = async (a: U) => (await api().get('/api/v1/posts?limit=50').set(auth(a)).expect(200)).body.items as { id: string; reposts: number; reposted: boolean; kind: string; body: string; repostOf: { id: string } | null }[];

    const first = await rp(sharer, p.id).expect(201);
    expect(first.body).toMatchObject({ kind: 'repost', body: '', repostOf: { id: p.id, reposts: 1 } });
    expect((await rp(sharer, p.id).expect(201)).body.id).toBe(first.body.id); // repost simples é idempotente
    const quote = await rp(sharer, p.id, 'concordo totalmente!').expect(201);
    expect(quote.body).toMatchObject({ body: 'concordo totalmente!', repostOf: { id: p.id, reposts: 2 } });
    expect(quote.body.id).not.toBe(first.body.id); // citações podem ser várias

    // Os outros veem os reposts no feed e as contagens/estado no original.
    const seen = await feedOf(viewer);
    expect(seen.filter((x) => x.kind === 'repost' && x.repostOf?.id === p.id)).toHaveLength(2);
    expect(seen.find((x) => x.id === p.id)).toMatchObject({ reposts: 2, reposted: false });
    expect((await feedOf(sharer)).find((x) => x.id === p.id)).toMatchObject({ reposted: true });
    const mine = (await api().get(`/api/v1/users/${sharer.username}/posts`).set(auth(viewer)).expect(200)).body.items;
    expect(mine.some((x: { id: string }) => x.id === first.body.id)).toBe(true); // aparece no perfil de quem repostou

    // Regras.
    const own = await rp(author, p.id).expect(201); // o dono também pode repostar a própria publicação
    expect(own.body.repostOf.id).toBe(p.id);
    await api().delete(`/api/v1/posts/${p.id}/repost`).set(auth(author)).expect(200);
    await rp(viewer, first.body.id).expect(400); // repost de um repost
    await rp(viewer, '00000000-0000-7000-8000-00000000dead').expect(404);
    const kinds = (await notes(author)).filter((x) => x.kind === 'repost');
    expect(kinds.length).toBeGreaterThanOrEqual(2);
    expect(kinds[0].actor.username).toBe(sharer.username);

    // Contas privadas não se repostam, e os reposts existentes deixam de ser visíveis a quem não é seguidor.
    const q = await post(author, 'outro post');
    await api().patch('/api/v1/users/me').set(auth(author)).send({ isPrivate: true }).expect(200);
    await rp(viewer, q.id).expect(404); // nem a vê
    await rp(sharer, q.id).expect(404);
    expect((await feedOf(viewer)).some((x) => x.kind === 'repost' && x.repostOf?.id === p.id)).toBe(false);
    await api().patch('/api/v1/users/me').set(auth(author)).send({ isPrivate: false }).expect(200);

    // Bloqueio: quem foi bloqueado não repõe.
    await api().put(`/api/v1/blocks/${viewer.username}`).set(auth(author)).expect(200);
    await rp(viewer, q.id).expect(404);
    await api().delete(`/api/v1/blocks/${viewer.username}`).set(auth(author)).expect(200);

    // Desfazer remove só o repost simples.
    expect((await api().delete(`/api/v1/posts/${p.id}/repost`).set(auth(sharer)).expect(200)).body).toEqual({ reposted: false, reposts: 1 });
    const after = await feedOf(sharer);
    expect(after.some((x) => x.id === first.body.id)).toBe(false);
    expect(after.some((x) => x.id === quote.body.id)).toBe(true);
  });

  it('género: definido pela pessoa, privado por defeito, e selo de verificado', async () => {
    const name = `pg${run}`.slice(0, 28);
    const reg = (b: object) => api().post('/api/v1/auth/register').send({ email: `${name}@example.com`, username: name, displayName: 'Género Teste', password: PASSWORD, birthDate: '1990-06-15', acceptTerms: true, ...b });
    await reg({ gender: 'xyz' }).expect(400); // valor inválido
    const r = await reg({ gender: 'female' }).expect(201);
    const g: U = { token: r.body.accessToken, id: r.body.user.id, username: name, cookie: '' };

    expect(await api().get('/api/v1/settings/privacy').set(auth(g)).expect(200).then((x) => x.body)).toMatchObject({ gender: 'female', showGender: false });
    expect((await profile(g, g)).gender).toBe('female'); // a própria pessoa vê
    expect((await profile(u.pa, g)).gender).toBeNull(); // os outros não, por defeito

    await api().patch('/api/v1/settings/privacy').set(auth(g)).send({ showGender: true }).expect(200);
    expect((await profile(u.pa, g)).gender).toBe('female'); // só depois de ela o ativar
    await api().patch('/api/v1/settings/privacy').set(auth(g)).send({ gender: 'unspecified' }).expect(200); // "prefiro não dizer" é uma escolha
    expect((await profile(u.pa, g)).gender).toBe('unspecified');
    await api().patch('/api/v1/settings/privacy').set(auth(g)).send({ gender: 'xyz' }).expect(400);

    // Contas sem género (antigas / API) ficam a null: a app pede-o uma vez.
    expect((await api().get('/api/v1/settings/privacy').set(auth(u.pa)).expect(200)).body.gender).toBeNull();
    await api().patch('/api/v1/settings/privacy').set(auth(u.pa)).send({ gender: 'other' }).expect(200);

    // Selo de verificado (o processo fica para depois: por agora só o campo).
    const pg = await post(g, 'post verificado');
    const pa = await post(u.pa, 'post normal');
    expect((await profile(u.pb, g)).verified).toBe(false);
    await pool.query('UPDATE identity.users SET verified = true, verified_at = now() WHERE id = $1', [g.id]);
    expect((await profile(u.pb, g)).verified).toBe(true);
    expect((await profile(u.pb, u.pa)).verified).toBe(false);
    const feed = (await api().get('/api/v1/posts?limit=50').set(auth(u.pb)).expect(200)).body.items as { id: string; author: { verified: boolean } }[];
    expect(feed.find((x) => x.id === pg.id)!.author.verified).toBe(true);
    expect(feed.find((x) => x.id === pa.id)!.author.verified).toBe(false);
    const found = (await api().get(`/api/v1/search?q=${name}`).set(auth(u.pb)).expect(200)).body.people;
    expect(found[0]).toMatchObject({ username: name, verified: true });
  });

  it('pesquisa: pessoas por @ ou nome, publicações visíveis, escape de % e mínimo de 2 letras', async () => {
    const { pa: a, pb: b } = u;
    const q = async (viewer: U, term: string) => (await api().get(`/api/v1/search?q=${encodeURIComponent(term)}`).set(auth(viewer)).expect(200)).body;

    expect((await q(b, a.username)).people[0].username).toBe(a.username); // por @
    await api().patch('/api/v1/users/me').set(auth(a)).send({ displayName: `Pessoa ${run}` }).expect(200); // nome único: a base de testes acumula "pa Teste"
    expect((await q(b, `Pessoa ${run}`)).people.map((x: { username: string }) => x.username)).toContain(a.username); // por nome
    expect((await q(b, 'x')).people).toEqual([]); // curto demais
    expect((await q(b, '%%')).people).toEqual([]); // % não é padrão
    expect((await q(b, a.username)).people.every((x: { username: string }) => x.username !== b.username)).toBe(true); // sem o próprio

    const marker = `praiadapesquisa${run}`;
    const pub = await post(a, `Estou na ${marker} agora`);
    expect((await q(b, marker)).posts.map((x: { id: string }) => x.id)).toEqual([pub.id]);
    await api().patch('/api/v1/users/me').set(auth(a)).send({ isPrivate: true }).expect(200);
    expect((await q(b, marker)).posts).toEqual([]); // perfil privado: publicações escondidas da pesquisa
    expect((await q(a, marker)).posts).toHaveLength(1);
    await api().patch('/api/v1/users/me').set(auth(a)).send({ isPrivate: false }).expect(200);
  });

  it('foto de perfil: define, serve por @, remove, e não reutiliza fotos de publicações', async () => {
    const { pe: a } = u;
    await api().get(`/api/v1/avatars/${a.username}`).expect(204); // sem foto
    const mediaId = await uploadPng(a);
    await api().put('/api/v1/users/me/avatar').set(auth(a)).send({ mediaId }).expect(200);
    const img = await api().get(`/api/v1/avatars/${a.username}`).expect(200);
    expect(img.headers['content-type']).toMatch(/image\/png/);
    expect(img.headers['cache-control']).toContain('no-cache');
    expect((await profile(a, a)).hasAvatar).toBe(true);

    await api().put('/api/v1/users/me/avatar').set(auth(a)).send({ mediaId }).expect(400); // já em uso
    const other = await uploadPng(a);
    await api().post('/api/v1/posts').set(auth(a)).send({ body: 'com foto', mediaIds: [other] }).expect(201);
    await api().put('/api/v1/users/me/avatar').set(auth(a)).send({ mediaId: other }).expect(400); // foto de uma publicação
    const strangers = await uploadPng(u.pb);
    await api().put('/api/v1/users/me/avatar').set(auth(u.pa)).send({ mediaId: strangers }).expect(400); // foto de outra pessoa

    await api().delete('/api/v1/users/me/avatar').set(auth(a)).expect(200);
    await api().get(`/api/v1/avatars/${a.username}`).expect(204);
    await api().put('/api/v1/users/me/avatar').send({ mediaId }).expect(401);
  });

  it('segurança: alterar senha, sessões e eliminar conta', async () => {
    const x = await signup('px');
    const csrf = { 'X-Requested-With': 'txillapp' };

    // Alterar senha
    const change = (cur: string, next: string) => api().post('/api/v1/auth/password').set(auth(x)).send({ currentPassword: cur, newPassword: next });
    await change('errada-errada-1', 'nova-senha-bem-longa-2').expect(401);
    await change(PASSWORD, 'curta').expect(400);
    await change(PASSWORD, PASSWORD).expect(400);
    const ok = await change(PASSWORD, 'nova-senha-bem-longa-2').expect(200);
    const newCookie = (ok.headers['set-cookie'] as unknown as string[])[0].split(';')[0];
    await api().post('/api/v1/auth/refresh').set(csrf).set('Cookie', x.cookie).expect(401); // a sessão antiga terminou
    await api().post('/api/v1/auth/refresh').set(csrf).set('Cookie', newCookie).expect(200); // a nova funciona
    await api().post('/api/v1/auth/login').send({ identifier: x.username, password: PASSWORD }).expect(401);
    const re = await api().post('/api/v1/auth/login').send({ identifier: x.username, password: 'nova-senha-bem-longa-2' }).expect(200);
    const cookie2 = (re.headers['set-cookie'] as unknown as string[])[0].split(';')[0];
    x.token = re.body.accessToken;

    // Sessões
    const s = (await api().get('/api/v1/auth/sessions').set(auth(x)).set('Cookie', cookie2).expect(200)).body;
    expect(s.length).toBeGreaterThanOrEqual(2);
    expect(s.filter((r: { current: boolean }) => r.current)).toHaveLength(1);
    const other = s.find((r: { current: boolean }) => !r.current);
    await api().delete(`/api/v1/auth/sessions/${other.id}`).set(auth(x)).expect(204);
    await api().post('/api/v1/auth/sessions/revoke-others').set(auth(x)).set('Cookie', cookie2).expect(204);
    const left = (await api().get('/api/v1/auth/sessions').set(auth(x)).set('Cookie', cookie2).expect(200)).body;
    expect(left).toHaveLength(1);
    expect(left[0].current).toBe(true);
    await api().get('/api/v1/auth/sessions').expect(401);

    // Eliminar conta
    const live = await post(x, 'vou desaparecer');
    await follow(u.pa, x).expect(200);
    await api().post('/api/v1/auth/delete-account').set(auth(x)).send({ confirmUsername: 'outro', password: 'nova-senha-bem-longa-2' }).expect(400);
    await api().post('/api/v1/auth/delete-account').set(auth(x)).send({ confirmUsername: x.username, password: 'errada-errada-1' }).expect(401);
    await api().post('/api/v1/auth/delete-account').set(auth(x)).send({ confirmUsername: `@${x.username}`, password: 'nova-senha-bem-longa-2' }).expect(204);

    await api().post('/api/v1/auth/login').send({ identifier: x.username, password: 'nova-senha-bem-longa-2' }).expect(401);
    await api().post('/api/v1/auth/refresh').set(csrf).set('Cookie', cookie2).expect(401);
    await api().get(`/api/v1/users/${x.username}`).set(auth(u.pa)).expect(404);
    const feed = (await api().get('/api/v1/posts?limit=50').set(auth(u.pa)).expect(200)).body.items;
    expect(feed.find((p: { id: string }) => p.id === live.id)).toBeUndefined(); // as publicações deixam de aparecer
    const row = (await pool.query('SELECT status, display_name, email, bio FROM identity.users WHERE id = $1', [x.id])).rows[0];
    expect(row).toMatchObject({ status: 'deleted', display_name: 'Conta eliminada', bio: null });
    expect(row.email).toMatch(/^deleted\+.*@invalid\.local$/); // sem dados pessoais
    expect((await profile(u.pa, u.pa)).counts.following).toBeGreaterThanOrEqual(0);
    // O email pode ser usado numa conta nova.
    await api().post('/api/v1/auth/register').send({ email: `${x.username}@example.com`, username: `${x.username}n`.slice(0, 30), displayName: 'Novo', password: PASSWORD , birthDate: '1990-06-15', acceptTerms: true}).expect(201);
  });
});
