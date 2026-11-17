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
import { PushService, type PushPayload } from '../push/push.service';
import type { LiveKitRooms } from './livekit';
import { TxilladaService } from './txillada.service';

const DB = process.env.TEST_DATABASE_URL ?? 'postgres://txill:txill_dev@localhost:5433/txillapp_test';
const PASSWORD = 'password-bem-longa-1';
const LK = { LIVEKIT_URL: 'ws://localhost:7880', LIVEKIT_API_KEY: 'devkey', LIVEKIT_API_SECRET: 'secret' };

interface U { token: string; id: string; username: string; ip: string }

/**
 * Reabrir (0174), docs/txillada-contrato.md: o anfitrião acabou uma Angariação antes da meta e reabre-a (a mesma Txillada,
 * sala nova, relógio a zero), até 24 h depois e no máximo 3 vezes; as entradas pagas continuam a valer; quem ofereceu é avisado.
 * Sem o servidor LiveKit (o cliente da sala é um falso) e com os pushes guardados em vez de enviados.
 */
describe('Txillada: reabrir uma Angariação (integração)', () => {
  let app: INestApplication;
  let pool: Pool;
  let svc: TxilladaService;
  const run = Date.now().toString(36);
  const api = () => request(app.getHttpServer());
  const auth = (x: U) => ({ Authorization: `Bearer ${x.token}`, 'X-Forwarded-For': x.ip });
  const u: Record<string, U> = {};
  const pushes: { userId: string; p: PushPayload }[] = [];
  const deleted: string[] = [];
  const rooms: LiveKitRooms = {
    removeParticipant: async () => undefined,
    deleteRoom: async (room: string) => {
      deleted.push(room);
    },
    // O anfitrião está sempre com vídeo (a tarefa não acaba nada por falta dele).
    participants: async () => [],
    setCanPublish: async () => undefined,
  };
  let n = 0;

  async function signup(name: string): Promise<U> {
    const username = `${name}${run}`.slice(0, 28);
    n++;
    const ip = `10.175.${n >> 8}.${n & 255}`;
    const r = await api().post('/api/v1/auth/register').set('X-Forwarded-For', ip)
      .send({ email: `${username}@example.com`, username, displayName: `${name[0].toUpperCase()}${name.slice(1)} Teste`, password: PASSWORD, birthDate: '1990-06-15', acceptTerms: true }).expect(201);
    await pool.query('UPDATE identity.users SET email_verified_at = now() WHERE id = $1', [r.body.user.id]);
    return { token: r.body.accessToken, id: r.body.user.id, username, ip };
  }
  const open = (x: U, body: Record<string, unknown> = {}) => api().post('/api/v1/txilladas').set(auth(x)).send({ title: 'Ajuda', ...body });
  const get = (x: U, id: string) => api().get(`/api/v1/txilladas/${id}`).set(auth(x));
  const end = (x: U, id: string) => api().post(`/api/v1/txilladas/${id}/end`).set(auth(x)).expect(200);
  const reopen = (x: U, id: string) => api().post(`/api/v1/txilladas/${id}/reopen`).set(auth(x));
  const join = (x: U, id: string) => api().post(`/api/v1/txilladas/${id}/join`).set(auth(x));
  const gift = (x: U, id: string, amount: number) => api().post(`/api/v1/txilladas/${id}/gifts`).set(auth(x)).send({ amount, key: `k${Math.random().toString(36).slice(2, 12)}` });
  const balance = async (x: U) => (await api().get('/api/v1/wallet').set(auth(x)).expect(200)).body.balance as number;
  const row = async (id: string) => (await pool.query('SELECT status, room, started_at, ended_at, raised, reopens, pinned_comment_id FROM content.txilladas WHERE id = $1', [id])).rows[0];
  const lives = async (x: U, id: string) =>
    (await pool.query(`SELECT data FROM social.notifications WHERE user_id = $1 AND kind = 'txillada_live' AND data->>'txilladaId' = $2 ORDER BY id`, [x.id, id])).rows.map((r) => r.data);
  async function until(f: () => Promise<boolean>) {
    for (let i = 0; i < 50 && !(await f()); i++) await new Promise((r) => setTimeout(r, 20));
  }
  async function webhook(ev: Record<string, unknown>) {
    const body = JSON.stringify({ id: `EV_${Math.random().toString(36).slice(2)}`, createdAt: String(Math.floor(Date.now() / 1000)), ...ev });
    const at = new AccessToken('devkey', 'secret');
    at.sha256 = createHash('sha256').update(body).digest('base64');
    return api().post('/api/v1/txilladas/livekit-webhook').set('Content-Type', 'application/webhook+json').set('Authorization', await at.toJwt()).send(body);
  }

  beforeAll(async () => {
    await migrate(DB);
    pool = new Pool({ connectionString: DB });
    app = await createApp(
      loadConfig({ DATABASE_URL: DB, JWT_ACCESS_SECRET: 't'.repeat(40), NODE_ENV: 'test', MEDIA_DIR: './uploads-test', ...LK }),
      { livekitRooms: rooms },
    );
    await app.init();
    svc = app.get(TxilladaService);
    const push = app.get(PushService);
    Object.defineProperty(push, 'enabled', { value: true });
    jest.spyOn(push, 'send').mockImplementation(async (userId: string, p: PushPayload) => {
      pushes.push({ userId, p });
      return 1;
    });
    for (const name of ['host', 'ana', 'rui', 'h2', 'h3', 'h4', 'hp', 'pa']) u[name] = await signup(name);
  }, 240_000);

  afterAll(async () => {
    await app.close();
    await pool.end();
    jest.restoreAllMocks();
  });

  it('reabrir: a mesma Txillada a decorrer, sala nova, o relógio a zero, o que se juntou e quem ofereceu ficam; quem ofereceu é avisado', async () => {
    const { host, ana, rui } = u;
    const id = (await open(host, { goal: 100, purpose: 'Livros' }).expect(201)).body.txillada.id as string;
    expect((await get(host, id).expect(200)).body).toMatchObject({ status: 'live', canReopen: false, reopenUntil: null });
    await gift(ana, id, 30).expect(200);
    const c = (await api().post(`/api/v1/txilladas/${id}/comments`).set(auth(ana)).send({ body: 'força' }).expect(201)).body;
    await api().post(`/api/v1/txilladas/${id}/pin`).set(auth(host)).send({ commentId: c.id }).expect(200);
    const before = await row(id);
    const ended = (await end(host, id)).body;
    expect(ended).toMatchObject({ status: 'ended', canReopen: true, raised: 30, goal: 100 });
    expect(new Date(ended.reopenUntil).getTime() - new Date(ended.endedAt).getTime()).toBe(24 * 3_600_000);
    // Quem não é o anfitrião não vê os campos de reabrir.
    const forRui = (await get(rui, id).expect(200)).body;
    expect(forRui).not.toHaveProperty('canReopen');
    expect(forRui).not.toHaveProperty('reopenUntil');
    await new Promise((r) => setTimeout(r, 20));
    pushes.length = 0;

    const r = (await reopen(host, id).expect(200)).body;
    expect(r).toMatchObject({
      id, status: 'live', endedAt: null, title: 'Ajuda', goal: 100, goalPurpose: 'Livros', raised: 30, viewers: 0,
      canReopen: false, reopenUntil: null, pinned: null, guests: [],
      topGivers: [{ username: ana.username, total: 30 }],
    });
    const after = await row(id);
    expect(after).toMatchObject({ status: 'live', reopens: 1, pinned_comment_id: null, ended_at: null });
    expect(after.room).not.toBe(before.room);
    expect(after.room).toBe(`tx-${id}-r1`);
    expect(new Date(after.started_at).getTime()).toBeGreaterThan(new Date(before.started_at).getTime());
    // Os comentários continuam.
    expect((await api().get(`/api/v1/txilladas/${id}/comments`).set(auth(rui)).expect(200)).body.items.map((x: any) => x.id)).toContain(c.id);
    // O token novo é da sala nova; o room_finished da sala antiga não a acaba.
    const tok = decodeJwt((await join(rui, id).expect(200)).body.token) as { video?: { room?: string } };
    expect(tok.video?.room).toBe(after.room);
    expect((await webhook({ event: 'room_finished', room: { name: before.room } })).status).toBe(200);
    expect((await row(id)).status).toBe('live');
    // A tarefa não a acaba logo (o vídeo tem os mesmos 60 s de folga de uma nova).
    await svc.sweep();
    expect((await row(id)).status).toBe('live');
    // Quem ofereceu é avisado (lista e telemóvel), com `reopened`.
    await until(async () => pushes.some((p) => p.userId === ana.id));
    expect(await lives(ana, id)).toContainEqual({ txilladaId: id, title: 'Ajuda', reopened: true });
    expect(pushes.find((p) => p.userId === ana.id)?.p).toMatchObject({ body: `@${host.username} reabriu a Txillada: Ajuda`, url: `/txillada/${id}`, category: 'txilladas' });
    // A decorrer: não se reabre outra vez.
    expect((await reopen(host, id).expect(409)).body).toMatchObject({ code: 'still_live', message: 'A Txillada ainda está a decorrer.' });
    // Acabar e reabrir outra vez dentro de 10 min: sem segundo aviso a quem ofereceu.
    await end(host, id);
    await reopen(host, id).expect(200);
    await new Promise((r) => setTimeout(r, 200));
    expect(await lives(ana, id)).toHaveLength(1);
    await end(host, id);
  });

  it('não se reabre: por quem não é o anfitrião, cortada, sem angariação, meta atingida, depois de 24 h, com outra a decorrer, mais de 3 vezes', async () => {
    const { h2, h3, h4, ana } = u;
    // Sem angariação.
    const plain = (await open(h2).expect(201)).body.txillada.id as string;
    expect((await end(h2, plain)).body).toMatchObject({ canReopen: false, reopenUntil: null });
    expect((await reopen(h2, plain).expect(409)).body).toMatchObject({ code: 'no_goal', message: 'Só se pode reabrir uma Txillada com angariação.' });
    // Por quem não é o anfitrião.
    const id = (await open(h2, { goal: 50 }).expect(201)).body.txillada.id as string;
    await end(h2, id);
    expect((await reopen(ana, id).expect(403)).body.message).toBe('Só o anfitrião pode reabrir a Txillada.');
    // Com outra a decorrer: 409 (o índice de uma 'live' por anfitrião fica a salvo), e o canReopen diz que não.
    const other = (await open(h2).expect(201)).body.txillada.id as string;
    expect((await get(h2, id).expect(200)).body).toMatchObject({ canReopen: false, reopenUntil: expect.any(String) });
    expect((await reopen(h2, id).expect(409)).body).toMatchObject({ code: 'other_live', id: other });
    await end(h2, other);
    // Depois de 24 h: 410.
    await pool.query(`UPDATE content.txilladas SET ended_at = now() - interval '25 hours' WHERE id = $1`, [id]);
    expect((await get(h2, id).expect(200)).body).toMatchObject({ canReopen: false, reopenUntil: null });
    expect((await reopen(h2, id).expect(410)).body).toMatchObject({ code: 'too_late' });

    // Meta atingida.
    const done = (await open(h3, { goal: 10 }).expect(201)).body.txillada.id as string;
    await gift(ana, done, 10).expect(200);
    expect((await end(h3, done)).body).toMatchObject({ canReopen: false });
    expect((await reopen(h3, done).expect(409)).body).toMatchObject({ code: 'goal_reached' });
    // Cortada pela moderação.
    const cut = (await open(h3, { goal: 100 }).expect(201)).body.txillada.id as string;
    await pool.query(`UPDATE content.txilladas SET status = 'cut', ended_at = now() WHERE id = $1`, [cut]);
    expect((await get(h3, cut).expect(200)).body).toMatchObject({ canReopen: false });
    expect((await reopen(h3, cut).expect(409)).body).toMatchObject({ code: 'cut' });

    // No máximo 3 vezes.
    const cap = (await open(h4, { goal: 100 }).expect(201)).body.txillada.id as string;
    for (let i = 1; i <= 3; i++) {
      await end(h4, cap);
      await reopen(h4, cap).expect(200);
      expect((await row(cap)).room).toBe(`tx-${cap}-r${i}`);
    }
    expect((await end(h4, cap)).body).toMatchObject({ canReopen: false, reopenUntil: null });
    expect((await reopen(h4, cap).expect(409)).body).toMatchObject({ code: 'reopens_max' });
  });

  it('numa paga: quem já pagou volta a entrar sem pagar outra vez, e nada se devolve nem se cobra', async () => {
    const { hp, pa } = u;
    const id = (await open(hp, { audience: 'paid', price: 5, goal: 100 }).expect(201)).body.txillada.id as string;
    await api().post(`/api/v1/txilladas/${id}/ticket`).set(auth(pa)).expect(200);
    const a0 = await balance(pa);
    const h0 = await balance(hp);
    await end(hp, id);
    await reopen(hp, id).expect(200);
    await svc.sweep();
    expect((await get(pa, id).expect(200)).body).toMatchObject({ status: 'live', locked: false, hasTicket: true });
    await join(pa, id).expect(200);
    expect((await api().post(`/api/v1/txilladas/${id}/ticket`).set(auth(pa)).expect(200)).body).toMatchObject({ hasTicket: true, charged: false });
    expect(await balance(pa)).toBe(a0);
    expect(await balance(hp)).toBe(h0);
    expect((await pool.query(`SELECT count(*)::int AS n FROM content.txillada_tickets WHERE txillada_id = $1 AND refunded_at IS NULL`, [id])).rows[0].n).toBe(1);
    // Quem pagou a entrada também é avisado.
    await until(async () => (await lives(pa, id)).length > 0);
    expect(await lives(pa, id)).toContainEqual({ txilladaId: id, title: 'Ajuda', reopened: true });
    await end(hp, id);
  });
});
