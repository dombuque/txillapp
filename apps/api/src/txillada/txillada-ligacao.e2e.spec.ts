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
import type { LiveKitRooms } from './livekit';
import { TxilladaService } from './txillada.service';

const DB = process.env.TEST_DATABASE_URL ?? 'postgres://txill:txill_dev@localhost:5433/txillapp_test';
const PASSWORD = 'password-bem-longa-1';
const LK = { LIVEKIT_URL: 'ws://localhost:7880', LIVEKIT_API_KEY: 'devkey', LIVEKIT_API_SECRET: 'secret' };

interface U { token: string; id: string; username: string; ip: string }

/**
 * A ligação do anfitrião (0180), docs/txillada-contrato.md: desligar a câmara não acaba a Txillada; sair ou cair da sala
 * dá 3 min para voltar; depois acaba com o motivo 'lost' e o anfitrião pode continuar a mesma Txillada até 10 min depois
 * (sala nova; quem a tinha aberta recebe `txillada.resumed`). As ações depois do fim dão 409 com `code: 'ended'`.
 * Sem o servidor LiveKit: o cliente da sala é um falso (quem está na sala vem de `inRoom`).
 */
describe('Txillada: a ligação do anfitrião (integração)', () => {
  let app: INestApplication;
  let pool: Pool;
  let svc: TxilladaService;
  const run = Date.now().toString(36);
  const api = () => request(app.getHttpServer());
  const auth = (x: U) => ({ Authorization: `Bearer ${x.token}`, 'X-Forwarded-For': x.ip });
  const u: Record<string, U> = {};
  const events: { to: string; e: any }[] = [];
  const roomCalls: string[] = [];
  const inRoom: Record<string, { identity: string; videoTracks: number; tracks?: number }[]> = {};
  const rooms: LiveKitRooms = {
    removeParticipant: async (room, identity) => void roomCalls.push(`remove:${room}:${identity}`),
    deleteRoom: async (room) => void roomCalls.push(`delete:${room}`),
    participants: async (room) => inRoom[room] ?? [],
    setCanPublish: async (room, identity, on) => void roomCalls.push(`publish:${room}:${identity}:${on}`),
    createRoom: async (room) => void roomCalls.push(`create:${room}`),
  };
  let n = 0;

  async function signup(name: string): Promise<U> {
    const username = `${name}${run}`.slice(0, 28);
    n++;
    const ip = `10.180.${n >> 8}.${n & 255}`;
    const r = await api().post('/api/v1/auth/register').set('X-Forwarded-For', ip)
      .send({ email: `${username}@example.com`, username, displayName: `${name[0].toUpperCase()}${name.slice(1)} Teste`, password: PASSWORD, birthDate: '1990-06-15', acceptTerms: true }).expect(201);
    await pool.query('UPDATE identity.users SET email_verified_at = now() WHERE id = $1', [r.body.user.id]);
    return { token: r.body.accessToken, id: r.body.user.id, username, ip };
  }
  const open = (x: U, body: Record<string, unknown> = {}) => api().post('/api/v1/txilladas').set(auth(x)).send({ title: 'Ligação', ...body });
  const get = (x: U, id: string) => api().get(`/api/v1/txilladas/${id}`).set(auth(x));
  const join = (x: U, id: string) => api().post(`/api/v1/txilladas/${id}/join`).set(auth(x));
  const reopen = (x: U, id: string) => api().post(`/api/v1/txilladas/${id}/reopen`).set(auth(x));
  const txEvents = (x: U, type: string) => events.filter((e) => e.to === x.id && e.e?.type === type).map((e) => e.e);
  const row = async (id: string) =>
    (await pool.query('SELECT status, room, started_at, end_reason, host_gone_at, reopens, resumes FROM content.txilladas WHERE id = $1', [id])).rows[0];
  async function webhook(ev: Record<string, unknown>) {
    const body = JSON.stringify({ id: `EV_${Math.random().toString(36).slice(2)}`, createdAt: String(Math.floor(Date.now() / 1000)), ...ev });
    const at = new AccessToken('devkey', 'secret');
    at.sha256 = createHash('sha256').update(body).digest('base64');
    return api().post('/api/v1/txilladas/livekit-webhook').set('Content-Type', 'application/webhook+json').set('Authorization', await at.toJwt()).send(body).expect(200);
  }
  const hostEv = (event: string, room: string, host: U, track?: 'VIDEO' | 'AUDIO') =>
    webhook({ event, room: { name: room }, participant: { identity: host.id }, ...(track ? { track: { sid: `TR_${track}`, type: track } } : {}) });
  /** O anfitrião fora da sala há `min` minutos (como se o webhook o tivesse dito nessa altura). */
  const goneFor = (id: string, min: number) => pool.query(`UPDATE content.txilladas SET host_gone_at = now() - make_interval(mins => $2) WHERE id = $1`, [id, min]);
  const endedFor = (id: string, min: number) => pool.query(`UPDATE content.txilladas SET ended_at = now() - make_interval(mins => $2) WHERE id = $1`, [id, min]);

  beforeAll(async () => {
    await migrate(DB);
    pool = new Pool({ connectionString: DB });
    app = await createApp(
      loadConfig({ DATABASE_URL: DB, JWT_ACCESS_SECRET: 't'.repeat(40), NODE_ENV: 'test', MEDIA_DIR: './uploads-test', ...LK }),
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
    for (const name of ['host', 'ana', 'rui', 'h2', 'h3', 'h4']) u[name] = await signup(name);
    // As que tenham ficado de outras corridas na mesma base.
    await pool.query(`UPDATE content.txilladas SET status = 'ended', ended_at = now() WHERE status = 'live'`);
  }, 240_000);

  afterAll(async () => {
    await app.close();
    await pool.end();
    jest.restoreAllMocks();
  });

  it('a sala cria-se com os tempos largos; desligar a câmara (fica o som) não acaba; sem nenhuma faixa começa a margem', async () => {
    const { h2 } = u;
    roomCalls.length = 0;
    const id = (await open(h2).expect(201)).body.txillada.id as string;
    const room = `tx-${id}`;
    expect(roomCalls).toContain(`create:${room}`);
    // Ainda não entrou: a margem já conta.
    expect((await row(id)).host_gone_at).not.toBeNull();
    await hostEv('participant_joined', room, h2);
    expect((await row(id)).host_gone_at).toBeNull();
    await hostEv('track_published', room, h2, 'AUDIO');
    await hostEv('track_published', room, h2, 'VIDEO');
    // Desliga a câmara: o LiveKit diz que continua lá com o microfone.
    inRoom[room] = [{ identity: h2.id, videoTracks: 0, tracks: 1 }];
    await hostEv('track_unpublished', room, h2, 'VIDEO');
    expect(await row(id)).toMatchObject({ status: 'live', host_gone_at: null });
    // Muito tempo sem notícias do webhook (e sem vídeo): a tarefa pergunta ao LiveKit e fica.
    await pool.query(`UPDATE content.txilladas SET video_at = now() - interval '30 minutes' WHERE id = $1`, [id]);
    expect(await svc.sweep()).toBe(0);
    expect(await svc.sweep(new Date(Date.now() + 20 * 60_000))).toBe(0);
    expect(await row(id)).toMatchObject({ status: 'live', host_gone_at: null });
    // Desliga também o microfone (sem nenhuma faixa): começa a margem para voltar.
    inRoom[room] = [{ identity: h2.id, videoTracks: 0, tracks: 0 }];
    await hostEv('track_unpublished', room, h2, 'AUDIO');
    expect((await row(id)).host_gone_at).not.toBeNull();
    await hostEv('track_published', room, h2, 'AUDIO');
    expect((await row(id)).host_gone_at).toBeNull();
    await api().post(`/api/v1/txilladas/${id}/end`).set(auth(h2)).expect(200);
  });

  it('o anfitrião cai: 2 min ainda não acaba, volta e a margem cai; 4 min fora acaba com «lost» e as ações dão 409 ended', async () => {
    const { host, ana, rui } = u;
    const id = (await open(host).expect(201)).body.txillada.id as string;
    const room = `tx-${id}`;
    await hostEv('participant_joined', room, host);
    inRoom[room] = [{ identity: host.id, videoTracks: 1, tracks: 2 }];
    await join(ana, id).expect(200);
    await join(rui, id).expect(200);
    // Um convidado a transmitir (para o anfitrião o tirar depois).
    await api().post(`/api/v1/txilladas/${id}/guests/request`).set(auth(rui)).expect(200);
    await api().post(`/api/v1/txilladas/${id}/guests/${rui.username}/accept`).set(auth(host)).expect(200);

    // A ligação cai.
    inRoom[room] = [{ identity: rui.id, videoTracks: 1, tracks: 2 }];
    await hostEv('participant_connection_aborted', room, host);
    expect((await row(id)).host_gone_at).not.toBeNull();
    await goneFor(id, 2);
    expect(await svc.sweep()).toBe(0);
    expect((await row(id)).status).toBe('live');
    // Volta a ligar: a margem cai.
    await hostEv('participant_joined', room, host);
    expect((await row(id)).host_gone_at).toBeNull();
    // A sala fechou (room_finished) com ele fora: não acaba logo, só depois da margem.
    await hostEv('participant_left', room, host);
    await webhook({ event: 'room_finished', room: { name: room } });
    expect((await row(id)).status).toBe('live');
    await goneFor(id, 4);
    // O LiveKit ainda o vê lá com outra ligação: fica.
    inRoom[room] = [{ identity: host.id, videoTracks: 1, tracks: 2 }];
    expect(await svc.sweep()).toBe(0);
    expect(await row(id)).toMatchObject({ status: 'live', host_gone_at: null });
    // Fora há 4 min, confirmado: acaba com 'lost'.
    inRoom[room] = [];
    await hostEv('participant_left', room, host);
    await goneFor(id, 4);
    expect(await svc.sweep()).toBe(1);
    expect(await row(id)).toMatchObject({ status: 'ended', end_reason: 'lost' });
    expect(txEvents(ana, 'txillada.ended').at(-1)).toEqual({ type: 'txillada.ended', txilladaId: id, status: 'ended', reason: 'lost' });
    expect(txEvents(host, 'txillada.ended').at(-1)).toEqual({ type: 'txillada.ended', txilladaId: id, status: 'ended', reason: 'lost' });

    const forAna = (await get(ana, id).expect(200)).body;
    expect(forAna).toMatchObject({ status: 'ended', endReason: 'lost' });
    expect(new Date(forAna.resumeUntil).getTime() - new Date(forAna.endedAt).getTime()).toBe(10 * 60_000);
    expect(forAna).not.toHaveProperty('canReopen');
    const forHost = (await get(host, id).expect(200)).body;
    expect(forHost).toMatchObject({ endReason: 'lost', canReopen: true, reopenUntil: forAna.resumeUntil, resumeUntil: forAna.resumeUntil });

    // O que o anfitrião carrega depois de acabar: 409 com code 'ended' (a app passa logo ao fim).
    for (const r of await Promise.all(Array.from({ length: 5 }, () => api().post(`/api/v1/txilladas/${id}/guests/${rui.username}/remove`).set(auth(host))))) {
      expect(r.status).toBe(409);
      expect(r.body).toMatchObject({ message: 'A Txillada já acabou.', code: 'ended' });
    }
    expect((await api().post(`/api/v1/txilladas/${id}/cheer`).set(auth(ana)).expect(409)).body.code).toBe('ended');
    expect((await api().post(`/api/v1/txilladas/${id}/comments`).set(auth(ana)).send({ body: 'caiu?' }).expect(409)).body.code).toBe('ended');
    expect((await join(ana, id).expect(410)).body.code).toBe('ended');
  });

  it('continuar até 10 min: a mesma Txillada (qualquer tipo, sem gastar reaberturas), sala nova, quem a tinha aberta é avisado e volta a entrar', async () => {
    const { host, ana } = u;
    const id = (await pool.query(`SELECT id FROM content.txilladas WHERE host_id = $1 AND end_reason = 'lost' ORDER BY ended_at DESC LIMIT 1`, [host.id])).rows[0].id as string;
    const before = await row(id);
    await endedFor(id, 9);
    roomCalls.length = 0;
    const r = (await reopen(host, id).expect(200)).body;
    expect(r).toMatchObject({ id, status: 'live', endedAt: null, endReason: null, resumeUntil: null, guests: [] });
    const after = await row(id);
    expect(after).toMatchObject({ status: 'live', room: `tx-${id}-c1`, end_reason: null, reopens: 0, resumes: 1 });
    // O relógio das 4 h continua do início.
    expect(new Date(after.started_at).getTime()).toBe(new Date(before.started_at).getTime());
    expect(after.host_gone_at).not.toBeNull();
    expect(roomCalls).toContain(`create:tx-${id}-c1`);
    expect(txEvents(ana, 'txillada.resumed').at(-1)).toEqual({ type: 'txillada.resumed', txilladaId: id });
    // Quem vê volta a entrar, na sala nova.
    const tok = (await join(ana, id).expect(200)).body.token as string;
    expect((decodeJwt(tok) as { video?: { room?: string } }).video?.room).toBe(`tx-${id}-c1`);
    // Um aviso da sala antiga já não mexe em nada.
    await webhook({ event: 'room_finished', room: { name: `tx-${id}` } });
    expect((await row(id)).status).toBe('live');

    // Cai outra vez e passam mais de 10 min: já não se continua.
    await goneFor(id, 4);
    inRoom[`tx-${id}-c1`] = [];
    expect(await svc.sweep()).toBe(1);
    await endedFor(id, 11);
    const late = (await get(host, id).expect(200)).body;
    expect(late).toMatchObject({ endReason: 'lost', resumeUntil: null, canReopen: false, reopenUntil: null });
    expect((await reopen(host, id).expect(410)).body.code).toBe('too_late');
  });

  it('continuar: só o anfitrião, não com outra a decorrer; uma Angariação caída depois dos 10 min reabre-se como antes', async () => {
    const { h3, h4, ana } = u;
    const id = (await open(h3).expect(201)).body.txillada.id as string;
    await goneFor(id, 4);
    expect(await svc.sweep()).toBe(1);
    await reopen(ana, id).expect(403);
    // Com outra a decorrer, não.
    await pool.query(`UPDATE content.txilladas SET status = 'live', ended_at = NULL, room = $2 WHERE id = $1`, [id, `tx-${id}`]);
    const other = (await open(h3).expect(409)).body;
    expect(other.id).toBe(id);
    await pool.query(`UPDATE content.txilladas SET status = 'ended', ended_at = now(), end_reason = 'lost' WHERE id = $1`, [id]);
    const second = (await open(h3).expect(201)).body.txillada.id as string;
    expect((await get(h3, id).expect(200)).body).toMatchObject({ canReopen: false });
    expect((await reopen(h3, id).expect(409)).body.code).toBe('other_live');
    await api().post(`/api/v1/txilladas/${second}/end`).set(auth(h3)).expect(200);
    await reopen(h3, id).expect(200);
    await api().post(`/api/v1/txilladas/${id}/end`).set(auth(h3)).expect(200);

    // Uma Angariação que caiu há mais de 10 min: «Reabrir a Angariação» (24 h, gasta uma reabertura).
    const g = (await open(h4, { goal: 100, purpose: 'Livros' }).expect(201)).body.txillada.id as string;
    await goneFor(g, 4);
    expect(await svc.sweep()).toBe(1);
    await endedFor(g, 11);
    const dto = (await get(h4, g).expect(200)).body;
    expect(dto).toMatchObject({ endReason: 'lost', resumeUntil: null, canReopen: true });
    expect(new Date(dto.reopenUntil).getTime() - new Date(dto.endedAt).getTime()).toBe(24 * 3_600_000);
    await reopen(h4, g).expect(200);
    expect(await row(g)).toMatchObject({ status: 'live', room: `tx-${g}-r1`, reopens: 1, resumes: 0, end_reason: null });
    await api().post(`/api/v1/txilladas/${g}/end`).set(auth(h4)).expect(200);
  });
});
