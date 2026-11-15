import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Pool } from 'pg';
import { loadConfig } from '../config';
import { migrate } from '../db/migrate';
import { createApp } from '../main';
import { RealtimeBus } from '../realtime/realtime-bus';
import { staffLogin } from '../staff/staff-test';
import type { LiveKitRooms } from './livekit';
import { TxilladaService } from './txillada.service';

const DB = process.env.TEST_DATABASE_URL ?? 'postgres://txill:txill_dev@localhost:5433/txillapp_test';
const PASSWORD = 'password-bem-longa-1';
const LK = { LIVEKIT_URL: 'ws://localhost:7880', LIVEKIT_API_KEY: 'devkey', LIVEKIT_API_SECRET: 'secret' };

interface U { token: string; id: string; username: string; ip: string }

/**
 * Fixar um comentário e denunciar um comentário da Txillada (0162): POST /txilladas/:id/pin (só o anfitrião, evento
 * `txillada.pinned`, `pinned` no DTO, apagar o fixado tira-o) e POST /txilladas/:id/comments/:commentId/report (a fila da
 * moderação 'txillada_comment', deixa de aparecer a quem denunciou, fica guardado até à decisão). O LiveKit é falso.
 */
describe('Txillada: fixar e denunciar comentários (integração)', () => {
  let app: INestApplication;
  let pool: Pool;
  let svc: TxilladaService;
  const run = Date.now().toString(36);
  const api = () => request(app.getHttpServer());
  const auth = (x: U) => ({ Authorization: `Bearer ${x.token}`, 'X-Forwarded-For': x.ip });
  const sauth = (s: { token: string }) => ({ Authorization: `Bearer ${s.token}` });
  const u: Record<string, U> = {};
  const events: { to: string; e: any }[] = [];
  const rooms: LiveKitRooms = { removeParticipant: async () => undefined, deleteRoom: async () => undefined, participants: async () => [] };
  let n = 0;
  const net = Math.floor(Math.random() * 256);

  async function signup(name: string, verified = false): Promise<U> {
    const username = `${name}${run}`.slice(0, 28);
    n++;
    const ip = `10.163.${net}.${n}`;
    const r = await api().post('/api/v1/auth/register').set('X-Forwarded-For', ip)
      .send({ email: `${username}@example.com`, username, displayName: `${name} Teste`, password: PASSWORD, birthDate: '1990-06-15', acceptTerms: true }).expect(201);
    await pool.query('UPDATE identity.users SET email_verified_at = now(), verified = $2 WHERE id = $1', [r.body.user.id, verified]);
    return { token: r.body.accessToken, id: r.body.user.id, username, ip };
  }
  const open = async (x: U, title = 'Bora') => (await api().post('/api/v1/txilladas').set(auth(x)).send({ title, audience: 'everyone' }).expect(201)).body.txillada.id as string;
  const join = (x: U, id: string) => api().post(`/api/v1/txilladas/${id}/join`).set(auth(x)).expect(200);
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const say = async (x: U, id: string, body: string) => {
    const r = await api().post(`/api/v1/txilladas/${id}/comments`).set(auth(x)).send({ body });
    if (r.status === 429) { await wait(2_100); return say(x, id, body); }
    expect(r.status).toBe(201);
    return r.body as { id: string };
  };
  const pin = (x: U, id: string, commentId: string | null) => api().post(`/api/v1/txilladas/${id}/pin`).set(auth(x)).send({ commentId });
  const get = async (x: U, id: string) => (await api().get(`/api/v1/txilladas/${id}`).set(auth(x)).expect(200)).body;
  const list = async (x: U, id: string) => ((await api().get(`/api/v1/txilladas/${id}/comments`).set(auth(x)).expect(200)).body.items as { id: string }[]).map((c) => c.id);
  const report = (x: U, id: string, c: string, reason = 'harassment') => api().post(`/api/v1/txilladas/${id}/comments/${c}/report`).set(auth(x)).send({ reason });
  const got = (x: U, id: string, type = 'txillada.pinned') => events.filter((e) => e.to === x.id && e.e?.type === type && e.e.txilladaId === id).map((e) => e.e);
  const endAll = (x: U) => pool.query(`UPDATE content.txilladas SET status = 'ended', ended_at = now() WHERE host_id = $1 AND status = 'live'`, [x.id]);

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
    u.phost = await signup('phost');
    u.pana = await signup('pana', true);
    for (const name of ['pblk', 'prui', 'pban', 'peva']) u[name] = await signup(name);
    // A Ana bloqueia o Blk (não se veem um ao outro).
    await api().put(`/api/v1/blocks/${u.pblk.username}`).set(auth(u.pana)).expect((r) => expect([200, 204]).toContain(r.status));
  }, 180_000);

  beforeEach(async () => {
    for (const x of Object.values(u)) await endAll(x);
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
    jest.restoreAllMocks();
  });

  it('fixar: só o anfitrião, `pinned` no DTO (com o autor e o selo), o evento a quem está na sala (null a quem tem bloqueio), trocar e tirar', async () => {
    const { phost, pana, pblk, prui } = u;
    const id = await open(phost, 'Fixar');
    for (const x of [pana, pblk, prui]) await join(x, id);
    const c = await say(pana, id, 'Fixa-me!');
    const c2 = await say(prui, id, 'Eu também');
    expect((await get(prui, id)).pinned).toBeNull();

    await pin(prui, id, c.id).expect(403);
    await pin(phost, id, '11111111-1111-4111-8111-111111111111').expect(404);
    await pin(phost, id, 'nada').expect(400);
    const r = await pin(phost, id, c.id).expect(200);
    expect(r.body.pinned).toMatchObject({ id: c.id, body: 'Fixa-me!', author: { username: pana.username, verified: true }, cheers: 0 });

    // O DTO de quem vê (e do anfitrião): o comentário completo, com o autor e o selo.
    expect((await get(prui, id)).pinned).toMatchObject({ id: c.id, body: 'Fixa-me!', author: { username: pana.username, displayName: 'pana Teste', verified: true }, cheered: false });
    expect((await get(phost, id)).pinned).toMatchObject({ id: c.id });
    // O Blk tem bloqueio com a autora: não a vê fixada.
    expect((await get(pblk, id)).pinned).toBeNull();
    const live = (await api().get('/api/v1/txilladas/live').set(auth(prui)).expect(200)).body.items as { id: string; pinned: { id: string } | null }[];
    expect(live.find((x) => x.id === id)?.pinned).toMatchObject({ id: c.id });

    // O evento: o comentário a quem está na sala; null ao Blk.
    for (const x of [phost, pana, prui]) expect(got(x, id).at(-1)).toMatchObject({ type: 'txillada.pinned', txilladaId: id, comment: { id: c.id, author: { username: pana.username, verified: true } } });
    expect(got(pblk, id).at(-1)).toEqual({ type: 'txillada.pinned', txilladaId: id, comment: null });

    // Fixar o mesmo outra vez: nada muda nem se repete o evento.
    const before = got(prui, id).length;
    await pin(phost, id, c.id).expect(200);
    expect(got(prui, id)).toHaveLength(before);

    // Trocar e tirar.
    await pin(phost, id, c2.id).expect(200);
    expect((await get(pana, id)).pinned).toMatchObject({ id: c2.id });
    await pin(phost, id, null).expect(200);
    expect((await get(pana, id)).pinned).toBeNull();
    expect(got(pana, id).at(-1)).toEqual({ type: 'txillada.pinned', txilladaId: id, comment: null });

    // Acabada: já não se fixa.
    await api().post(`/api/v1/txilladas/${id}/end`).set(auth(phost)).expect(200);
    await pin(phost, id, c.id).expect(409);
  });

  it('apagar o comentário fixado tira-o (o autor ou o anfitrião), com o evento; apagar outro não mexe', async () => {
    const { phost, pana, prui } = u;
    const id = await open(phost, 'Apagar o fixado');
    for (const x of [pana, prui]) await join(x, id);
    const c = await say(pana, id, 'Fixado e apagado');
    const other = await say(prui, id, 'Outro');
    await pin(phost, id, c.id).expect(200);
    await api().delete(`/api/v1/txilladas/${id}/comments/${other.id}`).set(auth(prui)).expect(204);
    expect((await get(prui, id)).pinned).toMatchObject({ id: c.id });
    await api().delete(`/api/v1/txilladas/${id}/comments/${c.id}`).set(auth(pana)).expect(204);
    expect((await pool.query('SELECT pinned_comment_id FROM content.txilladas WHERE id = $1', [id])).rows[0].pinned_comment_id).toBeNull();
    expect((await get(prui, id)).pinned).toBeNull();
    expect(got(prui, id).at(-1)).toEqual({ type: 'txillada.pinned', txilladaId: id, comment: null });
    expect(got(prui, id, 'txillada.comment_removed').at(-1)).toEqual({ type: 'txillada.comment_removed', txilladaId: id, commentId: c.id });
    // Um comentário apagado não se fixa.
    await pin(phost, id, c.id).expect(404);
  });

  it('denunciar um comentário: a fila (txillada_comment), deixa de aparecer a quem denunciou (lista e fixado), regras', async () => {
    const { phost, pana, pblk, prui, pban, peva } = u;
    const staff = await staffLogin(app, 'pcmod', ['moderacao']);
    const id = await open(phost, 'Denúncias');
    for (const x of [pana, prui, pban, peva]) await join(x, id);
    const c = await say(pana, id, 'Comentário feio');
    await pin(phost, id, c.id).expect(200);

    await report(pana, id, c.id).expect(400); // o próprio
    await report(pblk, id, c.id).expect(404); // bloqueio com a autora
    await report(prui, id, '11111111-1111-4111-8111-111111111111').expect(404);
    await report(prui, id, c.id, 'nada').expect(400);
    await api().post(`/api/v1/txilladas/${id}/ban/${pban.username}`).set(auth(phost)).expect(204);
    await report(pban, id, c.id).expect(403); // expulso
    // Um comentário de outra Txillada não se denuncia por esta.
    const other = await open(peva, 'Outra');
    await report(prui, other, c.id).expect(404);
    await endAll(peva);

    await report(prui, id, c.id).expect(204);
    await report(prui, id, c.id).expect(204); // outra vez: o mesmo
    // Ao Rui deixa de aparecer (na lista e no fixado); aos outros continua.
    expect(await list(prui, id)).not.toContain(c.id);
    expect((await get(prui, id)).pinned).toBeNull();
    expect(await list(phost, id)).toContain(c.id);
    expect((await get(phost, id)).pinned).toMatchObject({ id: c.id });
    // Fixar outra vez: ao Rui vai null.
    await pin(phost, id, null).expect(200);
    await pin(phost, id, c.id).expect(200);
    expect(got(prui, id).at(-1)).toEqual({ type: 'txillada.pinned', txilladaId: id, comment: null });
    expect(got(phost, id).at(-1)).toMatchObject({ comment: { id: c.id } });

    // A fila de queixas.
    const q = (await api().get('/api/v1/admin/mod/queue?type=txillada_comment').set(sauth(staff)).expect(200)).body.items as any[];
    expect(q.find((x) => x.id === c.id)).toMatchObject({ type: 'txillada_comment', reports: 1, reasons: ['harassment'], preview: 'Comentário feio', removed: null, owner: { username: pana.username } });
    // Também pela rota geral das denúncias.
    await api().post('/api/v1/reports').set(auth(peva)).send({ type: 'txillada_comment', id: c.id, reason: 'spam' }).expect(204);
    expect(await list(peva, id)).not.toContain(c.id);

    // Remover pela fila: sai para todos, deixa de estar fixado, a sala é avisada e a autora recebe o aviso.
    const d = await api().post('/api/v1/admin/mod/queue/decide').set(sauth(staff)).send({ items: [{ type: 'txillada_comment', id: c.id }], action: 'remove', note: 'Assédio' }).expect((r) => expect([200, 201]).toContain(r.status));
    expect(d.body.done).toHaveLength(1);
    for (let i = 0; i < 40 && !got(phost, id, 'txillada.comment_removed').some((e) => e.commentId === c.id); i++) await wait(25);
    expect(got(phost, id, 'txillada.comment_removed').at(-1)).toEqual({ type: 'txillada.comment_removed', txilladaId: id, commentId: c.id });
    expect(await list(phost, id)).not.toContain(c.id);
    expect((await get(phost, id)).pinned).toBeNull();
    const q2 = (await api().get('/api/v1/admin/mod/queue?type=txillada_comment&status=actioned').set(sauth(staff)).expect(200)).body.items as any[];
    expect(q2.find((x) => x.id === c.id)).toMatchObject({ removed: 'moderation', preview: 'Comentário feio' });
    for (let i = 0; i < 40; i++) {
      const notes = (await api().get('/api/v1/notifications').set(auth(pana)).expect(200)).body.items as any[];
      if (notes.some((x) => x.kind === 'content_removed' && x.data.type === 'txillada_comment')) break;
      await wait(25);
    }
    const notes = (await api().get('/api/v1/notifications').set(auth(pana)).expect(200)).body.items as any[];
    expect(notes.find((x) => x.kind === 'content_removed' && x.data.type === 'txillada_comment')).toMatchObject({ data: { reason: 'Assédio' } });
  });

  it('limpeza dos 7 dias: o comentário denunciado fica até à decisão; apagar a conta tira o fixado', async () => {
    const { phost, pana, prui } = u;
    const id = await open(phost, 'Limpeza');
    for (const x of [pana, prui]) await join(x, id);
    const kept = await say(pana, id, 'Denunciado, fica');
    const gone = await say(prui, id, 'Sai na limpeza');
    await report(prui, id, kept.id).expect(204);
    await pin(phost, id, gone.id).expect(200);
    await api().post(`/api/v1/txilladas/${id}/end`).set(auth(phost)).expect(200);
    await pool.query(`UPDATE content.txilladas SET ended_at = now() - interval '8 days' WHERE id = $1`, [id]);
    await svc.purge();
    const left = (await pool.query('SELECT id FROM content.txillada_comments WHERE txillada_id = $1', [id])).rows.map((r) => r.id);
    expect(left).toEqual([kept.id]);
    // O fixado saiu com a limpeza (a chave estrangeira põe-no a null).
    expect((await pool.query('SELECT pinned_comment_id FROM content.txilladas WHERE id = $1', [id])).rows[0].pinned_comment_id).toBeNull();
    // Decidida (arquivada), sai na limpeza seguinte.
    await pool.query(`UPDATE social.reports SET status = 'dismissed', resolved_at = now() WHERE target_type = 'txillada_comment' AND target_id = $1`, [kept.id]);
    await svc.purge();
    expect((await pool.query('SELECT count(*)::int AS n FROM content.txillada_comments WHERE txillada_id = $1', [id])).rows[0].n).toBe(0);

    // Apagar a conta: o comentário fixado sai e a Txillada fica sem fixado.
    const id2 = await open(phost, 'Conta apagada');
    await join(prui, id2);
    const c = await say(prui, id2, 'Vou-me embora');
    await pin(phost, id2, c.id).expect(200);
    await api().post('/api/v1/auth/delete-account').set(auth(prui)).send({ confirmUsername: prui.username, password: PASSWORD }).expect(204);
    expect((await pool.query('SELECT pinned_comment_id FROM content.txilladas WHERE id = $1', [id2])).rows[0].pinned_comment_id).toBeNull();
    expect((await get(phost, id2)).pinned).toBeNull();
  });
});
