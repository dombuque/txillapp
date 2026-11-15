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
 * Txillada: os limites que o txillada.e2e.spec.ts não cobre — corridas (dois «abrir» ao mesmo tempo, entrar enquanto
 * acaba), validação, permissões de quem não é anfitrião, o que sai nos DTO e nos eventos, bloquear a meio, suspender o
 * anfitrião a meio e o webhook sem corpo cru.
 */
describe('Txillada: limites, corridas e privacidade (integração)', () => {
  let app: INestApplication;
  let pool: Pool;
  let svc: TxilladaService;
  const run = Date.now().toString(36);
  const api = () => request(app.getHttpServer());
  const auth = (x: U) => ({ Authorization: `Bearer ${x.token}`, 'X-Forwarded-For': x.ip });
  const u: Record<string, U> = {};
  const events: { to: string; e: any }[] = [];
  const roomCalls: string[] = [];
  const rooms: LiveKitRooms = {
    removeParticipant: async (room, identity) => void roomCalls.push(`remove:${room}:${identity}`),
    deleteRoom: async (room) => void roomCalls.push(`delete:${room}`),
    participants: async () => [],
  };
  let n = 0;

  async function signup(name: string): Promise<U> {
    const username = `${name}${run}`.slice(0, 28);
    n++;
    const ip = `10.159.${n >> 8}.${n & 255}`;
    const r = await api().post('/api/v1/auth/register').set('X-Forwarded-For', ip)
      .send({ email: `${username}@example.com`, username, displayName: `${name} Teste`, password: PASSWORD, birthDate: '1990-06-15', acceptTerms: true }).expect(201);
    await pool.query('UPDATE identity.users SET email_verified_at = now() WHERE id = $1', [r.body.user.id]);
    return { token: r.body.accessToken, id: r.body.user.id, username, ip };
  }
  const open = (x: U, title = 'Bora', audience = 'everyone') => api().post('/api/v1/txilladas').set(auth(x)).send({ title, audience });
  const txEvents = (x: U, type?: string) => events.filter((e) => e.to === x.id && String(e.e?.type).startsWith(type ?? 'txillada.')).map((e) => e.e);
  const endAll = (x: U) => pool.query(`UPDATE content.txilladas SET status = 'ended', ended_at = now() WHERE host_id = $1 AND status = 'live'`, [x.id]);
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

  async function signed(body: string) {
    const at = new AccessToken('devkey', 'secret');
    at.sha256 = createHash('sha256').update(body).digest('base64');
    return at.toJwt();
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
    for (const name of ['lhost', 'lana', 'lrui', 'lsus', 'lfol']) u[name] = await signup(name);
    await api().post(`/api/v1/users/${u.lhost.username}/follow`).set(auth(u.lfol)).expect(200);
  }, 180_000);

  // Cada teste começa sem Txilladas a decorrer (um teste que falha a meio não estraga os outros).
  beforeEach(async () => {
    for (const x of Object.values(u)) await endAll(x);
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
    jest.restoreAllMocks();
  });

  it('dois «abrir» ao mesmo tempo: só uma Txillada a decorrer, o outro recebe 409', async () => {
    const { lhost } = u;
    const rs = await Promise.all([open(lhost, 'Um'), open(lhost, 'Dois'), open(lhost, 'Três')]);
    const codes = rs.map((r) => r.status).sort();
    expect(codes.filter((c) => c === 201)).toHaveLength(1);
    expect(codes.filter((c) => c === 409)).toHaveLength(2);
    expect((await pool.query(`SELECT count(*)::int AS n FROM content.txilladas WHERE host_id = $1 AND status = 'live'`, [lhost.id])).rows[0].n).toBe(1);
    await endAll(lhost);
  });

  it('validação: título, público, comentário, ids e motivo da denúncia', async () => {
    const { lhost, lana } = u;
    // O título é opcional (0159): vazio abre uma Txillada sem título; mais de 80 letras não.
    const semTitulo = await open(lhost, '').expect(201);
    expect(semTitulo.body.txillada.title).toBe('');
    await endAll(lhost);
    await open(lhost, 'x'.repeat(81)).expect(400);
    await open(lhost, 'Ok', 'amigos').expect(400);
    await api().get('/api/v1/txilladas/nao-e-uuid').set(auth(lana)).expect(400);
    await api().get('/api/v1/txilladas/11111111-1111-4111-8111-111111111111').set(auth(lana)).expect(404);
    const id = (await open(lhost, 'Validar').expect(201)).body.txillada.id as string;
    await api().post(`/api/v1/txilladas/${id}/comments`).set(auth(lana)).send({ body: '' }).expect(400);
    await api().post(`/api/v1/txilladas/${id}/comments`).set(auth(lana)).send({ body: 'y'.repeat(301) }).expect(400);
    await api().get(`/api/v1/txilladas/${id}/comments?after=xpto`).set(auth(lana)).expect(400);
    await api().post(`/api/v1/txilladas/${id}/report`).set(auth(lana)).send({ reason: 'feio' }).expect(400);
    // Sem sessão: 401.
    await api().get(`/api/v1/txilladas/${id}`).expect(401);
    await endAll(lhost);
  });

  it('quem não é anfitrião não termina, não expulsa e não apaga o comentário dos outros; o autor apaga o seu', async () => {
    const { lhost, lana, lrui } = u;
    const id = (await open(lhost, 'Permissões').expect(201)).body.txillada.id as string;
    const c = (await api().post(`/api/v1/txilladas/${id}/comments`).set(auth(lana)).send({ body: 'Olá malta' }).expect(201)).body;
    await api().post(`/api/v1/txilladas/${id}/end`).set(auth(lrui)).expect(403);
    await api().post(`/api/v1/txilladas/${id}/ban/${lana.username}`).set(auth(lrui)).expect(403);
    await api().delete(`/api/v1/txilladas/${id}/comments/${c.id}`).set(auth(lrui)).expect(403);
    await api().post(`/api/v1/txilladas/${id}/ban/${lhost.username}`).set(auth(lhost)).expect(400);
    await api().post(`/api/v1/txilladas/${id}/ban/naoexiste${run}`).set(auth(lhost)).expect(404);
    await api().delete(`/api/v1/txilladas/${id}/comments/${c.id}`).set(auth(lana)).expect(204);
    await api().delete(`/api/v1/txilladas/${id}/comments/${c.id}`).set(auth(lana)).expect(404);
    expect((await api().get(`/api/v1/txilladas/${id}`).set(auth(lana)).expect(200)).body.comments).toBe(0);
    await endAll(lhost);
  });

  it('o que sai: o DTO, o comentário e os eventos não levam e-mails, datas de nascimento nem quem está a ver', async () => {
    const { lhost, lana, lrui } = u;
    const created = (await open(lhost, 'Dados').expect(201)).body;
    const id = created.txillada.id as string;
    expect(Object.keys(created).sort()).toEqual(['token', 'txillada', 'url']);
    await api().post(`/api/v1/txilladas/${id}/join`).set(auth(lana)).expect(200);
    await api().post(`/api/v1/txilladas/${id}/join`).set(auth(lrui)).expect(200);
    const dto = (await api().get(`/api/v1/txilladas/${id}`).set(auth(lana)).expect(200)).body;
    expect(Object.keys(dto).sort()).toEqual(['audience', 'canComment', 'cheers', 'comments', 'endedAt', 'host', 'id', 'isHost', 'peakViewers', 'startedAt', 'status', 'title', 'viewers'].sort());
    expect(Object.keys(dto.host).sort()).toEqual(expect.arrayContaining(['avatarUrl', 'displayName', 'id', 'username']));
    await wait(2_100); // 1 comentário a cada 2 s por pessoa
    const c = (await api().post(`/api/v1/txilladas/${id}/comments`).set(auth(lana)).send({ body: 'Que fixe' }).expect(201)).body;
    expect(Object.keys(c).sort()).toEqual(['author', 'body', 'createdAt', 'id']);
    await api().post(`/api/v1/txilladas/${id}/cheer`).set(auth(lrui)).expect(200);
    const all = JSON.stringify([dto, c, ...txEvents(lana), ...txEvents(lrui), ...txEvents(lhost)]);
    expect(all).not.toMatch(/@example\.com|email|birth|1990-06-15/i);
    // Quem está a ver não sai em lado nenhum (só o número): o id do Rui (que só brindou) não chega à Ana.
    expect(JSON.stringify(txEvents(lana))).not.toContain(lrui.id);
    await endAll(lhost);
  });

  it('entrar enquanto acaba: o join depois do fim dá 410; o webhook de quem entra com um token antigo tira-o da sala', async () => {
    const { lhost, lana } = u;
    const id = (await open(lhost, 'Corrida').expect(201)).body.txillada.id as string;
    const [end, join] = await Promise.all([
      api().post(`/api/v1/txilladas/${id}/end`).set(auth(lhost)),
      api().post(`/api/v1/txilladas/${id}/join`).set(auth(lana)),
    ]);
    expect(end.status).toBe(200);
    expect([200, 410]).toContain(join.status);
    await api().post(`/api/v1/txilladas/${id}/join`).set(auth(lana)).expect(410);
    roomCalls.length = 0;
    const body = JSON.stringify({ id: 'EV_x', createdAt: String(Math.floor(Date.now() / 1000)), event: 'participant_joined', room: { name: `tx-${id}` }, participant: { identity: lana.id } });
    await api().post('/api/v1/txilladas/livekit-webhook').set('Content-Type', 'application/webhook+json').set('Authorization', await signed(body)).send(body).expect(200);
    expect(roomCalls).toEqual([`remove:tx-${id}:${lana.id}`]);
  });

  it('webhook: sem assinatura 401; o corpo tem de chegar cru (re-serializado, a assinatura não bate)', async () => {
    const body = JSON.stringify({ id: 'EV_y', createdAt: String(Math.floor(Date.now() / 1000)), event: 'room_finished', room: { name: 'tx-nenhuma' } });
    await api().post('/api/v1/txilladas/livekit-webhook').set('Content-Type', 'application/webhook+json').send(body).expect(401);
    // Com espaços (como um JSON bonito): o corpo cru bate com a assinatura.
    const pretty = JSON.stringify(JSON.parse(body), null, 2);
    await api().post('/api/v1/txilladas/livekit-webhook').set('Content-Type', 'application/webhook+json').set('Authorization', await signed(pretty)).send(pretty).expect(200);
  });

  it('bloquear a meio: quem foi bloqueado pelo anfitrião deixa de receber os eventos e sai da sala', async () => {
    const { lhost, lrui, lana } = u;
    const id = (await open(lhost, 'Bloqueio').expect(201)).body.txillada.id as string;
    await api().post(`/api/v1/txilladas/${id}/join`).set(auth(lrui)).expect(200);
    await api().post(`/api/v1/txilladas/${id}/join`).set(auth(lana)).expect(200);
    roomCalls.length = 0;
    await api().put(`/api/v1/blocks/${lrui.username}`).set(auth(lhost)).expect((r) => expect([200, 204]).toContain(r.status));
    await api().get(`/api/v1/txilladas/${id}`).set(auth(lrui)).expect(404);
    const before = txEvents(lrui).length;
    await wait(2_100);
    await api().post(`/api/v1/txilladas/${id}/comments`).set(auth(lana)).send({ body: 'Continua!' }).expect(201);
    await api().post(`/api/v1/txilladas/${id}/cheer`).set(auth(lana)).expect(200);
    await api().post(`/api/v1/txilladas/${id}/end`).set(auth(lhost)).expect(200);
    expect(txEvents(lrui).slice(before)).toEqual([]);
    expect(roomCalls).toContain(`remove:tx-${id}:${lrui.id}`);
  });

  it('suspender o anfitrião a meio: a Txillada acaba (na volta seguinte da tarefa) e a sala fecha', async () => {
    const { lsus, lana } = u;
    const id = (await open(lsus, 'Vou ser suspenso').expect(201)).body.txillada.id as string;
    await api().post(`/api/v1/txilladas/${id}/join`).set(auth(lana)).expect(200);
    // O anfitrião continua a publicar vídeo (o webhook disse-o).
    await pool.query('UPDATE content.txilladas SET video_on = true, video_at = now() WHERE id = $1', [id]);
    await pool.query(`UPDATE identity.users SET status = 'suspended' WHERE id = $1`, [lsus.id]);
    roomCalls.length = 0;
    await svc.sweep();
    expect((await pool.query('SELECT status FROM content.txilladas WHERE id = $1', [id])).rows[0].status).not.toBe('live');
    expect(roomCalls).toContain(`delete:tx-${id}`);
    expect(txEvents(lana, 'txillada.ended').at(-1)).toMatchObject({ txilladaId: id });
    await pool.query(`UPDATE identity.users SET status = 'active' WHERE id = $1`, [lsus.id]);
  });

  it('os espectadores entram escondidos na sala (hidden); o anfitrião não', async () => {
    const { lhost, lana } = u;
    const created = (await open(lhost, 'Escondidos').expect(201)).body;
    const id = created.txillada.id as string;
    expect(decodeJwt(created.token).video).toMatchObject({ canPublish: true });
    expect((decodeJwt(created.token).video as { hidden?: boolean }).hidden).toBeFalsy();
    const v = (await api().post(`/api/v1/txilladas/${id}/join`).set(auth(lana)).expect(200)).body;
    expect(decodeJwt(v.token).video).toMatchObject({ canPublish: false, canSubscribe: true, hidden: true });
    const h = (await api().post(`/api/v1/txilladas/${id}/join`).set(auth(lhost)).expect(200)).body;
    expect((decodeJwt(h.token).video as { hidden?: boolean }).hidden).toBeFalsy();
  });

  it('sem data de nascimento: 403 com uma razão verdadeira (não há esse campo nas Definições)', async () => {
    const nb = await signup('lnob');
    await pool.query('UPDATE identity.users SET birth_date = NULL WHERE id = $1', [nb.id]);
    const m = (await open(nb, 'Sem data').expect(403)).body.message as string;
    expect(m).toMatch(/data de nascimento/);
    expect(m).not.toMatch(/Definições/);
  });

  it('a roda «AO VIVO» (perfil e fila dos mimos) não aparece a quem denunciou essa Txillada', async () => {
    const { lhost, lfol, lana } = u;
    const media = (await pool.query(`INSERT INTO content.media_assets (id, owner_id, mime, size_bytes, storage_key, status) VALUES (gen_random_uuid(), $1, 'image/jpeg', 1, 'x', 'ready') RETURNING id`, [lhost.id])).rows[0].id;
    await pool.query('INSERT INTO content.stories (id, author_id, media_id) VALUES (gen_random_uuid(), $1, $2)', [lhost.id, media]);
    const id = (await open(lhost, 'Roda').expect(201)).body.txillada.id as string;
    const ring = async (x: U) => ({
      profile: (await api().get(`/api/v1/users/${lhost.username}`).set(auth(x)).expect(200)).body.live,
      tray: ((await api().get('/api/v1/stories').set(auth(x)).expect(200)).body as { username: string; live: unknown }[]).find((t) => t.username === lhost.username)?.live,
    });
    expect(await ring(lfol)).toEqual({ profile: { id }, tray: { id } });
    await api().post(`/api/v1/txilladas/${id}/report`).set(auth(lfol)).send({ reason: 'spam' }).expect(204);
    expect(await ring(lfol)).toEqual({ profile: null, tray: null });
    expect((await ring(lana)).profile).toEqual({ id });
  });

  it('público «seguidores»: quem não segue não vê, não entra, não comenta, não brinda nem denuncia (404)', async () => {
    const { lhost, lana, lfol } = u;
    await wait(2_100);
    const id = (await open(lhost, 'Só seguidores', 'followers').expect(201)).body.txillada.id as string;
    await api().get(`/api/v1/txilladas/${id}`).set(auth(lfol)).expect(200);
    for (const [m, p, b] of [
      ['get', '', undefined], ['post', '/join', {}], ['get', '/comments', undefined], ['post', '/comments', { body: 'oi' }], ['post', '/cheer', {}], ['post', '/report', { reason: 'spam' }],
    ] as const) {
      const r = (api() as any)[m](`/api/v1/txilladas/${id}${p}`).set(auth(lana));
      await (b ? r.send(b) : r).expect(404);
    }
    expect((await api().get('/api/v1/txilladas/live').set(auth(lana)).expect(200)).body.items.map((t: { id: string }) => t.id)).not.toContain(id);
    await endAll(lhost);
  });
});
