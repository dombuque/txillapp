import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Pool } from 'pg';
import { loadConfig } from '../config';
import { migrate } from '../db/migrate';
import { createApp } from '../main';
import { staffLogin } from '../staff/staff-test';

const DB = process.env.TEST_DATABASE_URL ?? 'postgres://txill:txill_dev@localhost:5433/txillapp_test';
const PASSWORD = 'password-bem-longa-1';
const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');

interface U { token: string; id: string; username: string }

/**
 * Regras das lojas (Apple 1.2, Google Play UGC): tudo o que outras pessoas veem denuncia-se (também mimos, comentários de
 * mimos, Zás e locais), e o que alguém denunciou deixa de lhe aparecer, mas continua para os outros até a moderação decidir.
 */
describe('denunciar mimos, comentários de mimos, Zás e locais; o denunciado sai para quem denunciou (integração)', () => {
  let app: INestApplication;
  let pool: Pool;
  const run = Date.now().toString(36);
  const api = () => request(app.getHttpServer());
  const auth = (x: U) => ({ Authorization: `Bearer ${x.token}` });
  const u: Record<string, U> = {};
  let mod = '';
  const mauth = () => ({ Authorization: `Bearer ${mod}` });

  async function signup(name: string): Promise<U> {
    const username = `${name}${run}`.slice(0, 28);
    const r = await api().post('/api/v1/auth/register').send({ email: `${username}@example.com`, username, displayName: `${name} Teste`, password: PASSWORD, birthDate: '1990-06-15', acceptTerms: true }).expect(201);
    return { token: r.body.accessToken, id: r.body.user.id, username };
  }
  const follow = (a: U, b: U) => pool.query('INSERT INTO social.follows (follower_id, followee_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [a.id, b.id]);
  const report = (x: U, type: string, id: string, reason = 'harassment') => api().post('/api/v1/reports').set(auth(x)).send({ type, id, reason });
  async function photo(a: U, purpose?: 'chat') {
    const up = await api().post('/api/v1/media/uploads').set(auth(a)).send({ mime: 'image/png', size: PNG.length, ...(purpose ? { purpose } : {}) }).expect(201);
    await api().put(up.body.uploadUrl).set('Content-Type', 'image/png').send(PNG).expect(200);
    if (purpose) await api().post(`/api/v1/media/${up.body.assetId}/complete`).set(auth(a)).send({}).expect(200);
    return up.body.assetId as string;
  }
  const queue = async (type: string) => (await api().get('/api/v1/admin/mod/queue').query({ type }).set(mauth()).expect(200)).body.items as { type: string; id: string; preview: string; removed: string | null; media: { url: string; review?: boolean }[] }[];
  const decide = (type: string, id: string, action: string, note?: string) =>
    api().post('/api/v1/admin/mod/queue/decide').set(mauth()).send({ items: [{ type, id }], action, ...(note ? { note } : {}) }).expect(200);

  beforeAll(async () => {
    await migrate(DB);
    pool = new Pool({ connectionString: DB });
    app = await createApp(loadConfig({ DATABASE_URL: DB, JWT_ACCESS_SECRET: 'f'.repeat(40), NODE_ENV: 'test', MEDIA_DIR: './uploads-test' }));
    await app.init();
    for (const n of ['uga', 'ugb', 'ugc']) u[n] = await signup(n);
    // As três seguem-se umas às outras: todas veem os mimos e os Zás («Amigos») de todas.
    for (const a of Object.values(u)) for (const b of Object.values(u)) if (a !== b) await follow(a, b);
    mod = (await staffLogin(app, 'ugm', ['moderacao'])).token;
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  it('mimo: denuncia-se; o próprio não; sai para quem denunciou e fica para os outros', async () => {
    const { uga, ugb, ugc } = u;
    const mediaId = await photo(uga); // antes do pedido (com o upload no meio dele, o supertest falha)
    const story = (await api().post('/api/v1/stories').set(auth(uga)).send({ mediaId, caption: 'mimo duvidoso' }).expect(201)).body;
    const ids = async (x: U) => ((await api().get(`/api/v1/stories/user/${uga.username}`).set(auth(x)).expect(200)).body as { id: string }[]).map((s) => s.id);
    expect(await ids(ugb)).toContain(story.id);
    await report(uga, 'story', story.id).expect(400); // o próprio mimo
    await report(ugb, 'story', story.id, 'nudity').expect(204);
    expect(await ids(ugb)).not.toContain(story.id);
    expect(await ids(ugc)).toContain(story.id);
    expect(await ids(uga)).toContain(story.id);
    // Na bandeja também: quem denunciou o único mimo da pessoa deixa de a ver lá.
    const tray = async (x: U) => ((await api().get('/api/v1/stories').set(auth(x)).expect(200)).body as { username: string }[]).map((t) => t.username);
    expect(await tray(ugb)).not.toContain(uga.username);
    expect(await tray(ugc)).toContain(uga.username);
    expect((await queue('story')).map((x) => x.id)).toContain(story.id);
  });

  it('comentário de mimo: denuncia-se, sai para quem denunciou e a moderação apaga-o', async () => {
    const { uga, ugb, ugc } = u;
    const mediaId = await photo(uga); // antes do pedido (com o upload no meio dele, o supertest falha)
    const story = (await api().post('/api/v1/stories').set(auth(uga)).send({ mediaId, caption: 'comentem' }).expect(201)).body;
    const c = (await api().post(`/api/v1/stories/${story.id}/comments`).set(auth(ugc)).send({ body: 'comentário feio' }).expect(201)).body;
    const comments = async (x: U) => ((await api().get(`/api/v1/stories/${story.id}/comments`).set(auth(x)).expect(200)).body as { id: string }[]).map((k) => k.id);
    await report(ugc, 'story_comment', c.id).expect(400); // o próprio comentário
    await report(ugb, 'story_comment', '00000000-0000-7000-8000-000000000000').expect(404);
    await report(ugb, 'story_comment', c.id).expect(204);
    expect(await comments(ugb)).not.toContain(c.id);
    expect(await comments(uga)).toContain(c.id);

    const it = (await queue('story_comment')).find((x) => x.id === c.id)!;
    expect(it).toMatchObject({ type: 'story_comment', preview: 'comentário feio', removed: null });
    await decide('story_comment', c.id, 'remove', 'insulto');
    expect(await comments(uga)).not.toContain(c.id);
    const done = (await api().get('/api/v1/admin/mod/queue').query({ type: 'story_comment', status: 'actioned' }).set(mauth()).expect(200)).body.items.find((x: { id: string }) => x.id === c.id);
    expect(done).toMatchObject({ removed: 'moderation' });
  });

  it('Zás: denuncia-se, sai para quem denunciou, a moderação vê a foto e fá-lo expirar', async () => {
    const { uga, ugb, ugc } = u;
    const mediaId = await photo(uga, 'chat');
    const z = (await api().post('/api/v1/instants').set(auth(uga)).send({ mediaId, caption: 'zás duvidoso' }).expect(201)).body;
    const zas = async (x: U) => ((await api().get(`/api/v1/instants/of/${uga.username}`).set(auth(x)).expect(200)).body as { id: string }[]).map((i) => i.id);
    const tray = async (x: U) => ((await api().get('/api/v1/instants').set(auth(x)).expect(200)).body.others as { username: string }[]).map((o) => o.username);
    await report(uga, 'instant', z.id).expect(400);
    await report(ugb, 'instant', z.id, 'nudity').expect(204);
    expect(await zas(ugb)).not.toContain(z.id);
    expect(await tray(ugb)).not.toContain(uga.username);
    expect(await zas(ugc)).toContain(z.id);

    const it = (await queue('instant')).find((x) => x.id === z.id)!;
    expect(it).toMatchObject({ type: 'instant', preview: 'zás duvidoso', removed: null });
    expect(it.media[0]).toMatchObject({ review: true });
    await api().get(it.media[0].url).set(mauth()).expect(200); // a foto privada vê-se pela rota de revisão
    await decide('instant', z.id, 'remove', 'nudez');
    expect(await zas(ugc)).not.toContain(z.id);
    await api().get(it.media[0].url).set(mauth()).expect(404); // decidida a queixa, a foto deixa de se ver
  });

  it('local: denuncia-se a página aprovada; publicação denunciada sai do feed; mensagem denunciada sai da conversa', async () => {
    const { uga, ugb, ugc } = u;
    const v = (await pool.query(
      `INSERT INTO content.venues (id, slug, name, kind, owner_id, check_token, review_status) VALUES (gen_random_uuid(), $1, 'Bar UGC', 'bar', $2, 'x', 'approved') RETURNING id`,
      [`ugc-${run}`, uga.id],
    )).rows[0];
    await report(uga, 'venue', v.id).expect(400); // a própria página
    await report(ugb, 'venue', v.id, 'scam').expect(204);
    expect((await queue('venue')).map((x) => x.id)).toContain(v.id);

    const p = (await api().post('/api/v1/posts').set(auth(uga)).send({ body: `publicação denunciada ${run}` }).expect(201)).body;
    const feed = async (x: U) => ((await api().get('/api/v1/feed?limit=50').set(auth(x)).expect(200)).body.items as { id: string }[]).map((i) => i.id);
    expect(await feed(ugb)).toContain(p.id);
    await report(ugb, 'post', p.id).expect(204);
    expect(await feed(ugb)).not.toContain(p.id);
    expect(await feed(ugc)).toContain(p.id);

    const m = (await api().post(`/api/v1/chat/with/${ugb.username}`).set(auth(uga)).send({ body: 'mensagem denunciada' }).expect(201)).body;
    const thread = async (x: U, other: U) => ((await api().get(`/api/v1/chat/with/${other.username}`).set(auth(x)).expect(200)).body.items as { id: string }[]).map((i) => i.id);
    expect(await thread(ugb, uga)).toContain(m.id);
    await report(ugb, 'message', m.id).expect(204);
    expect(await thread(ugb, uga)).not.toContain(m.id);
    expect(await thread(uga, ugb)).toContain(m.id);
  });

  it('comentário de publicação denunciado sai para quem denunciou, também nas respostas', async () => {
    const { uga, ugb, ugc } = u;
    const p = (await api().post('/api/v1/posts').set(auth(uga)).send({ body: 'comentem aqui' }).expect(201)).body;
    const c = (await api().post(`/api/v1/posts/${p.id}/comments`).set(auth(ugc)).send({ body: 'comentário a denunciar' }).expect(201)).body;
    const parent = (await api().post(`/api/v1/posts/${p.id}/comments`).set(auth(uga)).send({ body: 'pai' }).expect(201)).body;
    const reply = (await api().post(`/api/v1/posts/${p.id}/comments`).set(auth(ugc)).send({ body: 'resposta a denunciar', parentId: parent.id }).expect(201)).body;
    const top = async (x: U) => ((await api().get(`/api/v1/posts/${p.id}/comments`).set(auth(x)).expect(200)).body.items as { id: string }[]).map((k) => k.id);
    const replies = async (x: U) => ((await api().get(`/api/v1/comments/${parent.id}/replies`).set(auth(x)).expect(200)).body.items as { id: string }[]).map((k) => k.id);
    await report(ugb, 'comment', c.id).expect(204);
    await report(ugb, 'comment', reply.id).expect(204);
    expect(await top(ugb)).not.toContain(c.id);
    expect(await top(ugb)).toContain(parent.id);
    expect(await replies(ugb)).not.toContain(reply.id);
    expect(await top(uga)).toContain(c.id);
    expect(await replies(uga)).toContain(reply.id);
  });
});
