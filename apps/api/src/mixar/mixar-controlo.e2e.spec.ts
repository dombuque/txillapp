import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Pool } from 'pg';
import sharp from 'sharp';
import { uuidv7 } from '../common/uuid7';
import { loadConfig } from '../config';
import { migrate } from '../db/migrate';
import { createApp } from '../main';
import { loadControl } from './mixar-controlo';
import { MixarControloService } from './mixar-controlo.service';
import { mixarDay } from './mixar-pick';
import { MixarService } from './mixar.service';

const DB = process.env.TEST_DATABASE_URL ?? 'postgres://txill:txill_dev@localhost:5433/txillapp_test';
const PASSWORD = 'password-bem-longa-1';

interface U { token: string; id: string; username: string; ip: string }
type Item = { post: { id: string }; from: string; topic: { topic: string; label: string } | null };

/**
 * Mixar, controlo e resumo (0172, docs/mixar-contrato.md, «Controlo e resumo»), de ponta a ponta: os temas privados (que
 * nunca chegam ao outro: nem no match e temas em comum, nem nas razões dos itens, nem no resumo da semana), tirar e voltar a
 * pôr um tema no Mixar (sai logo do feed e da seleção seguinte, dos dois), «Menos disto» num item (o tema e o autor), o
 * resumo da semana (o mais reagido, os acertos, a série, os temas, os vídeos vistos), a imagem e a partilha no Zás e nos
 * mimos, e a exportação.
 *
 * Os gostos usam temas que mais nenhum teste usa (fe, historia, solidariedade, cabelo).
 */
