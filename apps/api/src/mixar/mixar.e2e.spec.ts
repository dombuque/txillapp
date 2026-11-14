import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Pool } from 'pg';
import webpush from 'web-push';
import { ChatEvents, type StreamEvent } from '../chat/chat.events';
import { uuidv7 } from '../common/uuid7';
import { loadConfig } from '../config';
import { migrate } from '../db/migrate';
import { createApp } from '../main';
import { mixarDay, prevDay } from './mixar-pick';
import { MixarService } from './mixar.service';

const DB = process.env.TEST_DATABASE_URL ?? 'postgres://txill:txill_dev@localhost:5433/txillapp_test';
const PASSWORD = 'password-bem-longa-1';

interface U { token: string; id: string; username: string; ip: string }

/**
 * Mixar (0150, docs/mixar-contrato.md), de ponta a ponta: o convite (com o cartão no chat), aceitar, recusar e sair, um Mixar
 * por par (409 com o id), os limites, o feed só com o que os dois veem (conta privada, bloqueio, removida, escondida, as
 * publicações dos próprios) e reavaliado em cada leitura, `from` me/them/both, as reações só para os dois, o desafio que só
 * se revela quando os dois escolheram, a série e os «match», a tarefa diária, os eventos e os avisos no telemóvel, a
 * exportação e a eliminação da conta.
 *
 * Os gostos usam temas que mais nenhum teste usa (pesca, agricultura, casamentos), com as preferências do Explorar, para as
 * publicações deste teste ficarem à frente mesmo com as dos outros testes na mesma base.
 */
