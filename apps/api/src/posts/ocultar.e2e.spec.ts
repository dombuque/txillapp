import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { getStorageToken } from '@nestjs/throttler';
import request from 'supertest';
import { Pool } from 'pg';
import { loadConfig } from '../config';
import { migrate } from '../db/migrate';
import { createApp } from '../main';
import { staffLogin } from '../staff/staff-test';
import { HIDE_BOOSTED } from './hidden';

const DB = process.env.TEST_DATABASE_URL ?? 'postgres://txill:txill_dev@localhost:5433/txillapp_test';
const PASSWORD = 'password-bem-longa-1';

interface U { token: string; id: string; username: string }
interface P { id: string; code: string; body: string; kind: string; hidden?: boolean; cheers: number; comments: number; reposts: number; repostOf?: P | null }

/**
 * «Ocultar publicação» (0169): o autor esconde uma publicação sua e volta a mostrá-la quando quiser. Enquanto está oculta só
 * ele a vê (o link e o separador «Ocultas»); para os outros é como uma apagada, em todo o lado.
 */
describe('ocultar e voltar a mostrar uma publicação (integração)', () => {
  let app: INestApplication;
  let pool: Pool;
  const run = Date.now().toString(36);
  let n = 0;
  const api = () => request(app.getHttpServer());
  const auth = (x: { token: string }) => ({ Authorization: `Bearer ${x.token}` });
  let au: U, fb: U, st: U;
  // P0 < P1 < P2 (pela data); P1 é a que se oculta. T: uma tcheka; PH: uma foto partilhada num mimo.
  let p0: P, p1: P, p2: P, t: P, ph: P, repost: P, quote: P;
  const tag = `ocultar${run}`;
  const word = `palavrinha${run}`;
  const place = `Praia Oculta ${run}`;

  async function signup(name: string): Promise<U> {
    const username = `${name}${run}`.slice(0, 28);
    const r = await api().post('/api/v1/auth/register').set('X-Forwarded-For', `10.69.0.${(n++ % 250) + 1}`)
      .send({ email: `${username}@example.com`, username, displayName: `${name} Teste`, password: PASSWORD, birthDate: '1990-06-15', acceptTerms: true }).expect(201);
    return { token: r.body.accessToken, id: r.body.user.id, username };
  }
  const media = async (owner: U, mime: string) =>
    (await pool.query(`INSERT INTO content.media_assets (id, owner_id, mime, size_bytes, storage_key, status, duration_ms, width, height) VALUES (gen_random_uuid(), $1, $2, 1, 'x', 'ready', 5000, 720, 1280) RETURNING id`, [owner.id, mime])).rows[0].id as string;
  const publish = async (who: U, body: Record<string, unknown>) => (await api().post('/api/v1/posts').set(auth(who)).send(body).expect(201)).body as P;
  const one = (who: U, id: string) => api().get(`/api/v1/posts/${id}`).set(auth(who));
  const hide = (who: U, id: string) => api().post(`/api/v1/posts/${id}/hide`).set(auth(who));
  const unhide = (who: U, id: string) => api().post(`/api/v1/posts/${id}/unhide`).set(auth(who));
  const ids = (items: { id: string }[]) => items.map((i) => i.id);
  const profilePosts = async (viewer: U, of: U, tab = 'all') => ids((await api().get(`/api/v1/users/${of.username}/posts?tab=${tab}&limit=50`).set(auth(viewer)).expect(200)).body.items);
  const profile = async (viewer: U, of: U) => (await api().get(`/api/v1/users/${of.username}`).set(auth(viewer)).expect(200)).body as { counts: { posts: number }; hiddenPosts: number };
  const feedIds = async (who: U) => {
    const out: string[] = [];
    let cursor: string | null = null;
    for (let i = 0; i < 8; i++) {
      const b: { items: { id: string; repostOf?: { id: string } | null }[]; nextCursor: string | null } = (await api().get(`/api/v1/feed?limit=30${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`).set(auth(who)).expect(200)).body;
      for (const it of b.items) out.push(it.id, ...(it.repostOf ? [it.repostOf.id] : []));
      cursor = b.nextCursor;
      if (!cursor) break;
    }
    return out;
  };
  const searchIds = async (who: U, q: string) => ids((await api().get(`/api/v1/search?q=${encodeURIComponent(q)}`).set(auth(who)).expect(200)).body.posts);
  const tagPage = async (who: U) => (await api().get(`/api/v1/tags/${tag}?sort=recent`).set(auth(who)).expect(200)).body as { posts: number; items: { id: string }[] };
  const placeIds = async (who: U) => ids((await api().get(`/api/v1/feed/place?label=${encodeURIComponent(place)}&mode=at`).set(auth(who)).expect(200)).body.items);
  const reelsIds = async (who: U) => ids((await api().get('/api/v1/feed/reels?following=1&limit=15').set(auth(who)).expect(200)).body.items);
  const hiddenList = async (who: U) => ids((await api().get('/api/v1/me/posts/hidden').set(auth(who)).expect(200)).body.items);
  const resetThrottle = () => {
    const s = app.get(getStorageToken()) as { storage: Map<string, unknown>; hitExpirations?: Map<string, unknown> };
    s.storage.clear();
    s.hitExpirations?.clear();
  };

  beforeAll(async () => {
    await migrate(DB);
    pool = new Pool({ connectionString: DB });
    app = await createApp(loadConfig({ DATABASE_URL: DB, JWT_ACCESS_SECRET: 'o'.repeat(40), NODE_ENV: 'test', MEDIA_DIR: './uploads-test' }));
    await app.init();
    [au, fb, st] = [await signup('ocau'), await signup('ocfb'), await signup('ocst')];
    // fb e au seguem-se (podem conversar); st não segue ninguém.
    await api().post(`/api/v1/users/${au.username}/follow`).set(auth(fb)).expect(200);
    await api().post(`/api/v1/users/${fb.username}/follow`).set(auth(au)).expect(200);

    p0 = await publish(au, { body: `a mais antiga ${run}` });
    p1 = await publish(au, { body: `a que vou ocultar #${tag} ${word}`, locationLabel: place });
    p2 = await publish(au, { body: `a mais recente ${run}` });
    t = await publish(au, { body: `a minha tcheka ${run}`, mediaIds: [await media(au, 'video/mp4')] });
    ph = await publish(au, { body: `uma foto ${run}`, mediaIds: [await media(au, 'image/png')] });
    // Interações antes de ocultar: ficam guardadas.
    await api().post(`/api/v1/posts/${p1.id}/cheers`).set(auth(fb)).expect(200);
    await api().post(`/api/v1/posts/${p1.id}/comments`).set(auth(fb)).send({ body: 'que bom' }).expect(201);
    repost = (await api().post(`/api/v1/posts/${p1.id}/repost`).set(auth(fb)).send({}).expect(201)).body;
    quote = (await api().post(`/api/v1/posts/${p1.id}/repost`).set(auth(st)).send({ body: `citação ${run}` }).expect(201)).body;
    await api().post('/api/v1/stories/share').set(auth(fb)).send({ postId: ph.id }).expect(201);
  }, 90_000);

  beforeEach(() => resetThrottle());

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  it('antes de ocultar, todos a veem em todo o lado', async () => {
    expect(await feedIds(fb)).toContain(p1.id);
    expect(await profilePosts(st, au)).toContain(p1.id);
    expect(await searchIds(st, word)).toContain(p1.id);
    expect(ids((await tagPage(st)).items)).toContain(p1.id);
    expect(await placeIds(st)).toContain(p1.id);
    expect(await reelsIds(fb)).toContain(t.id);
    expect((await one(st, repost.id).expect(200)).body.repostOf.id).toBe(p1.id);
    expect((await one(au, p1.id).expect(200)).body.hidden).toBe(false);
  });

  it('só o autor oculta; repetir não faz nada', async () => {
    await hide(fb, p1.id).expect(404);
    await hide(st, p1.id).expect(404);
    const r = (await hide(au, p1.id).expect(200)).body as P;
    expect(r).toMatchObject({ id: p1.id, hidden: true, cheers: 1, comments: 1 });
    expect((await hide(au, p1.id).expect(200)).body.hidden).toBe(true);
    await unhide(fb, p1.id).expect(404);
  });

  it('pelo link: o autor abre-a (com hidden), os outros recebem 404 como numa apagada', async () => {
    expect((await one(au, p1.id).expect(200)).body).toMatchObject({ hidden: true, cheers: 1, comments: 1 });
    await one(fb, p1.id).expect(404);
    await one(st, p1.id).expect(404);
    await api().get(`/api/v1/posts/code/${p1.code}`).set(auth(fb)).expect(404);
    expect((await api().get(`/api/v1/posts/code/${p1.code}`).set(auth(au)).expect(200)).body.hidden).toBe(true);
    // A página pública e a pré-visualização (og:) também não a mostram.
    expect((await api().get(`/api/v1/share/p/${p1.code}`).expect(200)).text).not.toContain(word);
    await api().get(`/api/v1/public/posts/${p1.code}`).expect(404);
  });

  it('sai do feed (de todos, também do autor), do perfil, da pesquisa, das hashtags e dos sítios', async () => {
    expect(await feedIds(fb)).not.toContain(p1.id);
    expect(await feedIds(au)).not.toContain(p1.id);
    for (const v of [au, fb, st]) expect(await profilePosts(v, au)).not.toContain(p1.id);
    expect(await profilePosts(st, au, 'posts')).not.toContain(p1.id);
    expect(await searchIds(st, word)).not.toContain(p1.id);
    expect(await searchIds(au, word)).not.toContain(p1.id);
    const tp = await tagPage(st);
    expect(ids(tp.items)).not.toContain(p1.id);
    expect(tp.posts).toBe(0);
    expect(await placeIds(st)).not.toContain(p1.id);
  });

  it('não conta nas publicações do perfil; o separador «Ocultas» é só do autor', async () => {
    const mine = await profile(au, au);
    const seen = await profile(st, au);
    // p0, p2, t e ph (a p1 está oculta).
    expect(seen.counts.posts).toBe(4);
    expect(mine.counts.posts).toBe(4);
    expect(mine.hiddenPosts).toBe(1);
    expect(seen.hiddenPosts).toBe(0);
    expect(await hiddenList(au)).toEqual([p1.id]);
    expect(await hiddenList(fb)).toEqual([]);
    const page = (await api().get('/api/v1/me/posts/hidden').set(auth(au)).expect(200)).body.items[0] as P;
    expect(page).toMatchObject({ id: p1.id, hidden: true, cheers: 1, comments: 1 });
  });

  it('os reposts e as citações dela desaparecem para todos', async () => {
    await one(st, repost.id).expect(404);
    await one(fb, repost.id).expect(404);
    expect(await profilePosts(st, fb, 'reposts')).not.toContain(repost.id);
    expect(await profilePosts(fb, fb, 'reposts')).not.toContain(repost.id);
    expect(await profilePosts(au, st, 'reposts')).not.toContain(quote.id);
    expect(await feedIds(au)).not.toContain(repost.id);
  });

  it('ninguém brinda, comenta, presenteia, reposta nem guarda; só o autor lê os comentários', async () => {
    for (const who of [fb, st, au]) {
      await api().post(`/api/v1/posts/${p1.id}/cheers`).set(auth(who)).expect(404);
      await api().post(`/api/v1/posts/${p1.id}/comments`).set(auth(who)).send({ body: 'olá' }).expect(404);
      await api().post(`/api/v1/posts/${p1.id}/repost`).set(auth(who)).send({}).expect(404);
      await api().put(`/api/v1/posts/${p1.id}/save`).set(auth(who)).expect(404);
    }
    await api().post(`/api/v1/posts/${p1.id}/gifts`).set(auth(fb)).set('Idempotency-Key', `oc-${run}-g`).send({ amount: 5 }).expect(404);
    await api().get(`/api/v1/posts/${p1.id}/comments`).set(auth(fb)).expect(404);
    expect((await api().get(`/api/v1/posts/${p1.id}/comments`).set(auth(au)).expect(200)).body.items).toHaveLength(1);
    await api().get(`/api/v1/posts/${p1.id}/people/cheers`).set(auth(st)).expect(404);
    expect((await api().get(`/api/v1/posts/${p1.id}/people/cheers`).set(auth(au)).expect(200)).body).toHaveLength(1);
  });

  it('nas conversas: não se partilha (nem pelo autor) e uma partilha antiga fica sem a publicação', async () => {
    await unhide(au, p1.id).expect(200);
    await api().post(`/api/v1/chat/with/${fb.username}`).set(auth(au)).send({ kind: 'post', body: p1.id }).expect(201);
    await hide(au, p1.id).expect(200);
    await api().post(`/api/v1/chat/with/${fb.username}`).set(auth(au)).send({ kind: 'post', body: p1.id }).expect(404);
    const thread = (await api().get(`/api/v1/chat/with/${au.username}`).set(auth(fb)).expect(200)).body as { items?: { kind: string; post?: unknown; body: string }[]; messages?: { kind: string; post?: unknown; body: string }[] };
    const msgs = (thread.items ?? thread.messages ?? []).filter((m) => m.kind === 'post' && m.body === p1.id);
    expect(msgs.length).toBeGreaterThan(0);
    for (const m of msgs) expect(m.post ?? null).toBeNull();
  });

  it('tchekas: sai dos Reels e do separador Tcheka; o mimo que partilhou a foto deixa de se ver', async () => {
    const mimos = async () => ((await api().get(`/api/v1/stories/user/${fb.username}`).set(auth(st)).expect(200)).body as unknown[]).length;
    expect(await mimos()).toBe(1);
    await hide(au, t.id).expect(200);
    await hide(au, ph.id).expect(200);
    expect(await reelsIds(fb)).not.toContain(t.id);
    expect(await profilePosts(fb, au, 'reels')).not.toContain(t.id);
    expect(await mimos()).toBe(0);
    await unhide(au, t.id).expect(200);
    await unhide(au, ph.id).expect(200);
    expect(await reelsIds(fb)).toContain(t.id);
    expect(await mimos()).toBe(1);
  });

  it('a equipa continua a vê-la, marcada como «oculta pelo autor»', async () => {
    const staff = await staffLogin(app, 'ocmod', ['moderacao']);
    const items = (await api().get('/api/v1/admin/mod/content').query({ author: au.username, type: 'post' }).set(auth(staff)).expect(200)).body.items as { id: string; hiddenByAuthor?: boolean }[];
    expect(items.find((i) => i.id === p1.id)?.hiddenByAuthor).toBe(true);
    expect(items.find((i) => i.id === p2.id)?.hiddenByAuthor).toBe(false);
  });

  it('a exportação dos dados leva as ocultas, com a marca', async () => {
    const exp = (await api().get('/api/v1/me/export').set(auth(au)).expect(200)).body as { posts: { id: string; hidden: boolean; hiddenAt: string | null }[] };
    const row = exp.posts.find((p) => p.id === p1.id)!;
    expect(row.hidden).toBe(true);
    expect(row.hiddenAt).toBeTruthy();
    expect(exp.posts.find((p) => p.id === p2.id)?.hidden).toBe(false);
  });

  it('voltar a mostrar: volta ao mesmo sítio, com os números e sem avisar ninguém', async () => {
    const notes = async (who: U) => ((await api().get('/api/v1/notifications').set(auth(who)).expect(200)).body.items as unknown[]).length;
    const before = { fb: await notes(fb), st: await notes(st) };
    const r = (await unhide(au, p1.id).expect(200)).body as P;
    // Duas: o repost simples de fb e a citação de st.
    expect(r).toMatchObject({ hidden: false, cheers: 1, comments: 1, reposts: 2 });
    expect((await unhide(au, p1.id).expect(200)).body.hidden).toBe(false);
    // A ordem do perfil é a de sempre (pela data): p2 antes de p1 antes de p0.
    const order = (await profilePosts(st, au)).filter((id) => [p0.id, p1.id, p2.id].includes(id));
    expect(order).toEqual([p2.id, p1.id, p0.id]);
    expect((await profile(st, au)).counts.posts).toBe(5);
    expect((await profile(au, au)).hiddenPosts).toBe(0);
    expect(await hiddenList(au)).toEqual([]);
    expect(await feedIds(fb)).toContain(p1.id);
    expect(await searchIds(st, word)).toContain(p1.id);
    expect((await tagPage(st)).posts).toBe(1);
    expect(await placeIds(st)).toContain(p1.id);
    expect((await one(st, repost.id).expect(200)).body.repostOf.id).toBe(p1.id);
    expect((await one(fb, p1.id).expect(200)).body).toMatchObject({ hidden: false, cheers: 1, comments: 1, reposts: 2 });
    expect({ fb: await notes(fb), st: await notes(st) }).toEqual(before);
    // E as interações voltam a funcionar.
    await api().post(`/api/v1/posts/${p1.id}/cheers`).set(auth(st)).expect(200);
  });

  it('o autor oculta o seu repost: só ele o vê, e repostar outra vez volta a mostrá-lo', async () => {
    expect((await hide(fb, repost.id).expect(200)).body.hidden).toBe(true);
    await one(st, repost.id).expect(404);
    expect(await profilePosts(st, fb, 'reposts')).not.toContain(repost.id);
    expect((await one(st, p1.id).expect(200)).body.reposts).toBe(1);
    const again = (await api().post(`/api/v1/posts/${p1.id}/repost`).set(auth(fb)).send({}).expect(201)).body as P;
    expect(again).toMatchObject({ id: repost.id, hidden: false });
    expect((await one(st, p1.id).expect(200)).body.reposts).toBe(2);
  });

  it('com o Bombar a decorrer não se oculta; quando acaba, já dá', async () => {
    const v = (await api().post('/api/v1/venues').set(auth(au)).send({ name: `Bar Oculto ${run}`, kind: 'bar', lat: -25.9, lng: 32.6, city: 'Maputo' }).expect(201)).body as { id: string; slug: string };
    await pool.query("UPDATE content.venues SET review_status = 'approved' WHERE id = $1", [v.id]);
    const vp = await publish(au, { body: `promoção ${run}`, venueId: v.id });
    const camp = (await pool.query(
      `INSERT INTO content.boost_campaigns (id, venue_id, target_kind, post_id, package, days, radius_km, starts_at, ends_at, price, status, created_by)
       VALUES (gen_random_uuid(), $1, 'post', $2, '1d', 1, 3, now() - interval '1 hour', now() + interval '1 day', 100, 'active', $3) RETURNING id`,
      [v.id, vp.id, au.id],
    )).rows[0].id as string;
    const r = await hide(au, vp.id).expect(409);
    expect(r.body.message).toBe(HIDE_BOOSTED);
    expect((await one(au, vp.id).expect(200)).body.hidden).toBe(false);
    // Uma campanha marcada para mais tarde também conta.
    await pool.query(`UPDATE content.boost_campaigns SET starts_at = now() + interval '1 day', ends_at = now() + interval '2 days' WHERE id = $1`, [camp]);
    await hide(au, vp.id).expect(409);
    await pool.query(`UPDATE content.boost_campaigns SET status = 'stopped', stopped_at = now() WHERE id = $1`, [camp]);
    expect((await hide(au, vp.id).expect(200)).body.hidden).toBe(true);
    // Oculta, não entra nas publicações que o local pode bombar nem na página do local.
    expect(ids((await api().get(`/api/v1/venues/${v.slug}/posts`).set(auth(st)).expect(200)).body.items)).not.toContain(vp.id);
    const opts = (await api().get(`/api/v1/boosts/venue/${v.slug}/options`).set(auth(au))).body as { posts?: { id: string }[] };
    if (opts.posts) expect(ids(opts.posts)).not.toContain(vp.id);
    // Voltar a mostrar é sempre possível.
    expect((await unhide(au, vp.id).expect(200)).body.hidden).toBe(false);
  });

  it('apagar uma oculta continua a dar; depois já não se mostra', async () => {
    const x = await publish(au, { body: `para apagar ${run}` });
    await hide(au, x.id).expect(200);
    await api().delete(`/api/v1/posts/${x.id}`).set(auth(au)).expect(204);
    await unhide(au, x.id).expect(404);
    await one(au, x.id).expect(404);
    expect(await hiddenList(au)).not.toContain(x.id);
  });
});
