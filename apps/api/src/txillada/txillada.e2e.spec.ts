import 'reflect-metadata';
import { createHash } from 'crypto';
import { INestApplication } from '@nestjs/common';
import { decodeJwt, jwtVerify } from 'jose';
import { AccessToken } from 'livekit-server-sdk';
import request from 'supertest';
import { Pool } from 'pg';
import webpush from 'web-push';
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
 * Txillada (os lives), fase 1 — docs/txillada-contrato.md, de ponta a ponta, sem o servidor LiveKit a correr: os tokens
 * descodificam-se e verificam-se com o segredo dev; o cliente da sala (tirar pessoas, fechar a sala, quem publica) é um falso;
 * o webhook vai assinado como o LiveKit o assina (JWT com o sha256 do corpo).
 */
describe('Txillada: os lives (integração)', () => {
  let app: INestApplication;
  let pool: Pool;
  let svc: TxilladaService;
  const run = Date.now().toString(36);
  const api = () => request(app.getHttpServer());
  const auth = (x: U) => ({ Authorization: `Bearer ${x.token}`, 'X-Forwarded-For': x.ip });
  const u: Record<string, U> = {};
  const sent: { endpoint: string; payload: { title: string; body: string; url: string } }[] = [];
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

  async function signup(name: string, birthDate: string | null = '1990-06-15'): Promise<U> {
    const username = `${name}${run}`.slice(0, 28);
    n++;
    const ip = `10.158.${n >> 8}.${n & 255}`;
    const r = await api().post('/api/v1/auth/register').set('X-Forwarded-For', ip)
      .send({ email: `${username}@example.com`, username, displayName: `${name[0].toUpperCase()}${name.slice(1)} Teste`, password: PASSWORD, birthDate: birthDate ?? '1990-06-15', acceptTerms: true }).expect(201);
    await pool.query('UPDATE identity.users SET email_verified_at = now() WHERE id = $1', [r.body.user.id]);
    if (birthDate === null) await pool.query('UPDATE identity.users SET birth_date = NULL WHERE id = $1', [r.body.user.id]);
    return { token: r.body.accessToken, id: r.body.user.id, username, ip };
  }
  const follow = (a: U, b: U) => api().post(`/api/v1/users/${b.username}/follow`).set(auth(a)).expect(200);
  const open = (x: U, title = 'Bora conversar', audience = 'everyone') => api().post('/api/v1/txilladas').set(auth(x)).send({ title, audience });
  const get = (x: U, id: string) => api().get(`/api/v1/txilladas/${id}`).set(auth(x));
  const txEvents = (x: U, type: string) => events.filter((e) => e.to === x.id && e.e?.type === type).map((e) => e.e);
  /** Acaba já qualquer Txillada a decorrer do anfitrião (para abrir outra). */
  const endAll = (x: U) => pool.query(`UPDATE content.txilladas SET status = 'ended', ended_at = now() WHERE host_id = $1 AND status = 'live'`, [x.id]);

  /** O webhook como o LiveKit o manda: corpo JSON e um JWT (HS256, chave e segredo do LiveKit) com o sha256 do corpo. */
  async function webhook(ev: Record<string, unknown>, opts: { secret?: string; tamper?: boolean } = {}) {
    const body = JSON.stringify({ id: `EV_${Math.random().toString(36).slice(2)}`, createdAt: String(Math.floor(Date.now() / 1000)), ...ev });
    const at = new AccessToken('devkey', opts.secret ?? 'secret');
    at.sha256 = createHash('sha256').update(body).digest('base64');
    const jwt = await at.toJwt();
    return api().post('/api/v1/txilladas/livekit-webhook').set('Content-Type', 'application/webhook+json').set('Authorization', jwt).send(opts.tamper ? body.replace('}', ',"x":1}') : body);
  }

  beforeAll(async () => {
    await migrate(DB);
    pool = new Pool({ connectionString: DB });
    const keys = webpush.generateVAPIDKeys();
    jest.spyOn(webpush, 'sendNotification').mockImplementation(async (s, payload) => {
      sent.push({ endpoint: (s as { endpoint: string }).endpoint, payload: JSON.parse(String(payload)) });
      return { statusCode: 201, body: '', headers: {} };
    });
    app = await createApp(
      loadConfig({ DATABASE_URL: DB, JWT_ACCESS_SECRET: 't'.repeat(40), NODE_ENV: 'test', MEDIA_DIR: './uploads-test', VAPID_PUBLIC_KEY: keys.publicKey, VAPID_PRIVATE_KEY: keys.privateKey, ...LK }),
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
    for (const name of ['host', 'ana', 'rui', 'eva', 'blk', 'zed']) u[name] = await signup(name);
    u.minor = await signup('minor', `${new Date().getFullYear() - 15}-03-01`);
    u.nobirth = await signup('nobirth', null);
    await follow(u.ana, u.host);
    await follow(u.eva, u.host);
    await api().put(`/api/v1/blocks/${u.blk.username}`).set(auth(u.host)).expect((r) => expect([200, 204]).toContain(r.status));
    await api().post('/api/v1/push/subscribe').set(auth(u.ana)).send({ endpoint: `https://push.example.com/${run}/ana`, keys: { p256dh: 'p'.repeat(20), auth: 'a'.repeat(16) } }).expect(204);
    // Um mimo do anfitrião, para ele aparecer na fila dos mimos de quem o segue.
    const media = (await pool.query(`INSERT INTO content.media_assets (id, owner_id, mime, size_bytes, storage_key, status) VALUES (gen_random_uuid(), $1, 'image/jpeg', 1, 'x', 'ready') RETURNING id`, [u.host.id])).rows[0].id;
    await pool.query('INSERT INTO content.stories (id, author_id, media_id) VALUES (gen_random_uuid(), $1, $2)', [u.host.id, media]);
  }, 180_000);

  afterAll(async () => {
    await app.close();
    await pool.end();
    jest.restoreAllMocks();
  });

  it('sem as chaves do LiveKit: config { enabled: false } e criar/entrar respondem 503', async () => {
    const off = await createApp(loadConfig({ DATABASE_URL: DB, JWT_ACCESS_SECRET: 't'.repeat(40), NODE_ENV: 'test', MEDIA_DIR: './uploads-test' }));
    await off.init();
    try {
      const s = () => request(off.getHttpServer());
      expect((await s().get('/api/v1/txilladas/config').set(auth(u.host)).expect(200)).body).toEqual({ enabled: false });
      const r = await s().post('/api/v1/txilladas').set(auth(u.host)).send({ title: 'Olá', audience: 'everyone' }).expect(503);
      expect(r.body.message).toBe('A Txillada ainda não está disponível.');
      await s().post(`/api/v1/txilladas/11111111-1111-4111-8111-111111111111/join`).set(auth(u.host)).expect(503);
      await s().post('/api/v1/txilladas/livekit-webhook').set('Content-Type', 'application/webhook+json').send('{}').expect(503);
    } finally {
      await off.close();
    }
    expect((await api().get('/api/v1/txilladas/config').set(auth(u.host)).expect(200)).body).toEqual({ enabled: true });
  });

  it('quem pode abrir: menor e sem data de nascimento → 403; o anfitrião recebe o token de publicar; 409 com uma a decorrer', async () => {
    expect((await open(u.minor).expect(403)).body.message).toMatch(/18 anos/);
    expect((await open(u.nobirth).expect(403)).body.message).toMatch(/data de nascimento/);
    await open(u.host, 'kys').expect(422);
    await open(u.host, 'x'.repeat(81)).expect(400);
    // Título opcional (0159): vazio também abre (aqui não se abre para o resto do teste seguir com o título).
    const r = await open(u.host).expect(201);
    const t = r.body.txillada;
    expect(t).toMatchObject({ title: 'Bora conversar', audience: 'everyone', status: 'live', viewers: 0, peakViewers: 0, cheers: 0, comments: 0, isHost: true, canComment: true, endedAt: null });
    expect(t.host).toMatchObject({ id: u.host.id, username: u.host.username, displayName: 'Host Teste', avatarUrl: null, verified: false, verifiedTier: null });
    expect(r.body.url).toBe('ws://localhost:7880');
    const { payload } = await jwtVerify(r.body.token, new TextEncoder().encode('secret'));
    expect(payload.iss).toBe('devkey');
    expect(payload.sub).toBe(u.host.id);
    expect(payload.video).toEqual({ roomJoin: true, room: `tx-${t.id}`, canPublish: true, canSubscribe: true, canPublishData: false, canUpdateOwnMetadata: false });
    const again = await open(u.host, 'Outra').expect(409);
    expect(again.body.id).toBe(t.id);
  });

  it('avisa os seguidores (lista e telemóvel) com «@x abriu uma Txillada: <título>», no máximo uma vez por hora', async () => {
    const live = (await pool.query(`SELECT id FROM content.txilladas WHERE host_id = $1 AND status = 'live'`, [u.host.id])).rows[0].id as string;
    for (let i = 0; i < 40 && !sent.some((s) => s.endpoint.endsWith('/ana')); i++) await new Promise((r) => setTimeout(r, 50));
    const list = (await api().get('/api/v1/notifications').set(auth(u.ana)).expect(200)).body.items.filter((x: any) => x.kind === 'txillada_live');
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ data: { txilladaId: live, title: 'Bora conversar' }, actor: { username: u.host.username }, txillada: { status: 'live' } });
    const push = sent.filter((s) => s.endpoint.endsWith('/ana'));
    expect(push).toHaveLength(1);
    expect(push[0].payload).toMatchObject({ body: `@${u.host.username} abriu uma Txillada: Bora conversar`, url: `/txillada/${live}` });
    // Quem não segue não é avisado.
    expect((await api().get('/api/v1/notifications').set(auth(u.rui)).expect(200)).body.items.filter((x: any) => x.kind === 'txillada_live')).toHaveLength(0);
    // Acaba e abre outra na mesma hora: sem aviso novo.
    await api().post(`/api/v1/txilladas/${live}/end`).set(auth(u.host)).expect(200);
    const second = (await open(u.host, 'Segunda').expect(201)).body.txillada.id as string;
    await new Promise((r) => setTimeout(r, 300));
    expect((await api().get('/api/v1/notifications').set(auth(u.ana)).expect(200)).body.items.filter((x: any) => x.kind === 'txillada_live')).toHaveLength(1);
    expect(sent.filter((s) => s.endpoint.endsWith('/ana'))).toHaveLength(1);
    // Uma hora depois da que avisou, avisa outra vez.
    await pool.query(`UPDATE content.txilladas SET started_at = now() - interval '2 hours' WHERE host_id = $1 AND notified`, [u.host.id]);
    await api().post(`/api/v1/txilladas/${second}/end`).set(auth(u.host)).expect(200);
    await open(u.host, 'Terceira').expect(201);
    for (let i = 0; i < 40 && sent.filter((s) => s.endpoint.endsWith('/ana')).length < 2; i++) await new Promise((r) => setTimeout(r, 50));
    expect(sent.filter((s) => s.endpoint.endsWith('/ana'))).toHaveLength(2);
    await endAll(u.host);
  });

  it('quem pode ver: público, seguidores, próximos, bloqueio, conta privada e expulso', async () => {
    const { host, ana, rui, eva, blk } = u;
    const pub = (await open(host, 'Para todos').expect(201)).body.txillada.id as string;
    await get(rui, pub).expect(200);
    await get(blk, pub).expect(404);
    await api().post(`/api/v1/txilladas/${pub}/join`).set(auth(blk)).expect(404);
    // Conta privada: só quem segue.
    await pool.query('UPDATE identity.users SET is_private = true WHERE id = $1', [host.id]);
    await get(rui, pub).expect(404);
    await get(ana, pub).expect(200);
    await pool.query('UPDATE identity.users SET is_private = false WHERE id = $1', [host.id]);
    await endAll(host);

    const fol = (await open(host, 'Só seguidores', 'followers').expect(201)).body.txillada.id as string;
    await get(rui, fol).expect(404);
    expect((await get(ana, fol).expect(200)).body).toMatchObject({ audience: 'followers', isHost: false, canComment: true });
    await endAll(host);

    await api().put(`/api/v1/stories/close-friends/${ana.username}`).set(auth(host)).expect(204);
    const close = (await open(host, 'Só próximos', 'close').expect(201)).body.txillada.id as string;
    await get(ana, close).expect(200);
    await get(eva, close).expect(404);
    await get(rui, close).expect(404);
    expect((await get(host, close).expect(200)).body.isHost).toBe(true);
    await endAll(host);
  });

  it('entrar: o espectador só recebe (canSubscribe), o anfitrião publica; a lista do que está a decorrer', async () => {
    const { host, ana, rui } = u;
    const id = (await open(host, 'Ao vivo').expect(201)).body.txillada.id as string;
    const v = await api().post(`/api/v1/txilladas/${id}/join`).set(auth(ana)).expect(200);
    expect(v.body.url).toBe('ws://localhost:7880');
    expect(decodeJwt(v.body.token)).toMatchObject({ sub: ana.id, video: { roomJoin: true, room: `tx-${id}`, canPublish: false, canSubscribe: true, canPublishData: false } });
    // Quem vê não leva o nome nem o @ no token (chega a todos na sala, também a quem tem bloqueio); o anfitrião leva.
    expect(decodeJwt(v.body.token)).not.toHaveProperty('name');
    expect(decodeJwt(v.body.token)).not.toHaveProperty('metadata');
    const h = await api().post(`/api/v1/txilladas/${id}/join`).set(auth(host)).expect(200);
    expect(decodeJwt(h.body.token)).toMatchObject({ sub: host.id, name: 'Host Teste' });
    expect(JSON.parse(String(decodeJwt(h.body.token).metadata))).toEqual({ username: host.username });
    expect((decodeJwt(h.body.token).video as { canPublish: boolean }).canPublish).toBe(true);
    // A lista: a de quem sigo aparece; a minha não.
    const mine = (await api().get('/api/v1/txilladas/live').set(auth(ana)).expect(200)).body.items as { id: string }[];
    expect(mine.map((x) => x.id)).toContain(id);
    expect(((await api().get('/api/v1/txilladas/live').set(auth(host)).expect(200)).body.items as { id: string }[]).map((x) => x.id)).not.toContain(id);
    await api().post(`/api/v1/txilladas/${id}/join`).set(auth(rui)).expect(200);
  });

  it('comentários: filtro, 1 a cada 2 s (429), quem comenta, a lista, o tempo real e apagar', async () => {
    const { host, ana, rui, eva } = u;
    const id = (await pool.query(`SELECT id FROM content.txilladas WHERE host_id = $1 AND status = 'live'`, [host.id])).rows[0].id as string;
    await api().post(`/api/v1/txilladas/${id}/comments`).set(auth(ana)).send({ body: 'kys' }).expect(422);
    const c1 = (await api().post(`/api/v1/txilladas/${id}/comments`).set(auth(ana)).send({ body: 'Olá malta!' }).expect(201)).body;
    expect(c1).toMatchObject({ body: 'Olá malta!', author: { id: ana.id, username: ana.username, displayName: 'Ana Teste', avatarUrl: null, verified: false } });
    expect(typeof c1.createdAt).toBe('string');
    const fast = await api().post(`/api/v1/txilladas/${id}/comments`).set(auth(ana)).send({ body: 'Outra vez' }).expect(429);
    expect(fast.body.message).toMatch(/Calma/);
    // Os eventos: quem fez join (a Ana e o Rui) e o anfitrião.
    expect(txEvents(host, 'txillada.comment').at(-1)).toMatchObject({ txilladaId: id, comment: { id: c1.id } });
    expect(txEvents(rui, 'txillada.comment').at(-1)).toMatchObject({ comment: { id: c1.id } });
    expect(txEvents(eva, 'txillada.comment')).toHaveLength(0);
    const c2 = (await api().post(`/api/v1/txilladas/${id}/comments`).set(auth(rui)).send({ body: 'Boa!' }).expect(201)).body;
    // «Quem comenta»: só quem o anfitrião segue.
    await pool.query(`UPDATE identity.users SET comments_allowed = 'following' WHERE id = $1`, [host.id]);
    expect((await get(rui, id).expect(200)).body.canComment).toBe(false);
    await new Promise((r) => setTimeout(r, 2_100));
    await api().post(`/api/v1/txilladas/${id}/comments`).set(auth(rui)).send({ body: 'Posso?' }).expect(403);
    await pool.query(`UPDATE identity.users SET comments_allowed = 'everyone' WHERE id = $1`, [host.id]);
    // A lista: do mais antigo para o mais recente; `after` dá só os novos.
    const all = (await api().get(`/api/v1/txilladas/${id}/comments`).set(auth(eva)).expect(200)).body.items as { id: string }[];
    expect(all.map((x) => x.id)).toEqual([c1.id, c2.id]);
    expect(((await api().get(`/api/v1/txilladas/${id}/comments?after=${c1.id}`).set(auth(eva)).expect(200)).body.items as { id: string }[]).map((x) => x.id)).toEqual([c2.id]);
    // Apagar: o autor o seu, o anfitrião qualquer um; os outros não.
    await api().delete(`/api/v1/txilladas/${id}/comments/${c1.id}`).set(auth(rui)).expect(403);
    await api().delete(`/api/v1/txilladas/${id}/comments/${c1.id}`).set(auth(ana)).expect(204);
    await api().delete(`/api/v1/txilladas/${id}/comments/${c2.id}`).set(auth(host)).expect(204);
    expect(txEvents(ana, 'txillada.comment_removed').map((e) => e.commentId)).toEqual([c1.id, c2.id]);
    expect((await api().get(`/api/v1/txilladas/${id}/comments`).set(auth(eva)).expect(200)).body.items).toEqual([]);
    expect((await get(eva, id).expect(200)).body.comments).toBe(0);
  });

  it('brindes: contam, chegam em tempo real, no máximo 5 por segundo; o anfitrião não brinda a sua', async () => {
    const { host, ana, rui } = u;
    const id = (await pool.query(`SELECT id FROM content.txilladas WHERE host_id = $1 AND status = 'live'`, [host.id])).rows[0].id as string;
    expect((await api().post(`/api/v1/txilladas/${id}/cheer`).set(auth(ana)).expect(200)).body).toEqual({ cheers: 1 });
    expect(txEvents(host, 'txillada.cheer').at(-1)).toEqual({ type: 'txillada.cheer', txilladaId: id, cheers: 1, from: { username: ana.username, verified: false, verifiedTier: null } });
    const burst = await Promise.all(Array.from({ length: 8 }, () => api().post(`/api/v1/txilladas/${id}/cheer`).set(auth(rui))));
    expect(burst.filter((r) => r.status === 429).length).toBeGreaterThanOrEqual(3);
    const ok = burst.filter((r) => r.status === 200).length;
    expect(ok).toBeLessThanOrEqual(5);
    expect((await get(ana, id).expect(200)).body.cheers).toBe(1 + ok);
    expect((await pool.query('SELECT count FROM content.txillada_cheers WHERE txillada_id = $1 AND user_id = $2', [id, rui.id])).rows[0].count).toBe(ok);
    await api().post(`/api/v1/txilladas/${id}/cheer`).set(auth(host)).expect(400);
  });

  it('webhook: assinatura, quem entra e sai (viewers/peak), expulsar, vídeo e room_finished', async () => {
    const { host, ana, rui, eva } = u;
    const id = (await pool.query(`SELECT id FROM content.txilladas WHERE host_id = $1 AND status = 'live'`, [host.id])).rows[0].id as string;
    const room = `tx-${id}`;
    expect((await webhook({ event: 'participant_joined', room: { name: room }, participant: { identity: ana.id } }, { secret: 'outro-segredo' })).status).toBe(401);
    expect((await webhook({ event: 'participant_joined', room: { name: room }, participant: { identity: ana.id } }, { tamper: true })).status).toBe(401);
    expect((await webhook({ event: 'participant_joined', room: { name: room }, participant: { identity: host.id } })).status).toBe(200);
    expect((await webhook({ event: 'participant_joined', room: { name: room }, participant: { identity: ana.id } })).status).toBe(200);
    expect((await webhook({ event: 'participant_joined', room: { name: room }, participant: { identity: eva.id } })).status).toBe(200);
    expect((await get(ana, id).expect(200)).body).toMatchObject({ viewers: 2, peakViewers: 2 });
    expect(txEvents(host, 'txillada.viewers').at(-1)).toEqual({ type: 'txillada.viewers', txilladaId: id, viewers: 2 });
    expect((await webhook({ event: 'participant_left', room: { name: room }, participant: { identity: eva.id } })).status).toBe(200);
    expect((await get(ana, id).expect(200)).body).toMatchObject({ viewers: 1, peakViewers: 2 });
    // A Eva saiu: já não recebe os eventos.
    const before = txEvents(eva, 'txillada.cheer').length;
    await api().post(`/api/v1/txilladas/${id}/cheer`).set(auth(ana)).expect(200);
    expect(txEvents(eva, 'txillada.cheer')).toHaveLength(before);

    // Expulsar: só o anfitrião; sai da sala no LiveKit e não volta a entrar.
    await api().post(`/api/v1/txilladas/${id}/ban/${rui.username}`).set(auth(ana)).expect(403);
    await api().post(`/api/v1/txilladas/${id}/ban/${rui.username}`).set(auth(host)).expect(204);
    expect(roomCalls).toContain(`remove:${room}:${rui.id}`);
    expect((await get(rui, id).expect(403)).body.message).toMatch(/tirou-te/);
    await api().post(`/api/v1/txilladas/${id}/join`).set(auth(rui)).expect(403);
    await api().post(`/api/v1/txilladas/${id}/comments`).set(auth(rui)).send({ body: 'Voltei' }).expect(403);
    // Com um token antigo, o LiveKit deixa entrar: o webhook tira-o outra vez (e não conta).
    roomCalls.length = 0;
    expect((await webhook({ event: 'participant_joined', room: { name: room }, participant: { identity: rui.id } })).status).toBe(200);
    expect(roomCalls).toEqual([`remove:${room}:${rui.id}`]);
    expect((await get(ana, id).expect(200)).body.viewers).toBe(1);

    // O vídeo do anfitrião.
    expect((await webhook({ event: 'track_published', room: { name: room }, participant: { identity: host.id }, track: { sid: 'TR_1', type: 'VIDEO' } })).status).toBe(200);
    expect((await pool.query('SELECT video_on FROM content.txilladas WHERE id = $1', [id])).rows[0].video_on).toBe(true);
    expect((await webhook({ event: 'track_unpublished', room: { name: room }, participant: { identity: host.id }, track: { sid: 'TR_1', type: 'VIDEO' } })).status).toBe(200);
    expect((await pool.query('SELECT video_on FROM content.txilladas WHERE id = $1', [id])).rows[0].video_on).toBe(false);
    // Uma sala que não é nossa: 200 e nada.
    expect((await webhook({ event: 'room_finished', room: { name: 'outra-sala' } })).status).toBe(200);
    // room_finished: a sala fechou, mas o anfitrião tem a margem para voltar (só a tarefa acaba, ver txillada-ligacao).
    expect((await webhook({ event: 'room_finished', room: { name: room } })).status).toBe(200);
    expect((await pool.query('SELECT status, host_gone_at IS NOT NULL AS gone FROM content.txilladas WHERE id = $1', [id])).rows[0]).toEqual({ status: 'live', gone: true });
    // O anfitrião termina: quem estava a ver recebe txillada.ended.
    await api().post(`/api/v1/txilladas/${id}/end`).set(auth(host)).expect(200);
    const t = (await get(ana, id).expect(200)).body;
    expect(t).toMatchObject({ status: 'ended', viewers: 0, canComment: false });
    expect(t.endedAt).toBeTruthy();
    expect(txEvents(ana, 'txillada.ended').at(-1)).toEqual({ type: 'txillada.ended', txilladaId: id, status: 'ended' });
    expect(txEvents(host, 'txillada.ended').at(-1)).toEqual({ type: 'txillada.ended', txilladaId: id, status: 'ended' });
    // Acabada: já não se entra, nem se comenta, nem se brinda.
    await api().post(`/api/v1/txilladas/${id}/join`).set(auth(ana)).expect(410);
    await api().post(`/api/v1/txilladas/${id}/comments`).set(auth(ana)).send({ body: 'Já foi?' }).expect(409);
    await api().post(`/api/v1/txilladas/${id}/cheer`).set(auth(ana)).expect(409);
  });

  it('o anfitrião termina: status ended, a sala fecha e todos recebem txillada.ended', async () => {
    const { host, ana } = u;
    const id = (await open(host, 'Rapidinha').expect(201)).body.txillada.id as string;
    await api().post(`/api/v1/txilladas/${id}/join`).set(auth(ana)).expect(200);
    await api().post(`/api/v1/txilladas/${id}/end`).set(auth(ana)).expect(403);
    roomCalls.length = 0;
    const r = await api().post(`/api/v1/txilladas/${id}/end`).set(auth(host)).expect(200);
    expect(r.body).toMatchObject({ id, status: 'ended', isHost: true });
    expect(roomCalls).toEqual([`delete:tx-${id}`]);
    expect(txEvents(ana, 'txillada.ended').at(-1)).toEqual({ type: 'txillada.ended', txilladaId: id, status: 'ended' });
    // Terminar outra vez não faz mal.
    await api().post(`/api/v1/txilladas/${id}/end`).set(auth(host)).expect(200);
  });

  it('fim automático: o anfitrião fora da sala há mais de 3 min (confirmado no LiveKit) e o limite das 4 h', async () => {
    const { host, zed } = u;
    const status = async (id: string) => (await pool.query('SELECT status FROM content.txilladas WHERE id = $1', [id])).rows[0].status as string;
    await svc.sweep(); // as que tenham ficado de outras corridas
    const a = (await open(host, 'Sem vídeo').expect(201)).body.txillada.id as string;
    // Ainda dentro da margem (o anfitrião ainda não entrou na sala): fica.
    expect(await svc.sweep()).toBe(0);
    expect(await status(a)).toBe('live');
    await pool.query(`UPDATE content.txilladas SET host_gone_at = now() - interval '4 minutes' WHERE id = $1`, [a]);
    // O LiveKit diz que o anfitrião está lá a publicar (o webhook perdeu-se): fica, e a margem cai.
    inRoom[`tx-${a}`] = [{ identity: host.id, videoTracks: 1 }];
    expect(await svc.sweep()).toBe(0);
    expect((await pool.query('SELECT status, host_gone_at FROM content.txilladas WHERE id = $1', [a])).rows[0]).toEqual({ status: 'live', host_gone_at: null });
    // Fora há mais de 3 min e o LiveKit confirma: acaba, com o motivo 'lost'.
    await pool.query(`UPDATE content.txilladas SET host_gone_at = now() - interval '4 minutes' WHERE id = $1`, [a]);
    inRoom[`tx-${a}`] = [];
    expect(await svc.sweep()).toBe(1);
    expect((await pool.query('SELECT status, end_reason FROM content.txilladas WHERE id = $1', [a])).rows[0]).toEqual({ status: 'ended', end_reason: 'lost' });
    // Com vídeo pelo webhook mas há mais de 4 h: acaba (limite de segurança).
    const b = (await open(zed, 'Maratona').expect(201)).body.txillada.id as string;
    await pool.query(`UPDATE content.txilladas SET video_on = true, video_at = now(), started_at = now() - interval '4 hours 1 minute' WHERE id = $1`, [b]);
    expect(await svc.sweep()).toBe(1);
    expect((await pool.query('SELECT status FROM content.txilladas WHERE id = $1', [b])).rows[0].status).toBe('ended');
  });

  it('denúncia na fila de moderação (txillada), «Txilladas ao vivo» no backoffice e o corte', async () => {
    const { host, ana, eva } = u;
    const staff = await staffLogin(app, 'txmod', ['moderacao']);
    const sup = await staffLogin(app, 'txsup', ['suporte']);
    const sauth = (s: { token: string }) => ({ Authorization: `Bearer ${s.token}` });
    const id = (await open(host, 'Denunciada').expect(201)).body.txillada.id as string;
    await api().post(`/api/v1/txilladas/${id}/join`).set(auth(ana)).expect(200);
    await api().post(`/api/v1/txilladas/${id}/report`).set(auth(host)).send({ reason: 'spam' }).expect(400);
    await api().post(`/api/v1/txilladas/${id}/report`).set(auth(ana)).send({ reason: 'nudity' }).expect(204);
    await api().post(`/api/v1/txilladas/${id}/report`).set(auth(u.blk)).send({ reason: 'nudity' }).expect(404);
    // Quem denunciou deixa de a ver na lista.
    expect(((await api().get('/api/v1/txilladas/live').set(auth(ana)).expect(200)).body.items as { id: string }[]).map((x) => x.id)).not.toContain(id);
    // A fila de queixas.
    const q = (await api().get('/api/v1/admin/mod/queue?type=txillada').set(sauth(staff)).expect(200)).body.items as any[];
    expect(q.find((x) => x.id === id)).toMatchObject({ type: 'txillada', reports: 1, preview: 'Denunciada', removed: null, owner: { username: host.username } });
    // O backoffice: a lista (com a denúncia) e o «Cortar».
    await api().get('/api/v1/admin/txilladas').set(auth(ana)).expect(401);
    const list = (await api().get('/api/v1/admin/txilladas').set(sauth(staff)).expect(200)).body.items as any[];
    expect(list.find((x) => x.id === id)).toMatchObject({ title: 'Denunciada', status: 'live', reports: { open: 1, reasons: ['nudity'] }, host: { username: host.username } });
    await api().post(`/api/v1/admin/txilladas/${id}/cut`).set(sauth(sup)).send({ reason: 'Nudez ao vivo' }).expect(403);
    await api().post(`/api/v1/admin/txilladas/${id}/cut`).set(sauth(staff)).send({ reason: 'x' }).expect(400);
    roomCalls.length = 0;
    await api().post(`/api/v1/admin/txilladas/${id}/cut`).set(sauth(staff)).send({ reason: 'Nudez ao vivo' }).expect(204);
    expect(roomCalls).toEqual([`delete:tx-${id}`]);
    expect(txEvents(ana, 'txillada.ended').at(-1)).toEqual({ type: 'txillada.ended', txilladaId: id, status: 'cut' });
    expect((await pool.query('SELECT status, cut_reason, cut_by FROM content.txilladas WHERE id = $1', [id])).rows[0]).toEqual({ status: 'cut', cut_reason: 'Nudez ao vivo', cut_by: staff.userId });
    expect((await pool.query(`SELECT status, resolution FROM social.reports WHERE target_type = 'txillada' AND target_id = $1`, [id])).rows).toEqual([{ status: 'actioned', resolution: 'remove' }]);
    await api().post(`/api/v1/admin/txilladas/${id}/cut`).set(sauth(staff)).send({ reason: 'Outra vez' }).expect(409);
    const notes = (await api().get('/api/v1/notifications').set(auth(host)).expect(200)).body.items as any[];
    expect(notes.find((x) => x.kind === 'content_removed' && x.data.type === 'txillada')).toMatchObject({ data: { reason: 'Nudez ao vivo' } });

    // Pela fila de queixas («Remover»): também corta, fecha a sala e avisa.
    const id2 = (await open(host, 'Outra denunciada').expect(201)).body.txillada.id as string;
    await api().post(`/api/v1/txilladas/${id2}/join`).set(auth(eva)).expect(200);
    await api().post(`/api/v1/txilladas/${id2}/report`).set(auth(eva)).send({ reason: 'violence' }).expect(204);
    roomCalls.length = 0;
    const d = await api().post('/api/v1/admin/mod/queue/decide').set(sauth(staff)).send({ items: [{ type: 'txillada', id: id2 }], action: 'remove', note: 'Violência' }).expect((r) => expect([200, 201]).toContain(r.status));
    expect(d.body.done).toHaveLength(1);
    for (let i = 0; i < 40 && !roomCalls.length; i++) await new Promise((r) => setTimeout(r, 25));
    expect(roomCalls).toEqual([`delete:tx-${id2}`]);
    expect((await pool.query('SELECT status FROM content.txilladas WHERE id = $1', [id2])).rows[0].status).toBe('cut');
    expect(txEvents(eva, 'txillada.ended').at(-1)).toEqual({ type: 'txillada.ended', txilladaId: id2, status: 'cut' });
    const q2 = (await api().get('/api/v1/admin/mod/queue?type=txillada&status=actioned').set(sauth(staff)).expect(200)).body.items as any[];
    expect(q2.find((x) => x.id === id2)?.removed).toBe('moderation');
  });

  it('live: { id } no perfil e na fila dos mimos, só para quem a pode ver', async () => {
    const { host, ana, rui } = u;
    expect((await api().get(`/api/v1/users/${host.username}`).set(auth(ana)).expect(200)).body.live).toBeNull();
    const id = (await open(host, 'No perfil').expect(201)).body.txillada.id as string;
    expect((await api().get(`/api/v1/users/${host.username}`).set(auth(ana)).expect(200)).body.live).toEqual({ id });
    expect((await api().get(`/api/v1/users/${host.username}`).set(auth(rui)).expect(200)).body.live).toEqual({ id });
    const tray = (await api().get('/api/v1/stories').set(auth(ana)).expect(200)).body as { username: string; live: { id: string } | null }[];
    expect(tray.find((x) => x.username === host.username)?.live).toEqual({ id });
    // O Rui foi expulso de outra Txillada, não desta: vê. Só para próximos: o Rui deixa de ver.
    await pool.query(`UPDATE content.txilladas SET audience = 'close' WHERE id = $1`, [id]);
    expect((await api().get(`/api/v1/users/${host.username}`).set(auth(rui)).expect(200)).body.live).toBeNull();
    expect((await api().get(`/api/v1/users/${host.username}`).set(auth(ana)).expect(200)).body.live).toEqual({ id });
    await api().post(`/api/v1/txilladas/${id}/end`).set(auth(host)).expect(200);
    expect((await api().get(`/api/v1/users/${host.username}`).set(auth(ana)).expect(200)).body.live).toBeNull();
    // A notificação diz que já acabou.
    const n = (await api().get('/api/v1/notifications').set(auth(ana)).expect(200)).body.items.find((x: any) => x.kind === 'txillada_live');
    expect(n.txillada.status).toBe('ended');
  });

  it('nada fica guardado: 7 dias depois do fim, comentários e brindes apagam-se (menos os de uma denúncia por decidir)', async () => {
    const { zed, ana, eva } = u;
    const mk = async (title: string) => {
      const id = (await open(zed, title).expect(201)).body.txillada.id as string;
      await new Promise((r) => setTimeout(r, 2_100));
      await api().post(`/api/v1/txilladas/${id}/comments`).set(auth(ana)).send({ body: `Comentário em ${title}` }).expect(201);
      await api().post(`/api/v1/txilladas/${id}/cheer`).set(auth(ana)).expect(200);
      return id;
    };
    const old = await mk('Velha');
    await api().post(`/api/v1/txilladas/${old}/end`).set(auth(zed)).expect(200);
    const reported = await mk('Velha denunciada');
    await api().post(`/api/v1/txilladas/${reported}/report`).set(auth(eva)).send({ reason: 'hate' }).expect(204);
    await api().post(`/api/v1/txilladas/${reported}/end`).set(auth(zed)).expect(200);
    const recent = await mk('Recente');
    await api().post(`/api/v1/txilladas/${recent}/end`).set(auth(zed)).expect(200);
    await pool.query(`UPDATE content.txilladas SET ended_at = now() - interval '8 days' WHERE id = ANY($1::uuid[])`, [[old, reported]]);
    await pool.query(`UPDATE content.txilladas SET ended_at = now() - interval '6 days' WHERE id = $1`, [recent]);
    const out = await svc.purge();
    expect(out.comments).toBeGreaterThanOrEqual(1);
    const count = async (table: string, id: string) => (await pool.query(`SELECT count(*)::int AS n FROM content.${table} WHERE txillada_id = $1`, [id])).rows[0].n as number;
    expect([await count('txillada_comments', old), await count('txillada_cheers', old)]).toEqual([0, 0]);
    expect([await count('txillada_comments', reported), await count('txillada_cheers', reported)]).toEqual([1, 0]);
    expect([await count('txillada_comments', recent), await count('txillada_cheers', recent)]).toEqual([1, 1]);
    // A linha fica, como registo (com os números), e acabada já não se vê nem se entra.
    expect((await get(ana, old).expect(200)).body).toMatchObject({ status: 'ended', comments: 1, cheers: 1 });
    expect((await api().get(`/api/v1/txilladas/${old}/comments`).set(auth(ana)).expect(200)).body.items).toEqual([]);
    // Decidida a denúncia, os comentários dessa também saem.
    await pool.query(`UPDATE social.reports SET status = 'dismissed', resolved_at = now() WHERE target_type = 'txillada' AND target_id = $1`, [reported]);
    await svc.purge();
    expect(await count('txillada_comments', reported)).toBe(0);
  });

  it('exportação e apagar a conta', async () => {
    const { zed, ana } = u;
    const live = (await open(zed, 'Até já').expect(201)).body.txillada.id as string;
    await api().post(`/api/v1/txilladas/${live}/join`).set(auth(ana)).expect(200);
    await new Promise((r) => setTimeout(r, 2_100));
    await api().post(`/api/v1/txilladas/${live}/comments`).set(auth(ana)).send({ body: 'Fica!' }).expect(201);
    const ex = (await api().get('/api/v1/me/export').set(auth(zed)).expect(200)).body;
    expect(ex.txilladas.map((t: { title: string }) => t.title)).toEqual(expect.arrayContaining(['Maratona', 'Velha', 'Até já']));
    expect(ex.txilladas.find((t: { id: string }) => t.id === live)).toMatchObject({ status: 'live', audience: 'everyone' });
    const exA = (await api().get('/api/v1/me/export').set(auth(ana)).expect(200)).body;
    expect(exA.txilladaComments.map((c: { body: string }) => c.body)).toContain('Fica!');
    // O Zed apaga a conta: a que estava a decorrer acaba (a sala fecha) e as Txilladas dele saem, com o que tinham.
    roomCalls.length = 0;
    await api().post('/api/v1/auth/delete-account').set(auth(zed)).send({ confirmUsername: zed.username, password: PASSWORD }).expect(204);
    expect(roomCalls).toContain(`delete:tx-${live}`);
    expect(txEvents(ana, 'txillada.ended').at(-1)).toEqual({ type: 'txillada.ended', txilladaId: live, status: 'ended' });
    expect((await pool.query('SELECT count(*)::int AS n FROM content.txilladas WHERE host_id = $1', [zed.id])).rows[0].n).toBe(0);
    expect((await pool.query('SELECT count(*)::int AS n FROM content.txillada_comments WHERE txillada_id = $1', [live])).rows[0].n).toBe(0);
    // A Ana apaga a conta: os comentários e os brindes dela nas Txilladas dos outros saem.
    expect((await pool.query('SELECT count(*)::int AS n FROM content.txillada_cheers WHERE user_id = $1', [ana.id])).rows[0].n).toBeGreaterThan(0);
    await api().post('/api/v1/auth/delete-account').set(auth(ana)).send({ confirmUsername: ana.username, password: PASSWORD }).expect(204);
    for (const t of ['txillada_comments WHERE author_id', 'txillada_cheers WHERE user_id', 'txillada_bans WHERE user_id']) {
      expect((await pool.query(`SELECT count(*)::int AS n FROM content.${t} = $1`, [ana.id])).rows[0].n).toBe(0);
    }
  });
});
