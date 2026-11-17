import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Pool } from 'pg';
import { uuidv7 } from '../common/uuid7';
import { loadConfig } from '../config';
import { migrate } from '../db/migrate';
import { createApp } from '../main';
import { mixarDayStart } from './mixar-avisos.service';
import { MixarGrupoService } from './mixar-grupo.service';
import { mixarDay } from './mixar-pick';
import { MixarService } from './mixar.service';

const DB = process.env.TEST_DATABASE_URL ?? 'postgres://txill:txill_dev@localhost:5433/txillapp_test';
const PASSWORD = 'password-bem-longa-1';

interface U { token: string; id: string; username: string; ip: string }
type Person = { username: string; displayName: string; verified: boolean };
interface GItem { post: { id: string }; from: string; topic: unknown; mine: string | null; group: { fans: Person[]; mine: boolean; everyone: boolean; reactions: { person: Person; reaction: string }[]; seenBy: Person[] } }

/**
 * Mixar de grupo (0173, docs/mixar-contrato.md «Mixar de grupo»), de ponta a ponta: propor num TxillGroup de 3 a 5 (um grupo
 * de 6 é recusado), ativo com 3 que aceitam, quem não aceitou não vê nada (nem os gostos), o feed com as razões de quem é o
 * gosto, as reações e os vistos de todos, os Guardados pela maioria, o desafio com a contagem, a conversa só dos
 * participantes, o «Mais 5», entrar mais tarde, sair do grupo = sair do Mixar, menos de 3 acaba, a lista, os avisos, a
 * exportação e apagar a conta. E o Mixar a dois continua igual.
 *
 * Os temas (bonsai, ceramica, tricot) não são usados por mais nenhum teste; no fim as publicações deste teste saem.
 */
