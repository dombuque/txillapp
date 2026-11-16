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
import { staffLogin } from '../staff/staff-test';
import { WalletService } from '../wallet/wallet.service';
import type { LiveKitRooms } from './livekit';
import { TxilladaService } from './txillada.service';

const DB = process.env.TEST_DATABASE_URL ?? 'postgres://txill:txill_dev@localhost:5433/txillapp_test';
const PASSWORD = 'password-bem-longa-1';
const LK = { LIVEKIT_URL: 'ws://localhost:7880', LIVEKIT_API_KEY: 'devkey', LIVEKIT_API_SECRET: 'secret' };

interface U { token: string; id: string; username: string; ip: string }

/**
 * Txillada: os três tipos (Pública, Para amigos, Privada paga) e a Angariação (0167) — docs/txillada-contrato.md. Sem o
 * servidor LiveKit: os tokens descodificam-se; o cliente da sala é um falso; o webhook vai assinado como o LiveKit o assina.
 */
describe('Txillada: tipos e Angariação (integração)', () => {
  let app: INestApplication;
  let pool: Pool;
  let svc: TxilladaService;
  let wallet: WalletService;
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
    setCanPublish: async (room, identity, on) => void roomCalls.push(`publish:${room}:${identity}:${on}`),
  };
  let n = 0;

  async function signup(name: string): Promise<U> {
    const username = `${name}${run}`.slice(0, 28);
    n++;
    const ip = `10.167.${n >> 8}.${n & 255}`;
    const r = await api().post('/api/v1/auth/register').set('X-Forwarded-For', ip)
      .send({ email: `${username}@example.com`, username, displayName: `${name[0].toUpperCase()}${name.slice(1)} Teste`, password: PASSWORD, birthDate: '1990-06-15', acceptTerms: true }).expect(201);
    await pool.query('UPDATE identity.users SET email_verified_at = now() WHERE id = $1', [r.body.user.id]);
    return { token: r.body.accessToken, id: r.body.user.id, username, ip };
  }
  const follow = (a: U, b: U) => api().post(`/api/v1/users/${b.username}/follow`).set(auth(a)).expect(200);
  const open = (x: U, body: Record<string, unknown>) => api().post('/api/v1/txilladas').set(auth(x)).send({ title: 'Bora', ...body });
  const get = (x: U, id: string) => api().get(`/api/v1/txilladas/${id}`).set(auth(x));
  const join = (x: U, id: string) => api().post(`/api/v1/txilladas/${id}/join`).set(auth(x));
  const pay = (x: U, id: string) => api().post(`/api/v1/txilladas/${id}/ticket`).set(auth(x));
  const gift = (x: U, id: string, amount: number, key: string) => api().post(`/api/v1/txilladas/${id}/gifts`).set(auth(x)).send({ amount, key });
  const balance = async (x: U) => (await api().get('/api/v1/wallet').set(auth(x)).expect(200)).body.balance as number;
  const txEvents = (x: U, type: string) => events.filter((e) => e.to === x.id && e.e?.type === type).map((e) => e.e);
  const endAll = (x: U) => pool.query(`UPDATE content.txilladas SET status = 'ended', ended_at = now() WHERE host_id = $1 AND status = 'live'`, [x.id]);
  const ledger = async (type: string, actor: U) => (await pool.query('SELECT count(*)::int AS n FROM ledger.transactions WHERE type = $1 AND actor_id = $2', [type, actor.id])).rows[0].n as number;

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
    wallet = app.get(WalletService);
    const bus = app.get(RealtimeBus);
    const publish = bus.publish.bind(bus);
    jest.spyOn(bus, 'publish').mockImplementation((to: string, e: unknown) => {
      events.push({ to, e });
      publish(to, e);
    });
    for (const name of ['host', 'ana', 'rui', 'eva', 'zed', 'blk', 'ivo']) u[name] = await signup(name);
    // A Ana e o anfitrião seguem-se um ao outro (amigos); a Eva só segue o anfitrião; o anfitrião só segue o Rui.
    await follow(u.ana, u.host);
    await follow(u.host, u.ana);
    await follow(u.eva, u.host);
    await follow(u.host, u.rui);
    await api().put(`/api/v1/blocks/${u.blk.username}`).set(auth(u.host)).expect((r) => expect([200, 204]).toContain(r.status));
  }, 180_000);

  afterAll(async () => {
    await app.close();
    await pool.end();
    jest.restoreAllMocks();
  });

  it('Para amigos: só quem eu sigo e me segue; «Só amigos próximos» estreita à lista; o antigo «followers» ainda vale', async () => {
    const { host, ana, rui, eva, zed } = u;
    await open(host, { audience: 'xyz' }).expect(400);
    const fr = (await open(host, { audience: 'friends' }).expect(201)).body.txillada;
    expect(fr).toMatchObject({ audience: 'friends', kind: 'friends', closeOnly: false, price: null, hasTicket: true, locked: false, goal: null, raised: 0, topGivers: [] });
    expect((await get(ana, fr.id).expect(200)).body).toMatchObject({ kind: 'friends', isHost: false, hasTicket: true, locked: false });
    await get(eva, fr.id).expect(404); // só segue o anfitrião
    await get(rui, fr.id).expect(404); // só o anfitrião o segue
    await get(zed, fr.id).expect(404);
    await join(eva, fr.id).expect(404);
    // Na lista do que está a decorrer e na notificação, também só os amigos.
    expect(((await api().get('/api/v1/txilladas/live').set(auth(ana)).expect(200)).body.items as { id: string }[]).map((x) => x.id)).toContain(fr.id);
    expect(((await api().get('/api/v1/txilladas/live').set(auth(eva)).expect(200)).body.items as { id: string }[]).map((x) => x.id)).not.toContain(fr.id);
    await endAll(host);

    // «Só amigos próximos» (o 'close'): só a lista dos mimos; a Eva entra na lista, a Ana não.
    await api().put(`/api/v1/stories/close-friends/${eva.username}`).set(auth(host)).expect(204);
    const cl = (await open(host, { audience: 'close' }).expect(201)).body.txillada;
    expect(cl).toMatchObject({ audience: 'close', kind: 'friends', closeOnly: true });
    await get(eva, cl.id).expect(200);
    await get(ana, cl.id).expect(404);
    await endAll(host);

    // As apps antigas ainda mandam 'followers' (Pública para quem segue).
    const fo = (await open(host, { audience: 'followers' }).expect(201)).body.txillada;
    expect(fo).toMatchObject({ audience: 'followers', kind: 'public' });
    await get(eva, fo.id).expect(200);
    await get(rui, fo.id).expect(404);
    await endAll(host);
  });

  it('Privada (paga): o preço tem limites; antes de pagar, só o cartão (nada da sala); pagar uma vez, sem cobrar outra vez', async () => {
    const { host, ana, rui, eva } = u;
    await open(host, { audience: 'paid' }).expect(400);
    await open(host, { audience: 'paid', price: 4 }).expect(400);
    await open(host, { audience: 'paid', price: 5001 }).expect(400);
    await open(host, { audience: 'paid', price: 12.5 }).expect(400);
    const t = (await open(host, { audience: 'paid', price: 50, goal: 1000, purpose: 'Para o som novo' }).expect(201)).body.txillada;
    expect(t).toMatchObject({ audience: 'paid', kind: 'paid', price: 50, hasTicket: true, locked: false, viewersHidden: false, tickets: 0, goal: 1000, goalPurpose: 'Para o som novo' });
    const id = t.id as string;
    // O preço numa que não é paga ignora-se.
    expect((await open(u.zed, { audience: 'everyone', price: 50 }).expect(201)).body.txillada).toMatchObject({ kind: 'public', price: null });
    await endAll(u.zed);

    // Antes de pagar: o título, o anfitrião, o preço e «a decorrer»; nada mais.
    await pool.query('UPDATE content.txilladas SET viewers = 7, peak_viewers = 9, cheers = 3, comments = 2, raised = 40 WHERE id = $1', [id]);
    const card = (await get(ana, id).expect(200)).body;
    expect(card).toMatchObject({
      kind: 'paid', price: 50, status: 'live', title: 'Bora', hasTicket: false, locked: true, viewersHidden: true,
      viewers: 0, peakViewers: 0, cheers: 0, comments: 0, goal: null, goalPurpose: '', raised: 0, topGivers: [], guests: [], pinned: null, canComment: false,
    });
    expect(card).not.toHaveProperty('tickets');
    expect(card.host).toMatchObject({ username: host.username });
    await pool.query('UPDATE content.txilladas SET viewers = 0, peak_viewers = 0, cheers = 0, comments = 0, raised = 0 WHERE id = $1', [id]);
    // Na lista, com o cadeado e o preço.
    const inList = ((await api().get('/api/v1/txilladas/live').set(auth(ana)).expect(200)).body.items as any[]).find((x) => x.id === id);
    expect(inList).toMatchObject({ locked: true, price: 50, viewers: 0 });
    // No perfil e na fila dos mimos, a roda leva o preço (o cadeado) a quem ainda não pagou.
    const liveOnProfile = async (x: U) => (await api().get(`/api/v1/users/${host.username}`).set(auth(x)).expect(200)).body.live;
    expect(await liveOnProfile(ana)).toEqual({ id, price: 50 });
    expect((await api().get('/api/v1/stories?live=1').set(auth(ana)).expect(200)).body.find((x: { username: string }) => x.username === host.username)?.live).toEqual({ id, price: 50 });
    // Nada da sala sem a entrada: 402 com o preço.
    const j = await join(ana, id).expect(402);
    expect(j.body).toMatchObject({ code: 'ticket_required', price: 50 });
    await api().get(`/api/v1/txilladas/${id}/comments`).set(auth(ana)).expect(402);
    await api().post(`/api/v1/txilladas/${id}/comments`).set(auth(ana)).send({ body: 'Olá' }).expect(402);
    await api().get(`/api/v1/txilladas/${id}/viewers`).set(auth(ana)).expect(402);
    await api().post(`/api/v1/txilladas/${id}/cheer`).set(auth(ana)).expect(402);
    await api().post(`/api/v1/txilladas/${id}/react`).set(auth(ana)).send({ kind: 'fire' }).expect(402);
    await api().post(`/api/v1/txilladas/${id}/guests/request`).set(auth(ana)).expect(402);
    await gift(ana, id, 10, 'antes-de-pagar').expect(402);
    // Com um token de outra (ou forjado), o webhook tira-a da sala.
    roomCalls.length = 0;
    expect((await webhook({ event: 'participant_joined', room: { name: `tx-${id}` }, participant: { identity: ana.id } })).status).toBe(200);
    expect(roomCalls).toContain(`remove:tx-${id}:${ana.id}`);
    expect(events.filter((e) => e.to === ana.id && e.e?.txilladaId === id)).toEqual([]);
    // O anfitrião não paga.
    expect((await pay(host, id).expect(200)).body).toMatchObject({ hasTicket: true, charged: false });

    // Pagar: quem vê → anfitrião, uma vez.
    const a0 = await balance(ana);
    const h0 = await balance(host);
    const p1 = (await pay(ana, id).expect(200)).body;
    expect(p1).toMatchObject({ hasTicket: true, charged: true, balance: a0 - 50, txillada: { hasTicket: true, locked: false, goal: 1000 } });
    expect(await balance(host)).toBe(h0 + 50);
    expect((await pay(ana, id).expect(200)).body).toMatchObject({ hasTicket: true, charged: false, balance: a0 - 50 });
    expect(await liveOnProfile(ana)).toEqual({ id });
    expect(await balance(ana)).toBe(a0 - 50);
    // Dois pedidos ao mesmo tempo: só um cobra.
    const r0 = await balance(rui);
    const both = await Promise.all([pay(rui, id), pay(rui, id), pay(rui, id)]);
    expect(both.map((r) => r.status)).toEqual([200, 200, 200]);
    expect(both.filter((r) => r.body.charged).length).toBe(1);
    expect(await balance(rui)).toBe(r0 - 50);
    expect(await ledger('txillada_ticket', rui)).toBe(1);
    expect((await pool.query('SELECT count(*)::int AS n FROM content.txillada_tickets WHERE txillada_id = $1', [id])).rows[0].n).toBe(2);
    expect((await get(host, id).expect(200)).body.tickets).toBe(2);
    // O histórico da carteira diz o que foi.
    const hist = (await api().get('/api/v1/wallet').set(auth(ana)).expect(200)).body.history as any[];
    expect(hist[0]).toMatchObject({ type: 'txillada_ticket', amount: -50, label: `Entrada na Txillada de @${host.username}`, counterparty: { username: host.username } });

    // Entrar (e voltar a entrar) é grátis; quem vê entra escondido; «entrou» só ao anfitrião; a lista só para o anfitrião.
    events.length = 0;
    const tok = decodeJwt((await join(rui, id).expect(200)).body.token) as any;
    expect(tok.video).toMatchObject({ canPublish: false, canSubscribe: true, hidden: true });
    await join(ana, id).expect(200);
    await join(ana, id).expect(200);
    expect(await balance(ana)).toBe(a0 - 50);
    expect(txEvents(host, 'txillada.joined').map((e) => e.user.username)).toEqual(expect.arrayContaining([ana.username, rui.username]));
    expect(txEvents(rui, 'txillada.joined')).toEqual([]);
    expect((await api().get(`/api/v1/txilladas/${id}/viewers`).set(auth(ana)).expect(200)).body).toEqual({ items: [], total: 0, hidden: true });
    const hv = (await api().get(`/api/v1/txilladas/${id}/viewers`).set(auth(host)).expect(200)).body;
    expect(hv.hidden).toBe(false);
    expect(hv.items.map((x: { username: string }) => x.username).sort()).toEqual([ana.username, rui.username].sort());
    expect((await get(ana, id).expect(200)).body).toMatchObject({ viewersHidden: true, locked: false, canComment: true });
    // Com a entrada: comentar e o resto.
    await api().get(`/api/v1/txilladas/${id}/comments`).set(auth(ana)).expect(200);

    // Sem saldo: 422 claro, sem cobrar nem gravar nada.
    const big = (await open(u.zed, { audience: 'paid', price: 5000 }).expect(201)).body.txillada.id as string;
    const e0 = await balance(eva);
    const no = await pay(eva, big).expect(422);
    expect(no.body).toMatchObject({ code: 'insufficient_funds', amount: 5000, balance: e0 });
    expect(no.body.message).toMatch(/Não tens Txills suficientes/);
    expect(await balance(eva)).toBe(e0);
    expect((await pool.query('SELECT count(*)::int AS n FROM content.txillada_tickets WHERE txillada_id = $1', [big])).rows[0].n).toBe(0);
    // Pagar uma que não é paga: 400; uma que já acabou: 409.
    await endAll(u.zed);
    await pay(eva, big).expect(409);
    const free = (await open(u.zed, { audience: 'everyone' }).expect(201)).body.txillada.id as string;
    await pay(eva, free).expect(400);
    await endAll(u.zed);
  });

  it('Privada: os convidados para transmitir não pagam; a moderação corta e as entradas voltam (uma vez só); acabar normalmente não devolve', async () => {
    const { host, ana, rui, ivo } = u;
    const id = ((await api().get('/api/v1/txilladas/live').set(auth(ana)).expect(200)).body.items as any[]).find((x) => x.host.username === host.username).id as string;
    // O anfitrião convida o Ivo (que ainda não entrou): entra de graça e aceita.
    const i0 = await balance(ivo);
    await api().post(`/api/v1/txilladas/${id}/guests/invite`).set(auth(host)).send({ username: ivo.username }).expect(200);
    expect(txEvents(ivo, 'txillada.invite').at(-1)).toMatchObject({ txilladaId: id });
    expect((await get(ivo, id).expect(200)).body).toMatchObject({ hasTicket: true, locked: false, guestState: 'invited' });
    await join(ivo, id).expect(200);
    await api().post(`/api/v1/txilladas/${id}/guests/accept`).set(auth(ivo)).expect(200);
    expect((await pay(ivo, id).expect(200)).body).toMatchObject({ charged: false });
    expect(await balance(ivo)).toBe(i0);
    // O convidado entra a poder publicar e não escondido.
    expect((decodeJwt((await join(ivo, id).expect(200)).body.token) as any).video).toMatchObject({ canPublish: true });
    // Quem o anfitrião não pode convidar (bloqueio): 404.
    await api().post(`/api/v1/txilladas/${id}/guests/invite`).set(auth(host)).send({ username: u.blk.username }).expect(404);

    // O anfitrião gasta quase tudo antes do corte: a devolução tira o que ele tem e a emissão cobre o resto.
    await wallet.ensureWallet(u.zed.id);
    const hb = await balance(host);
    await wallet.transfer({ actorId: host.id, fromUserId: host.id, toUserId: u.zed.id, amount: hb - 30, type: 'transfer', idempotencyKey: `gasta-${run}` });
    expect(await balance(host)).toBe(30);
    const a0 = await balance(ana);
    const r0 = await balance(rui);
    const staff = await staffLogin(app, 'txtipos', ['moderacao']);
    await api().post(`/api/v1/admin/txilladas/${id}/cut`).set({ Authorization: `Bearer ${staff.token}` }).send({ reason: 'Conteúdo proibido' }).expect(204);
    expect(await balance(ana)).toBe(a0 + 50);
    expect(await balance(rui)).toBe(r0 + 50);
    expect(await balance(host)).toBe(0);
    const tk = (await pool.query('SELECT refunded_at IS NOT NULL AS done, refund_transaction_id FROM content.txillada_tickets WHERE txillada_id = $1', [id])).rows;
    expect(tk.every((x) => x.done && x.refund_transaction_id)).toBe(true);
    // Outra vez (a tarefa, ou o gancho da moderação): nada muda.
    expect(await svc.refundTickets(id)).toBe(0);
    await svc.sweep();
    await svc.afterCut(id);
    expect(await balance(ana)).toBe(a0 + 50);
    expect(await ledger('txillada_refund', host)).toBe(2);
    const hist = (await api().get('/api/v1/wallet').set(auth(ana)).expect(200)).body.history as any[];
    expect(hist[0]).toMatchObject({ type: 'txillada_refund', amount: 50 });
    expect(hist[0].label).toMatch(/^Devolução da entrada na Txillada/);

    // Acabar normalmente (o anfitrião): não há devolução.
    const ok = (await open(u.zed, { audience: 'paid', price: 10 }).expect(201)).body.txillada.id as string;
    await follow(rui, u.zed);
    const r1 = await balance(rui);
    await pay(rui, ok).expect(200);
    await api().post(`/api/v1/txilladas/${ok}/end`).set(auth(u.zed)).expect(200);
    await svc.sweep();
    expect(await balance(rui)).toBe(r1 - 10);
    expect((await pool.query('SELECT refunded_at FROM content.txillada_tickets WHERE txillada_id = $1', [ok])).rows[0].refunded_at).toBeNull();
  });

  it('Angariação: a meta e o motivo; ofertas com idempotência, a barra em tempo real, a linha destacada e quem mais ofereceu', async () => {
    const { host, ana, rui, eva } = u;
    await open(host, { goal: 5 }).expect(400);
    await open(host, { goal: 2_000_000 }).expect(400);
    await open(host, { goal: 100, purpose: 'kys' }).expect(422);
    await open(host, { goal: 100, purpose: 'x'.repeat(81) }).expect(400);
    const t = (await open(host, { goal: 100, purpose: '  Para   a festa ' }).expect(201)).body.txillada;
    expect(t).toMatchObject({ kind: 'public', goal: 100, goalPurpose: 'Para a festa', raised: 0, topGivers: [] });
    const id = t.id as string;
    await join(ana, id).expect(200);
    await join(rui, id).expect(200);
    events.length = 0;

    // Validação: o anfitrião não oferece; 1 a 5000; a chave tem de ser boa.
    await gift(host, id, 10, `host-${run}`).expect(400);
    await gift(ana, id, 0, `zero-${run}`).expect(400);
    await gift(ana, id, 5001, `muito-${run}`).expect(400);
    await gift(ana, id, 10, 'curta').expect(400);
    await gift(eva, id, 10.5, `meio-${run}`).expect(400);

    const a0 = await balance(ana);
    const h0 = await balance(host);
    const g1 = (await gift(ana, id, 50, `ana-1-${run}`).expect(200)).body;
    expect(g1).toMatchObject({ replayed: false, raised: 50, goal: 100, balance: a0 - 50, gift: { amount: 50, from: { username: ana.username, verified: false, verifiedTier: null } } });
    expect(g1.topGivers).toEqual([expect.objectContaining({ username: ana.username, total: 50 })]);
    expect(await balance(host)).toBe(h0 + 50);
    // A mesma chave outra vez: a mesma oferta, sem cobrar.
    const again = (await gift(ana, id, 50, `ana-1-${run}`).expect(200)).body;
    expect(again).toMatchObject({ replayed: true, raised: 50, gift: { id: g1.gift.id } });
    expect(await balance(ana)).toBe(a0 - 50);
    expect(await ledger('txillada_gift', ana)).toBe(1);
    // A sala recebe a linha e a barra (o anfitrião, quem vê e quem ofereceu).
    for (const who of [host, rui, ana]) {
      expect(txEvents(who, 'txillada.gift')).toEqual([
        { type: 'txillada.gift', txilladaId: id, gift: g1.gift, raised: 50, goal: 100, topGivers: [expect.objectContaining({ username: ana.username, total: 50 })] },
      ]);
    }
    // Mais ofertas: o top 3 pelo total.
    await gift(rui, id, 10, `rui-1-${run}`).expect(200);
    await gift(rui, id, 100, `rui-2-${run}`).expect(200);
    await join(eva, id).expect(200);
    await gift(eva, id, 5, `eva-1-${run}`).expect(200);
    const dto = (await get(eva, id).expect(200)).body;
    expect(dto).toMatchObject({ raised: 165, goal: 100, goalPurpose: 'Para a festa' });
    expect(dto.topGivers.map((g: { username: string; total: number }) => [g.username, g.total])).toEqual([[rui.username, 110], [ana.username, 50], [eva.username, 5]]);
    expect(txEvents(host, 'txillada.gift').at(-1)).toMatchObject({ raised: 165 });
    // Sem saldo: 422 com o saldo.
    const e0 = await balance(eva);
    expect((await gift(eva, id, 5000, `eva-big-${run}`).expect(422)).body).toMatchObject({ code: 'insufficient_funds', amount: 5000, balance: e0 });
    // No máximo 5 ofertas a cada 10 s por pessoa.
    for (let i = 0; i < 3; i++) await gift(eva, id, 1, `eva-r${i}-${run}`).expect(200);
    await gift(eva, id, 1, `eva-r9-${run}`).expect(429);
    // O histórico da carteira do anfitrião.
    const hist = (await api().get('/api/v1/wallet').set(auth(host)).expect(200)).body.history as any[];
    expect(hist.find((h) => h.type === 'txillada_gift')).toMatchObject({ amount: expect.any(Number), label: expect.stringMatching(/^Oferta de @.+ na tua Txillada$/) });

    // Sem Angariação também se oferece (a meta vem a null).
    await endAll(host);
    const plain = (await open(host, {}).expect(201)).body.txillada.id as string;
    await join(ana, plain).expect(200);
    expect((await gift(ana, plain, 5, `ana-plain-${run}`).expect(200)).body).toMatchObject({ raised: 5, goal: null });
    expect((await get(ana, plain).expect(200)).body).toMatchObject({ goal: null, goalPurpose: '', raised: 5 });
    // Acabada: 409.
    await api().post(`/api/v1/txilladas/${plain}/end`).set(auth(host)).expect(200);
    await gift(ana, plain, 5, `ana-late-${run}`).expect(409);

    // A limpeza dos 7 dias não toca nas ofertas nem nas entradas (são dinheiro).
    await pool.query(`UPDATE content.txilladas SET ended_at = now() - interval '8 days' WHERE host_id = ANY($1::uuid[]) AND status <> 'live'`, [[host.id, u.zed.id]]);
    const before = (await pool.query('SELECT (SELECT count(*) FROM content.txillada_gifts)::int AS g, (SELECT count(*) FROM content.txillada_tickets)::int AS k')).rows[0];
    await svc.purge();
    expect((await pool.query('SELECT (SELECT count(*) FROM content.txillada_gifts)::int AS g, (SELECT count(*) FROM content.txillada_tickets)::int AS k')).rows[0]).toEqual(before);
    expect((await pool.query('SELECT count(*)::int AS n FROM content.txillada_gifts WHERE txillada_id = $1', [id])).rows[0].n).toBe(7);
  });

  it('exportação e apagar a conta: as entradas e as ofertas ficam como registo', async () => {
    const { host, ana } = u;
    const exA = (await api().get('/api/v1/me/export').set(auth(ana)).expect(200)).body;
    expect(exA.txilladaTickets).toEqual(expect.arrayContaining([expect.objectContaining({ host: host.username, price: 50 })]));
    expect(exA.txilladaGiftsGiven).toEqual(expect.arrayContaining([expect.objectContaining({ host: host.username, amount: 50 })]));
    const exH = (await api().get('/api/v1/me/export').set(auth(host)).expect(200)).body;
    expect(exH.txilladaTicketsSold).toEqual(expect.arrayContaining([expect.objectContaining({ from: ana.username, price: 50 })]));
    expect(exH.txilladaGiftsReceived.length).toBeGreaterThanOrEqual(5);
    expect(exH.txilladas.find((t: { price: number | null }) => t.price === 50)).toMatchObject({ audience: 'paid', goal: 1000, goalPurpose: 'Para o som novo', tickets: 2 });
    const count = async () => (await pool.query('SELECT (SELECT count(*) FROM content.txillada_gifts WHERE giver_id = $1 OR host_id = $2)::int AS g, (SELECT count(*) FROM content.txillada_tickets WHERE user_id = $1 OR host_id = $2)::int AS k', [ana.id, host.id])).rows[0];
    const before = await count();
    await api().post('/api/v1/auth/delete-account').set(auth(ana)).send({ confirmUsername: ana.username, password: PASSWORD }).expect(204);
    await api().post('/api/v1/auth/delete-account').set(auth(host)).send({ confirmUsername: host.username, password: PASSWORD }).expect(204);
    expect(await count()).toEqual(before);
    // As Txilladas do anfitrião saíram; o registo fica sem elas (txillada_id a NULL), com o anfitrião e os valores.
    expect((await pool.query('SELECT count(*)::int AS n FROM content.txillada_tickets WHERE host_id = $1 AND txillada_id IS NOT NULL', [host.id])).rows[0].n).toBe(0);
  });
});
