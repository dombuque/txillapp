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
 * Txillada com convidados (0165, docs/txillada-contrato.md): pedir para entrar, convidar, aceitar e recusar, o limite de 3,
 * sair, tirar e expulsar, bloqueios, 18+, os eventos, o webhook, a limpeza, a exportação e apagar a conta. O LiveKit é falso
 * (LIVEKIT_ROOMS regista o `updateParticipant` em `publish:<sala>:<id>:<true|false>`); os eventos apanham-se no bus.
 */
describe('Txillada: convidados a transmitir (integração)', () => {
  let app: INestApplication;
  let pool: Pool;
  let svc: TxilladaService;
  const run = Date.now().toString(36);
  const api = () => request(app.getHttpServer());
  const auth = (x: U) => ({ Authorization: `Bearer ${x.token}`, 'X-Forwarded-For': x.ip });
  const u: Record<string, U> = {};
  const events: { to: string; e: any }[] = [];
  const roomCalls: string[] = [];
  const inRoom: Record<string, { identity: string; videoTracks: number }[]> = {};
  const rooms: LiveKitRooms = {
    removeParticipant: async (room, identity) => void roomCalls.push(`remove:${room}:${identity}`),
    deleteRoom: async (room) => void roomCalls.push(`delete:${room}`),
    participants: async (room) => inRoom[room] ?? [],
    setCanPublish: async (room, identity, on) => void roomCalls.push(`publish:${room}:${identity}:${on}`),
  };
  let n = 0;

  async function signup(name: string, birthDate = '1990-06-15'): Promise<U> {
    const username = `${name}${run}`.slice(0, 28);
    n++;
    const ip = `10.165.${n >> 8}.${n & 255}`;
    const r = await api().post('/api/v1/auth/register').set('X-Forwarded-For', ip)
      .send({ email: `${username}@example.com`, username, displayName: `${name[0].toUpperCase()}${name.slice(1)} Teste`, password: PASSWORD, birthDate, acceptTerms: true }).expect(201);
    await pool.query('UPDATE identity.users SET email_verified_at = now() WHERE id = $1', [r.body.user.id]);
    return { token: r.body.accessToken, id: r.body.user.id, username, ip };
  }
  const open = (x: U, title = 'Bora conversar') => api().post('/api/v1/txilladas').set(auth(x)).send({ title, audience: 'everyone' });
  const get = (x: U, id: string) => api().get(`/api/v1/txilladas/${id}`).set(auth(x));
  const join = (x: U, id: string) => api().post(`/api/v1/txilladas/${id}/join`).set(auth(x)).expect(200);
  const g = (x: U, id: string, what: string) => api().post(`/api/v1/txilladas/${id}/guests/${what}`).set(auth(x));
  const txEvents = (x: U, type: string) => events.filter((e) => e.to === x.id && e.e?.type === type).map((e) => e.e);
  const names = (list: { user: { username: string } }[]) => list.map((x) => x.user.username);
  const row = async (id: string, who: U) => (await pool.query('SELECT kind, status FROM content.txillada_guests WHERE txillada_id = $1 AND user_id = $2', [id, who.id])).rows[0];
  const endAll = (x: U) => pool.query(`UPDATE content.txilladas SET status = 'ended', ended_at = now() WHERE host_id = $1 AND status = 'live'`, [x.id]);

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
    const bus = app.get(RealtimeBus);
    const publish = bus.publish.bind(bus);
    jest.spyOn(bus, 'publish').mockImplementation((to: string, e: unknown) => {
      events.push({ to, e });
      publish(to, e);
    });
    for (const name of ['host', 'ana', 'rui', 'eva', 'ze', 'lia', 'blk', 'out']) u[name] = await signup(name);
    u.minor = await signup('minor', `${new Date().getFullYear() - 15}-03-01`);
    // O blk tem um bloqueio com o anfitrião (não vê, não pede, não é convidado).
    await api().put(`/api/v1/blocks/${u.blk.username}`).set(auth(u.host)).expect((r) => expect([200, 204]).toContain(r.status));
  }, 180_000);

  afterAll(async () => {
    await app.close();
    await pool.end();
    jest.restoreAllMocks();
  });

  it('pedir para entrar: o anfitrião recebe o pedido, aceita, a sala vê o convidado e a permissão muda no LiveKit', async () => {
    const { host, ana, eva, minor } = u;
    const id = (await open(host).expect(201)).body.txillada.id as string;
    for (const x of [ana, eva, minor]) await join(x, id);
    // Antes: ninguém transmite e quem vê está só a ver.
    expect((await get(eva, id).expect(200)).body).toMatchObject({ guests: [], guestsMax: 3, guestState: 'none' });
    expect((await get(eva, id).expect(200)).body).not.toHaveProperty('requests');
    expect((await get(host, id).expect(200)).body).toMatchObject({ guests: [], requests: [], invites: [], guestState: 'none' });
    // O anfitrião não pede; um menor de 18 não transmite.
    expect((await g(host, id, 'request').expect(400)).body.message).toBe('Já estás a transmitir: és o anfitrião.');
    expect((await g(minor, id, 'request').expect(403)).body.message).toBe('Para transmitir numa Txillada tens de ter 18 anos ou mais.');
    // Pedir: o anfitrião recebe `txillada.request` com o pedido.
    expect((await g(ana, id, 'request').expect(200)).body).toEqual({ state: 'requested' });
    const req = txEvents(host, 'txillada.request').at(-1);
    expect(req).toMatchObject({ txilladaId: id, user: { id: ana.id, username: ana.username, verified: false }, invites: [] });
    expect(names(req.requests)).toEqual([ana.username]);
    expect((await get(ana, id).expect(200)).body.guestState).toBe('requested');
    expect(names((await get(host, id).expect(200)).body.requests)).toEqual([ana.username]);
    // Pedir outra vez com o pedido à espera: nada muda (sem outro aviso).
    const before = txEvents(host, 'txillada.request').length;
    expect((await g(ana, id, 'request').expect(200)).body).toEqual({ state: 'requested' });
    expect(txEvents(host, 'txillada.request')).toHaveLength(before);
    // Só o anfitrião aceita.
    await g(eva, id, `${ana.username}/accept`).expect(403);
    roomCalls.length = 0;
    const acc = await g(host, id, `${ana.username}/accept`).expect(200);
    expect(names(acc.body.guests)).toEqual([ana.username]);
    expect(acc.body.requests).toEqual([]);
    expect(roomCalls).toEqual([`publish:tx-${id}:${ana.id}:true`]);
    // A sala (o anfitrião, quem vê e a própria) recebe `guest_joined`; o anfitrião as listas novas.
    for (const x of [host, ana, eva]) expect(txEvents(x, 'txillada.guest_joined').at(-1)).toMatchObject({ txilladaId: id, guest: { user: { id: ana.id, username: ana.username } } });
    expect(txEvents(host, 'txillada.requests').at(-1)).toMatchObject({ requests: [], invites: [] });
    const dto = (await get(eva, id).expect(200)).body;
    expect(dto.guests).toEqual([{ user: expect.objectContaining({ id: ana.id, username: ana.username, displayName: 'Ana Teste' }), since: expect.any(String) }]);
    expect((await get(ana, id).expect(200)).body.guestState).toBe('guest');
    // Voltar a entrar dá um token que já publica (o convidado não leva o nome no token).
    const tok = decodeJwt((await join(ana, id)).body.token);
    expect((tok.video as { canPublish: boolean }).canPublish).toBe(true);
    expect(tok).not.toHaveProperty('name');
    expect((decodeJwt((await join(eva, id)).body.token).video as { canPublish: boolean }).canPublish).toBe(false);
    // Quem transmite não aparece em «A ver agora» (conta à parte).
    const viewers = (await api().get(`/api/v1/txilladas/${id}/viewers`).set(auth(host)).expect(200)).body.items as { username: string }[];
    expect(viewers.map((x) => x.username)).not.toContain(ana.username);
    expect(viewers.map((x) => x.username)).toContain(eva.username);
    // Pedir já a transmitir: 409.
    await g(ana, id, 'request').expect(409);
    await endAll(host);
  });

  it('recusar um pedido (o pedido volta só daqui a 20 s: 429) e desistir do pedido', async () => {
    const { host, rui, ze } = u;
    const id = (await open(host).expect(201)).body.txillada.id as string;
    for (const x of [rui, ze]) await join(x, id);
    await g(rui, id, 'request').expect(200);
    await g(host, id, `${rui.username}/decline`).expect(200);
    expect(txEvents(rui, 'txillada.request_declined').at(-1)).toEqual({ type: 'txillada.request_declined', txilladaId: id });
    expect(await row(id, rui)).toEqual({ kind: 'request', status: 'declined' });
    expect((await get(rui, id).expect(200)).body.guestState).toBe('none');
    expect((await g(rui, id, 'request').expect(429)).body.message).toBe('Calma! Espera um bocadinho antes de pedires outra vez.');
    await g(host, id, `${rui.username}/decline`).expect(404);
    // Desistir: o pedido sai da lista do anfitrião.
    await g(ze, id, 'request').expect(200);
    expect((await g(ze, id, 'leave').expect(200)).body).toEqual({ state: 'none' });
    expect(await row(id, ze)).toEqual({ kind: 'request', status: 'cancelled' });
    expect((await get(host, id).expect(200)).body.requests).toEqual([]);
    expect(txEvents(host, 'txillada.requests').at(-1)).toMatchObject({ txilladaId: id, requests: [] });
    await endAll(host);
  });

  it('convidar quem está a ver: aceitar, recusar, e as regras (a ver, bloqueio, 18+, expulso)', async () => {
    const { host, eva, lia, minor, out, blk, ze } = u;
    const id = (await open(host).expect(201)).body.txillada.id as string;
    for (const x of [eva, lia, minor, ze]) await join(x, id);
    // Só o anfitrião convida; quem não está a ver, não; quem tem bloqueio não existe para ele; um menor, sem dizer porquê.
    await api().post(`/api/v1/txilladas/${id}/guests/invite`).set(auth(eva)).send({ username: lia.username }).expect(403);
    const inv = (x: string) => api().post(`/api/v1/txilladas/${id}/guests/invite`).set(auth(host)).send({ username: x });
    // Quem ainda não está a ver também se convida pelo @ (0168; txillada-convidar.e2e.spec.ts); aqui retira-se logo.
    expect(names((await inv(out.username).expect(200)).body.invites)).toEqual([out.username]);
    expect((await inv(out.username).expect(409)).body).toMatchObject({ code: 'already_invited' });
    await g(host, id, `${out.username}/remove`).expect(200);
    await inv(blk.username).expect(404);
    expect((await inv(minor.username).expect(403)).body.message).toBe(`Não podes convidar @${minor.username} para transmitir.`);
    await inv(host.username).expect(400);
    // Convidar: a pessoa recebe o convite (com quem convidou e o selo).
    const r1 = await inv(eva.username).expect(200);
    expect(names(r1.body.invites)).toEqual([eva.username]);
    expect(txEvents(eva, 'txillada.invite').at(-1)).toEqual({
      type: 'txillada.invite', txilladaId: id, host: { username: host.username, displayName: 'Host Teste', avatarUrl: null, verified: false, verifiedTier: null },
    });
    expect((await get(eva, id).expect(200)).body.guestState).toBe('invited');
    // Aceitar: passa a transmitir.
    roomCalls.length = 0;
    const acc = await g(eva, id, 'accept').expect(200);
    expect(acc.body.state).toBe('guest');
    expect(names(acc.body.guests)).toEqual([eva.username]);
    expect(roomCalls).toEqual([`publish:tx-${id}:${eva.id}:true`]);
    expect(txEvents(host, 'txillada.guest_joined').at(-1)).toMatchObject({ guest: { user: { username: eva.username } } });
    await g(eva, id, 'accept').expect(200); // outra vez: já está
    // Recusar: o anfitrião recebe `invite_declined`.
    await inv(lia.username).expect(200);
    expect((await g(lia, id, 'decline').expect(200)).body).toEqual({ state: 'none' });
    expect(txEvents(host, 'txillada.invite_declined').at(-1)).toMatchObject({ txilladaId: id, user: { username: lia.username } });
    expect(await row(id, lia)).toEqual({ kind: 'invite', status: 'declined' });
    await g(lia, id, 'accept').expect(404);
    // Convidar quem pediu para entrar aceita o pedido.
    await g(ze, id, 'request').expect(200);
    const r2 = await inv(ze.username).expect(200);
    expect(names(r2.body.guests)).toEqual([eva.username, ze.username]);
    // Pedir com um convite à espera aceita o convite.
    await inv(lia.username).expect(200);
    expect((await g(lia, id, 'request').expect(200)).body.state).toBe('guest');
    // Tirar quem está a transmitir, e retirar um convite à espera (a pessoa recebe `invite_cancelled`).
    await g(host, id, `${lia.username}/remove`).expect(200);
    expect(txEvents(lia, 'txillada.guest_left').at(-1)).toMatchObject({ reason: 'removed' });
    await inv(lia.username).expect(200);
    const rm = await g(host, id, `${lia.username}/remove`).expect(200);
    expect(rm.body.invites).toEqual([]);
    expect(txEvents(lia, 'txillada.invite_cancelled').at(-1)).toEqual({ type: 'txillada.invite_cancelled', txilladaId: id });
    expect(await row(id, lia)).toEqual({ kind: 'invite', status: 'cancelled' });
    await endAll(host);
  });

  it('no máximo 3 convidados a transmitir (409), e um lugar livre volta a servir', async () => {
    const { host, ana, rui, eva, ze, lia } = u;
    const id = (await open(host).expect(201)).body.txillada.id as string;
    for (const x of [ana, rui, eva, ze, lia]) await join(x, id);
    for (const x of [ana, rui, eva, ze]) await g(x, id, 'request').expect(200);
    for (const x of [ana, rui, eva]) await g(host, id, `${x.username}/accept`).expect(200);
    expect((await g(host, id, `${ze.username}/accept`).expect(409)).body.message).toBe('Já há 3 convidados a transmitir. Tira um para entrar outro.');
    expect((await api().post(`/api/v1/txilladas/${id}/guests/invite`).set(auth(host)).send({ username: lia.username }).expect(409)).body.message).toMatch(/Já há 3/);
    // Ao mesmo tempo também não passa dos 3: tira-se um e aceitam-se dois de uma vez.
    await g(host, id, `${rui.username}/remove`).expect(200);
    await g(lia, id, 'request').expect(200);
    const both = await Promise.all([g(host, id, `${ze.username}/accept`), g(host, id, `${lia.username}/accept`)]);
    expect(both.map((r) => r.status).sort()).toEqual([200, 409]);
    expect((await pool.query(`SELECT count(*)::int AS n FROM content.txillada_guests WHERE txillada_id = $1 AND status = 'accepted'`, [id])).rows[0].n).toBe(3);
    expect((await get(eva, id).expect(200)).body.guests).toHaveLength(3);
    await endAll(host);
  });

  it('sair, tirar e expulsar: a permissão sai no LiveKit e a sala recebe guest_left', async () => {
    const { host, ana, eva, ze } = u;
    const id = (await open(host).expect(201)).body.txillada.id as string;
    for (const x of [ana, eva, ze]) await join(x, id);
    const inv = (x: U) => api().post(`/api/v1/txilladas/${id}/guests/invite`).set(auth(host)).send({ username: x.username }).expect(200);
    for (const x of [ana, eva, ze]) { await inv(x); await g(x, id, 'accept').expect(200); }
    // O convidado sai quando quer (volta a só ver).
    roomCalls.length = 0;
    expect((await g(ana, id, 'leave').expect(200)).body).toEqual({ state: 'none' });
    expect(roomCalls).toEqual([`publish:tx-${id}:${ana.id}:false`]);
    for (const x of [host, ana, eva]) expect(txEvents(x, 'txillada.guest_left').at(-1)).toMatchObject({ txilladaId: id, user: { username: ana.username }, reason: 'left' });
    expect(await row(id, ana)).toEqual({ kind: 'invite', status: 'left' });
    expect((await get(ana, id).expect(200)).body.guestState).toBe('none');
    expect((decodeJwt((await join(ana, id)).body.token).video as { canPublish: boolean }).canPublish).toBe(false);
    // O anfitrião tira um convidado.
    roomCalls.length = 0;
    await g(eva, id, `${ze.username}/remove`).expect(403);
    const rm = await g(host, id, `${eva.username}/remove`).expect(200);
    expect(names(rm.body.guests)).toEqual([ze.username]);
    expect(roomCalls).toEqual([`publish:tx-${id}:${eva.id}:false`]);
    expect(txEvents(eva, 'txillada.guest_left').at(-1)).toMatchObject({ reason: 'removed' });
    expect(await row(id, eva)).toEqual({ kind: 'invite', status: 'removed' });
    await g(host, id, `${eva.username}/remove`).expect(404);
    // Expulsar também tira de transmitir (e da sala).
    roomCalls.length = 0;
    await api().post(`/api/v1/txilladas/${id}/ban/${ze.username}`).set(auth(host)).expect(204);
    expect(roomCalls).toEqual([`publish:tx-${id}:${ze.id}:false`, `remove:tx-${id}:${ze.id}`]);
    expect(txEvents(host, 'txillada.guest_left').at(-1)).toMatchObject({ user: { username: ze.username }, reason: 'removed' });
    expect((await get(host, id).expect(200)).body.guests).toEqual([]);
    await g(ze, id, 'request').expect(403); // expulso
    await endAll(host);
  });

  it('bloqueios: o convidado que bloqueia o anfitrião deixa de transmitir; quem bloqueia um convidado não o vê', async () => {
    const { host, rui, lia, eva } = u;
    const id = (await open(host).expect(201)).body.txillada.id as string;
    for (const x of [rui, lia, eva]) await join(x, id);
    for (const x of [rui, lia]) {
      await api().post(`/api/v1/txilladas/${id}/guests/invite`).set(auth(host)).send({ username: x.username }).expect(200);
      await g(x, id, 'accept').expect(200);
    }
    // A Eva bloqueia a Lia: não a vê entre os convidados (a app não recebe as faixas dela); o resto vê.
    await api().put(`/api/v1/blocks/${lia.username}`).set(auth(eva)).expect((r) => expect([200, 204]).toContain(r.status));
    expect(names((await get(eva, id).expect(200)).body.guests)).toEqual([rui.username]);
    expect(names((await get(host, id).expect(200)).body.guests)).toEqual([rui.username, lia.username]);
    // A Lia sai: a Eva (bloqueio) não recebe o aviso; o anfitrião recebe.
    const evaBefore = txEvents(eva, 'txillada.guest_left').length;
    await g(lia, id, 'leave').expect(200);
    expect(txEvents(eva, 'txillada.guest_left')).toHaveLength(evaBefore);
    expect(txEvents(host, 'txillada.guest_left').at(-1)).toMatchObject({ user: { username: lia.username } });
    // O Rui bloqueia o anfitrião: deixa de transmitir e sai da sala.
    roomCalls.length = 0;
    await api().put(`/api/v1/blocks/${host.username}`).set(auth(rui)).expect((r) => expect([200, 204]).toContain(r.status));
    expect(await row(id, rui)).toEqual({ kind: 'invite', status: 'removed' });
    expect(roomCalls).toEqual(expect.arrayContaining([`publish:tx-${id}:${rui.id}:false`, `remove:tx-${id}:${rui.id}`]));
    expect(txEvents(host, 'txillada.guest_left').at(-1)).toMatchObject({ user: { username: rui.username }, reason: 'removed' });
    await api().delete(`/api/v1/blocks/${host.username}`).set(auth(rui));
    await api().delete(`/api/v1/blocks/${lia.username}`).set(auth(eva));
    await endAll(host);
  });

  it('webhook: um convidado que volta a entrar recupera a permissão; um que sai da sala deixa de transmitir; não conta como espectador', async () => {
    const { host, ana, eva } = u;
    const id = (await open(host).expect(201)).body.txillada.id as string;
    const room = `tx-${id}`;
    for (const x of [ana, eva]) await join(x, id);
    await api().post(`/api/v1/txilladas/${id}/guests/invite`).set(auth(host)).send({ username: ana.username }).expect(200);
    await g(ana, id, 'accept').expect(200);
    for (const x of [host, ana, eva]) expect((await webhook({ event: 'participant_joined', room: { name: room }, participant: { identity: x.id } })).status).toBe(200);
    // Só a Eva conta como espectadora (o anfitrião e a convidada à parte).
    expect((await get(eva, id).expect(200)).body.viewers).toBe(1);
    expect(roomCalls).toContain(`publish:${room}:${ana.id}:true`);
    // Ainda na sala (outra ligação): o aviso de saída era da antiga e fica a transmitir.
    inRoom[room] = [{ identity: ana.id, videoTracks: 1 }];
    expect((await webhook({ event: 'participant_left', room: { name: room }, participant: { identity: ana.id } })).status).toBe(200);
    expect(await row(id, ana)).toEqual({ kind: 'invite', status: 'accepted' });
    inRoom[room] = [];
    expect((await webhook({ event: 'participant_left', room: { name: room }, participant: { identity: ana.id } })).status).toBe(200);
    expect(await row(id, ana)).toEqual({ kind: 'invite', status: 'left' });
    expect(txEvents(eva, 'txillada.guest_left').at(-1)).toMatchObject({ user: { username: ana.username }, reason: 'left' });
    // O anfitrião acaba: acaba para todos (os pedidos e convites à espera caem).
    await join(u.ze, id);
    await g(u.ze, id, 'request').expect(200);
    await api().post(`/api/v1/txilladas/${id}/guests/invite`).set(auth(host)).send({ username: eva.username }).expect(200);
    await api().post(`/api/v1/txilladas/${id}/end`).set(auth(host)).expect(200);
    expect(await row(id, u.ze)).toEqual({ kind: 'request', status: 'cancelled' });
    expect(await row(id, eva)).toEqual({ kind: 'invite', status: 'cancelled' });
    await g(eva, id, 'accept').expect(409);
  });

  it('limpeza dos 7 dias, exportação e apagar a conta de um convidado', async () => {
    const { host, lia, eva } = u;
    const id = (await open(host).expect(201)).body.txillada.id as string;
    for (const x of [lia, eva]) await join(x, id);
    await api().post(`/api/v1/txilladas/${id}/guests/invite`).set(auth(host)).send({ username: lia.username }).expect(200);
    await g(lia, id, 'accept').expect(200);
    const ex = (await api().get('/api/v1/me/export').set(auth(lia)).expect(200)).body;
    expect(ex.txilladaGuests).toEqual(expect.arrayContaining([expect.objectContaining({ txilladaId: id, host: host.username, kind: 'invite', status: 'accepted', since: expect.any(String) })]));
    // A Lia apaga a conta: deixa de transmitir (a sala sabe e ela sai da sala) e as linhas dela saem.
    roomCalls.length = 0;
    await api().post('/api/v1/auth/delete-account').set(auth(lia)).send({ confirmUsername: lia.username, password: PASSWORD }).expect(204);
    expect(roomCalls).toEqual(expect.arrayContaining([`publish:tx-${id}:${lia.id}:false`, `remove:tx-${id}:${lia.id}`]));
    expect(txEvents(eva, 'txillada.guest_left').at(-1)).toMatchObject({ txilladaId: id, reason: 'left' });
    expect((await pool.query('SELECT count(*)::int AS n FROM content.txillada_guests WHERE user_id = $1', [lia.id])).rows[0].n).toBe(0);
    // A limpeza: 7 dias depois do fim, quem pediu, foi convidado ou transmitiu sai (as outras ficam).
    await join(eva, id);
    await g(eva, id, 'request').expect(200);
    await api().post(`/api/v1/txilladas/${id}/end`).set(auth(host)).expect(200);
    const count = async (t: string) => (await pool.query('SELECT count(*)::int AS n FROM content.txillada_guests WHERE txillada_id = $1', [t])).rows[0].n as number;
    expect(await count(id)).toBe(1);
    await svc.purge();
    expect(await count(id)).toBe(1);
    await pool.query(`UPDATE content.txilladas SET ended_at = now() - interval '8 days' WHERE id = $1`, [id]);
    const out = await svc.purge();
    expect(out.guests).toBeGreaterThanOrEqual(1);
    expect(await count(id)).toBe(0);
  });
});
