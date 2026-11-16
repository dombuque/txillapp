import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Pool } from 'pg';
import { loadConfig } from '../config';
import { migrate } from '../db/migrate';
import { createApp } from '../main';
import { PushService, type PushPayload } from '../push/push.service';
import { RealtimeBus } from '../realtime/realtime-bus';
import type { LiveKitRooms } from './livekit';

const DB = process.env.TEST_DATABASE_URL ?? 'postgres://txill:txill_dev@localhost:5433/txillapp_test';
const PASSWORD = 'password-bem-longa-1';
const LK = { LIVEKIT_URL: 'ws://localhost:7880', LIVEKIT_API_KEY: 'devkey', LIVEKIT_API_SECRET: 'secret' };

interface U { token: string; id: string; username: string; ip: string }

/**
 * «Convidar por @» (0168) — docs/txillada-contrato.md: o anfitrião convida para transmitir quem ainda não entrou, em qualquer
 * tipo; a pessoa recebe o aviso 'txillada_invite' (lista e telemóvel) que abre a Txillada; numa privada entra sem pagar.
 * Sem o servidor LiveKit (o cliente da sala é um falso) e com os pushes guardados em vez de enviados.
 */
describe('Txillada: convidar por @ (integração)', () => {
  let app: INestApplication;
  let pool: Pool;
  const run = Date.now().toString(36);
  const api = () => request(app.getHttpServer());
  const auth = (x: U) => ({ Authorization: `Bearer ${x.token}`, 'X-Forwarded-For': x.ip });
  const u: Record<string, U> = {};
  const events: { to: string; e: any }[] = [];
  const pushes: { userId: string; p: PushPayload }[] = [];
  const rooms: LiveKitRooms = {
    removeParticipant: async () => undefined,
    deleteRoom: async () => undefined,
    participants: async () => [],
    setCanPublish: async () => undefined,
  };
  let n = 0;

  async function signup(name: string): Promise<U> {
    const username = `${name}${run}`.slice(0, 28);
    n++;
    const ip = `10.168.${n >> 8}.${n & 255}`;
    const r = await api().post('/api/v1/auth/register').set('X-Forwarded-For', ip)
      .send({ email: `${username}@example.com`, username, displayName: `${name[0].toUpperCase()}${name.slice(1)} Teste`, password: PASSWORD, birthDate: '1990-06-15', acceptTerms: true }).expect(201);
    await pool.query('UPDATE identity.users SET email_verified_at = now() WHERE id = $1', [r.body.user.id]);
    return { token: r.body.accessToken, id: r.body.user.id, username, ip };
  }
  const follow = (a: U, b: U) => api().post(`/api/v1/users/${b.username}/follow`).set(auth(a)).expect(200);
  const open = (x: U, body: Record<string, unknown> = {}) => api().post('/api/v1/txilladas').set(auth(x)).send({ title: 'Bora', ...body });
  const get = (x: U, id: string) => api().get(`/api/v1/txilladas/${id}`).set(auth(x));
  const join = (x: U, id: string) => api().post(`/api/v1/txilladas/${id}/join`).set(auth(x));
  const g = (x: U, id: string, what: string) => api().post(`/api/v1/txilladas/${id}/guests/${what}`).set(auth(x));
  const invite = (x: U, id: string, username: string) => g(x, id, 'invite').send({ username });
  const names = (list: { user: { username: string } }[]) => list.map((x) => x.user.username);
  const endAll = (x: U) => pool.query(`UPDATE content.txilladas SET status = 'ended', ended_at = now() WHERE host_id = $1 AND status = 'live'`, [x.id]);
  const notes = async (x: U, id: string) =>
    (await pool.query(`SELECT actor_id, data FROM social.notifications WHERE user_id = $1 AND kind = 'txillada_invite' AND data->>'txilladaId' = $2`, [x.id, id])).rows;
  const listed = async (x: U) => ((await api().get('/api/v1/notifications').set(auth(x)).expect(200)).body.items as any[]).filter((i) => i.kind === 'txillada_invite');
  const pushesTo = (x: U) => pushes.filter((p) => p.userId === x.id && p.p.url?.startsWith('/txillada/') && /convidou-te/.test(p.p.body));
  const balance = async (x: U) => (await api().get('/api/v1/wallet').set(auth(x)).expect(200)).body.balance as number;

  beforeAll(async () => {
    await migrate(DB);
    pool = new Pool({ connectionString: DB });
    app = await createApp(
      loadConfig({ DATABASE_URL: DB, JWT_ACCESS_SECRET: 't'.repeat(40), NODE_ENV: 'test', MEDIA_DIR: './uploads-test', ...LK }),
      { livekitRooms: rooms },
    );
    await app.init();
    const bus = app.get(RealtimeBus);
    const publish = bus.publish.bind(bus);
    jest.spyOn(bus, 'publish').mockImplementation((to: string, e: unknown) => {
      events.push({ to, e });
      publish(to, e);
    });
    // Os pushes ficam guardados (sem servidor de push nos testes: liga-se o «enabled» à mão).
    const push = app.get(PushService);
    Object.defineProperty(push, 'enabled', { value: true });
    jest.spyOn(push, 'send').mockImplementation(async (userId: string, p: PushPayload) => {
      pushes.push({ userId, p });
      return 1;
    });
    for (const name of ['host', 'ana', 'rui', 'eva', 'blk', 'ivo', 'zed']) u[name] = await signup(name);
    // O anfitrião tem o selo (vai com o nome no aviso). A Eva só segue o anfitrião (não é amiga); o Blk bloqueou o anfitrião.
    await pool.query(`UPDATE identity.users SET verified = true, verified_tier = 'verified' WHERE id = $1`, [u.host.id]);
    await follow(u.eva, u.host);
    await api().put(`/api/v1/blocks/${u.host.username}`).set(auth(u.blk)).expect((r) => expect([200, 204]).toContain(r.status));
  }, 180_000);

  afterAll(async () => {
    await app.close();
    await pool.end();
    jest.restoreAllMocks();
  });

  it('pelo @, quem ainda não entrou: o convite, o aviso na lista e no telemóvel (com o selo), e depois entrar e aceitar', async () => {
    const { host, ana, rui } = u;
    const id = (await open(host).expect(201)).body.txillada.id as string;
    await join(rui, id).expect(200);
    pushes.length = 0;
    // A Ana ainda não entrou: convida-se pelo @ (com ou sem o «@»).
    const r = (await invite(host, id, `@${ana.username}`).expect(200)).body;
    expect(names(r.invites)).toEqual([ana.username]);
    expect(events.filter((e) => e.to === ana.id && e.e?.type === 'txillada.invite').at(-1)?.e).toMatchObject({ txilladaId: id, host: { username: host.username, verified: true } });
    expect(await notes(ana, id)).toEqual([{ actor_id: host.id, data: { txilladaId: id, title: 'Bora' } }]);
    expect(pushesTo(ana)).toEqual([{
      userId: ana.id,
      p: expect.objectContaining({ title: 'Host Teste', body: `@${host.username} convidou-te para transmitir na Txillada`, url: `/txillada/${id}`, category: 'txilladas' }),
    }]);
    const item = (await listed(ana))[0];
    expect(item).toMatchObject({ kind: 'txillada_invite', data: { txilladaId: id }, txillada: { status: 'live' }, actor: { username: host.username, verified: true, verifiedTier: 'verified' } });
    // O mesmo convite outra vez: 409 claro, sem outro aviso.
    expect((await invite(host, id, ana.username).expect(409)).body).toMatchObject({ code: 'already_invited', message: `Já convidaste @${ana.username}. Espera pela resposta.` });
    // Retirar e voltar a convidar não repete o aviso (no máximo um por Txillada a cada 10 min).
    await g(host, id, `${ana.username}/remove`).expect(200);
    await invite(host, id, ana.username).expect(200);
    expect(await notes(ana, id)).toHaveLength(1);
    expect(pushesTo(ana)).toHaveLength(1);
    // A Ana abre a Txillada pelo aviso: tem o convite à espera; entra e aceita.
    expect((await get(ana, id).expect(200)).body.guestState).toBe('invited');
    await g(ana, id, 'accept').expect(409); // ainda não está a ver
    await join(ana, id).expect(200);
    expect((await g(ana, id, 'accept').expect(200)).body.state).toBe('guest');
    // Quem já está a ver recebe o cartão do convite em tempo real: sem aviso na lista nem no telemóvel.
    await invite(host, id, rui.username).expect(200);
    expect(await notes(rui, id)).toEqual([]);
    expect(pushesTo(rui)).toEqual([]);
    // Quem já transmite: 409.
    expect((await invite(host, id, ana.username).expect(409)).body.message).toBe(`@${ana.username} já está a transmitir.`);
    await endAll(host);
    // Acabada: o aviso diz que já acabou.
    expect((await listed(ana))[0]).toMatchObject({ txillada: { status: 'ended' } });
  });

  it('as regras: só o anfitrião, quem não existe ou tem bloqueio (404), quem não pode ver (409), expulso (409); o aviso some com um bloqueio', async () => {
    const { host, ana, eva, blk, zed } = u;
    const fr = (await open(host, { audience: 'friends' }).expect(201)).body.txillada.id as string;
    await invite(host, fr, `ninguem${run}`).expect(404);
    await invite(host, fr, blk.username).expect(404);
    expect(await notes(blk, fr)).toEqual([]);
    // A Eva só segue o anfitrião: não vê uma Txillada «Para amigos».
    expect((await invite(host, fr, eva.username).expect(409)).body.message).toBe(`@${eva.username} não pode ver a tua Txillada.`);
    expect(await notes(eva, fr)).toEqual([]);
    await endAll(host);

    const id = (await open(host).expect(201)).body.txillada.id as string;
    // Só o anfitrião convida.
    await invite(ana, id, zed.username).expect(403);
    // Expulso: não se convida.
    await join(eva, id).expect(200);
    await api().post(`/api/v1/txilladas/${id}/ban/${eva.username}`).set(auth(host)).expect(204);
    expect((await invite(host, id, eva.username).expect(409)).body.message).toMatch(/Tiraste @.+ desta Txillada/);
    // O Zed recebe o aviso e depois bloqueia o anfitrião: o aviso sai da lista e o convite cai.
    await invite(host, id, zed.username).expect(200);
    expect(await listed(zed)).toHaveLength(1);
    await api().put(`/api/v1/blocks/${host.username}`).set(auth(zed)).expect((r) => expect([200, 204]).toContain(r.status));
    expect(await listed(zed)).toEqual([]);
    expect((await get(host, id).expect(200)).body.invites).toEqual([]);
    await api().delete(`/api/v1/blocks/${host.username}`).set(auth(zed));
    await endAll(host);
  });

  it('numa privada: quem é convidado pelo @ entra sem pagar (e pode transmitir)', async () => {
    const { host, ivo, rui } = u;
    const id = (await open(host, { audience: 'paid', price: 50 }).expect(201)).body.txillada.id as string;
    // Sem convite: o cartão com o cadeado.
    expect((await get(rui, id).expect(200)).body).toMatchObject({ locked: true, hasTicket: false });
    await join(rui, id).expect(402);
    const i0 = await balance(ivo);
    await invite(host, id, ivo.username).expect(200);
    expect(await notes(ivo, id)).toHaveLength(1);
    expect(pushesTo(ivo).at(-1)?.p.url).toBe(`/txillada/${id}`);
    expect((await get(ivo, id).expect(200)).body).toMatchObject({ locked: false, hasTicket: true, guestState: 'invited' });
    await join(ivo, id).expect(200);
    expect((await g(ivo, id, 'accept').expect(200)).body.state).toBe('guest');
    expect(await balance(ivo)).toBe(i0);
    expect((await pool.query(`SELECT count(*)::int AS n FROM content.txillada_tickets WHERE txillada_id = $1`, [id])).rows[0].n).toBe(0);
    await endAll(host);
  });
});
