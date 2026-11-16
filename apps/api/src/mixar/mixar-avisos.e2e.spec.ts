import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Pool } from 'pg';
import webpush from 'web-push';
import { uuidv7 } from '../common/uuid7';
import { loadConfig } from '../config';
import { migrate } from '../db/migrate';
import { createApp } from '../main';
import { MixarAvisosService, mixarDayStart } from './mixar-avisos.service';
import { mixarDay } from './mixar-pick';
import { MixarService } from './mixar.service';

const DB = process.env.TEST_DATABASE_URL ?? 'postgres://txill:txill_dev@localhost:5433/txillapp_test';
const PASSWORD = 'password-bem-longa-1';

interface U { token: string; id: string; username: string; ip: string }
type Push = { endpoint: string; payload: { title: string; body: string; url: string; tag?: string } };

/**
 * Mixar: avisos e descoberta (0170, docs/mixar-contrato.md «Avisos e descoberta»), de ponta a ponta: a abertura
 * (POST /mixar/:id/open e o `openedAt` nos resumos), o aviso da seleção do dia depois da tarefa diária (uma vez por Mixar e
 * por pessoa, não a quem já abriu hoje, só entre as 08:00 e as 21:00, com a categoria «Mixar» a desligar), os avisos do
 * Mixa Challenge («falta tu» e o resultado, uma vez cada) e as sugestões «Faz um Mixar com…» com o «Agora não».
 *
 * Os gostos usam temas que mais nenhum teste usa (xadrez, origami, astronomia, kitesurf).
 */