describe('Mixar: controlo dos temas, temas privados e resumo da semana (integração)', () => {
  let app: INestApplication;
  let pool: Pool;
  let svc: MixarService;
  let ctl: MixarControloService;
  const run = Date.now().toString(36);
  const api = () => request(app.getHttpServer());
  const auth = (x: U) => ({ Authorization: `Bearer ${x.token}`, 'X-Forwarded-For': x.ip });
  const u: Record<string, U> = {};
  let n = 0;

  async function signup(name: string, display?: string): Promise<U> {
    const username = `${name}${run}`.slice(0, 28);
    n++;
    const ip = `10.172.${n >> 8}.${n & 255}`;
    const r = await api().post('/api/v1/auth/register').set('X-Forwarded-For', ip)
      .send({ email: `${username}@example.com`, username, displayName: display ?? `${name[0].toUpperCase()}${name.slice(1)} Teste`, password: PASSWORD, birthDate: '1990-06-15', acceptTerms: true }).expect(201);
    await pool.query('UPDATE identity.users SET email_verified_at = now() WHERE id = $1', [r.body.user.id]);
    return { token: r.body.accessToken, id: r.body.user.id, username, ip };
  }
  const follow = (a: U, b: U) => api().post(`/api/v1/users/${b.username}/follow`).set(auth(a)).expect(200);
  const mutual = async (a: U, b: U) => { await follow(a, b); await follow(b, a); };
  const prefs = (x: U, topics: string[]) => Promise.all(topics.map((t) => pool.query('INSERT INTO social.explore_prefs (user_id, topic, pref) VALUES ($1, $2, 1) ON CONFLICT DO NOTHING', [x.id, t])));
  const feed = async (x: U, id: string) => (await api().get(`/api/v1/mixar/${id}/feed?limit=24`).set(auth(x)).expect(200)).body as { items: Item[] };
  const head = async (x: U, id: string) => (await api().get(`/api/v1/mixar/${id}`).set(auth(x)).expect(200)).body as { match: number; common: { topic: string }[]; onlyMe: { topic: string }[]; onlyThem: { topic: string }[] };
  const topicsOf = (h: { common: { topic: string }[]; onlyMe: { topic: string }[]; onlyThem: { topic: string }[] }) => [...h.common, ...h.onlyMe, ...h.onlyThem].map((t) => t.topic);

  async function tcheka(author: U, topics: string[], hours = 2) {
    const media = (await pool.query(`INSERT INTO content.media_assets (id, owner_id, mime, size_bytes, storage_key, status, duration_ms, width, height) VALUES (gen_random_uuid(), $1, 'video/mp4', 1, 'x', 'ready', 5000, 720, 1280) RETURNING id`, [author.id])).rows[0].id as string;
    const id = uuidv7(Date.now() - hours * 3_600_000);
    await pool.query(`INSERT INTO content.posts (id, author_id, body, topics, created_at) VALUES ($1, $2, $3, $4, now() - make_interval(hours => $5))`, [id, author.id, `tcheka ${topics.join(' ')}`, topics, hours]);
    await pool.query('INSERT INTO content.post_media (post_id, media_id, position) VALUES ($1, $2, 0)', [id, media]);
    return id;
  }

  const P: Record<string, string> = {};
  const authors: U[] = [];
  let mx = '';

  beforeAll(async () => {
    await migrate(DB);
    pool = new Pool({ connectionString: DB });
    app = await createApp(loadConfig({ DATABASE_URL: DB, JWT_ACCESS_SECRET: 'c'.repeat(40), NODE_ENV: 'test', MEDIA_DIR: './uploads-test' }));
    await app.init();
    svc = app.get(MixarService);
    ctl = app.get(MixarControloService);

    u.dom = await signup('cdom', 'Dom Teste');
    u.ana = await signup('cana', 'Ana Teste');
    u.rui = await signup('crui');
    for (let i = 0; i < 8; i++) authors.push(await signup(`cau${i}x`));
    await mutual(u.dom, u.ana);
    // Dom: história e fé; Ana: história e solidariedade (e cabelo, um pouco).
    await prefs(u.dom, ['historia', 'fe']);
    await prefs(u.ana, ['historia', 'solidariedade']);
    await pool.query(`UPDATE content.posts SET removed_at = now(), removed_by = 'author' WHERE topics && ARRAY['fe', 'historia', 'solidariedade', 'cabelo'] AND removed_at IS NULL`);
    for (let i = 0; i < 3; i++) for (let k = 0; k < 2; k++) P[`hist${i}${k}`] = await tcheka(authors[i], ['historia'], 1 + i + k);
    for (let i = 3; i < 5; i++) for (let k = 0; k < 2; k++) P[`fe${i}${k}`] = await tcheka(authors[i], ['fe'], 2 + k);
    for (let i = 5; i < 7; i++) for (let k = 0; k < 2; k++) P[`sol${i}${k}`] = await tcheka(authors[i], ['solidariedade'], 2 + k);
    // Para os dias seguintes (a seleção não repete o que já saiu): mais de cada tema, de outro autor.
    for (let k = 0; k < 3; k++) {
      P[`histB${k}`] = await tcheka(authors[7], ['historia'], 5 + k);
      P[`feB${k}`] = await tcheka(authors[7], ['fe'], 5 + k);
      P[`solB${k}`] = await tcheka(authors[7], ['solidariedade'], 5 + k);
    }
    mx = (await api().post('/api/v1/mixar/invite').set(auth(u.dom)).send({ username: u.ana.username }).expect(201)).body.id;
    await api().post(`/api/v1/mixar/${mx}/accept`).set(auth(u.ana)).expect(200);
  }, 180_000);

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  it('antes: a fé do Dom aparece ao Dom e à Ana (só do Dom), com a razão nos itens', async () => {
    expect(topicsOf(await head(u.dom, mx))).toContain('fe');
    expect((await head(u.ana, mx)).onlyThem.map((t) => t.topic)).toContain('fe');
    const f = await feed(u.ana, mx);
    expect(f.items.some((i) => i.topic?.topic === 'fe')).toBe(true);
  });

  it('temas privados: GET/PUT /me/mixar/private-topics (só meus; temas desconhecidos dão 400)', async () => {
    const empty = (await api().get('/api/v1/me/mixar/private-topics').set(auth(u.dom)).expect(200)).body;
    expect(empty.topics).toEqual([]);
    expect(empty.all.length).toBeGreaterThan(30);
    expect(empty.all).toContainEqual({ topic: 'fe', label: 'Fé' });
    await api().put('/api/v1/me/mixar/private-topics').set(auth(u.dom)).send({ topics: ['fe', 'nao-existe'] }).expect(400);
    await api().put('/api/v1/me/mixar/private-topics').set(auth(u.dom)).send({ topics: 'fe' }).expect(400);
    const r = (await api().put('/api/v1/me/mixar/private-topics').set(auth(u.dom)).send({ topics: ['fe', 'fe', 'cabelo'] }).expect(200)).body;
    expect(r.topics.map((t: { topic: string }) => t.topic).sort()).toEqual(['cabelo', 'fe']);
    // Substitui a lista.
    const r2 = (await api().put('/api/v1/me/mixar/private-topics').set(auth(u.dom)).send({ topics: ['fe'] }).expect(200)).body;
    expect(r2.topics).toEqual([{ topic: 'fe', label: 'Fé' }]);
    expect((await api().get('/api/v1/me/mixar/private-topics').set(auth(u.ana)).expect(200)).body.topics).toEqual([]);
    await api().get('/api/v1/me/mixar/private-topics').expect(401);
  });

  it('um tema privado nunca aparece ao outro: nem nos temas do cabeçalho, nem nas razões do feed, nem na seleção seguinte', async () => {
    // O cabeçalho, dos dois lados.
    expect(topicsOf(await head(u.dom, mx))).not.toContain('fe');
    expect(topicsOf(await head(u.ana, mx))).not.toContain('fe');
    // As razões já guardadas hoje ficam sem tema (para os dois).
    for (const x of [u.ana, u.dom]) {
      const f = await feed(x, mx);
      expect(f.items.length).toBeGreaterThan(0);
      expect(f.items.some((i) => i.topic?.topic === 'fe')).toBe(false);
      expect(JSON.stringify(f.items.map((i) => i.topic))).not.toContain('"fe"');
    }
    // A seleção de amanhã: nada que venha do gosto «fé» do Dom (com razão fé).
    const tomorrow = new Date(Date.now() + 86_400_000);
    await svc.runDaily({ now: tomorrow });
    const t = (await pool.query('SELECT topic, source FROM social.mixar_items WHERE mixar_id = $1 AND day = $2::date', [mx, mixarDay(tomorrow)])).rows;
    expect(t.length).toBeGreaterThan(0);
    expect(t.map((r) => r.topic)).not.toContain('fe');
    // O match também deixa de contar com a fé (o Dom fica só com a história).
    const h = await head(u.ana, mx);
    expect(h.common.map((c) => c.topic)).toEqual(['historia']);
  });

  it('integração: nos Guardados (0171) a razão também fica sem o tema privado', async () => {
    const fe = (await pool.query(`SELECT i.post_id FROM social.mixar_items i JOIN content.posts p ON p.id = i.post_id WHERE i.mixar_id = $1 AND i.topic = 'fe' AND p.removed_at IS NULL LIMIT 1`, [mx])).rows[0]?.post_id as string | undefined;
    expect(fe).toBeDefined();
    await api().post(`/api/v1/mixar/${mx}/saved/${fe}`).set(auth(u.ana)).expect(200);
    const saved = (await api().get(`/api/v1/mixar/${mx}/saved`).set(auth(u.ana)).expect(200)).body as { items: Item[] };
    const it = saved.items.find((i) => i.post.id === fe);
    expect(it).toBeDefined();
    expect(it!.topic).toBeNull();
    await api().delete(`/api/v1/mixar/${mx}/saved/${fe}`).set(auth(u.ana)).expect(200);
  });

  it('afinar os temas: tirar um tema («off») sai logo do feed dos dois e do cabeçalho; só quem o tirou o volta a pôr', async () => {
    const before = await feed(u.dom, mx);
    const sol = Object.entries(P).filter(([k]) => k.startsWith('sol')).map(([, v]) => v);
    expect(before.items.some((i) => sol.includes(i.post.id))).toBe(true);
    const r = (await api().put(`/api/v1/mixar/${mx}/topics`).set(auth(u.ana)).send({ topic: 'solidariedade', mode: 'off' }).expect(200)).body;
    expect(r.mine).toEqual([{ topic: 'solidariedade', label: 'Solidariedade', mode: 'off' }]);
    expect(r.theirsOff).toEqual([]);
    for (const x of [u.dom, u.ana]) expect((await feed(x, mx)).items.some((i) => sol.includes(i.post.id))).toBe(false);
    expect(topicsOf(await head(u.dom, mx))).not.toContain('solidariedade');
    // O «Mais 5» (0171) também não traz nada do tema tirado.
    const today = async () => new Set((await pool.query('SELECT post_id FROM social.mixar_items WHERE mixar_id = $1 AND day = $2::date', [mx, mixarDay()])).rows.map((x) => x.post_id as string));
    const had = await today();
    await api().post(`/api/v1/mixar/${mx}/more`).set(auth(u.dom)).expect(200);
    for (const id of await today()) if (!had.has(id)) expect(sol).not.toContain(id);
    const domView = (await api().get(`/api/v1/mixar/${mx}/topics`).set(auth(u.dom)).expect(200)).body;
    expect(domView.theirsOff).toEqual([{ topic: 'solidariedade', label: 'Solidariedade' }]);
    expect(domView.mine).toEqual([]);
    // O Dom «volta a pôr»: só tira a escolha dele (não tinha nenhuma); continua fora.
    await api().put(`/api/v1/mixar/${mx}/topics`).set(auth(u.dom)).send({ topic: 'solidariedade', mode: null }).expect(200);
    expect((await feed(u.dom, mx)).items.some((i) => sol.includes(i.post.id))).toBe(false);

    // A seleção seguinte também não tem nada de solidariedade.
    const later = new Date(Date.now() + 2 * 86_400_000);
    await svc.runDaily({ now: later });
    const ids = (await pool.query('SELECT post_id FROM social.mixar_items WHERE mixar_id = $1 AND day = $2::date', [mx, mixarDay(later)])).rows.map((x) => x.post_id as string);
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) expect(sol).not.toContain(id);

    // A Ana volta a pôr: o feed de hoje mostra outra vez.
    const back = (await api().put(`/api/v1/mixar/${mx}/topics`).set(auth(u.ana)).send({ topic: 'solidariedade', mode: null }).expect(200)).body;
    expect(back.mine).toEqual([]);
    expect((await feed(u.dom, mx)).items.some((i) => sol.includes(i.post.id))).toBe(true);
    // Erros: tema desconhecido, modo inválido, quem não é do Mixar.
    await api().put(`/api/v1/mixar/${mx}/topics`).set(auth(u.ana)).send({ topic: 'nao-existe', mode: 'off' }).expect(400);
    await api().put(`/api/v1/mixar/${mx}/topics`).set(auth(u.ana)).send({ topic: 'fe', mode: 'nunca' }).expect(400);
    await api().get(`/api/v1/mixar/${mx}/topics`).set(auth(u.rui)).expect(404);
  });

  it('«Menos disto» num item: o tema do item e o autor pesam menos neste Mixar (sem mexer no feed normal)', async () => {
    const f = await feed(u.dom, mx);
    const it = f.items.find((i) => i.topic?.topic === 'historia')!;
    expect(it).toBeDefined();
    const r = (await api().post(`/api/v1/mixar/${mx}/items/${it.post.id}/less`).set(auth(u.dom)).expect(200)).body;
    const author = (await pool.query('SELECT author_id FROM content.posts WHERE id = $1', [it.post.id])).rows[0].author_id as string;
    const a = authors.find((x) => x.id === author)!;
    expect(r.topic).toEqual({ topic: 'historia', label: 'História e cultura' });
    expect(r.author).toMatchObject({ username: a.username, verified: false, verifiedTier: null });
    expect(r.topics.mine).toEqual([{ topic: 'historia', label: 'História e cultura', mode: 'less' }]);
    expect(r.topics.lessAuthors).toBe(1);
    const c = await loadControl(pool, mx, u.dom.id, u.ana.id);
    expect([...c.less]).toEqual(['historia']);
    expect([...c.lessAuthors]).toEqual([author]);
    // Um 'off' não passa a 'less'.
    await api().put(`/api/v1/mixar/${mx}/topics`).set(auth(u.dom)).send({ topic: 'historia', mode: 'off' }).expect(200);
    expect((await api().post(`/api/v1/mixar/${mx}/items/${it.post.id}/less`).set(auth(u.dom)).expect(200)).body.topics.mine).toEqual([{ topic: 'historia', label: 'História e cultura', mode: 'off' }]);
    // Afinal não: volta a 'less' pelo PUT.
    await api().put(`/api/v1/mixar/${mx}/topics`).set(auth(u.dom)).send({ topic: 'historia', mode: 'less' }).expect(200);
    // As preferências do feed normal não mudaram.
    expect((await pool.query("SELECT pref FROM social.explore_prefs WHERE user_id = $1 AND topic = 'historia'", [u.dom.id])).rows[0].pref).toBe(1);
    // Fora do Mixar ou de quem não é do Mixar: 404.
    const other = await tcheka(authors[0], ['historia']);
    await api().post(`/api/v1/mixar/${mx}/items/${other}/less`).set(auth(u.dom)).expect(404);
    await api().post(`/api/v1/mixar/${mx}/items/${it.post.id}/less`).set(auth(u.rui)).expect(404);
  });

  it('«Menos disto» com o tema privado de um dos dois: não guarda o tema (só o autor) e não o mostra', async () => {
    const fe = (await pool.query(`SELECT i.post_id FROM social.mixar_items i JOIN content.posts p ON p.id = i.post_id WHERE i.mixar_id = $1 AND i.day = $2::date AND p.topics = ARRAY['fe']`, [mx, mixarDay()])).rows[0]?.post_id as string | undefined;
    if (!fe) return; // sem itens de fé hoje (não deve acontecer)
    const r = (await api().post(`/api/v1/mixar/${mx}/items/${fe}/less`).set(auth(u.ana)).expect(200)).body;
    expect(r.topic).toBeNull();
    expect(r.topics.mine.map((t: { topic: string }) => t.topic)).not.toContain('fe');
  });

  it('o resumo da semana: o mais reagido pelos dois, os acertos no desafio, a série, os temas (sem os privados) e os vídeos vistos', async () => {
    const { dom, ana } = u;
    const feIds = (await pool.query("SELECT id FROM content.posts WHERE 'fe' = ANY(topics)")).rows.map((r) => r.id as string);
    const f = await feed(dom, mx);
    const [x, y, z] = f.items.map((i) => i.post.id).filter((id) => !feIds.includes(id));
    await api().post(`/api/v1/mixar/${mx}/items/${y}/react`).set(auth(dom)).send({ reaction: 'kkk' }).expect(200);
    await api().post(`/api/v1/mixar/${mx}/items/${x}/react`).set(auth(dom)).send({ reaction: 'fogo' }).expect(200);
    await api().post(`/api/v1/mixar/${mx}/items/${x}/react`).set(auth(ana)).send({ reaction: 'amor' }).expect(200);
    await api().post(`/api/v1/mixar/${mx}/items/${z}/react`).set(auth(ana)).send({ reaction: 'nah' }).expect(200);
    for (const p of [x, y, z]) await api().post(`/api/v1/mixar/${mx}/items/${p}/seen`).set(auth(dom)).send({ watchedMs: 5000, done: true }).expect(204);
    await api().post(`/api/v1/mixar/${mx}/items/${x}/seen`).set(auth(ana)).send({ watchedMs: 5000, done: true }).expect(204);
    // A Ana reage e vê uma tcheka de fé (o tema privado do Dom): mesmo assim, a fé não entra nos temas da semana.
    const fe = (await pool.query(`SELECT i.post_id FROM social.mixar_items i JOIN content.posts p ON p.id = i.post_id WHERE i.mixar_id = $1 AND i.day = $2::date AND 'fe' = ANY(p.topics) AND p.removed_at IS NULL`, [mx, mixarDay()])).rows[0]?.post_id as string;
    expect(fe).toBeDefined();
    await api().post(`/api/v1/mixar/${mx}/items/${fe}/react`).set(auth(ana)).send({ reaction: 'uau' }).expect(200);
    await api().post(`/api/v1/mixar/${mx}/items/${fe}/shared`).set(auth(ana)).expect(204);
    // O desafio de hoje: os dois escolhem o mesmo.
    const c = (await api().get(`/api/v1/mixar/${mx}/challenge`).set(auth(dom)).expect(200)).body;
    await api().post(`/api/v1/mixar/${mx}/challenge/${c.id}/pick`).set(auth(dom)).send({ postId: c.options[0].id }).expect(200);
    await api().post(`/api/v1/mixar/${mx}/challenge/${c.id}/pick`).set(auth(ana)).send({ postId: c.options[0].id }).expect(200);

    const w = (await api().get(`/api/v1/mixar/${mx}/week`).set(auth(dom)).expect(200)).body;
    expect(w.to).toBe(mixarDay());
    expect(w.label).toEqual(expect.any(String));
    expect(w.recapDay).toBe(new Date(`${w.to}T12:00:00Z`).getUTCDay() === 1);
    expect(w.top).toMatchObject({ post: { id: x }, mine: 'fogo', theirs: 'amor' });
    expect(w.challenge).toEqual({ offered: 1, played: 1, matches: 1 });
    expect(w.streak).toBe(1);
    expect(w.videos).toBe(4); // x, y, z (o Dom) e a de fé (a Ana mandou-a para o chat)
    expect(w.together).toBe(1);
    expect(w.topics.length).toBeGreaterThan(0);
    const wa = (await api().get(`/api/v1/mixar/${mx}/week`).set(auth(ana)).expect(200)).body;
    expect(wa.top).toMatchObject({ post: { id: x }, mine: 'amor', theirs: 'fogo' });
    for (const v of [w, wa]) expect(v.topics.map((t: { topic: string }) => t.topic)).not.toContain('fe');
    expect(JSON.stringify(wa)).not.toContain('"Fé"');
    // Sem o tema privado, a fé já entrava nos temas da Ana.
    await api().put('/api/v1/me/mixar/private-topics').set(auth(dom)).send({ topics: [] }).expect(200);
    expect((await api().get(`/api/v1/mixar/${mx}/week`).set(auth(ana)).expect(200)).body.topics.map((t: { topic: string }) => t.topic)).toContain('fe');
    await api().put('/api/v1/me/mixar/private-topics').set(auth(dom)).send({ topics: ['fe'] }).expect(200);
    // Numa segunda-feira, recapDay.
    const monday = new Date('2026-11-16T10:00:00Z');
    expect((await ctl.week(dom.id, mx, monday)).recapDay).toBe(true);
    expect((await ctl.week(dom.id, mx, new Date('2026-11-17T10:00:00Z'))).recapDay).toBe(false);
    await api().get(`/api/v1/mixar/${mx}/week`).set(auth(u.rui)).expect(404);
  });

  it('a imagem do cartão (JPEG 1080×1920) e a partilha no Zás e nos mimos', async () => {
    const { dom } = u;
    const img = await api().get(`/api/v1/mixar/${mx}/week/image`).set(auth(dom)).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    }).expect(200);
    expect(img.headers['content-type']).toBe('image/jpeg');
    const meta = await sharp(img.body as Buffer).metadata();
    expect([meta.width, meta.height]).toEqual([1080, 1920]);

    const s = (await api().post(`/api/v1/mixar/${mx}/week/share`).set(auth(dom)).send({ to: 'story' }).expect(201)).body;
    expect(s.to).toBe('story');
    const story = (await pool.query('SELECT author_id, audience, media_id FROM content.stories WHERE id = $1', [s.id])).rows[0];
    expect(story).toMatchObject({ author_id: dom.id, audience: 'all' });
    expect((await pool.query('SELECT purpose, mime, signed FROM content.media_assets WHERE id = $1', [story.media_id])).rows[0]).toEqual({ purpose: 'public', mime: 'image/jpeg', signed: true });

    const zz = (await api().post(`/api/v1/mixar/${mx}/week/share`).set(auth(dom)).send({ to: 'zas' }).expect(201)).body;
    expect(zz.to).toBe('zas');
    expect((await pool.query('SELECT author_id, audience FROM social.instants WHERE id = $1', [zz.id])).rows[0]).toEqual({ author_id: dom.id, audience: 'friends' });
    await api().post(`/api/v1/mixar/${mx}/week/share`).set(auth(dom)).send({ to: 'feed' }).expect(400);
    await api().post(`/api/v1/mixar/${mx}/week/share`).set(auth(u.rui)).send({ to: 'zas' }).expect(404);
  }, 60_000);

  it('a exportação traz os temas afinados, os autores com «menos» e os temas privados (só os meus)', async () => {
    const r = (await api().get('/api/v1/me/export').set(auth(u.dom)).expect(200)).body;
    expect(r.mixarTopicPrefs).toEqual(expect.arrayContaining([expect.objectContaining({ mixarId: mx, topic: 'historia', mode: 'less' })]));
    expect(r.mixarAuthorLess.length).toBeGreaterThanOrEqual(1);
    expect(r.mixarPrivateTopics).toEqual([expect.objectContaining({ topic: 'fe' })]);
    const a = (await api().get('/api/v1/me/export').set(auth(u.ana)).expect(200)).body;
    expect(a.mixarPrivateTopics).toEqual([]);
    // Eliminar a conta leva tudo (CASCADE).
    await api().post('/api/v1/auth/delete-account').set(auth(u.dom)).send({ confirmUsername: u.dom.username, password: PASSWORD }).expect(204);
    for (const t of ['mixar_private_topics', 'mixar_topic_prefs', 'mixar_author_less']) {
      expect((await pool.query(`SELECT count(*)::int AS n FROM social.${t} WHERE user_id = $1`, [u.dom.id])).rows[0].n).toBe(0);
    }
  });
});