describe('Mixar: o feed a dois (integração)', () => {
  let app: INestApplication;
  let pool: Pool;
  let svc: MixarService;
  const run = Date.now().toString(36);
  const api = () => request(app.getHttpServer());
  const auth = (x: U) => ({ Authorization: `Bearer ${x.token}`, 'X-Forwarded-For': x.ip });
  const u: Record<string, U> = {};
  const sent: { endpoint: string; payload: { title: string; body: string; url: string; tag?: string } }[] = [];
  const emitted: { to: string; e: StreamEvent }[] = [];
  let n = 0;

  async function signup(name: string, display?: string): Promise<U> {
    const username = `${name}${run}`.slice(0, 28);
    n++;
    const ip = `10.150.${n >> 8}.${n & 255}`;
    const r = await api().post('/api/v1/auth/register').set('X-Forwarded-For', ip)
      .send({ email: `${username}@example.com`, username, displayName: display ?? `${name[0].toUpperCase()}${name.slice(1)} Teste`, password: PASSWORD, birthDate: '1990-06-15', acceptTerms: true }).expect(201);
    await pool.query('UPDATE identity.users SET email_verified_at = now() WHERE id = $1', [r.body.user.id]);
    return { token: r.body.accessToken, id: r.body.user.id, username, ip };
  }
  const follow = (a: U, b: U) => api().post(`/api/v1/users/${b.username}/follow`).set(auth(a)).expect(200);
  const mutual = async (a: U, b: U) => { await follow(a, b); await follow(b, a); };
  const pushTo = (x: U) => api().post('/api/v1/push/subscribe').set(auth(x)).send({ endpoint: `https://push.example.com/${run}/${x.username}`, keys: { p256dh: 'p'.repeat(20), auth: 'a'.repeat(16) } }).expect(204);
  const pushesTo = (x: U) => sent.filter((s) => s.endpoint.endsWith(`/${x.username}`));
  const mixarEvents = (x: U, id: string) => emitted.filter((e) => e.to === x.id && e.e.type === 'mixar' && e.e.id === id).map((e) => e.e as { what: string; self?: boolean });
  const prefs = (x: U, topics: string[]) => Promise.all(topics.map((t) => pool.query('INSERT INTO social.explore_prefs (user_id, topic, pref) VALUES ($1, $2, 1) ON CONFLICT DO NOTHING', [x.id, t])));
  const thread = async (x: U, with_: U) => (await api().get(`/api/v1/chat/with/${with_.username}`).set(auth(x)).expect(200)).body as { items: { kind: string; body: string; mixar?: any }[] };
  const invite = (x: U, to: U) => api().post('/api/v1/mixar/invite').set(auth(x)).send({ username: to.username });
  const feed = async (x: U, id: string, q = '') => (await api().get(`/api/v1/mixar/${id}/feed${q}`).set(auth(x)).expect(200)).body as { items: { post: any; from: string; topic: any; mine: string | null; theirs: string | null; seenByThem: boolean }[]; nextCursor: string | null; day: string };
  const ids = (f: { items: { post: { id: string } }[] }) => f.items.map((i) => i.post.id);
  async function waitFor(check: () => boolean, ms = 3000) {
    for (let t = 0; t < ms && !check(); t += 50) await new Promise((r) => setTimeout(r, 50));
    expect(check()).toBe(true);
  }

  /** Uma tcheka (um só vídeo) com estes temas, publicada há `hours` horas. */
  async function tcheka(author: U, topics: string[], hours = 2) {
    const media = (await pool.query(`INSERT INTO content.media_assets (id, owner_id, mime, size_bytes, storage_key, status, duration_ms, width, height) VALUES (gen_random_uuid(), $1, 'video/mp4', 1, 'x', 'ready', 5000, 720, 1280) RETURNING id`, [author.id])).rows[0].id as string;
    const id = uuidv7(Date.now() - hours * 3_600_000);
    await pool.query(`INSERT INTO content.posts (id, author_id, body, topics, created_at) VALUES ($1, $2, $3, $4, now() - make_interval(hours => $5))`, [id, author.id, `tcheka ${topics.join(' ')}`, topics, hours]);
    await pool.query('INSERT INTO content.post_media (post_id, media_id, position) VALUES ($1, $2, 0)', [id, media]);
    return id;
  }

  // As publicações: pesca (dos dois), agricultura (só do Dom), casamentos (só da Ana), e as que nunca podem aparecer.
  const P: Record<string, string> = {};
  const authors: U[] = [];
  let mx = ''; // o Mixar do Dom com a Ana

  beforeAll(async () => {
    await migrate(DB);
    pool = new Pool({ connectionString: DB });
    const keys = webpush.generateVAPIDKeys();
    jest.spyOn(webpush, 'sendNotification').mockImplementation(async (s, payload) => {
      sent.push({ endpoint: (s as { endpoint: string }).endpoint, payload: JSON.parse(String(payload)) });
      return { statusCode: 201, body: '', headers: {} };
    });
    app = await createApp(loadConfig({ DATABASE_URL: DB, JWT_ACCESS_SECRET: 'm'.repeat(40), NODE_ENV: 'test', MEDIA_DIR: './uploads-test', VAPID_PUBLIC_KEY: keys.publicKey, VAPID_PRIVATE_KEY: keys.privateKey }));
    await app.init();
    svc = app.get(MixarService);
    const events = app.get(ChatEvents);
    const emit = events.emit.bind(events);
    jest.spyOn(events, 'emit').mockImplementation((to: string, e: StreamEvent) => {
      emitted.push({ to, e });
      emit(to, e);
    });

    u.dom = await signup('dom', 'Dom Teste');
    u.ana = await signup('ana', 'Ana Teste');
    for (const name of ['rui', 'eva', 'zed', 'pri', 'flip', 'blk', 'lia', 'leo']) u[name] = await signup(name);
    for (let i = 0; i < 8; i++) authors.push(await signup(`au${i}x`));
    const { dom, ana, rui, eva, lia, leo } = u;
    await mutual(dom, ana);
    await mutual(rui, eva);
    await mutual(lia, leo);
    for (const x of [dom, ana, rui]) await pushTo(x);
    await prefs(dom, ['pesca', 'agricultura']);
    await prefs(ana, ['pesca', 'casamentos']);

    // A base pode já ter publicações destes temas de uma corrida anterior deste teste: saem, para a seleção ser só desta.
    await pool.query(`UPDATE content.posts SET removed_at = now(), removed_by = 'author' WHERE topics && ARRAY['pesca', 'agricultura', 'casamentos'] AND removed_at IS NULL`);
    // 8 autores: 2 de pesca cada um nos 4 primeiros, agricultura e casamentos nos outros.
    for (let i = 0; i < 4; i++) for (let k = 0; k < 2; k++) P[`pesca${i}${k}`] = await tcheka(authors[i], ['pesca'], 1 + i + k);
    for (let i = 4; i < 6; i++) P[`agri${i}`] = await tcheka(authors[i], ['agricultura']);
    for (let i = 6; i < 8; i++) P[`casa${i}`] = await tcheka(authors[i], ['casamentos']);
    // Conta privada: o Dom segue, a Ana não. Nunca entra.
    await pool.query('UPDATE identity.users SET is_private = true WHERE id = $1', [u.pri.id]);
    await pool.query('INSERT INTO social.follows (follower_id, followee_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [dom.id, u.pri.id]);
    P.private = await tcheka(u.pri, ['pesca']);
    // Removida pela moderação, escondida pela Ana («não me interessa») e as dos próprios dois: nunca entram.
    P.removed = await tcheka(u.zed, ['pesca']);
    await pool.query(`UPDATE content.posts SET removed_at = now(), removed_by = 'moderation' WHERE id = $1`, [P.removed]);
    P.hidden = await tcheka(u.zed, ['pesca', 'casamentos']);
    P.domOwn = await tcheka(dom, ['pesca']);
    P.anaOwn = await tcheka(ana, ['pesca']);
    // Entram hoje, mas depois mudam (conta privada, bloqueio): saem na leitura seguinte.
    P.flip = await tcheka(u.flip, ['pesca']);
    P.blk = await tcheka(u.blk, ['pesca']);
    await api().post('/api/v1/feed/hide').set(auth(ana)).send({ postId: P.hidden }).expect(204);
  }, 180_000);

  afterAll(async () => {
    await app.close();
    await pool.end();
    jest.restoreAllMocks();
  });

  it('convite: cria o Mixar pendente e um cartão no chat (kind mixar), com o texto de cada lado, o aviso e os eventos', async () => {
    const { dom, ana } = u;
    const r = await invite(dom, ana).expect(201);
    mx = r.body.id;
    expect(r.body).toMatchObject({ status: 'pending', invitedByMe: true, name: 'Dom + Ana', partner: { username: ana.username, displayName: 'Ana Teste', hasAvatar: false, verified: false, verifiedTier: null }, newToday: 0, challengePending: false, acceptedAt: null, streak: 0, matches: 0 });
    expect(typeof r.body.match).toBe('number');

    const theirs = (await thread(ana, dom)).items.find((m) => m.kind === 'mixar')!;
    expect(theirs.body).toBe('Convidou-te para um Mixar');
    expect(theirs.mixar).toEqual({ id: mx, status: 'pending', invitedByMe: false, name: 'Ana + Dom' });
    const mine = (await thread(dom, ana)).items.find((m) => m.kind === 'mixar')!;
    expect(mine.body).toBe('Convidaste para um Mixar');
    expect(mine.mixar).toMatchObject({ id: mx, invitedByMe: true, name: 'Dom + Ana' });
    const list = (await api().get('/api/v1/chat/conversations').set(auth(ana)).expect(200)).body as { username: string; lastMessage: { body: string; kind: string } }[];
    expect(list.find((c) => c.username === dom.username)?.lastMessage).toMatchObject({ body: 'Convidou-te para um Mixar', kind: 'mixar' });
    const domList = (await api().get('/api/v1/chat/conversations').set(auth(dom)).expect(200)).body as { username: string; lastMessage: { body: string } }[];
    expect(domList.find((c) => c.username === ana.username)?.lastMessage.body).toBe('Convidaste para um Mixar');

    // Um só aviso no telemóvel (o do Mixar, com o endereço do Mixar; o do chat não vai).
    await waitFor(() => pushesTo(ana).length === 1);
    expect(pushesTo(ana)[0].payload).toMatchObject({ body: 'Dom Teste convidou-te para um Mixar', url: `/mixar/${mx}` });
    expect(mixarEvents(ana, mx)).toEqual([{ type: 'mixar', id: mx, what: 'invite' }]);
    expect(mixarEvents(dom, mx)).toEqual([{ type: 'mixar', id: mx, what: 'invite', self: true }]);

    // A lista: o convite que recebi aparece aos dois.
    const l = (await api().get('/api/v1/mixar').set(auth(ana)).expect(200)).body.items;
    expect(l.find((m: { id: string }) => m.id === mx)).toMatchObject({ status: 'pending', invitedByMe: false, name: 'Ana + Dom' });
  });

  it('um Mixar por par: 409 com o id, dos dois lados; GET /mixar/with/:username encontra-o', async () => {
    const { dom, ana, rui } = u;
    expect((await invite(dom, ana).expect(409)).body).toMatchObject({ id: mx });
    expect((await invite(ana, dom).expect(409)).body).toMatchObject({ id: mx });
    expect((await api().get(`/api/v1/mixar/with/${ana.username}`).set(auth(dom)).expect(200)).body.id).toBe(mx);
    expect((await api().get(`/api/v1/mixar/with/${dom.username}`).set(auth(ana)).expect(200)).body.id).toBe(mx);
    await api().get(`/api/v1/mixar/with/${rui.username}`).set(auth(dom)).expect(404);
    // De outra pessoa: 404. Num pendente, o feed ainda não abre.
    await api().get(`/api/v1/mixar/${mx}`).set(auth(rui)).expect(404);
    await api().get(`/api/v1/mixar/${mx}/feed`).set(auth(dom)).expect(409);
    await invite(dom, dom).expect(400);
    await api().post('/api/v1/mixar/invite').set(auth(dom)).send({ username: 'ninguem_que_exista_x' }).expect(404);
  });

  it('aceitar: só quem foi convidado; fica ativo, o cartão muda, o outro recebe o aviso e o evento; a seleção do dia fica pronta', async () => {
    const { dom, ana } = u;
    await api().post(`/api/v1/mixar/${mx}/accept`).set(auth(dom)).expect(403);
    const r = await api().post(`/api/v1/mixar/${mx}/accept`).set(auth(ana)).expect(200);
    expect(r.body).toMatchObject({ id: mx, status: 'active', invitedByMe: false });
    expect(r.body.acceptedAt).toEqual(expect.any(String));
    await api().post(`/api/v1/mixar/${mx}/accept`).set(auth(ana)).expect(409);
    expect((await thread(dom, ana)).items.find((m) => m.kind === 'mixar')!.mixar.status).toBe('active');
    await waitFor(() => pushesTo(dom).some((p) => p.payload.body === 'Ana Teste aceitou o vosso Mixar'));
    expect(pushesTo(dom).find((p) => p.payload.body === 'Ana Teste aceitou o vosso Mixar')!.payload.url).toBe(`/mixar/${mx}`);
    expect(mixarEvents(dom, mx).map((e) => e.what)).toContain('accepted');
    expect(mixarEvents(ana, mx)).toContainEqual({ type: 'mixar', id: mx, what: 'accepted', self: true });
    const days = (await pool.query('SELECT items FROM social.mixar_days WHERE mixar_id = $1 AND day = $2::date', [mx, mixarDay()])).rows;
    expect(days).toHaveLength(1);
    expect(days[0].items).toBeGreaterThanOrEqual(10);

    // O cabeçalho: o match e os temas em comum, o que é só de cada um.
    const m = (await api().get(`/api/v1/mixar/${mx}`).set(auth(dom)).expect(200)).body;
    expect(m.match).toBeGreaterThan(0);
    expect(m.common[0]).toEqual({ topic: 'pesca', label: 'Pesca e mar', score: 100 });
    expect(m.onlyMe.map((t: { topic: string }) => t.topic)).toContain('agricultura');
    expect(m.onlyThem.map((t: { topic: string }) => t.topic)).toContain('casamentos');
    expect(m.onlyThem[0]).toMatchObject({ label: expect.any(String) });
  });

  it('o feed: só o que os dois podem ver (privada, removida, escondida, as dos próprios), com a forma dos reels e `from` de cada lado', async () => {
    const { dom, ana } = u;
    const f = await feed(dom, mx, '?limit=24');
    expect(f.day).toBe(mixarDay());
    const got = ids(f);
    for (const k of ['private', 'removed', 'hidden', 'domOwn', 'anaOwn']) expect(got).not.toContain(P[k]);
    for (const k of ['flip', 'blk', 'agri4', 'agri5', 'casa6', 'casa7']) expect(got).toContain(P[k]);
    expect(got.filter((id) => Object.entries(P).some(([k, v]) => k.startsWith('pesca') && v === id)).length).toBeGreaterThanOrEqual(6);

    // `from` e o tema, do ponto de vista de quem pede.
    const of = (x: typeof f, id: string) => x.items.find((i) => i.post.id === id)!;
    expect(of(f, P.agri4)).toMatchObject({ from: 'me', topic: { topic: 'agricultura', label: 'Campo e agricultura' } });
    expect(of(f, P.casa6)).toMatchObject({ from: 'them', topic: { topic: 'casamentos', label: 'Casamentos' } });
    expect(of(f, P.flip)).toMatchObject({ from: 'both', topic: { topic: 'pesca' }, mine: null, theirs: null, seenByThem: false });
    const fa = await feed(ana, mx, '?limit=24');
    expect(of(fa, P.agri4).from).toBe('them');
    expect(of(fa, P.casa6).from).toBe('me');
    expect(ids(fa)).toEqual(got);

    // A mesma forma de GET /posts/reels (FeedPost, como GET /posts/:id).
    const one = (await api().get(`/api/v1/posts/${P.flip}`).set(auth(dom)).expect(200)).body;
    expect(Object.keys(of(f, P.flip).post).sort()).toEqual(Object.keys(one).sort());
    expect(of(f, P.flip).post).toEqual(one);

    // Paginação.
    const p1 = await feed(dom, mx, '?limit=5');
    expect(p1.items).toHaveLength(5);
    expect(p1.nextCursor).toBe('5');
    const p2 = await feed(dom, mx, `?limit=5&cursor=${p1.nextCursor}`);
    expect(ids(p2)).toEqual(got.slice(5, 10));
  });

  it('reações exclusivas: uma por pessoa, só os dois as veem, null tira; sem aviso no telemóvel', async () => {
    const { dom, ana, rui } = u;
    const before = pushesTo(ana).length;
    const r = await api().post(`/api/v1/mixar/${mx}/items/${P.agri4}/react`).set(auth(dom)).send({ reaction: 'kkk' }).expect(200);
    expect(r.body).toEqual({ mine: 'kkk', theirs: null });
    expect((await api().post(`/api/v1/mixar/${mx}/items/${P.agri4}/react`).set(auth(ana)).send({ reaction: 'fogo' }).expect(200)).body).toEqual({ mine: 'fogo', theirs: 'kkk' });
    expect((await api().post(`/api/v1/mixar/${mx}/items/${P.agri4}/react`).set(auth(dom)).send({ reaction: 'amor' }).expect(200)).body).toEqual({ mine: 'amor', theirs: 'fogo' });
    const item = (await feed(ana, mx, '?limit=24')).items.find((i) => i.post.id === P.agri4)!;
    expect(item).toMatchObject({ mine: 'fogo', theirs: 'amor' });
    // Não é um brinde na publicação.
    expect(item.post.cheers).toBe(0);
    expect(mixarEvents(ana, mx).map((e) => e.what)).toContain('reaction');
    // Quem não é do Mixar não reage (nem vê); uma publicação fora do Mixar, nem os dois; reação desconhecida: 400.
    await api().post(`/api/v1/mixar/${mx}/items/${P.agri4}/react`).set(auth(rui)).send({ reaction: 'kkk' }).expect(404);
    await api().post(`/api/v1/mixar/${mx}/items/${P.private}/react`).set(auth(dom)).send({ reaction: 'kkk' }).expect(404);
    await api().post(`/api/v1/mixar/${mx}/items/${P.agri4}/react`).set(auth(dom)).send({ reaction: 'like' }).expect(400);
    expect((await api().post(`/api/v1/mixar/${mx}/items/${P.agri4}/react`).set(auth(ana)).send({ reaction: null }).expect(200)).body).toEqual({ mine: null, theirs: 'amor' });
    await new Promise((res) => setTimeout(res, 200));
    expect(pushesTo(ana).length).toBe(before);
  });

  it('vistos e «mandou para o chat»: 204; o outro vê `seenByThem`; os novos de hoje descem; pesam no perfil do Mixar', async () => {
    const { dom, ana } = u;
    const newBefore = (await api().get(`/api/v1/mixar/${mx}`).set(auth(dom)).expect(200)).body.newToday as number;
    expect(newBefore).toBeGreaterThan(0);
    await api().post(`/api/v1/mixar/${mx}/items/${P.casa6}/seen`).set(auth(dom)).send({ watchedMs: 4000, done: true }).expect(204);
    await api().post(`/api/v1/mixar/${mx}/items/${P.casa6}/seen`).set(auth(dom)).send({ watchedMs: 1000 }).expect(204);
    await api().post(`/api/v1/mixar/${mx}/items/${P.casa6}/shared`).set(auth(dom)).expect(204);
    const v = (await pool.query('SELECT watched_ms, done, shared_at FROM social.mixar_views WHERE mixar_id = $1 AND post_id = $2 AND user_id = $3', [mx, P.casa6, dom.id])).rows[0];
    expect(v).toMatchObject({ watched_ms: 4000, done: true });
    expect(v.shared_at).not.toBeNull();
    expect((await feed(ana, mx, '?limit=24')).items.find((i) => i.post.id === P.casa6)!.seenByThem).toBe(true);
    expect((await feed(dom, mx, '?limit=24')).items.find((i) => i.post.id === P.casa6)!.seenByThem).toBe(false);
    expect((await api().get(`/api/v1/mixar/${mx}`).set(auth(dom)).expect(200)).body.newToday).toBe(newBefore - 1);
    const s = (await api().get('/api/v1/mixar').set(auth(dom)).expect(200)).body.items.find((m: { id: string }) => m.id === mx);
    expect(s.newToday).toBe(newBefore - 1);
    // O perfil do Mixar: casamentos subiu (visto até ao fim e mandado para o chat), agricultura também (as reações).
    const prof = await (svc as unknown as { mixarProfile: (id: string, day: string) => Promise<Record<string, number>> }).mixarProfile(mx, mixarDay());
    expect(prof.casamentos).toBeGreaterThan(3);
    expect(prof.agricultura).toBeGreaterThan(0);
  });

  let chId = '';
  it('o desafio: 3 ou 4 opções do dia; a escolha fica às escondidas até os dois escolherem; depois abre-se aos dois', async () => {
    const { dom, ana } = u;
    const c = (await api().get(`/api/v1/mixar/${mx}/challenge`).set(auth(dom)).expect(200)).body;
    chId = c.id;
    expect(c).toMatchObject({ day: mixarDay(), myPick: null, theirPicked: false, theirPick: null, match: null });
    expect(['mais_engracado', 'mais_txilado', 'partilhavas', 'repetias']).toContain(c.kind);
    expect(c.question).toEqual(expect.any(String));
    expect(c.options.length).toBeGreaterThanOrEqual(3);
    expect(c.options.length).toBeLessThanOrEqual(4);
    const day = ids(await feed(dom, mx, '?limit=24'));
    for (const o of c.options) expect(day).toContain(o.id);
    expect((await api().get('/api/v1/mixar').set(auth(dom)).expect(200)).body.items.find((m: { id: string }) => m.id === mx).challengePending).toBe(true);

    const opt = c.options[0].id as string;
    await api().post(`/api/v1/mixar/${mx}/challenge/${chId}/pick`).set(auth(dom)).send({ postId: P.private }).expect(400);
    const mine = (await api().post(`/api/v1/mixar/${mx}/challenge/${chId}/pick`).set(auth(dom)).send({ postId: opt }).expect(200)).body;
    expect(mine).toMatchObject({ myPick: opt, theirPicked: false, theirPick: null, match: null });
    expect(mixarEvents(ana, mx).map((e) => e.what)).toContain('pick');
    const seen = (await api().get(`/api/v1/mixar/${mx}/challenge`).set(auth(ana)).expect(200)).body;
    expect(seen).toMatchObject({ myPick: null, theirPicked: true, theirPick: null, match: null });
    expect((await api().get('/api/v1/mixar').set(auth(dom)).expect(200)).body.items.find((m: { id: string }) => m.id === mx).challengePending).toBe(false);

    const before = pushesTo(dom).length;
    const res = (await api().post(`/api/v1/mixar/${mx}/challenge/${chId}/pick`).set(auth(ana)).send({ postId: opt }).expect(200)).body;
    expect(res).toMatchObject({ myPick: opt, theirPicked: true, theirPick: opt, match: true });
    expect((await api().get(`/api/v1/mixar/${mx}/challenge`).set(auth(dom)).expect(200)).body).toMatchObject({ myPick: opt, theirPick: opt, match: true });
    await waitFor(() => pushesTo(dom).length === before + 1);
    expect(pushesTo(dom)[before].payload).toMatchObject({ body: 'Escolheram o mesmo!', url: `/mixar/${mx}` });
    expect(mixarEvents(dom, mx).map((e) => e.what)).toContain('result');
    expect(mixarEvents(ana, mx)).toContainEqual({ type: 'mixar', id: mx, what: 'result', self: true });
    // Depois de revelado já não se muda.
    await api().post(`/api/v1/mixar/${mx}/challenge/${chId}/pick`).set(auth(dom)).send({ postId: c.options[1].id }).expect(409);
  });

  it('a série e os «match»: dias seguidos com os dois a jogar', async () => {
    const { dom, ana } = u;
    expect((await api().get(`/api/v1/mixar/${mx}`).set(auth(ana)).expect(200)).body).toMatchObject({ streak: 1, matches: 1 });
    // Ontem e anteontem também jogaram (escolhas diferentes); há 4 dias também, mas houve um dia sem jogo pelo meio.
    const today = mixarDay();
    const opts = [P.pesca00, P.pesca01, P.pesca10];
    const day1 = prevDay(today);
    const day2 = prevDay(day1);
    const day4 = prevDay(prevDay(day2));
    for (const d of [day1, day2, day4]) {
      const id = uuidv7();
      await pool.query(`INSERT INTO social.mixar_challenges (id, mixar_id, day, kind, options) VALUES ($1, $2, $3::date, 'repetias', $4::uuid[])`, [id, mx, d, opts]);
      await pool.query('INSERT INTO social.mixar_picks (challenge_id, user_id, post_id) VALUES ($1, $2, $3), ($1, $4, $5)', [id, dom.id, opts[0], ana.id, d === day4 ? opts[0] : opts[1]]);
    }
    expect((await api().get(`/api/v1/mixar/${mx}`).set(auth(dom)).expect(200)).body).toMatchObject({ streak: 3, matches: 2 });
  });

  it('reavalia em cada leitura: quem ficou privado ou bloqueou um dos dois sai do feed', async () => {
    const { dom, ana } = u;
    await pool.query('UPDATE identity.users SET is_private = true WHERE id = $1', [u.flip.id]);
    await api().put(`/api/v1/blocks/${ana.username}`).set(auth(u.blk)).expect(200);
    const got = ids(await feed(dom, mx, '?limit=24'));
    expect(got).not.toContain(P.flip);
    expect(got).not.toContain(P.blk);
    expect(ids(await feed(ana, mx, '?limit=24'))).toEqual(got);
    // Removida depois da seleção: sai também.
    await pool.query(`UPDATE content.posts SET removed_at = now(), removed_by = 'author' WHERE id = $1`, [P.casa7]);
    expect(ids(await feed(dom, mx, '?limit=24'))).not.toContain(P.casa7);
  });

  it('a tarefa diária: às 05:00 de Maputo gera a seleção de amanhã (sem repetir), o desafio e o evento, sem aviso no telemóvel', async () => {
    const { dom, ana } = u;
    const today = mixarDay();
    // Ainda «hoje»: nada para gerar neste Mixar.
    await svc.runDaily();
    const tomorrowNow = new Date(Date.now() + 86_400_000);
    const tomorrow = mixarDay(tomorrowNow);
    const pushesBefore = sent.length;
    const n0 = emitted.length;
    const made = await svc.runDaily({ now: tomorrowNow });
    expect(made).toBeGreaterThanOrEqual(1);
    const d = (await pool.query('SELECT items FROM social.mixar_days WHERE mixar_id = $1 AND day = $2::date', [mx, tomorrow])).rows[0];
    expect(d).toBeDefined();
    const t = (await pool.query('SELECT post_id FROM social.mixar_items WHERE mixar_id = $1 AND day = $2::date', [mx, tomorrow])).rows.map((r) => r.post_id);
    const y = (await pool.query('SELECT post_id FROM social.mixar_items WHERE mixar_id = $1 AND day = $2::date', [mx, today])).rows.map((r) => r.post_id);
    for (const id of t) expect(y).not.toContain(id);
    expect(emitted.slice(n0).filter((e) => e.e.type === 'mixar' && (e.e as { id: string }).id === mx && (e.e as { what: string }).what === 'daily').map((e) => e.to).sort()).toEqual([dom.id, ana.id].sort());
    expect(await svc.runDaily({ now: tomorrowNow })).toBe(0);
    await new Promise((res) => setTimeout(res, 100));
    expect(sent.length).toBe(pushesBefore);
    // Só os ativos: um pendente não tem seleção.
    const p = await invite(u.rui, u.eva).expect(201);
    await svc.runDaily({ now: tomorrowNow });
    expect((await pool.query('SELECT count(*)::int AS n FROM social.mixar_days WHERE mixar_id = $1', [p.body.id])).rows[0].n).toBe(0);
  });

  it('recusar e sair: o cartão mostra o estado atual; um convite novo depois disso cria outro Mixar', async () => {
    const { rui, eva } = u;
    const p = (await api().get(`/api/v1/mixar/with/${eva.username}`).set(auth(rui)).expect(200)).body.id as string;
    await api().post(`/api/v1/mixar/${p}/decline`).set(auth(rui)).expect(403); // quem convidou não recusa
    expect((await api().post(`/api/v1/mixar/${p}/decline`).set(auth(eva)).expect(200)).body).toEqual({ ok: true });
    await api().post(`/api/v1/mixar/${p}/accept`).set(auth(eva)).expect(409);
    expect((await thread(rui, eva)).items.find((m) => m.kind === 'mixar')!.mixar).toMatchObject({ id: p, status: 'declined' });
    expect((await api().get('/api/v1/mixar').set(auth(rui)).expect(200)).body.items.find((m: { id: string }) => m.id === p)).toBeUndefined();
    await api().get(`/api/v1/mixar/${p}`).set(auth(rui)).expect(404);

    const again = (await invite(eva, rui).expect(201)).body.id as string;
    expect(again).not.toBe(p);
    await api().post(`/api/v1/mixar/${again}/accept`).set(auth(rui)).expect(200);
    expect((await api().delete(`/api/v1/mixar/${again}`).set(auth(rui)).expect(200)).body).toEqual({ ok: true });
    await api().get(`/api/v1/mixar/${again}`).set(auth(eva)).expect(404);
    await api().get(`/api/v1/mixar/${again}/feed`).set(auth(eva)).expect(404);
    await api().delete(`/api/v1/mixar/${again}`).set(auth(eva)).expect(404);
    const cards = (await thread(eva, rui)).items.filter((m) => m.kind === 'mixar').map((m) => m.mixar);
    expect(cards).toEqual(expect.arrayContaining([expect.objectContaining({ id: again, status: 'ended', invitedByMe: true })]));
    // Quem convidou também pode desistir do convite (sair).
    const third = (await invite(rui, eva).expect(201)).body.id as string;
    await api().delete(`/api/v1/mixar/${third}`).set(auth(rui)).expect(200);
  });

  it('as regras do chat: com bloqueio não se convida; quem não aceita mensagens também não', async () => {
    const { lia, leo, zed, dom } = u;
    await api().put(`/api/v1/blocks/${leo.username}`).set(auth(lia)).expect(200);
    await invite(leo, lia).expect(403);
    await invite(lia, leo).expect(403);
    await api().delete(`/api/v1/blocks/${leo.username}`).set(auth(lia)).expect(200);
    await pool.query(`UPDATE identity.users SET dms_allowed = 'off' WHERE id = $1`, [zed.id]);
    await invite(dom, zed).expect(403);
  });

  it('limites: 10 convites por dia, 20 ativos por pessoa e no máximo 3 convites à mesma pessoa por dia (429)', async () => {
    const a = await signup('lima');
    const b = await signup('limb');
    await mutual(a, b);
    // 3 convites à mesma pessoa (convidar e sair) e o 4.º falha.
    for (let i = 0; i < 3; i++) {
      const id = (await invite(a, b).expect(201)).body.id as string;
      await api().delete(`/api/v1/mixar/${id}`).set(auth(a)).expect(200);
    }
    expect((await invite(a, b).expect(429)).body.message).toBe('Já convidaste esta pessoa muitas vezes hoje. Tenta amanhã');

    // Mais 7 convites de hoje (direto na base): 10 no total.
    for (let i = 0; i < 7; i++) {
      const [x, y] = a.id < b.id ? [a.id, b.id] : [b.id, a.id];
      await pool.query(`INSERT INTO social.mixars (id, user_a, user_b, invited_by, status) VALUES ($1, $2, $3, $4, 'declined')`, [uuidv7(), x, y, a.id]);
    }
    const c = await signup('limc');
    await mutual(a, c);
    expect((await invite(a, c).expect(429)).body.message).toBe('Já mandaste 10 convites para o Mixar hoje. Amanhã há mais');

    // 20 ativos: nem convidar nem aceitar.
    const full = await signup('limd');
    const e = await signup('lime');
    await mutual(full, e);
    const people = (await pool.query(`SELECT id FROM identity.users WHERE status = 'active' AND id NOT IN ($1, $2) ORDER BY id LIMIT 20`, [full.id, e.id])).rows.map((r) => r.id as string);
    for (const p of people) {
      const [x, y] = full.id < p ? [full.id, p] : [p, full.id];
      await pool.query(`INSERT INTO social.mixars (id, user_a, user_b, invited_by, status, accepted_at) VALUES ($1, $2, $3, $4, 'active', now()) ON CONFLICT DO NOTHING`, [uuidv7(), x, y, p]);
    }
    expect((await pool.query(`SELECT count(*)::int AS n FROM social.mixars WHERE (user_a = $1 OR user_b = $1) AND status = 'active'`, [full.id])).rows[0].n).toBe(20);
    expect((await invite(full, e).expect(429)).body.message).toBe('Já tens 20 Mixar ativos. Sai de um para começar outro');
    const pend = (await invite(e, full).expect(429)).body.message;
    expect(pend).toBe(`@${full.username} já tem 20 Mixar ativos`);
    // Um convite que já estava pendente também não se aceita.
    const g = await signup('limg');
    await mutual(full, g);
    const id = uuidv7();
    const [x, y] = full.id < g.id ? [full.id, g.id] : [g.id, full.id];
    await pool.query(`INSERT INTO social.mixars (id, user_a, user_b, invited_by) VALUES ($1, $2, $3, $4)`, [id, x, y, g.id]);
    await api().post(`/api/v1/mixar/${id}/accept`).set(auth(full)).expect(429);
  }, 60_000);

  it('bloqueio entre os dois: o Mixar acaba e sai da lista, a API dá 403 (e 404 em /with); desbloquear não o traz de volta', async () => {
    const { dom, ana } = u;
    await api().put(`/api/v1/blocks/${dom.username}`).set(auth(ana)).expect(200);
    expect((await api().get('/api/v1/mixar').set(auth(dom)).expect(200)).body.items.find((m: { id: string }) => m.id === mx)).toBeUndefined();
    expect((await api().get('/api/v1/mixar').set(auth(ana)).expect(200)).body.items.find((m: { id: string }) => m.id === mx)).toBeUndefined();
    await api().get(`/api/v1/mixar/${mx}`).set(auth(dom)).expect(403);
    await api().get(`/api/v1/mixar/${mx}/feed`).set(auth(ana)).expect(403);
    await api().get(`/api/v1/mixar/${mx}/challenge`).set(auth(ana)).expect(403);
    await api().post(`/api/v1/mixar/${mx}/items/${P.agri4}/react`).set(auth(dom)).send({ reaction: 'kkk' }).expect(403);
    await api().get(`/api/v1/mixar/with/${ana.username}`).set(auth(dom)).expect(404);
    // A tarefa diária salta-o.
    const later = new Date(Date.now() + 2 * 86_400_000);
    await svc.runDaily({ now: later });
    expect((await pool.query('SELECT count(*)::int AS n FROM social.mixar_days WHERE mixar_id = $1 AND day = $2::date', [mx, mixarDay(later)])).rows[0].n).toBe(0);
    expect((await pool.query('SELECT status, ended_by FROM social.mixars WHERE id = $1', [mx])).rows[0]).toMatchObject({ status: 'ended', ended_by: ana.id });
    await api().delete(`/api/v1/blocks/${dom.username}`).set(auth(ana)).expect(200);
    await api().get(`/api/v1/mixar/with/${ana.username}`).set(auth(dom)).expect(404);
    expect((await api().get('/api/v1/mixar').set(auth(dom)).expect(200)).body.items.find((m: { id: string }) => m.id === mx)).toBeUndefined();
  });

  it('a exportação traz os meus Mixar, as minhas reações, vistos e escolhas; eliminar a conta leva o Mixar', async () => {
    const { dom, ana } = u;
    const r = (await api().get('/api/v1/me/export').set(auth(dom)).expect(200)).body;
    expect(r.mixar).toEqual(expect.arrayContaining([expect.objectContaining({ id: mx, with: ana.username, invitedByMe: true, status: 'ended' })]));
    expect(r.mixarReactions).toEqual(expect.arrayContaining([expect.objectContaining({ mixarId: mx, postId: P.agri4, reaction: 'amor' })]));
    expect(r.mixarViews).toEqual(expect.arrayContaining([expect.objectContaining({ mixarId: mx, postId: P.casa6, done: true })]));
    expect(r.mixarPicks.length).toBeGreaterThanOrEqual(1);
    // Só os meus: a reação da Ana não vai na minha exportação.
    expect(JSON.stringify(r.mixarReactions)).not.toContain('fogo');

    await api().post('/api/v1/auth/delete-account').set(auth(ana)).send({ confirmUsername: ana.username, password: PASSWORD }).expect(204);
    expect((await pool.query('SELECT count(*)::int AS n FROM social.mixars WHERE user_a = $1 OR user_b = $1', [ana.id])).rows[0].n).toBe(0);
    for (const t of ['mixar_items', 'mixar_reactions', 'mixar_views', 'mixar_challenges', 'mixar_days']) {
      expect((await pool.query(`SELECT count(*)::int AS n FROM social.${t} WHERE mixar_id = $1`, [mx])).rows[0].n).toBe(0);
    }
    expect((await api().get('/api/v1/mixar').set(auth(dom)).expect(200)).body.items.find((m: { id: string }) => m.id === mx)).toBeUndefined();
    await api().get(`/api/v1/mixar/${mx}`).set(auth(dom)).expect(404);
  });

  it('limpeza: os terminados ou recusados há mais de 30 dias apagam-se (com tudo o que tinham); pendentes antigos terminam', async () => {
    const x = await signup('lpx'), y = await signup('lpy');
    await mutual(x, y);
    const gone = (await api().post('/api/v1/mixar/invite').set(auth(x)).send({ username: y.username }).expect(201)).body.id as string;
    await api().post(`/api/v1/mixar/${gone}/decline`).set(auth(y)).expect(200);
    await pool.query("UPDATE social.mixars SET ended_at = now() - interval '31 days' WHERE id = $1", [gone]);
    const pend = (await api().post('/api/v1/mixar/invite').set(auth(x)).send({ username: y.username }).expect(201)).body.id as string;
    // Ainda dentro dos 30 dias: o pendente fica como está.
    await svc.purge();
    const st = async (id: string) => (await pool.query('SELECT status FROM social.mixars WHERE id = $1', [id])).rows[0]?.status ?? null;
    expect(await st(gone)).toBeNull();
    expect(await st(pend)).toBe('pending');
    // Pendente há mais de 30 dias: termina; 30 dias depois apaga-se.
    await svc.purge(new Date(Date.now() + 31 * 86_400_000));
    expect(await st(pend)).toBe('ended');
    await svc.purge(new Date(Date.now() + 62 * 86_400_000));
    expect(await st(pend)).toBeNull();
  });
});
