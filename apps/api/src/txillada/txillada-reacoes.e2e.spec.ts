import 'reflect-metadata';
import { createHash } from 'crypto';
import { INestApplication } from '@nestjs/common';
import { decodeJwt } from 'jose';
import { AccessToken } from 'livekit-server-sdk';
import request from 'supertest';
import { Pool } from 'pg';
import { loadConfig } from '../config';
import { migrate } from '../db/migrate';
import { createApp } from '../main';
import { RealtimeBus } from '../realtime/realtime-bus';
import { RATE_STORE, type RateStore } from '../security/rate-store';
import type { LiveKitRooms } from './livekit';

const DB = process.env.TEST_DATABASE_URL ?? 'postgres://txill:txill_dev@localhost:5433/txillapp_test';
const PASSWORD = 'password-bem-longa-1';
const LK = { LIVEKIT_URL: 'ws://localhost:7880', LIVEKIT_API_KEY: 'devkey', LIVEKIT_API_SECRET: 'secret' };

interface U { token: string; id: string; username: string; ip: string }

/**
 * Txillada moderna: as reações (POST /txilladas/:id/react, não se guardam; o 🍻 conta como brinde), quem está a ver
 * (GET /txilladas/:id/viewers), o «@fulano entrou» (txillada.joined) e os espectadores visíveis (tokens sem hidden).
 * O LiveKit é falso (LIVEKIT_ROOMS); os eventos apanham-se no RealtimeBus.publish.
 */