describe('Mixar: avisos e descoberta (integração)', () => {
  let app: INestApplication;
  let pool: Pool;
  let svc: MixarService;
  let avisos: MixarAvisosService;
  const run = Date.now().toString(36);
  const api = () => request(app.getHttpServer());
  const auth = (x: U) => ({ Authorization: `Bearer ${x.token}`, 'X-Forwarded-For': x.ip });
  const sent: Push[] = [];
  let n = 0;

  async function signup(name: string, display?: string): Promise<U> {
    const username = `${name}${run}`.slice(0, 28);
    n++;
    const ip = `10.170.${n >> 8}.${n & 255}`;
    const r = await api().post('/api/v1/auth/register').set('X-Forwarded-For', ip)
      .send({ email: `${username}@example.com`, username, displayName: display ?? `${name[0].toUpperCase()}${name.slice(1)} Teste`, password: PASSWORD, birthDate: '1990-06-15', acceptTerms: true }).expect(201);
    await pool.query('UPDATE identity.users SET email_verified_at = now() WHERE id = $1', [r.body.user.id]);
    return { token: r.body.accessToken, id: r.body.user.id, username, ip };
  }
  const follow = (a: U, b: U) => api().post(`/api/v1/users/${b.username}/follow`).set(auth(a)).expect(200);
  const mutual = async (a: U, b: U) => { await follow(a, b); await follow(b, a); };
  const pushTo = (x: U) => api().post('/api/v1/push/subscribe').set(auth(x)).send({ endpoint: `https://push.example.com/${run}/${x.username}`, keys: { p256dh: 'p'.repeat(20), auth: 'a'.repeat(16) } }).expect(204);
  const pushesTo = (x: U) => sent.filter((s) => s.endpoint.endsWith(`/${x.username}`));
  const prefs = (x: U, topics: string[]) => Promise.all(topics.map((t) => pool.query('INSERT INTO social.explore_prefs (user_id, topic, pref) VALUES ($1, $2, 1) ON CONFLICT DO NOTHING', [x.id, t])));
  const off = (x: U, cats: string[]) => api().put('/api/v1/notifications/settings').set(auth(x)).send({ off: cats }).expect(204);
  const notices = async (x: U, kind: string, mixarId?: string) =>
    (await pool.query(`SELECT actor_id, data, read_at FROM social.notifications WHERE user_id = $1 AND kind = $2 AND ($3::text IS NULL OR data->>'mixarId' = $3) ORDER BY id`, [x.id, kind, mixarId ?? null])).rows;
  const summary = async (x: U, id: string) => ((await api().get('/api/v1/mixar').set(auth(x)).expect(200)).body.items as { id: string; openedAt: string | null }[]).find((m) => m.id === id);
  async function waitFor(check: () => boolean, ms = 3000) {
    for (let t = 0; t < ms && !check(); t += 50) await new Promise((r) => setTimeout(r, 50));
    expect(check()).toBe(true);
  }
  const settle = () => new Promise((r) => setTimeout(r, 150));

  /** Um Mixar ativo entre os dois (convite pela API e aceite), aceite há 2 dias. */
  async function pair(a: U, b: U): Promise<string> {
    await mutual(a, b);
    const id = (await api().post('/api/v1/mixar/invite').set(auth(a)).send({ username: b.username }).expect(201)).body.id as string;
    await api().post(`/api/v1/mixar/${id}/accept`).set(auth(b)).expect(200);
    await pool.query(`UPDATE social.mixars SET accepted_at = now() - interval '2 days', created_at = now() - interval '2 days' WHERE id = $1`, [id]);
    return id;
  }

  /** Uma tcheka (um só vídeo) com estes temas. */
  async function tcheka(author: U, topics: string[], hours = 2) {
    const media = (await pool.query(`INSERT INTO content.media_assets (id, owner_id, mime, size_bytes, storage_key, status, duration_ms, width, height) VALUES (gen_random_uuid(), $1, 'video/mp4', 1, 'x', 'ready', 5000, 720, 1280) RETURNING id`, [author.id])).rows[0].id as string;
    const id = uuidv7(Date.now() - hours * 3_600_000);
    await pool.query(`INSERT INTO content.posts (id, author_id, body, topics, created_at) VALUES ($1, $2, $3, $4, now() - make_interval(hours => $5))`, [id, author.id, `tcheka ${topics.join(' ')}`, topics, hours]);
    await pool.query('INSERT INTO content.post_media (post_id, media_id, position) VALUES ($1, $2, 0)', [id, media]);
    return id;
  }

  /** `count` mensagens na conversa a dois (`fromA` delas de `a`), há `daysAgo` dias. */
  async function talk(a: U, b: U, count: number, fromA: number, daysAgo = 0) {
    const [x, y] = a.id < b.id ? [a.id, b.id] : [b.id, a.id];
    const conv = (
      await pool.query(
        `INSERT INTO social.conversations (id, user_a, user_b, last_message_at) VALUES ($1, $2, $3, now() - make_interval(days => $4))
         ON CONFLICT (user_a, user_b) DO UPDATE SET last_message_at = EXCLUDED.last_message_at RETURNING id`,
        [uuidv7(), x, y, daysAgo],
      )
    ).rows[0].id as string;
    for (let i = 0; i < count; i++) {
      await pool.query(`INSERT INTO social.messages (id, conversation_id, sender_id, body, created_at) VALUES ($1, $2, $3, 'olá', now() - make_interval(days => $4, mins => $5))`, [
        uuidv7(), conv, i < fromA ? a.id : b.id, daysAgo, count - i,
      ]);
    }
  }

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
    avisos = app.get(MixarAvisosService);
    // A seleção destes testes: só as publicações desta corrida com estes temas.
    await pool.query(`UPDATE content.posts SET removed_at = now(), removed_by = 'author' WHERE topics && ARRAY['xadrez', 'origami', 'astronomia', 'kitesurf'] AND removed_at IS NULL`);
    const authors: U[] = [];
    for (let i = 0; i < 6; i++) authors.push(await signup(`mva${i}x`));
    for (let i = 0; i < 6; i++) for (let k = 0; k < 2; k++) await tcheka(authors[i], i % 2 ? ['xadrez', 'origami'] : ['xadrez'], 1 + i + k);
  }, 180_000);

  afterAll(async () => {
    await app.close();
    await pool.end();
    jest.restoreAllMocks();
  });

  it('a categoria «Mixar» existe e desliga também o aviso do convite', async () => {
    const kim = await signup('kim'), joy = await signup('joy');
    await pushTo(kim);
    await pushTo(joy);
    expect((await api().get('/api/v1/notifications/settings').set(auth(joy)).expect(200)).body.categories).toContain('mixar');
    await off(joy, ['mixar']);
    await mutual(kim, joy);
    await api().post('/api/v1/mixar/invite').set(auth(kim)).send({ username: joy.username }).expect(201);
    await settle();
    expect(pushesTo(joy).filter((p) => p.payload.url.startsWith('/mixar/'))).toEqual([]);
    // Com a categoria ligada, o convite chega (categoria 'mixar').
    const lu = await signup('lu');
    await pushTo(lu);
    await mutual(kim, lu);
    await api().post('/api/v1/mixar/invite').set(auth(kim)).send({ username: lu.username }).expect(201);
    const mixarPushes = () => pushesTo(lu).filter((p) => p.payload.url.startsWith('/mixar/'));
    await waitFor(() => mixarPushes().length === 1);
    expect(mixarPushes()[0].payload.body).toBe('Kim Teste convidou-te para um Mixar');
  });

  describe('abrir (POST /mixar/:id/open) e openedAt', () => {
    let a: U, b: U, c: U, id = '';
    beforeAll(async () => {
      a = await signup('opa');
      b = await signup('opb');
      c = await signup('opc');
      await prefs(a, ['xadrez']);
      await prefs(b, ['xadrez']);
      id = await pair(a, b);
    });

    it('guarda a última abertura, devolve-a nos resumos e é idempotente', async () => {
      expect((await summary(a, id))!.openedAt).toBeNull();
      expect((await api().get(`/api/v1/mixar/${id}`).set(auth(a)).expect(200)).body.openedAt).toBeNull();
      const first = (await api().post(`/api/v1/mixar/${id}/open`).set(auth(a)).expect(200)).body.openedAt as string;
      expect(new Date(first).getTime()).toBeGreaterThan(Date.now() - 60_000);
      expect((await summary(a, id))!.openedAt).toBe(first);
      expect((await api().get(`/api/v1/mixar/${id}`).set(auth(a)).expect(200)).body.openedAt).toBe(first);
      // Só a minha: o outro continua sem abertura.
      expect((await summary(b, id))!.openedAt).toBeNull();
      const again = (await api().post(`/api/v1/mixar/${id}/open`).set(auth(a)).expect(200)).body.openedAt as string;
      expect(again >= first).toBe(true);
      expect((await pool.query('SELECT count(*)::int AS n FROM social.mixar_opens WHERE mixar_id = $1', [id])).rows[0].n).toBe(1);
    });

    it('nunca fica antes da última mudança do Mixar (a bolinha não volta por causa da seleção que chegou no mesmo instante)', async () => {
      const future = new Date(Date.now() + 3_600_000);
      await pool.query('UPDATE social.mixars SET updated_at = $2 WHERE id = $1', [id, future]);
      const at = (await api().post(`/api/v1/mixar/${id}/open`).set(auth(b)).expect(200)).body.openedAt as string;
      expect(at).toBe(future.toISOString());
      const s = (await summary(b, id))!;
      expect(s.openedAt! >= (s as unknown as { updatedAt: string }).updatedAt).toBe(true);
    });

    it('404 se não é meu, 400 sem id válido, 403 com bloqueio; um convite pendente também se abre', async () => {
      await api().post(`/api/v1/mixar/${id}/open`).set(auth(c)).expect(404);
      await api().post(`/api/v1/mixar/${uuidv7()}/open`).set(auth(a)).expect(404);
      await api().post('/api/v1/mixar/nada/open').set(auth(a)).expect(400);
      await mutual(a, c);
      const p = (await api().post('/api/v1/mixar/invite').set(auth(c)).send({ username: a.username }).expect(201)).body.id as string;
      await api().post(`/api/v1/mixar/${p}/open`).set(auth(a)).expect(200);
      expect((await summary(a, p))!.openedAt).toEqual(expect.any(String));
      // Um bloqueio (direto na base: pela API, bloquear também termina o Mixar, que passa a 404).
      await pool.query('INSERT INTO social.blocks (blocker_id, blocked_id) VALUES ($1, $2)', [a.id, c.id]);
      await api().post(`/api/v1/mixar/${p}/open`).set(auth(a)).expect(403);
      await pool.query('DELETE FROM social.blocks WHERE blocker_id = $1 AND blocked_id = $2', [a.id, c.id]);
      await api().put(`/api/v1/blocks/${c.username}`).set(auth(a)).expect(200);
      await api().post(`/api/v1/mixar/${p}/open`).set(auth(c)).expect(404);
    });
  });

  describe('o aviso da seleção do dia', () => {
    let dom: U, ana: U, rui: U, eva: U, tia: U, tio: U;
    let p1 = '', p2 = '', p3 = '';
    // Daqui a 3 dias, às 09:00 de Maputo (e às 06:30, antes da janela dos avisos).
    const base = new Date(Date.now() + 3 * 86_400_000);
    const at = (h: number, m = 0) => new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate(), h - 2, m));
    const nine = at(9);
    const day = mixarDay(nine);
    const start = mixarDayStart(day);

    beforeAll(async () => {
      dom = await signup('dmv', 'Dom Teste');
      ana = await signup('amv', 'Ana Teste');
      rui = await signup('rmv', 'Rui Teste');
      eva = await signup('emv', 'Eva Teste');
      tia = await signup('tia', 'Tia Teste');
      tio = await signup('tio', 'Tio Teste');
      for (const x of [dom, ana, rui, eva, tia, tio]) {
        await prefs(x, ['xadrez', 'origami']);
        await pushTo(x);
      }
      await pool.query(`UPDATE identity.users SET verified = true, verified_tier = 'verified' WHERE id = $1`, [ana.id]);
      p1 = await pair(dom, ana);
      p2 = await pair(rui, eva);
      p3 = await pair(tia, tio);
      // A seleção de hoje (feita ao aceitar) usou as publicações todas: sai, para a desse dia ter itens.
      await pool.query('DELETE FROM social.mixar_items WHERE mixar_id = ANY($1::uuid[])', [[p1, p2, p3]]);
      // O Mixar 3 foi aceite já depois das 05:00 desse dia: quem aceitou viu-o e quem convidou recebeu o «aceitou».
      await pool.query('UPDATE social.mixars SET accepted_at = $2 WHERE id = $1', [p3, new Date(start.getTime() + 30 * 60_000)]);
      // A Eva desligou os avisos do Mixar; o Rui já abriu o Mixar nesse dia.
      await off(eva, ['mixar']);
      await pool.query('INSERT INTO social.mixar_opens (mixar_id, user_id, opened_at) VALUES ($1, $2, $3)', [p2, rui.id, new Date(start.getTime() + 3_600_000)]);
      expect(start.toISOString().slice(11, 16)).toBe('03:00'); // 05:00 em Maputo
    });

    it('antes das 08:00 de Maputo não avisa; depois da tarefa diária (às 09:00) avisa cada um dos dois, uma vez', async () => {
      expect(await avisos.dailyNotices({ now: at(6, 30) })).toBe(0);
      const before = sent.length;
      await svc.runDaily({ now: nine });
      expect((await pool.query('SELECT items FROM social.mixar_days WHERE mixar_id = $1 AND day = $2::date', [p1, day])).rows[0].items).toBeGreaterThan(0);
      const nd = await notices(dom, 'mixar_daily', p1);
      const na = await notices(ana, 'mixar_daily', p1);
      expect(nd).toHaveLength(1);
      expect(na).toHaveLength(1);
      expect(nd[0]).toMatchObject({ actor_id: ana.id, data: { mixarId: p1, name: 'Dom + Ana', day } });
      expect(na[0]).toMatchObject({ actor_id: dom.id, data: { mixarId: p1, name: 'Ana + Dom', day } });
      await waitFor(() => pushesTo(dom).some((p) => p.payload.tag === `mixar:${p1}:daily`) && pushesTo(ana).some((p) => p.payload.tag === `mixar:${p1}:daily`));
      expect(pushesTo(dom).find((p) => p.payload.tag === `mixar:${p1}:daily`)!.payload).toMatchObject({ title: 'Dom + Ana', body: 'A vossa seleção de hoje está pronta', url: `/mixar/${p1}` });
      // Já abriu hoje (o Rui), a categoria desligada (a Eva) e o Mixar aceite depois das 05:00: nada.
      expect(await notices(rui, 'mixar_daily')).toHaveLength(0);
      expect(await notices(eva, 'mixar_daily')).toHaveLength(0);
      expect(await notices(tia, 'mixar_daily')).toHaveLength(0);
      expect(await notices(tio, 'mixar_daily')).toHaveLength(0);
      expect(sent.slice(before).filter((p) => [rui, eva, tia, tio].some((x) => p.endpoint.endsWith(`/${x.username}`)))).toEqual([]);

      // Outra volta da tarefa (de 15 em 15 minutos): nada repetido.
      await svc.runDaily({ now: at(9, 15) });
      expect(await avisos.dailyNotices({ now: at(14) })).toBe(0);
      await settle();
      expect(await notices(dom, 'mixar_daily', p1)).toHaveLength(1);
      expect(pushesTo(dom).filter((p) => p.payload.tag === `mixar:${p1}:daily`)).toHaveLength(1);
    }, 60_000);

    it('na lista: o aviso com quem (e o selo); abrir o Mixar dá-o por lido', async () => {
      const items = (await api().get('/api/v1/notifications').set(auth(dom)).expect(200)).body.items as { kind: string; data: { mixarId: string }; read: boolean; actor: { username: string; verified: boolean; verifiedTier: string | null } }[];
      const it = items.find((i) => i.kind === 'mixar_daily' && i.data.mixarId === p1)!;
      expect(it).toMatchObject({ read: false, actor: { username: ana.username, verified: true, verifiedTier: 'verified' } });
      await api().post(`/api/v1/mixar/${p1}/open`).set(auth(dom)).expect(200);
      expect((await notices(dom, 'mixar_daily', p1))[0].read_at).not.toBeNull();
      expect((await notices(ana, 'mixar_daily', p1))[0].read_at).toBeNull();
    });

    it('no dia seguinte há outro aviso (um por dia), e quem abriu nesse dia já não o recebe', async () => {
      const next = new Date(nine.getTime() + 86_400_000);
      const nextDay = mixarDay(next);
      await pool.query('DELETE FROM social.mixar_items WHERE mixar_id = $1', [p1]);
      await pool.query('INSERT INTO social.mixar_opens (mixar_id, user_id, opened_at) VALUES ($1, $2, $3) ON CONFLICT (mixar_id, user_id) DO UPDATE SET opened_at = EXCLUDED.opened_at', [p1, ana.id, new Date(mixarDayStart(nextDay).getTime() + 60_000)]);
      await svc.runDaily({ now: next });
      expect((await notices(dom, 'mixar_daily', p1)).map((r) => r.data.day)).toEqual([day, nextDay]);
      expect((await notices(ana, 'mixar_daily', p1)).map((r) => r.data.day)).toEqual([day]);
    }, 60_000);
  });

  describe('os avisos do Mixa Challenge', () => {
    const challenge = async (x: U, id: string) => (await api().get(`/api/v1/mixar/${id}/challenge`).set(auth(x)).expect(200)).body as { id: string; options: { id: string }[] };
    const pick = (x: U, id: string, ch: string, postId: string) => api().post(`/api/v1/mixar/${id}/challenge/${ch}/pick`).set(auth(x)).send({ postId });

    it('um escolhe: o outro recebe «falta tu» (uma vez); o outro escolhe o mesmo: quem escolheu primeiro recebe «Acertaram no mesmo»', async () => {
      const leo = await signup('lev', 'Leo Teste'), mia = await signup('miv', 'Mia Teste');
      for (const x of [leo, mia]) {
        await prefs(x, ['xadrez']);
        await pushTo(x);
      }
      const id = await pair(leo, mia);
      const c = await challenge(leo, id);
      expect(c.options.length).toBeGreaterThanOrEqual(3);
      await pick(leo, id, c.id, c.options[0].id).expect(200);
      await waitFor(() => pushesTo(mia).some((p) => p.payload.tag === `mixar:${id}:challenge`));
      expect(pushesTo(mia).find((p) => p.payload.tag === `mixar:${id}:challenge`)!.payload).toMatchObject({ title: 'Mia + Leo', body: 'Leo já escolheu no Mixa Challenge, falta tu', url: `/mixar/${id}` });
      expect(await notices(mia, 'mixar_pick', id)).toEqual([expect.objectContaining({ actor_id: leo.id, data: { mixarId: id, name: 'Mia + Leo', challengeId: c.id }, read_at: null })]);
      // Mudar de ideias não avisa outra vez.
      await pick(leo, id, c.id, c.options[1].id).expect(200);
      await settle();
      expect(await notices(mia, 'mixar_pick', id)).toHaveLength(1);
      expect(pushesTo(mia).filter((p) => p.payload.tag === `mixar:${id}:challenge`)).toHaveLength(1);
      expect(await notices(leo, 'mixar_pick', id)).toHaveLength(0);

      await pick(mia, id, c.id, c.options[1].id).expect(200);
      await waitFor(() => pushesTo(leo).some((p) => p.payload.tag === `mixar:${id}:challenge`));
      expect(pushesTo(leo).find((p) => p.payload.tag === `mixar:${id}:challenge`)!.payload).toMatchObject({ title: 'Leo + Mia', body: 'Acertaram no mesmo', url: `/mixar/${id}` });
      expect(await notices(leo, 'mixar_result', id)).toEqual([expect.objectContaining({ actor_id: mia.id, data: { mixarId: id, name: 'Leo + Mia', challengeId: c.id, match: true } })]);
      // A Mia (a segunda) não recebe o resultado e o seu «falta tu» fica lido.
      expect(await notices(mia, 'mixar_result', id)).toHaveLength(0);
      expect((await notices(mia, 'mixar_pick', id))[0].read_at).not.toBeNull();
      await pick(mia, id, c.id, c.options[0].id).expect(409);
      await settle();
      expect(await notices(leo, 'mixar_result', id)).toHaveLength(1);
    });

    it('escolhas diferentes: «Escolheram diferente»; com a categoria desligada, nada', async () => {
      const tom = await signup('tov', 'Tom Teste'), sol = await signup('sov', 'Sol Teste');
      for (const x of [tom, sol]) {
        await prefs(x, ['xadrez']);
        await pushTo(x);
      }
      const id = await pair(tom, sol);
      const c = await challenge(tom, id);
      await pick(tom, id, c.id, c.options[0].id).expect(200);
      await pick(sol, id, c.id, c.options[1].id).expect(200);
      await waitFor(() => pushesTo(tom).some((p) => p.payload.tag === `mixar:${id}:challenge`));
      expect(pushesTo(tom).find((p) => p.payload.tag === `mixar:${id}:challenge`)!.payload.body).toBe('Escolheram diferente');
      expect((await notices(tom, 'mixar_result', id))[0].data.match).toBe(false);

      const kai = await signup('kav', 'Kai Teste'), noa = await signup('nov', 'Noa Teste');
      for (const x of [kai, noa]) {
        await prefs(x, ['xadrez']);
        await pushTo(x);
      }
      const id2 = await pair(kai, noa);
      await off(noa, ['mixar']);
      const c2 = await challenge(kai, id2);
      await pick(kai, id2, c2.id, c2.options[0].id).expect(200);
      await settle();
      expect(await notices(noa, 'mixar_pick', id2)).toHaveLength(0);
      expect(pushesTo(noa).filter((p) => p.payload.tag === `mixar:${id2}:challenge`)).toEqual([]);
    });
  });

  describe('sugestões «Faz um Mixar com…»', () => {
    let me: U;
    const P: Record<string, U> = {};
    const list = async () => (await api().get('/api/v1/mixar/suggestions').set(auth(me)).expect(200)).body.items as { username: string; displayName: string; hasAvatar: boolean; verified: boolean; verifiedTier: string | null; match: number; common: { topic: string; label: string }[] }[];

    beforeAll(async () => {
      me = await signup('sug', 'Sug Teste');
      await prefs(me, ['astronomia', 'kitesurf']);
      for (const k of ['lina', 'bia', 'ines', 'jo', 'caio', 'duda', 'edu', 'fabi', 'gil', 'hugo']) P[k] = await signup(`s${k}`, `${k[0].toUpperCase()}${k.slice(1)} Teste`);
      await pool.query(`UPDATE identity.users SET verified = true, verified_tier = 'paid' WHERE id = $1`, [P.lina.id]);
      // Gostos: iguais (lina, ines, jo, fabi, gil, hugo, edu, duda), parecidos (bia) e nada a ver (caio).
      for (const k of ['lina', 'ines', 'jo', 'fabi', 'gil', 'hugo', 'edu', 'duda']) await prefs(P[k], ['astronomia', 'kitesurf']);
      await prefs(P.bia, ['astronomia', 'origami']);
      await prefs(P.caio, ['origami']);
      for (const k of ['lina', 'bia', 'ines', 'jo', 'caio', 'edu', 'fabi', 'gil', 'hugo']) await mutual(me, P[k]);
      await follow(me, P.duda); // só eu sigo
      await talk(me, P.lina, 12, 6);
      await talk(me, P.bia, 40, 20);
      await talk(me, P.ines, 30, 15);
      await talk(me, P.jo, 10, 5);
      await talk(me, P.caio, 50, 25);
      await talk(me, P.duda, 30, 15);
      await talk(me, P.edu, 4, 2); // pouco
      await talk(me, P.fabi, 30, 15);
      await talk(me, P.gil, 30, 15);
      await talk(me, P.hugo, 30, 15, 40); // há mais de 30 dias
      await api().put(`/api/v1/blocks/${P.fabi.username}`).set(auth(me)).expect(200);
      await api().post('/api/v1/mixar/invite').set(auth(me)).send({ username: P.gil.username }).expect(201);
    }, 120_000);

    it('até 3: quem fala muito comigo, nos seguimos, sem Mixar, sem bloqueio e com gostos parecidos (com o match e os temas)', async () => {
      const got = await list();
      expect(got).toHaveLength(3);
      const names = got.map((s) => s.username);
      for (const k of ['caio', 'duda', 'edu', 'fabi', 'gil', 'hugo']) expect(names).not.toContain(P[k].username);
      // Ines, Lina e Jo batem 100% (a Ines fala mais: vem primeiro); a Bia fala muito, mas bate menos: fica de fora.
      expect(names).toEqual([P.ines.username, P.lina.username, P.jo.username]);
      const lina = got.find((s) => s.username === P.lina.username)!;
      expect(lina).toMatchObject({ displayName: 'Lina Teste', hasAvatar: false, verified: true, verifiedTier: 'paid', match: 100 });
      expect(lina.common.map((c) => c.topic).sort()).toEqual(['astronomia', 'kitesurf']);
    });

    it('«Agora não» esconde a pessoa 30 dias (no servidor); depois volta', async () => {
      await api().post(`/api/v1/mixar/suggestions/${P.ines.username}/dismiss`).set(auth(me)).expect(204);
      await api().post(`/api/v1/mixar/suggestions/${P.ines.username}/dismiss`).set(auth(me)).expect(204); // idempotente
      const got = await list();
      expect(got.map((s) => s.username)).toEqual([P.lina.username, P.jo.username, P.bia.username]);
      const bia = got.find((s) => s.username === P.bia.username)!;
      expect(bia.match).toBeGreaterThanOrEqual(40);
      expect(bia.match).toBeLessThan(100);
      expect(bia.common.map((c) => c.topic)).toEqual(['astronomia']);
      const until = (await pool.query('SELECT until FROM social.mixar_suggestion_dismissals WHERE user_id = $1 AND person_id = $2', [me.id, P.ines.id])).rows[0].until as Date;
      expect(Math.round((until.getTime() - Date.now()) / 86_400_000)).toBe(30);
      await api().post('/api/v1/mixar/suggestions/ninguem-aqui/dismiss').set(auth(me)).expect(404);
      // A exportação traz quem dispensei.
      const exp = (await api().get('/api/v1/me/export').set(auth(me)).expect(200)).body;
      expect(exp.mixarSuggestionsDismissed).toEqual([expect.objectContaining({ username: P.ines.username })]);
      expect(Array.isArray(exp.mixarOpens)).toBe(true);
      // Passados os 30 dias, volta (e a linha velha apaga-se).
      await pool.query(`UPDATE social.mixar_suggestion_dismissals SET until = now() - interval '1 minute' WHERE user_id = $1`, [me.id]);
      expect((await list()).map((s) => s.username)).toEqual([P.ines.username, P.lina.username, P.jo.username]);
      expect((await pool.query('SELECT count(*)::int AS n FROM social.mixar_suggestion_dismissals WHERE user_id = $1', [me.id])).rows[0].n).toBe(0);
    });

    it('com um Mixar novo a pessoa sai das sugestões; eliminar a conta apaga o que foi dispensado', async () => {
      await api().post('/api/v1/mixar/invite').set(auth(me)).send({ username: P.ines.username }).expect(201);
      expect((await list()).map((s) => s.username)).toEqual([P.lina.username, P.jo.username, P.bia.username]);
      await api().post(`/api/v1/mixar/suggestions/${P.jo.username}/dismiss`).set(auth(me)).expect(204);
      await api().post('/api/v1/auth/delete-account').set(auth(P.jo)).send({ confirmUsername: P.jo.username, password: PASSWORD }).expect(204);
      expect((await pool.query('SELECT count(*)::int AS n FROM social.mixar_suggestion_dismissals WHERE person_id = $1', [P.jo.id])).rows[0].n).toBe(0);
    });
  });
});
