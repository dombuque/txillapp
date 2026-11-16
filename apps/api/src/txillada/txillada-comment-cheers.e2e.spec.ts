import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Pool } from 'pg';
import { loadConfig } from '../config';
import { migrate } from '../db/migrate';
import { createApp } from '../main';
import { RealtimeBus } from '../realtime/realtime-bus';
import type { LiveKitRooms } from './livekit';
import { TxilladaService } from './txillada.service';

const DB = process.env.TEST_DATABASE_URL ?? 'postgres://txill:txill_dev@localhost:5433/txillapp_test';
const PASSWORD = 'password-bem-longa-1';
const LK = { LIVEKIT_URL: 'ws://localhost:7880', LIVEKIT_API_KEY: 'devkey', LIVEKIT_API_SECRET: 'secret' };

interface U { token: string; id: string; username: string; ip: string }

/**
 * Brindar os comentários da Txillada (0161): POST /txilladas/:id/comments/:commentId/cheer alterna, a contagem vai no
 * comentário e em `txillada.comment_cheer` a quem está na sala; sem aviso ao autor. O LiveKit é falso.
 */
describe('Txillada: brindar os comentários (integração)', () => {
  let app: INestApplication;
  let pool: Pool;
  let svc: TxilladaService;
  const run = Date.now().toString(36);
  const api = () => request(app.getHttpServer());
  const auth = (x: U) => ({ Authorization: `Bearer ${x.token}`, 'X-Forwarded-For': x.ip });
  const u: Record<string, U> = {};
  const events: { to: string; e: any }[] = [];
  const rooms: LiveKitRooms = { removeParticipant: async () => undefined, deleteRoom: async () => undefined, participants: async () => [], setCanPublish: async () => undefined };
  let n = 0;
  const net = Math.floor(Math.random() * 256);

  async function signup(name: string): Promise<U> {
    const username = `${name}${run}`.slice(0, 28);
    n++;
    const ip = `10.162.${net}.${n}`;
    const r = await api().post('/api/v1/auth/register').set('X-Forwarded-For', ip)
      .send({ email: `${username}@example.com`, username, displayName: `${name} Teste`, password: PASSWORD, birthDate: '1990-06-15', acceptTerms: true }).expect(201);
    await pool.query('UPDATE identity.users SET email_verified_at = now() WHERE id = $1', [r.body.user.id]);
    return { token: r.body.accessToken, id: r.body.user.id, username, ip };
  }
  const open = async (x: U, title = 'Bora') => (await api().post('/api/v1/txilladas').set(auth(x)).send({ title, audience: 'everyone' }).expect(201)).body.txillada.id as string;
  const join = (x: U, id: string) => api().post(`/api/v1/txilladas/${id}/join`).set(auth(x)).expect(200);
  const say = async (x: U, id: string, body: string) => (await api().post(`/api/v1/txilladas/${id}/comments`).set(auth(x)).send({ body }).expect(201)).body as { id: string; cheers: number; cheered: boolean };
  const cheer = (x: U, id: string, c: string) => api().post(`/api/v1/txilladas/${id}/comments/${c}/cheer`).set(auth(x));
  const list = async (x: U, id: string) => (await api().get(`/api/v1/txilladas/${id}/comments`).set(auth(x)).expect(200)).body.items as { id: string; cheers: number; cheered: boolean }[];
  const got = (x: U, id: string) => events.filter((e) => e.to === x.id && e.e?.type === 'txillada.comment_cheer' && e.e.txilladaId === id).map((e) => e.e);
  const endAll = (x: U) => pool.query(`UPDATE content.txilladas SET status = 'ended', ended_at = now() WHERE host_id = $1 AND status = 'live'`, [x.id]);
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const rows = async (c: string) => (await pool.query('SELECT count(*)::int AS n FROM content.txillada_comment_cheers WHERE comment_id = $1', [c])).rows[0].n as number;

  beforeAll(async () => {
    await migrate(DB);
    pool = new Pool({ connectionString: DB });
    app = await createApp(
      loadConfig({ DATABASE_URL: DB, JWT_ACCESS_SECRET: 'c'.repeat(40), NODE_ENV: 'test', MEDIA_DIR: './uploads-test', ...LK }),
      { livekitRooms: rooms },
    );
    await app.init();
    svc = app.get(TxilladaService);
    const bus = app.get(RealtimeBus);
    const publish = bus.publish.bind(bus);
    jest.spyOn(bus, 'publish').mockImplementation((to: string, e: unknown) => {
      events.push({ to, e });
      publish(to, e);
    });
    for (const name of ['chost', 'cana', 'cblk', 'crui', 'cban', 'cout']) u[name] = await signup(name);
    // A Ana bloqueia o Blk; o anfitrião bloqueia o Out.
    await api().put(`/api/v1/blocks/${u.cblk.username}`).set(auth(u.cana)).expect((r) => expect([200, 204]).toContain(r.status));
    await api().put(`/api/v1/blocks/${u.cout.username}`).set(auth(u.chost)).expect((r) => expect([200, 204]).toContain(r.status));
  }, 180_000);

  beforeEach(async () => {
    for (const x of Object.values(u)) await endAll(x);
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
    jest.restoreAllMocks();
  });

  it('brindar e tirar: a contagem no comentário e na lista, o evento a quem está na sala (sem quem tem bloqueio com o autor), sem aviso', async () => {
    const { chost, cana, cblk, crui } = u;
    const id = await open(chost, 'Brindes nos comentários');
    for (const x of [cana, cblk, crui]) await join(x, id);
    const c = await say(cana, id, 'Saúde!');
    expect(c).toMatchObject({ cheers: 0, cheered: false });

    expect((await cheer(crui, id, c.id).expect(200)).body).toEqual({ cheered: true, cheers: 1 });
    expect((await cheer(chost, id, c.id).expect(200)).body).toEqual({ cheered: true, cheers: 2 }); // o anfitrião também brinda
    expect((await list(crui, id)).find((x) => x.id === c.id)).toMatchObject({ cheers: 2, cheered: true });
    expect((await list(cana, id)).find((x) => x.id === c.id)).toMatchObject({ cheers: 2, cheered: false });

    const ev = { type: 'txillada.comment_cheer', txilladaId: id, commentId: c.id, cheers: 2 };
    for (const x of [chost, cana, crui]) expect(got(x, id).at(-1)).toEqual(ev);
    // O Blk tem bloqueio com a Ana (a autora): não vê o comentário, não recebe a contagem, nem brinda.
    expect(got(cblk, id)).toEqual([]);
    await cheer(cblk, id, c.id).expect(404);

    // Tirar: desce e avisa a sala.
    expect((await cheer(crui, id, c.id).expect(200)).body).toEqual({ cheered: false, cheers: 1 });
    expect(got(cana, id).at(-1)).toMatchObject({ cheers: 1 });
    // Nada nas notificações da autora.
    const items = (await api().get('/api/v1/notifications').set(auth(cana)).expect(200)).body.items as { kind: string; data: { targetId?: string } }[];
    expect(items.filter((x) => x.kind === 'cheer' && x.data.targetId === c.id)).toEqual([]);
    expect((await pool.query('SELECT count(*)::int AS n FROM social.cheer_notices WHERE target_id = $1', [c.id])).rows[0].n).toBe(0);
  });

  it('expulso 403, quem não pode ver 404, comentário apagado 404, acabada 409', async () => {
    const { chost, cana, cban, cout } = u;
    const id = await open(chost, 'Regras');
    await join(cban, id);
    await wait(2_100);
    const c = await say(cana, id, 'Olá a todos');
    await api().post(`/api/v1/txilladas/${id}/ban/${cban.username}`).set(auth(chost)).expect(204);
    await cheer(cban, id, c.id).expect(403);
    await cheer(cout, id, c.id).expect(404);
    await cheer(cana, id, '11111111-1111-4111-8111-111111111111').expect(404);
    await wait(2_100);
    const gone = await say(cana, id, 'Apaga-me');
    await api().delete(`/api/v1/txilladas/${id}/comments/${gone.id}`).set(auth(chost)).expect(204);
    await cheer(cana, id, gone.id).expect(404);
    await api().post(`/api/v1/txilladas/${id}/end`).set(auth(chost)).expect(200);
    await cheer(cana, id, c.id).expect(409);
  });

  it('ritmo: no máximo 5 brindes a comentários por segundo por pessoa (429)', async () => {
    const { chost, cana, crui } = u;
    const id = await open(chost, 'Rajada');
    await wait(2_100);
    const c = await say(cana, id, 'Brinda-me muito');
    await wait(1_100);
    const codes: number[] = [];
    for (let i = 0; i < 7; i++) codes.push((await cheer(crui, id, c.id)).status);
    expect(codes.slice(0, 5)).toEqual([200, 200, 200, 200, 200]);
    expect(codes.slice(5)).toEqual([429, 429]);
  });

  it('limpeza dos 7 dias, exportação e apagar a conta', async () => {
    const { chost, cana, crui } = u;
    const old = await open(chost, 'Velha');
    await wait(2_100);
    const c1 = await say(cana, old, 'Vai sair');
    await cheer(crui, old, c1.id).expect(200);
    // Denunciada: o comentário fica até à decisão, mas os brindes a ele saem.
    await api().post(`/api/v1/txilladas/${old}/report`).set(auth(crui)).send({ reason: 'spam' }).expect(204);
    await api().post(`/api/v1/txilladas/${old}/end`).set(auth(chost)).expect(200);
    const recent = await open(chost, 'Recente');
    await wait(2_100);
    const c2 = await say(cana, recent, 'Fica');
    await cheer(crui, recent, c2.id).expect(200);
    const ex = (await api().get('/api/v1/me/export').set(auth(crui)).expect(200)).body;
    expect(ex.txilladaCommentCheers).toEqual(expect.arrayContaining([expect.objectContaining({ commentId: c1.id, txilladaId: old }), expect.objectContaining({ commentId: c2.id, txilladaId: recent })]));
    await api().post(`/api/v1/txilladas/${recent}/end`).set(auth(chost)).expect(200);
    await pool.query(`UPDATE content.txilladas SET ended_at = now() - interval '8 days' WHERE id = $1`, [old]);
    const out = await svc.purge();
    expect(out.commentCheers).toBeGreaterThanOrEqual(1);
    expect(await rows(c1.id)).toBe(0);
    expect((await pool.query('SELECT count(*)::int AS n FROM content.txillada_comments WHERE id = $1', [c1.id])).rows[0].n).toBe(1);
    expect(await rows(c2.id)).toBe(1);
    // O Rui apaga a conta: os brindes dele saem.
    await api().post('/api/v1/auth/delete-account').set(auth(crui)).send({ confirmUsername: crui.username, password: PASSWORD }).expect(204);
    expect(await rows(c2.id)).toBe(0);
  });
});