describe('Txillada: reações, quem está a ver e «entrou» (integração)', () => {
  let app: INestApplication;
  let pool: Pool;
  let rates: RateStore;
  const run = Date.now().toString(36);
  const api = () => request(app.getHttpServer());
  const auth = (x: U) => ({ Authorization: `Bearer ${x.token}`, 'X-Forwarded-For': x.ip });
  const u: Record<string, U> = {};
  const events: { to: string; e: any }[] = [];
  const rooms: LiveKitRooms = {
    removeParticipant: async () => undefined,
    deleteRoom: async () => undefined,
    participants: async () => [],
  };
  let n = 0;
  const net = Math.floor(Math.random() * 256);

  async function signup(name: string): Promise<U> {
    const username = `${name}${run}`.slice(0, 28);
    n++;
    // Uma rede /24 diferente em cada corrida (o limite de contas novas por rede e por dia não trava as corridas seguidas).
    const ip = `10.161.${net}.${n}`;
    const r = await api().post('/api/v1/auth/register').set('X-Forwarded-For', ip)
      .send({ email: `${username}@example.com`, username, displayName: `${name} Teste`, password: PASSWORD, birthDate: '1990-06-15', acceptTerms: true }).expect(201);
    await pool.query('UPDATE identity.users SET email_verified_at = now() WHERE id = $1', [r.body.user.id]);
    return { token: r.body.accessToken, id: r.body.user.id, username, ip };
  }
  const open = async (x: U, title = 'Bora') => (await api().post('/api/v1/txilladas').set(auth(x)).send({ title, audience: 'everyone' }).expect(201)).body.txillada.id as string;
  const join = (x: U, id: string) => api().post(`/api/v1/txilladas/${id}/join`).set(auth(x)).expect(200);
  const react = (x: U, id: string, body: Record<string, unknown>) => api().post(`/api/v1/txilladas/${id}/react`).set(auth(x)).send(body);
  const viewers = (x: U, id: string) => api().get(`/api/v1/txilladas/${id}/viewers`).set(auth(x));
  const txEvents = (x: U, type: string, id?: string) => events.filter((e) => e.to === x.id && e.e?.type === type && (!id || e.e.txilladaId === id)).map((e) => e.e);
  const endAll = (x: U) => pool.query(`UPDATE content.txilladas SET status = 'ended', ended_at = now() WHERE host_id = $1 AND status = 'live'`, [x.id]);
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const count = async (sql: string, args: unknown[]) => (await pool.query(sql, args)).rows[0].n as number;

  async function webhook(ev: Record<string, unknown>) {
    const body = JSON.stringify({ id: `EV_${Math.random().toString(36).slice(2)}`, createdAt: String(Math.floor(Date.now() / 1000)), ...ev });
    const at = new AccessToken('devkey', 'secret');
    at.sha256 = createHash('sha256').update(body).digest('base64');
    return api().post('/api/v1/txilladas/livekit-webhook').set('Content-Type', 'application/webhook+json').set('Authorization', await at.toJwt()).send(body).expect(200);
  }

  beforeAll(async () => {
    await migrate(DB);
    pool = new Pool({ connectionString: DB });
    app = await createApp(
      loadConfig({ DATABASE_URL: DB, JWT_ACCESS_SECRET: 't'.repeat(40), NODE_ENV: 'test', MEDIA_DIR: './uploads-test', ...LK }),
      { livekitRooms: rooms },
    );
    await app.init();
    rates = app.get(RATE_STORE);
    const bus = app.get(RealtimeBus);
    const publish = bus.publish.bind(bus);
    jest.spyOn(bus, 'publish').mockImplementation((to: string, e: unknown) => {
      events.push({ to, e });
      publish(to, e);
    });
    for (const name of ['rhost', 'rana', 'rblk', 'rrui', 'rzed', 'rout', 'rban']) u[name] = await signup(name);
    // A Ana bloqueia o Blk (os dois veem o anfitrião, mas não se veem um ao outro).
    await api().put(`/api/v1/blocks/${u.rblk.username}`).set(auth(u.rana)).expect((r) => expect([200, 204]).toContain(r.status));
    // O anfitrião bloqueia o Out (não vê as Txilladas dele).
    await api().put(`/api/v1/blocks/${u.rout.username}`).set(auth(u.rhost)).expect((r) => expect([200, 204]).toContain(r.status));
    // A Ana segue o Zed (aparece primeiro na lista de quem está a ver, para ela).
    await api().post(`/api/v1/users/${u.rzed.username}/follow`).set(auth(u.rana)).expect(200);
  }, 180_000);

  beforeEach(async () => {
    for (const x of Object.values(u)) await endAll(x);
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
    jest.restoreAllMocks();
  });

  it('tokens: o espectador entra visível (sem hidden), como o anfitrião', async () => {
    const { rhost, rana } = u;
    const created = (await api().post('/api/v1/txilladas').set(auth(rhost)).send({ title: 'Visível', audience: 'everyone' }).expect(201)).body;
    expect(decodeJwt(created.token).video).not.toHaveProperty('hidden');
    const v = (await join(rana, created.txillada.id)).body;
    expect(decodeJwt(v.token).video).toMatchObject({ roomJoin: true, canPublish: false, canSubscribe: true });
    expect(decodeJwt(v.token).video).not.toHaveProperty('hidden');
    expect(JSON.parse(String(decodeJwt(v.token).metadata))).toEqual({ username: rana.username });
  });

  it('react: o evento chega ao anfitrião e a quem vê (não a quem tem bloqueio com quem reagiu) e nada se guarda', async () => {
    const { rhost, rana, rblk, rrui } = u;
    const id = await open(rhost, 'Reações');
    for (const x of [rana, rblk, rrui]) await join(x, id);
    const comments = () => count('SELECT count(*)::int AS n FROM content.txillada_comments WHERE txillada_id = $1', [id]);
    const cheerRows = () => count('SELECT count(*)::int AS n FROM content.txillada_cheers WHERE txillada_id = $1', [id]);
    const row = async () => (await pool.query('SELECT comments, cheers FROM content.txilladas WHERE id = $1', [id])).rows[0];
    const before = { comments: await comments(), cheers: await cheerRows(), row: await row() };

    const r = (await react(rana, id, { kind: 'fire' }).expect(200)).body;
    expect(r).toEqual({ sent: true });
    const ev = { type: 'txillada.reaction', txilladaId: id, kind: 'fire', from: { username: rana.username, displayName: 'rana Teste', avatarUrl: null, verified: false, verifiedTier: null, host: false } };
    expect(txEvents(rhost, 'txillada.reaction', id).at(-1)).toEqual(ev);
    expect(txEvents(rrui, 'txillada.reaction', id).at(-1)).toEqual(ev);
    expect(txEvents(rblk, 'txillada.reaction', id)).toHaveLength(0);
    // O Blk reage: a Ana (que o bloqueou) não recebe; o anfitrião e o Rui sim.
    await react(rblk, id, { kind: 'heart' }).expect(200);
    expect(txEvents(rana, 'txillada.reaction', id).filter((e) => e.from.username === rblk.username)).toHaveLength(0);
    expect(txEvents(rrui, 'txillada.reaction', id).at(-1)).toMatchObject({ kind: 'heart', from: { username: rblk.username } });
    // O anfitrião reage: chega a todos, com host: true.
    await react(rhost, id, { kind: 'laugh' }).expect(200);
    for (const x of [rana, rblk, rrui]) expect(txEvents(x, 'txillada.reaction', id).at(-1)).toMatchObject({ kind: 'laugh', from: { username: rhost.username, host: true } });
    // Quem está fora da sala (não fez join) não recebe.
    expect(txEvents(u.rzed, 'txillada.reaction', id)).toHaveLength(0);
    // Nada guardado: nem comentários, nem brindes, nem os números da Txillada.
    expect({ comments: await comments(), cheers: await cheerRows(), row: await row() }).toEqual(before);
    // Validação.
    await react(rana, id, { kind: 'xpto' }).expect(400);
    await react(rana, id, {}).expect(400);
  });

  it('react: 404 a quem não pode ver, 403 ao expulso, 409 acabada', async () => {
    const { rhost, rana, rout, rban } = u;
    const id = await open(rhost, 'Regras');
    await react(rout, id, { kind: 'fire' }).expect(404);
    await join(rban, id);
    await api().post(`/api/v1/txilladas/${id}/ban/${rban.username}`).set(auth(rhost)).expect(204);
    expect((await react(rban, id, { kind: 'fire' }).expect(403)).body.message).toMatch(/tirou-te/);
    await react(rana, '11111111-1111-4111-8111-111111111111', { kind: 'fire' }).expect(404);
    await api().post(`/api/v1/txilladas/${id}/end`).set(auth(rhost)).expect(200);
    await react(rana, id, { kind: 'fire' }).expect(409);
    await react(rhost, id, { kind: 'hello' }).expect(409);
  });

  it('react 🍻: conta como um brinde (cheers e txillada_cheers), manda txillada.cheer; o anfitrião não brinda', async () => {
    const { rhost, rana, rrui } = u;
    const id = await open(rhost, 'Brindes');
    await join(rana, id);
    await join(rrui, id);
    expect((await react(rana, id, { kind: 'cheers' }).expect(200)).body).toEqual({ sent: true, cheers: 1 });
    expect((await react(rana, id, { kind: 'cheers' }).expect(200)).body).toEqual({ sent: true, cheers: 2 });
    await api().post(`/api/v1/txilladas/${id}/cheer`).set(auth(rrui)).expect(200);
    expect((await api().get(`/api/v1/txilladas/${id}`).set(auth(rrui)).expect(200)).body.cheers).toBe(3);
    expect((await pool.query('SELECT count FROM content.txillada_cheers WHERE txillada_id = $1 AND user_id = $2', [id, rana.id])).rows[0].count).toBe(2);
    expect(txEvents(rhost, 'txillada.cheer', id).map((e) => e.cheers)).toEqual([1, 2, 3]);
    expect(txEvents(rrui, 'txillada.reaction', id).filter((e) => e.kind === 'cheers')).toHaveLength(2);
    const host = await react(rhost, id, { kind: 'cheers' }).expect(400);
    expect(host.body.message).toBe('Não podes brindar a tua própria Txillada.');
    expect((await api().get(`/api/v1/txilladas/${id}`).set(auth(rrui)).expect(200)).body.cheers).toBe(3);
  });

  it('react: no máximo 8 por segundo por pessoa (429)', async () => {
    const { rhost, rrui } = u;
    const id = await open(rhost, 'Rajada');
    await join(rrui, id);
    // 20 de uma vez: no máximo 8 por janela de 1 s (mesmo que a rajada caia em duas janelas, pelo menos 4 ficam de fora).
    const burst = await Promise.all(Array.from({ length: 20 }, () => react(rrui, id, { kind: 'fire' })));
    const ok = burst.filter((r) => r.status === 200).length;
    const slow = burst.filter((r) => r.status === 429);
    expect(ok + slow.length).toBe(20);
    expect(ok).toBeLessThanOrEqual(16);
    expect(slow.length).toBeGreaterThanOrEqual(4);
    expect(slow[0].body.message).toBe('Calma! Muitas reações seguidas.');
    await wait(1_100);
    await react(rrui, id, { kind: 'fire' }).expect(200);
  });

  it('olá: quem vê, 1 a cada 4 s; `to` só do anfitrião e só com olá; o anfitrião responde a quem entrou', async () => {
    const { rhost, rana, rrui, rout } = u;
    const id = await open(rhost, 'Olá');
    await join(rana, id);
    await join(rrui, id);
    expect((await react(rana, id, { kind: 'hello' }).expect(200)).body).toEqual({ sent: true });
    expect((await react(rana, id, { kind: 'hello' }).expect(429)).body.message).toBe('Calma! Muitas reações seguidas.');
    await react(rana, id, { kind: 'heart' }).expect(200);
    // O olá do anfitrião (a saudação a todos) não tem o limite dos 4 s.
    await react(rhost, id, { kind: 'hello' }).expect(200);
    // As contas verificadas levam sempre o selo (o nome nunca aparece sem ele).
    await pool.query(`UPDATE identity.users SET verified = true, verified_tier = 'official' WHERE username = $1`, [rhost.username]);
    await react(rhost, id, { kind: 'hello' }).expect(200);
    expect(txEvents(rana, 'txillada.reaction', id).at(-1)).toEqual({
      type: 'txillada.reaction', txilladaId: id, kind: 'hello',
      from: { username: rhost.username, displayName: 'rhost Teste', avatarUrl: null, verified: true, verifiedTier: 'official', host: true },
    });
    // `to`: só o anfitrião, só com 'hello', a alguém que existe e sem bloqueio com ele.
    await react(rrui, id, { kind: 'hello', to: rana.username }).expect(400);
    await react(rhost, id, { kind: 'fire', to: rana.username }).expect(400);
    await react(rhost, id, { kind: 'hello', to: `naoexiste${run}` }).expect(404);
    await react(rhost, id, { kind: 'hello', to: rout.username }).expect(404);
    await react(rhost, id, { kind: 'hello', to: rhost.username }).expect(400);
    expect((await react(rhost, id, { kind: 'hello', to: `@${rana.username.toUpperCase()}` }).expect(200)).body).toEqual({ sent: true });
    const e = txEvents(rrui, 'txillada.reaction', id).at(-1);
    expect(e).toEqual({ type: 'txillada.reaction', txilladaId: id, kind: 'hello', from: expect.objectContaining({ username: rhost.username, host: true }), to: { username: rana.username, verified: false, verifiedTier: null } });
    expect(txEvents(rana, 'txillada.reaction', id).at(-1)).toMatchObject({ to: { username: rana.username } });
  });

  it('a sala acima de 40 reações por segundo: não se difunde (sent: false), mas o 🍻 conta', async () => {
    const { rhost, rana, rrui } = u;
    const id = await open(rhost, 'Cheia');
    await join(rana, id);
    await join(rrui, id);
    await wait(1_100); // as rajadas dos outros testes
    // A sala já vai acima das 40 neste segundo (sem depender do relógio: a máquina dos testes pode ir lenta).
    const hit = rates.hit.bind(rates);
    const spy = jest.spyOn(rates, 'hit').mockImplementation(async (key, ms) => (key === `tx:react-room:${id}` ? REACT_ROOM_FILL : hit(key, ms)));
    const evBefore = txEvents(rhost, 'txillada.reaction', id).length + txEvents(rhost, 'txillada.cheer', id).length;
    expect((await react(rana, id, { kind: 'fire' }).expect(200)).body).toEqual({ sent: false });
    expect((await react(rrui, id, { kind: 'cheers' }).expect(200)).body).toEqual({ sent: false, cheers: 1 });
    expect(txEvents(rhost, 'txillada.reaction', id).length + txEvents(rhost, 'txillada.cheer', id).length).toBe(evBefore);
    spy.mockRestore();
    // A sala acalma: volta a difundir.
    expect((await react(rana, id, { kind: 'laugh' }).expect(200)).body).toEqual({ sent: true });
    expect((await pool.query('SELECT cheers FROM content.txilladas WHERE id = $1', [id])).rows[0].cheers).toBe(1);
    expect((await pool.query('SELECT count FROM content.txillada_cheers WHERE txillada_id = $1 AND user_id = $2', [id, rrui.id])).rows[0].count).toBe(1);
  });

  it('viewers: quem está a ver agora (sem o anfitrião, sem bloqueios com quem pede, sem expulsos), quem sigo primeiro', async () => {
    const { rhost, rana, rblk, rrui, rzed, rout } = u;
    const id = await open(rhost, 'Quem vê');
    expect((await viewers(rana, id).expect(200)).body).toEqual({ items: [], total: 0 });
    await join(rhost, id);
    for (const x of [rrui, rblk, rana, rzed]) await join(x, id);
    const names = (b: { items: { username: string }[] }) => b.items.map((x) => x.username);
    // A Ana: o Zed (que ela segue) primeiro, depois pelo @; sem o Blk (bloqueio) e sem o anfitrião.
    const a = (await viewers(rana, id).expect(200)).body;
    expect(names(a)).toEqual([rzed.username, rana.username, rrui.username]);
    expect(a.total).toBe(3);
    expect(a.items[0]).toEqual({ username: rzed.username, displayName: 'rzed Teste', avatarUrl: null, verified: false, verifiedTier: null });
    expect(Object.keys(a.items[0]).sort()).toEqual(['avatarUrl', 'displayName', 'username', 'verified', 'verifiedTier']);
    expect(JSON.stringify(a)).not.toContain(rzed.id);
    // O Rui vê o Blk; o anfitrião vê todos, pelo @.
    expect(names((await viewers(rrui, id).expect(200)).body)).toEqual(expect.arrayContaining([rblk.username, rana.username, rrui.username, rzed.username]));
    const h = (await viewers(rhost, id).expect(200)).body;
    expect(names(h)).toEqual([rana.username, rblk.username, rrui.username, rzed.username]);
    expect(h.total).toBe(4);
    // Quem não pode ver: 404.
    await viewers(rout, id).expect(404);
    // Expulso: sai da lista (e não a pode pedir); conta suspensa também sai; quem sai da sala (webhook) também.
    await api().post(`/api/v1/txilladas/${id}/ban/${rrui.username}`).set(auth(rhost)).expect(204);
    await viewers(rrui, id).expect(403);
    await pool.query(`UPDATE identity.users SET status = 'suspended' WHERE id = $1`, [rzed.id]);
    try {
      expect(names((await viewers(rhost, id).expect(200)).body)).toEqual([rana.username, rblk.username]);
    } finally {
      await pool.query(`UPDATE identity.users SET status = 'active' WHERE id = $1`, [rzed.id]);
    }
    await webhook({ event: 'participant_left', room: { name: `tx-${id}` }, participant: { identity: rana.id } });
    expect(names((await viewers(rhost, id).expect(200)).body)).toEqual([rblk.username, rzed.username]);
  });

  it('joined: «@fulano entrou» chega ao anfitrião e a quem vê, não ao próprio nem a quem tem bloqueio, e não repete na religação', async () => {
    const { rhost, rana, rblk, rrui } = u;
    const id = await open(rhost, 'Entradas');
    await join(rhost, id);
    await join(rana, id);
    expect(txEvents(rhost, 'txillada.joined', id)).toEqual([
      { type: 'txillada.joined', txilladaId: id, user: { username: rana.username, displayName: 'rana Teste', avatarUrl: null, verified: false, verifiedTier: null } },
    ]);
    expect(txEvents(rana, 'txillada.joined', id)).toHaveLength(0);
    await join(rrui, id);
    expect(txEvents(rana, 'txillada.joined', id).map((e) => e.user.username)).toEqual([rrui.username]);
    expect(txEvents(rhost, 'txillada.joined', id).map((e) => e.user.username)).toEqual([rana.username, rrui.username]);
    // O Blk entra: a Ana (que o bloqueou) não sabe; o anfitrião e o Rui sim.
    await join(rblk, id);
    expect(txEvents(rana, 'txillada.joined', id).map((e) => e.user.username)).toEqual([rrui.username]);
    expect(txEvents(rrui, 'txillada.joined', id).map((e) => e.user.username)).toEqual([rblk.username]);
    expect(txEvents(rhost, 'txillada.joined', id).map((e) => e.user.username)).toEqual([rana.username, rrui.username, rblk.username]);
    expect(txEvents(rblk, 'txillada.joined', id)).toHaveLength(0);
    // Religações (join outra vez dentro dos 60 s) e o anfitrião a entrar: nada de novo.
    await join(rana, id);
    await join(rana, id);
    await join(rhost, id);
    expect(txEvents(rhost, 'txillada.joined', id)).toHaveLength(3);
    expect(txEvents(rrui, 'txillada.joined', id)).toHaveLength(1);
    // Nenhum id interno no evento.
    const sentJoined = JSON.stringify(events.filter((e) => e.e?.type === 'txillada.joined').map((e) => e.e));
    for (const x of [rana, rrui, rblk]) expect(sentJoined).not.toContain(x.id);
    expect(sentJoined).not.toContain('"id"');
  });
});

/** Quantas reações a sala «já teve» neste segundo (acima das 40). */
const REACT_ROOM_FILL = 45;