describe('Mixar de grupo (integração)', () => {
  let app: INestApplication;
  let pool: Pool;
  let grupo: MixarGrupoService;
  const run = Date.now().toString(36);
  const api = () => request(app.getHttpServer());
  const auth = (x: U) => ({ Authorization: `Bearer ${x.token}`, 'X-Forwarded-For': x.ip });
  const u: Record<string, U> = {};
  const posts: string[] = [];
  let n = 0;
  let g4 = ''; // Dom, Ana, Zeca, Rui
  let g6 = ''; // seis pessoas
  let mx = '';
  let pair = '';
  let items: string[] = [];

  async function signup(name: string, display?: string): Promise<U> {
    const username = `${name}${run}`.slice(0, 28);
    n++;
    const ip = `10.173.${n >> 8}.${n & 255}`;
    const r = await api().post('/api/v1/auth/register').set('X-Forwarded-For', ip)
      .send({ email: `${username}@example.com`, username, displayName: display ?? `${name[0].toUpperCase()}${name.slice(1)} Teste`, password: PASSWORD, birthDate: '1990-06-15', acceptTerms: true }).expect(201);
    await pool.query('UPDATE identity.users SET email_verified_at = now() WHERE id = $1', [r.body.user.id]);
    return { token: r.body.accessToken, id: r.body.user.id, username, ip };
  }
  const follow = (a: U, b: U) => api().post(`/api/v1/users/${b.username}/follow`).set(auth(a)).expect(200);
  const prefs = (x: U, topics: string[]) => Promise.all(topics.map((t) => pool.query('INSERT INTO social.explore_prefs (user_id, topic, pref) VALUES ($1, $2, 1) ON CONFLICT DO NOTHING', [x.id, t])));
  const feed = async (x: U, id = mx) => {
    const out: GItem[] = [];
    let cursor: string | null = null;
    do {
      const r: { items: GItem[]; nextCursor: string | null } = (await api().get(`/api/v1/mixar/${id}/feed?limit=24${cursor ? `&cursor=${cursor}` : ''}`).set(auth(x)).expect(200)).body;
      out.push(...r.items);
      cursor = r.nextCursor;
    } while (cursor);
    return out;
  };
  const react = (x: U, postId: string, reaction: string | null) => api().post(`/api/v1/mixar/${mx}/items/${postId}/react`).set(auth(x)).send({ reaction });
  const notices = async (x: U, kind: string) => (await pool.query('SELECT actor_id, data FROM social.notifications WHERE user_id = $1 AND kind = $2 ORDER BY created_at', [x.id, kind])).rows;

  async function tcheka(author: U, topics: string[], hours = 2) {
    const media = (await pool.query(`INSERT INTO content.media_assets (id, owner_id, mime, size_bytes, storage_key, status, duration_ms, width, height) VALUES (gen_random_uuid(), $1, 'video/mp4', 1, 'x', 'ready', 5000, 720, 1280) RETURNING id`, [author.id])).rows[0].id as string;
    const id = uuidv7(Date.now() - hours * 3_600_000);
    await pool.query(`INSERT INTO content.posts (id, author_id, body, topics, created_at) VALUES ($1, $2, $3, $4, now() - make_interval(hours => $5))`, [id, author.id, `tcheka ${topics.join(' ')}`, topics, hours]);
    await pool.query('INSERT INTO content.post_media (post_id, media_id, position) VALUES ($1, $2, 0)', [id, media]);
    posts.push(id);
    return id;
  }

  beforeAll(async () => {
    await migrate(DB);
    pool = new Pool({ connectionString: DB });
    app = await createApp(loadConfig({ DATABASE_URL: DB, JWT_ACCESS_SECRET: 's'.repeat(40), NODE_ENV: 'test', MEDIA_DIR: './uploads-test' }));
    await app.init();
    grupo = app.get(MixarGrupoService);

    u.dom = await signup('gdom', 'Dom Teste');
    u.ana = await signup('gana', 'Ana Teste');
    u.zeca = await signup('gzeca', 'Zeca Teste');
    u.rui = await signup('grui', 'Rui Teste');
    u.eva = await signup('geva', 'Eva Teste');
    u.tia = await signup('gtia', 'Tia Teste');
    await pool.query(`UPDATE identity.users SET verified = true, verified_tier = 'verified' WHERE id = $1`, [u.ana.id]);
    const all = [u.dom, u.ana, u.zeca, u.rui, u.eva, u.tia];
    for (const a of all) for (const b of all) if (a !== b) await follow(a, b);
    // Gostos: todos bonsai; Dom e Ana também ceramica; Zeca tricot. O Rui (que não aceita logo) gosta só de tricot.
    await prefs(u.dom, ['bonsai', 'ceramica']);
    await prefs(u.ana, ['bonsai', 'ceramica']);
    await prefs(u.zeca, ['bonsai', 'tricot']);
    await prefs(u.rui, ['tricot']);
    await pool.query(`UPDATE content.posts SET removed_at = now(), removed_by = 'author' WHERE topics && ARRAY['bonsai', 'ceramica', 'tricot'] AND removed_at IS NULL`);
    // 30 autores com 2 tchekas cada: chega para a seleção do dia (24) e para o «Mais 5».
    for (let i = 0; i < 30; i++) {
      const a = await signup(`ga${i}x`);
      for (let k = 0; k < 2; k++) await tcheka(a, [['bonsai', 'ceramica', 'tricot'][(i + k) % 3]], 1 + i + k);
    }
    g4 = (await api().post('/api/v1/chat/groups').set(auth(u.dom)).send({ name: 'Malta do Bonsai', members: [u.ana.username, u.zeca.username, u.rui.username] }).expect(201)).body.id;
    g6 = (await api().post('/api/v1/chat/groups').set(auth(u.dom)).send({ name: 'Grupo Grande', members: [u.ana.username, u.zeca.username, u.rui.username, u.eva.username, u.tia.username] }).expect(201)).body.id;
  }, 300_000);

  afterAll(async () => {
    if (posts.length) await pool.query(`UPDATE content.posts SET removed_at = now(), removed_by = 'author' WHERE id = ANY($1::uuid[]) AND removed_at IS NULL`, [posts]);
    await app.close();
    await pool.end();
  });

  it('um grupo de 6 é recusado com um texto claro; quem não é do grupo não propõe', async () => {
    const r = await api().post(`/api/v1/mixar/grupo/${g6}`).set(auth(u.ana)).expect(409);
    expect(r.body.message).toBe('O Mixar de grupo é para grupos de 3 a 5 pessoas');
    await api().post(`/api/v1/mixar/grupo/${g4}`).set(auth(u.eva)).expect(404);
    await api().get(`/api/v1/mixar/grupo/${g4}`).set(auth(u.dom)).expect(404);
  });

  it('propor: fica pendente com quem propôs; os outros recebem o aviso «mixar_group»; um segundo dá 409 com o id', async () => {
    const r = (await api().post(`/api/v1/mixar/grupo/${g4}`).set(auth(u.dom)).expect(201)).body;
    mx = r.id;
    expect(r).toMatchObject({ status: 'pending', invitedByMe: true, name: 'Malta do Bonsai', group: { groupId: g4, groupName: 'Malta do Bonsai', members: 4, myState: 'in', need: 2, canJoin: false } });
    expect(r.group.people.map((p: Person) => p.username)).toEqual([u.dom.username]);
    expect(r.group.proposedBy).toMatchObject({ username: u.dom.username, displayName: 'Dom Teste' });
    for (const x of [u.ana, u.zeca, u.rui]) expect(await notices(x, 'mixar_group')).toEqual([{ actor_id: u.dom.id, data: { mixarId: mx, name: 'Malta do Bonsai', groupId: g4 } }]);
    expect(await notices(u.dom, 'mixar_group')).toEqual([]);
    expect(await notices(u.eva, 'mixar_group')).toEqual([]);
    const again = await api().post(`/api/v1/mixar/grupo/${g4}`).set(auth(u.ana)).expect(409);
    expect(again.body).toMatchObject({ message: 'Este grupo já tem um Mixar', id: mx });
    // O cabeçalho do grupo encontra-o; quem não é do grupo não.
    expect((await api().get(`/api/v1/mixar/grupo/${g4}`).set(auth(u.rui)).expect(200)).body).toMatchObject({ id: mx, group: { myState: null, canJoin: true } });
    await api().get(`/api/v1/mixar/${mx}`).set(auth(u.eva)).expect(404);
    // Pendente: o feed ainda não existe.
    await api().get(`/api/v1/mixar/${mx}/feed`).set(auth(u.dom)).expect(409);
  });

  it('com 3 que aceitam começa; quem disse «Agora não» não vê o feed, a conversa, os Guardados nem os gostos', async () => {
    const a = (await api().post(`/api/v1/mixar/${mx}/accept`).set(auth(u.ana)).expect(200)).body;
    expect(a).toMatchObject({ status: 'pending', group: { need: 1, myState: 'in' } });
    await api().post(`/api/v1/mixar/${mx}/accept`).set(auth(u.ana)).expect(409);
    await api().post(`/api/v1/mixar/${mx}/decline`).set(auth(u.rui)).expect(200, { ok: true });
    const z = (await api().post(`/api/v1/mixar/${mx}/accept`).set(auth(u.zeca)).expect(200)).body;
    expect(z).toMatchObject({ status: 'active', group: { need: 0, myState: 'in' } });
    expect(z.group.people.map((p: Person) => p.username)).toEqual([u.dom.username, u.ana.username, u.zeca.username]);
    expect(z.group.people[1]).toMatchObject({ verified: true, verifiedTier: 'verified' });
    expect(z.common.map((c: { topic: string }) => c.topic)).toEqual(['bonsai']);
    expect(z.match).toBeGreaterThan(0);

    const rui = (await api().get(`/api/v1/mixar/${mx}`).set(auth(u.rui)).expect(200)).body;
    expect(rui).toMatchObject({ status: 'active', match: 0, common: [], onlyMe: [], newToday: 0, challengePending: false, group: { myState: 'declined', canJoin: true } });
    await api().get(`/api/v1/mixar/${mx}/feed`).set(auth(u.rui)).expect(403);
    await api().get(`/api/v1/mixar/${mx}/challenge`).set(auth(u.rui)).expect(403);
    await api().get(`/api/v1/mixar/${mx}/saved`).set(auth(u.rui)).expect(403);
    await api().get(`/api/v1/mixar/${mx}/more`).set(auth(u.rui)).expect(403);
    await api().get(`/api/v1/mixar/${mx}/topics`).set(auth(u.rui)).expect(403);
  });

  it('o feed junta os gostos dos participantes: a razão diz de quem é; nunca o gosto de quem não entrou', async () => {
    const list = await feed(u.dom);
    items = list.map((i) => i.post.id);
    expect(items.length).toBeGreaterThanOrEqual(10);
    const rows = (await pool.query('SELECT post_id, source, fans FROM social.mixar_items WHERE mixar_id = $1', [mx])).rows;
    // Os fãs são sempre participantes (o Rui, que só gosta de tricot, não conta).
    for (const r of rows) for (const f of (r.fans as string[]) ?? []) expect([u.dom.id, u.ana.id, u.zeca.id]).toContain(f);
    expect(rows.some((r) => r.source === 'all')).toBe(true);
    expect(rows.every((r) => ['all', 'some'].includes(r.source as string))).toBe(true);
    // Uma tcheka de bonsai é de todos; uma de ceramica é de Dom e Ana (para o Dom: «do gosto de Ana e teu»).
    const topicOf = new Map((await pool.query('SELECT id, topics[1] AS t FROM content.posts WHERE id = ANY($1::uuid[])', [items])).rows.map((r) => [r.id as string, r.t as string]));
    const bonsai = list.find((i) => topicOf.get(i.post.id) === 'bonsai')!;
    expect(bonsai.group).toMatchObject({ everyone: true, mine: true });
    expect(bonsai.from).toBe('both');
    const ceramica = list.find((i) => topicOf.get(i.post.id) === 'ceramica');
    expect(ceramica).toBeDefined();
    if (ceramica) {
      expect(ceramica.group.everyone).toBe(false);
      expect(ceramica.group.mine).toBe(true);
      expect(ceramica.group.fans.map((p) => p.username)).toEqual([u.ana.username]);
    }
    const tricot = list.find((i) => topicOf.get(i.post.id) === 'tricot');
    expect(tricot).toBeDefined();
    if (tricot) {
      expect(tricot.group.mine).toBe(false);
      expect(tricot.group.fans.map((p) => p.username)).toEqual([u.zeca.username]);
      expect(tricot.from).toBe('them');
    }
  });

  it('reações e vistos de todos; os Guardados recebem sozinhos o que a maioria reage sem «nah»', async () => {
    const [p1, p2] = items;
    await react(u.ana, p1, 'fogo').expect(200);
    await api().post(`/api/v1/mixar/${mx}/items/${p1}/seen`).set(auth(u.zeca)).send({ watchedMs: 4000, done: true }).expect(204);
    const it1 = (await feed(u.dom)).find((i) => i.post.id === p1)!;
    expect(it1.group.reactions).toEqual([{ person: expect.objectContaining({ username: u.ana.username, verified: true }), reaction: 'fogo' }]);
    expect(it1.group.seenBy.map((p) => p.username)).toEqual([u.zeca.username]);
    // Um só (de 3) reagiu: ainda não entra.
    expect((await api().get(`/api/v1/mixar/${mx}/saved`).set(auth(u.dom)).expect(200)).body.items).toEqual([]);
    const r = (await react(u.zeca, p1, 'amor').expect(200)).body;
    expect(r.mine).toBe('amor');
    expect(r.reactions).toEqual([{ person: expect.objectContaining({ username: u.ana.username }), reaction: 'fogo' }]);
    const s = (await api().get(`/api/v1/mixar/${mx}/saved`).set(auth(u.dom)).expect(200)).body.items;
    expect(s.map((x: GItem) => x.post.id)).toEqual([p1]);
    expect(s[0]).toMatchObject({ savedBy: 'both', savedByPerson: null });
    // Com «nah» não conta.
    await react(u.ana, p2, 'nah').expect(200);
    await react(u.zeca, p2, 'kkk').expect(200);
    expect((await api().get(`/api/v1/mixar/${mx}/saved`).set(auth(u.dom)).expect(200)).body.items).toHaveLength(1);
    // À mão: quem guardou aparece com o nome.
    await api().post(`/api/v1/mixar/${mx}/saved/${p2}`).set(auth(u.ana)).expect(200);
    const s2 = (await api().get(`/api/v1/mixar/${mx}/saved`).set(auth(u.dom)).expect(200)).body.items;
    expect(s2[0]).toMatchObject({ post: { id: p2 }, savedBy: 'them', savedByPerson: { username: u.ana.username, verified: true } });
  });

  it('a conversa de cada item é só dos participantes', async () => {
    const [p1] = items;
    await api().post(`/api/v1/mixar/${mx}/items/${p1}/comments`).set(auth(u.ana)).send({ body: 'Que bonsai lindo' }).expect(201);
    const c = (await api().get(`/api/v1/mixar/${mx}/items/${p1}/comments`).set(auth(u.zeca)).expect(200)).body;
    expect(c.items.map((x: { body: string }) => x.body)).toEqual(['Que bonsai lindo']);
    await api().get(`/api/v1/mixar/${mx}/items/${p1}/comments`).set(auth(u.rui)).expect(403);
    await api().post(`/api/v1/mixar/${mx}/items/${p1}/comments`).set(auth(u.rui)).send({ body: 'olá' }).expect(403);
    await api().get(`/api/v1/mixar/${mx}/items/${p1}/comments`).set(auth(u.eva)).expect(404);
  });

  it('Mixa Challenge: cada um escolhe; só quando todos escolheram se vê quantos escolheram cada opção', async () => {
    const ch = (await api().get(`/api/v1/mixar/${mx}/challenge`).set(auth(u.dom)).expect(200)).body;
    expect(ch).toBeTruthy();
    const [o1, o2] = ch.options.map((p: { id: string }) => p.id);
    const a = (await api().post(`/api/v1/mixar/${mx}/challenge/${ch.id}/pick`).set(auth(u.dom)).send({ postId: o1 }).expect(200)).body;
    expect(a).toMatchObject({ myPick: o1, match: null, group: { picked: 1, total: 3, counts: null } });
    const b = (await api().post(`/api/v1/mixar/${mx}/challenge/${ch.id}/pick`).set(auth(u.ana)).send({ postId: o1 }).expect(200)).body;
    expect(b).toMatchObject({ theirPicked: true, theirPick: null, group: { picked: 2, counts: null } });
    // Falta o Zeca: recebeu o «já escolheu, falta tu» (uma vez), com group: true.
    const pk = await notices(u.zeca, 'mixar_pick');
    expect(pk).toHaveLength(1);
    expect(pk[0].data).toMatchObject({ mixarId: mx, name: 'Malta do Bonsai', group: true });
    const c = (await api().post(`/api/v1/mixar/${mx}/challenge/${ch.id}/pick`).set(auth(u.zeca)).send({ postId: o2 }).expect(200)).body;
    expect(c.match).toBe(false);
    expect(c.group.picked).toBe(3);
    const counts = Object.fromEntries((c.group.counts as { postId: string; n: number }[]).map((x) => [x.postId, x.n]));
    expect(counts[o1]).toBe(2);
    expect(counts[o2]).toBe(1);
    expect((c.group.counts as { n: number }[]).reduce((s, x) => s + x.n, 0)).toBe(3);
    await api().post(`/api/v1/mixar/${mx}/challenge/${ch.id}/pick`).set(auth(u.dom)).send({ postId: o2 }).expect(409);
    expect((await notices(u.dom, 'mixar_result'))[0].data).toMatchObject({ mixarId: mx, group: true, match: false });
  });

  it('«Mais 5» com os gostos do grupo, sem repetir', async () => {
    const before = new Set(items);
    const r = (await api().post(`/api/v1/mixar/${mx}/more`).set(auth(u.ana)).expect(200)).body;
    expect(r.added).toBeGreaterThan(0);
    const after = (await feed(u.zeca)).map((i) => i.post.id);
    expect(after.length).toBe(items.length + r.added);
    expect(after.filter((id) => !before.has(id))).toHaveLength(r.added);
    const fresh = (await pool.query('SELECT fans FROM social.mixar_items WHERE mixar_id = $1 AND NOT (post_id = ANY($2::uuid[]))', [mx, items])).rows;
    expect(fresh.every((x) => Array.isArray(x.fans))).toBe(true);
  });

  it('a lista: os Mixar de grupo vão em `groups` (os a dois ficam em `items`); a bolinha conta com openedAt', async () => {
    const l = (await api().get('/api/v1/mixar').set(auth(u.rui)).expect(200)).body;
    expect(l.items).toEqual([]);
    expect(l.groups).toHaveLength(1);
    expect(l.groups[0]).toMatchObject({ id: mx, name: 'Malta do Bonsai', status: 'active', group: { groupId: g4, myState: 'declined' } });
    // «Agora não» conta como visto (a bolinha do convite some).
    expect(l.groups[0].openedAt).not.toBeNull();
    expect((await api().get('/api/v1/mixar').set(auth(u.zeca)).expect(200)).body.groups[0].openedAt).toBeNull();
    const d = (await api().get('/api/v1/mixar').set(auth(u.dom)).expect(200)).body;
    expect(d.groups[0].group.myState).toBe('in');
    const o = (await api().post(`/api/v1/mixar/${mx}/open`).set(auth(u.dom)).expect(200)).body;
    expect((await api().get('/api/v1/mixar').set(auth(u.dom)).expect(200)).body.groups[0].openedAt).toBe(o.openedAt);
    // Abrir marca como lidos os avisos deste Mixar (também o «mixar_group»).
    await api().post(`/api/v1/mixar/${mx}/open`).set(auth(u.zeca)).expect(200);
    expect((await pool.query(`SELECT read_at FROM social.notifications WHERE user_id = $1 AND kind = 'mixar_group'`, [u.zeca.id])).rows[0].read_at).not.toBeNull();
    await api().get('/api/v1/mixar').set(auth(u.eva)).expect(200, { items: [], groups: [] });
  });

  it('aviso da seleção do dia: a quem participa e ainda não abriu, uma vez, entre as 08:00 e as 21:00', async () => {
    const day = mixarDay();
    await pool.query('UPDATE social.mixars SET accepted_at = $2 WHERE id = $1', [mx, new Date(mixarDayStart(day).getTime() - 3_600_000)]);
    await pool.query('DELETE FROM social.mixar_opens WHERE mixar_id = $1', [mx]);
    const ten = new Date(`${day}T08:00:00Z`); // 10:00 em Maputo
    expect(await grupo.dailyNotices(new Date(`${day}T05:00:00Z`))).toBe(0); // 07:00 em Maputo
    expect(await grupo.dailyNotices(ten)).toBe(3);
    expect(await grupo.dailyNotices(ten)).toBe(0);
    const d = await notices(u.ana, 'mixar_daily');
    expect(d).toHaveLength(1);
    expect(d[0].data).toMatchObject({ mixarId: mx, name: 'Malta do Bonsai', day, group: true });
    expect(await notices(u.rui, 'mixar_daily')).toEqual([]);
  });

  it('os avisos já enviados vão na exportação e apagam-se ao fim de 30 dias (na limpeza diária do Mixar)', async () => {
    const day = mixarDay();
    const e = (await api().get('/api/v1/me/export').set(auth(u.ana)).expect(200)).body;
    expect(e.mixarNotices).toEqual(expect.arrayContaining([expect.objectContaining({ mixarId: mx, kind: 'daily', ref: day })]));
    const count = async () => (await pool.query('SELECT count(*)::int AS n FROM social.mixar_notices WHERE mixar_id = $1', [mx])).rows[0].n as number;
    const had = await count();
    expect(had).toBeGreaterThanOrEqual(3);
    // Um registo antigo (há 31 dias) sai; os de hoje ficam.
    await pool.query(`INSERT INTO social.mixar_notices (mixar_id, user_id, kind, ref, created_at) VALUES ($1, $2, 'daily', '2000-01-01', now() - interval '31 days')`, [mx, u.dom.id]);
    expect(await count()).toBe(had + 1);
    await app.get(MixarService).purge();
    expect(await count()).toBe(had);
    // 31 dias depois, já nada fica.
    await app.get(MixarService).purge(new Date(Date.now() + 31 * 86_400_000));
    expect(await count()).toBe(0);
  });

  it('quem aceita mais tarde entra; sair do grupo é sair do Mixar (deixa de ver); com menos de 3 acaba', async () => {
    const r = (await api().post(`/api/v1/mixar/${mx}/accept`).set(auth(u.rui)).expect(200)).body;
    expect(r.group.people).toHaveLength(4);
    expect((await feed(u.rui)).length).toBeGreaterThan(0);
    // O Zeca sai do grupo: já não vê o Mixar (404) e deixa de contar.
    await api().delete(`/api/v1/chat/groups/${g4}/members/${u.zeca.username}`).set(auth(u.zeca)).expect(204);
    await api().get(`/api/v1/mixar/${mx}`).set(auth(u.zeca)).expect(404);
    await api().get(`/api/v1/mixar/${mx}/feed`).set(auth(u.zeca)).expect(404);
    const after = (await api().get(`/api/v1/mixar/${mx}`).set(auth(u.dom)).expect(200)).body;
    expect(after).toMatchObject({ status: 'active' });
    expect(after.group.people.map((p: Person) => p.username)).toEqual([u.dom.username, u.ana.username, u.rui.username]);
    expect((await pool.query('SELECT state FROM social.mixar_members WHERE mixar_id = $1 AND user_id = $2', [mx, u.zeca.id])).rows[0].state).toBe('left');
    // O Rui sai do Mixar (fica no grupo): ficam 2, acaba para todos.
    await api().delete(`/api/v1/mixar/${mx}`).set(auth(u.rui)).expect(200, { ok: true });
    expect((await pool.query('SELECT status FROM social.mixars WHERE id = $1', [mx])).rows[0].status).toBe('ended');
    await api().get(`/api/v1/mixar/${mx}`).set(auth(u.dom)).expect(404);
    await api().get(`/api/v1/mixar/grupo/${g4}`).set(auth(u.dom)).expect(404);
    expect((await api().get('/api/v1/mixar').set(auth(u.dom)).expect(200)).body.groups).toEqual([]);
    // O grupo ficou com 3: pode propor outro.
    await api().post(`/api/v1/mixar/grupo/${g4}`).set(auth(u.ana)).expect(201);
  });

  it('o Mixar a dois continua igual (convite, aceitar, feed com a/b/both, sem `group`)', async () => {
    pair = (await api().post('/api/v1/mixar/invite').set(auth(u.dom)).send({ username: u.ana.username }).expect(201)).body.id;
    const a = (await api().post(`/api/v1/mixar/${pair}/accept`).set(auth(u.ana)).expect(200)).body;
    expect(a.status).toBe('active');
    expect(a.group).toBeUndefined();
    expect(a.name).toBe('Ana + Dom');
    const f = (await api().get(`/api/v1/mixar/${pair}/feed?limit=24`).set(auth(u.dom)).expect(200)).body.items as GItem[];
    expect(f.length).toBeGreaterThan(0);
    for (const i of f) expect(i.group).toBeUndefined();
    expect((await pool.query('SELECT DISTINCT source FROM social.mixar_items WHERE mixar_id = $1', [pair])).rows.every((r) => ['a', 'b', 'both'].includes(r.source as string))).toBe(true);
    expect((await pool.query('SELECT count(*)::int AS n FROM social.mixar_items WHERE mixar_id = $1 AND fans IS NOT NULL', [pair])).rows[0].n).toBe(0);
    const p = f[0].post.id;
    expect((await api().post(`/api/v1/mixar/${pair}/items/${p}/react`).set(auth(u.dom)).send({ reaction: 'fogo' }).expect(200)).body).toEqual({ mine: 'fogo', theirs: null });
    await api().post(`/api/v1/mixar/${pair}/items/${p}/react`).set(auth(u.ana)).send({ reaction: 'kkk' }).expect(200);
    expect((await api().get(`/api/v1/mixar/${pair}/saved`).set(auth(u.dom)).expect(200)).body.items.map((x: GItem) => x.post.id)).toEqual([p]);
    // Um terceiro (o Rui, do mesmo grupo) não vê o Mixar a dois.
    await api().get(`/api/v1/mixar/${pair}`).set(auth(u.rui)).expect(404);
    const l = (await api().get('/api/v1/mixar').set(auth(u.dom)).expect(200)).body;
    expect(l.items.map((x: { id: string }) => x.id)).toEqual([pair]);
    expect(l.items[0].group).toBeUndefined();
  });

  it('a exportação traz os Mixar de grupo; apagar a conta tira a pessoa e o que fez; apagar o grupo apaga o Mixar', async () => {
    const e = (await api().get('/api/v1/me/export').set(auth(u.zeca)).expect(200)).body;
    expect(e.mixarGroups).toEqual([expect.objectContaining({ id: mx, group: 'Malta do Bonsai', state: 'left', proposedByMe: false, status: 'ended' })]);
    const d = (await api().get('/api/v1/me/export').set(auth(u.dom)).expect(200)).body;
    expect(d.mixarGroups.map((x: { id: string; proposedByMe: boolean }) => [x.id, x.proposedByMe])).toContainEqual([mx, true]);

    // A Ana apaga a conta: sai do grupo (e o Mixar novo, que ela propôs, fica com 1 e acaba) e o que fez sai.
    const open = (await pool.query(`SELECT id FROM social.mixars WHERE group_id = $1 AND status IN ('pending', 'active')`, [g4])).rows[0].id as string;
    await api().post('/api/v1/auth/delete-account').set(auth(u.ana)).send({ confirmUsername: u.ana.username, password: PASSWORD }).expect(204);
    const left = async (t: string) => (await pool.query(`SELECT count(*)::int AS n FROM social.${t} WHERE user_id = $1`, [u.ana.id])).rows[0].n as number;
    for (const t of ['mixar_members', 'mixar_reactions', 'mixar_views', 'mixar_picks', 'mixar_comments', 'mixar_opens']) expect(await left(t)).toBe(0);
    expect((await pool.query('SELECT status FROM social.mixars WHERE id = $1', [open])).rows[0].status).toBe('ended');

    // Apagar o grupo (o último sai) leva o Mixar dele e tudo o que estava pendurado.
    const g3 = (await api().post('/api/v1/chat/groups').set(auth(u.eva)).send({ name: 'Trio', members: [u.tia.username, u.rui.username] }).expect(201)).body.id as string;
    const m3 = (await api().post(`/api/v1/mixar/grupo/${g3}`).set(auth(u.eva)).expect(201)).body.id as string;
    await api().post(`/api/v1/mixar/${m3}/accept`).set(auth(u.tia)).expect(200);
    await api().post(`/api/v1/mixar/${m3}/accept`).set(auth(u.rui)).expect(200);
    await pool.query('DELETE FROM social.groups WHERE id = $1', [g3]);
    expect((await pool.query('SELECT count(*)::int AS n FROM social.mixars WHERE id = $1', [m3])).rows[0].n).toBe(0);
    expect((await pool.query('SELECT count(*)::int AS n FROM social.mixar_members WHERE mixar_id = $1', [m3])).rows[0].n).toBe(0);
  });
});
